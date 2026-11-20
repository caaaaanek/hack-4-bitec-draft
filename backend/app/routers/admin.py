"""Адмін-панель: користувачі, ролі, підрозділи, журнал дій."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import exists, func, inspect, select
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.audit import log_action, verify_chain
from app.db import get_db
from app.errors import ApiError
from app.models import (
    AccessToken,
    ApprovalRequest,
    AuditAnchor,
    ResultView,
    AuditLog,
    Campaign,
    CampaignStatus,
    CheckFinding,
    IndexSnapshot,
    Indicator,
    Measure,
    RecommendationDecision,
    RespondentCategory,
    Response as SurveyResponse,
    ResponsePool,
    Role,
    Unit,
    User,
)
from app.schemas import (
    AnchorCheckIn,
    AnchorIn,
    AnchorOut,
    ApprovalDecisionIn,
    ApprovalOut,
    ImportedCredential,
    InviteOut,
    AuditLogOut,
    AuditVerifyOut,
    UnitIn,
    UnitOut,
    UnitUpdate,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.routers.campaigns import IMPORT_MAX_BYTES, LOGIN_CHARS, read_csv, resolve_unit
from app.routers.campaigns import progress as campaign_progress
from app.services import categories
from app.services.eligibility import open_frozen_campaigns_of
from app.services.units import campaigns_covering, subtree_ids
from app.security import campaign_visible, require_people_manager, require_roles, revoke_all_tokens, zone_of
from app.services import approvals, audit_anchor, bootstrap, invites, titles

router = APIRouter(prefix="/admin", tags=["admin"])
# Люди й підрозділи веде лише технічний адміністратор (coordinator). Він не бачить хвиль, результатів і журналу.
managers = require_roles(Role.COORDINATOR)  # користувачі, підрозділи, зведення
audit_readers = require_roles(Role.ADMIN, Role.AUDITOR)


# Людьми керує лише технічний адміністратор (coordinator). Привілейовані ролі він лише просить: видачу,
# зміну, блокування привілейованого запису підтверджує уповноважений (а запис самого уповноваженого — аудит).
# Собі він не змінює нічого, крім імені: інакше видав би собі роль чи завів ще одного техадміна сам.
PRIVILEGED_ROLES = tuple(approvals.PRIVILEGED)


def guard_privileged(actor: User, target_role: Role | None = None, new_role: Role | None = None,
                     target: User | None = None, self_edit_fields: set[str] | None = None) -> None:
    if target is not None and target.id == actor.id and self_edit_fields is not None \
            and not self_edit_fields <= {"display_name"}:
        raise ApiError(403, "Свій обліковий запис можна змінити лише в межах імені", code="self_edit",
                       hint="Роль, підрозділ і блокування власного запису змінює інша людина.")


def check_respondent_fields(role: Role, category, unit_id, db: Session) -> None:
    if role == Role.RESPONDENT and category is None:
        raise HTTPException(status_code=422, detail="Для респондента потрібна категорія")
    if category is not None and not categories.exists(db, category):
        raise ApiError(422, f"Категорії «{category}» немає в довіднику", code="unknown_category",
                       hint="Додайте її в «Довідники» → «Категорії респондентів».")
    if unit_id is not None and db.get(Unit, unit_id) is None:
        raise HTTPException(status_code=422, detail="Підрозділ не знайдено")


# ---------- Користувачі ----------

@router.get("/users", response_model=list[UserOut])
def list_users(
    role: Role | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(managers),
):
    query = select(User).order_by(User.login)
    if role is not None:
        query = query.where(User.role == role)
    return db.scalars(query).all()


def user_out(user: User, **extra) -> UserOut:
    return UserOut.model_validate(user).model_copy(update=extra)


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_people_manager)):
    """Створити обліковий запис (лише технічний адміністратор).

    Пароля тут немає: відповідь містить одноразове запрошення, і людина ставить пароль сама.
    FOUR_EYES_ENABLED=true (за замовчуванням): обліковий запис неактивний, доки його не підтвердить
    уповноважений (POST /admin/approvals/{id}/approve). Так закривається атака «n−1» підставними респондентами.
    """
    if db.scalar(select(User).where(User.login == data.login)):
        raise HTTPException(status_code=409, detail="Такий логін уже існує")
    guard_privileged(admin, new_role=data.role)
    check_respondent_fields(data.role, data.category, data.unit_id, db)
    bootstrap.ensure_ready(db, admin, data.role)
    first_admin = data.role == Role.ADMIN and bootstrap.active_admins(db) == 0  # підтвердити нікому

    user = User(
        login=data.login,
        display_name=data.display_name,
        password_hash=invites.NO_PASSWORD,
        role=data.role,
        category=data.category,
        unit_id=data.unit_id,
        is_active=not approvals.enabled() or first_admin,
    )
    db.add(user)
    db.flush()
    log_action(db, admin, "create", "user", user.id, {"login": user.login, "role": user.role.value, "invite": True})
    token, expires = invites.issue(db, user, admin)
    extra = {"invite_link": invites.link(token), "invite_expires_at": expires}
    if approvals.enabled() and not first_admin:
        req = approvals.request(db, admin, "activate_users", user.id, {"user_ids": [str(user.id)]},
                                f"Новий обліковий запис {user.login} ({titles.role(user.role)}"
                                + (f", {user.category}" if user.category else "") + ")")
        extra["pending_approval_id"] = req.id
    db.commit()
    return user_out(user, **extra)


class UsersImportOut(BaseModel):
    rows: int
    created_users: int
    credentials: list[ImportedCredential]
    pending_approval_id: uuid.UUID | None = None


@router.post("/users/import", response_model=UsersImportOut, status_code=status.HTTP_201_CREATED)
def import_users(file: UploadFile = File(..., description="CSV UTF-8: login,category,unit[,display_name]"),
                 db: Session = Depends(get_db), admin: User = Depends(require_people_manager)):
    """Масово завести респондентів (лише технічний адміністратор). Кожному — одноразове запрошення.

    Усе або нічого: рядок з помилкою (логін зайнятий, немає категорії чи підрозділу) — нічого не змінюється.
    FOUR_EYES_ENABLED: записи неактивні, доки імпорт не підтвердить уповноважений (один запит на файл).
    Привілейовані ролі так не видаються: лише POST /admin/users по одному.
    """
    bootstrap.ensure_ready(db, admin, Role.RESPONDENT)
    rows = read_csv(file.file.read(IMPORT_MAX_BYTES + 1))
    if not rows:
        raise ApiError(422, "У файлі немає рядків", code="empty_file")
    all_units = db.scalars(select(Unit)).all()
    by_name, by_id = {u.name: u for u in all_units}, {str(u.id): u for u in all_units}
    issues, parsed, seen = [], [], set()
    for n, row in enumerate(rows, start=2):
        login = row.get("login") or row.get("pseudonym") or ""
        category = row.get("category") or ""
        unit = resolve_unit(row.get("unit", ""), by_name, by_id) if row.get("unit") else None
        if not (3 <= len(login) <= 64) or not set(login) <= LOGIN_CHARS:
            issues.append({"path": f"line {n}", "message": "login: 3–64 символи, латиниця, цифри, _ . -"})
        elif login.lower() in seen or db.scalar(select(User.id).where(User.login == login)):
            issues.append({"path": f"line {n}", "message": f"{login}: такий логін уже є"})
        elif not category or not categories.exists(db, category):
            issues.append({"path": f"line {n}", "message": f"category «{category}» немає в довіднику категорій"})
        elif row.get("unit") and unit is None:
            issues.append({"path": f"line {n}", "message": f"Підрозділ «{row['unit']}» не знайдено"})
        elif category != RespondentCategory.EXPERT and unit is None:
            issues.append({"path": f"line {n}", "message": f"{login}: потрібен unit"})
        else:
            parsed.append((login, category, unit, (row.get("display_name") or login)[:100]))
        seen.add(login.lower())
    if issues:
        raise ApiError(422, issues, code="import_failed", hint="Виправте рядки й завантажте файл ще раз. Нічого не змінено.")
    four_eyes = approvals.enabled()
    credentials, new_ids = [], []
    for login, category, unit, display_name in parsed:
        user = User(login=login, display_name=display_name, password_hash=invites.NO_PASSWORD, role=Role.RESPONDENT,
                    category=category, unit_id=unit.id if unit else None, is_active=not four_eyes)
        db.add(user)
        db.flush()
        token, _ = invites.issue(db, user, admin)
        credentials.append(ImportedCredential(login=login, invite_link=invites.link(token)))
        new_ids.append(str(user.id))
    pending = None
    if four_eyes:
        pending = approvals.request(db, admin, "activate_users", f"import:{len(new_ids)}:{new_ids[0]}",
                                    {"user_ids": new_ids},
                                    f"Імпорт людей: {len(new_ids)} нових облікових записів")
    log_action(db, admin, "import_users", "user", None, {"rows": len(rows), "created_users": len(new_ids)})
    db.commit()
    return UsersImportOut(rows=len(rows), created_users=len(new_ids), credentials=credentials,
                          pending_approval_id=pending.id if pending else None)


@router.post("/users/{user_id}/invite", response_model=InviteOut, status_code=status.HTTP_201_CREATED,
             responses={202: {"description": "Привілейований запис: створено запит user_invite (pending_approval_id)"}})
def reissue_invite(user_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_people_manager)):
    """Нове запрошення: так скидається пароль (забув, не встиг за строк). Попередні невикористані перестають
    діяти, а всі сесії людини відкликаються: старий пароль більше не дає доступу."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if user.id == admin.id:
        raise ApiError(403, "Собі запрошення видає інша людина", code="self_edit")
    if user.role in PRIVILEGED_ROLES and approvals.enabled():
        # Інакше технічний адміністратор скинув би пароль уповноваженого й зайшов замість нього.
        row = approvals.request(db, admin, "user_invite", user.id, {},
                                f"Скинути пароль і видати нове запрошення: {user.login} ({user.role.value})")
        db.commit()
        return JSONResponse(status_code=202, content={
            "pending_approval_id": str(row.id), "kind": "user_invite",
            "message": "Скидання привілейованого запису підтверджує "
                       + approvals.approvers_text(approvals.approvers_for(db, row))
                       + "; посилання отримає той, хто підтвердить"})
    token, expires = invites.issue(db, user, admin)
    user.password_hash = invites.NO_PASSWORD
    revoke_all_tokens(user)
    log_action(db, admin, "invite", "user", user.id, {"reset": True})
    db.commit()
    return InviteOut(user_id=user.id, invite_link=invites.link(token), invite_token=token, expires_at=expires)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    data: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_people_manager),
):
    """Змінити обліковий запис (лише технічний адміністратор). Пароль тут не змінюється: нове запрошення —
    POST /admin/users/{id}/invite.

    З FOUR_EYES_ENABLED не застосовуються одразу, а йдуть запитом другій людині (pending_approval_id):
    привілейована роль (видача чи зняття), категорія, а для привілейованого запису — ще й блокування і підрозділ.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    changes = data.model_dump(exclude_unset=True)
    for key in ("display_name", "role", "is_active"):
        if key in changes and changes[key] is None:
            raise HTTPException(status_code=422, detail=f"Поле {key} не може бути порожнім")
    guard_privileged(admin, target_role=user.role, new_role=changes.get("role"), target=user,
                     self_edit_fields=set(changes))
    structural = [f for f in ("unit_id", "category", "role") if f in changes and changes[f] != getattr(user, f)]
    if structural:
        busy = open_frozen_campaigns_of(db, user.id)
        if busy:
            # Інакше посеред хвилі зміниться склад груп і знаменник участі (див. docs/abuse-analysis.md).
            raise ApiError(409, "Людина в складі хвилі: " + ", ".join(c.title for c in busy),
                           code="campaign_open",
                           hint="Підрозділ, категорію чи роль можна змінити після закриття хвилі (або приберіть людину "
                                "з чернетки). Заблокувати можна й зараз.")
    # Принцип двох осіб: привілейована роль (видача чи зняття) і категорія — через запит.
    pending = None
    if approvals.enabled():
        deferred = {}
        new_role = changes.get("role")
        if new_role is not None and new_role != user.role and (new_role in approvals.PRIVILEGED
                                                              or user.role in approvals.PRIVILEGED):
            deferred["role"] = new_role.value
        if "category" in changes and changes["category"] != user.category:
            deferred["category"] = changes["category"]
        if user.role in approvals.PRIVILEGED:
            if changes.get("is_active") is False and user.is_active:
                deferred["is_active"] = False
            if "unit_id" in changes and changes["unit_id"] != user.unit_id:
                deferred["unit_id"] = str(changes["unit_id"]) if changes["unit_id"] else None
        if changes.get("is_active") is True and not user.is_active:
            # Активувати неактивний запис (новий, що чекає підтвердження, чи заблокований) сам техадмін не може:
            # інакше обійшов би підтвердження нових облікових записів.
            changes.pop("is_active")
            activation = approvals.request(db, admin, "activate_users", user.id, {"user_ids": [str(user.id)]},
                                           f"Активувати обліковий запис {user.login} ({user.role.value})")
            if not deferred:
                pending = activation
        if deferred:
            kind = "user_category" if set(deferred) == {"category"} else "user_role"
            pending = approvals.request(db, admin, kind, user.id, {"changes": deferred},
                                        f"{user.login}: " + ", ".join(f"{k} → {v}" for k, v in deferred.items()))
            for key in deferred:
                changes.pop(key, None)
    for field, value in changes.items():
        setattr(user, field, value)
    if changes.get("is_active") is False:
        revoke_all_tokens(user)  # сесії заблокованого більше не діють
    check_respondent_fields(user.role, user.category, user.unit_id, db)

    logged = {k: (v.value if hasattr(v, "value") else str(v)) for k, v in changes.items()}
    if pending is not None:
        logged["pending_approval"] = str(pending.id)
    log_action(db, admin, "update", "user", user.id, logged)
    db.commit()
    return user_out(user, pending_approval_id=pending.id if pending else None)


# ---------- Принцип двох осіб ----------

approval_users = require_roles(*approvals.APPROVER_ROLES, Role.COORDINATOR)


@router.get("/approvals", response_model=list[ApprovalOut])
def list_approvals(status_filter: str | None = Query(default="pending", alias="status",
                                                     pattern="^(pending|approved|rejected)$"),
                   db: Session = Depends(get_db), user: User = Depends(approval_users)):
    """Запити принципу двох осіб: ті, що людина може вирішити (за роллю й зоною), і ті, що подала сама.

    can_decide у відповіді: чи може поточний користувач підтвердити чи відхилити запит.
    """
    query = select(ApprovalRequest).order_by(ApprovalRequest.requested_at.desc())
    if status_filter:
        query = query.where(ApprovalRequest.status == status_filter)
    out = []
    for row in db.scalars(query.limit(500)):
        decidable = row.status == "pending" and approvals.can_decide(db, row, user)
        if row.requested_by_id == user.id or approvals.can_decide(db, row, user) or (
                row.status != "pending" and row.decided_by_id == user.id):
            out.append(ApprovalOut.model_validate(row).model_copy(update={
                "can_decide": decidable, "approver_roles": list(approvals.approvers_for(db, row))}))
    return out


def approval_or_404(db: Session, approval_id: uuid.UUID) -> ApprovalRequest:
    row = db.get(ApprovalRequest, approval_id, with_for_update=True)
    if row is None:
        raise HTTPException(status_code=404, detail="Запит не знайдено")
    return row


# Рішення: роль і зону перевіряє approvals.decide (403 same_person / forbidden_role з підказкою, хто підтверджує).
deciders = approval_users


@router.post("/approvals/{approval_id}/approve", response_model=ApprovalOut)
def approve(approval_id: uuid.UUID, data: ApprovalDecisionIn | None = None, db: Session = Depends(get_db),
            user: User = Depends(deciders)):
    """Підтвердити: дія виконується від імені того, хто підтвердив. Підтверджує не той, хто просив,
    роль — за матрицею (approver_roles), підрозділ — у зоні підтверджувача.

    user_invite: відповідь один раз містить invite_link — підтверджувач передає його людині.
    """
    row = approvals.decide(db, approval_or_404(db, approval_id), user, True, (data.comment if data else ""))
    issued = db.info.get("issued_invites", {}).pop(row.id, None)
    db.commit()
    out = ApprovalOut.model_validate(row)
    if issued:
        out = out.model_copy(update={"invite_link": issued[0], "invite_expires_at": issued[1]})
    return out


@router.post("/approvals/{approval_id}/reject", response_model=ApprovalOut)
def reject(approval_id: uuid.UUID, data: ApprovalDecisionIn | None = None, db: Session = Depends(get_db),
           user: User = Depends(deciders)):
    row = approvals.decide(db, approval_or_404(db, approval_id), user, False, (data.comment if data else ""))
    db.commit()
    return row


# ---------- Підрозділи ----------

@router.get("/units", response_model=list[UnitOut])
def list_units(db: Session = Depends(get_db), _: User = Depends(managers)):
    return db.scalars(select(Unit).order_by(Unit.name)).all()


STRUCTURE_RESPONSES = {202: {"description": "Зміна зачіпає чернетку хвилі: створено запит unit_change "
                                             "(pending_approval_id), виконає його підтвердження уповноваженого"}}


def structure_guard(db: Session, actor: User, affected: set[uuid.UUID], payload: dict,
                    summary: str) -> JSONResponse | None:
    """Структура заморожена від створення хвилі до закриття.

    Відкрита хвиля зачеплена — 409. Лише чернетка — з FOUR_EYES_ENABLED запит unit_change (202), без нього 409.
    Нічого не зачеплено — None: змінювати можна одразу.
    """
    if not affected:
        return None
    open_ = campaigns_covering(db, affected, (CampaignStatus.OPEN,))
    if open_:
        raise ApiError(409, "Підрозділ входить у відкриту хвилю: " + ", ".join(c.title for c in open_),
                       code="campaign_open", hint="Змініть структуру після закриття хвилі.")
    drafts = campaigns_covering(db, affected, (CampaignStatus.DRAFT,))
    if not drafts:
        return None
    titles = ", ".join(c.title for c in drafts)
    if not approvals.enabled():
        raise ApiError(409, "Підрозділ входить у чернетку хвилі: " + titles, code="campaign_draft",
                       hint="Склад хвилі зафіксовано з моменту створення. Змініть структуру після закриття хвилі "
                            "або видаліть чернетку.")
    row = approvals.request(db, actor, "unit_change", f"{payload['op']}:{payload.get('unit_id') or payload.get('name')}",
                            payload, f"{summary} (чернетка: {titles})")
    db.commit()
    return JSONResponse(status_code=202, content={"pending_approval_id": str(row.id), "kind": "unit_change",
                                                  "message": "Зміну зачеплено чернеткою хвилі: її підтвердить уповноважений"})


@router.post("/units", response_model=UnitOut, status_code=status.HTTP_201_CREATED, responses=STRUCTURE_RESPONSES)
def create_unit(data: UnitIn, db: Session = Depends(get_db), admin: User = Depends(require_people_manager)):
    """Створити підрозділ. Новий дочірній у підрозділі чернетки хвилі — через запит (202), відкритої — 409."""
    if data.parent_id is not None and db.get(Unit, data.parent_id) is None:
        raise HTTPException(status_code=422, detail="Батьківський підрозділ не знайдено")
    pending = structure_guard(db, admin, {data.parent_id} if data.parent_id else set(),
                              {"op": "create", "name": data.name, "parent_id": str(data.parent_id) if data.parent_id else None},
                              f"Новий підрозділ «{data.name}»")
    if pending is not None:
        return pending
    unit = Unit(name=data.name, parent_id=data.parent_id)
    db.add(unit)
    db.flush()
    log_action(db, admin, "create", "unit", unit.id, {"name": unit.name})
    db.commit()
    return unit


@router.patch("/units/{unit_id}", response_model=UnitOut, responses=STRUCTURE_RESPONSES)
def update_unit(unit_id: uuid.UUID, data: UnitUpdate, db: Session = Depends(get_db),
                admin: User = Depends(require_people_manager)):
    """Перейменувати або перенести підрозділ (parent_id: null — зробити кореневим).

    Переносити не можна в самого себе чи в свій дочірній підрозділ. Структура заморожена від створення хвилі до
    закриття: якщо старе чи нове місце в чернетці хвилі — запит unit_change (202), у відкритій — 409.
    Перейменувати можна завжди. Знімки закритих хвиль не змінюються.
    """
    unit = db.get(Unit, unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Підрозділ не знайдено")
    changes = data.model_dump(exclude_unset=True)
    logged = {}
    if "name" in changes:
        if changes["name"] is None:
            raise HTTPException(status_code=422, detail="Назва не може бути порожньою")
        logged["name"] = {"from": unit.name, "to": changes["name"]}
        unit.name = changes["name"]
    if "parent_id" in changes and changes["parent_id"] != unit.parent_id:
        new_parent = changes["parent_id"]
        moved = subtree_ids(db, unit.id)
        if new_parent is not None:
            if db.get(Unit, new_parent) is None:
                raise HTTPException(status_code=422, detail="Батьківський підрозділ не знайдено")
            if new_parent in moved:
                raise ApiError(422, "Не можна перенести підрозділ у самого себе чи в дочірній", code="unit_cycle")
        affected = moved | ({new_parent} if new_parent else set())
        pending = structure_guard(db, admin, affected,
                                  {"op": "move", "unit_id": str(unit.id),
                                   "parent_id": str(new_parent) if new_parent else None},
                                  f"Перенесення підрозділу «{unit.name}»")
        if pending is not None:
            return pending
        logged["parent_id"] = {"from": str(unit.parent_id) if unit.parent_id else None,
                               "to": str(new_parent) if new_parent else None}
        unit.parent_id = new_parent
    if logged:
        log_action(db, admin, "update", "unit", unit.id, logged)
    db.commit()
    return unit


@router.delete("/units/{unit_id}", status_code=status.HTTP_204_NO_CONTENT, responses=STRUCTURE_RESPONSES)
def delete_unit(unit_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_people_manager)):
    """Видалити підрозділ, лише якщо на нього ніщо не посилається (діти, люди, хвилі, відповіді, факти, заходи)."""
    unit = db.get(Unit, unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Підрозділ не знайдено")
    references = {
        "дочірні підрозділи": Unit.parent_id, "користувачі": User.unit_id, "хвилі": Campaign.unit_id,
        "відповіді": SurveyResponse.unit_id, "буфер відповідей": ResponsePool.unit_id, "факти": Indicator.unit_id,
        "знімки": IndexSnapshot.unit_id, "рішення": RecommendationDecision.unit_id, "заходи": Measure.unit_id,
        "посилання": AccessToken.unit_id,
    }
    used = [name for name, column in references.items() if db.scalar(select(exists().where(column == unit.id)))]
    if used:
        raise ApiError(409, "Підрозділ використовується: " + ", ".join(used), code="unit_in_use",
                       hint="Перейменуйте або перенесіть його замість видалення.")
    pending = structure_guard(db, admin, {unit.id}, {"op": "delete", "unit_id": str(unit.id)},
                              f"Видалення підрозділу «{unit.name}»")
    if pending is not None:
        return pending
    log_action(db, admin, "delete", "unit", unit.id, {"name": unit.name})
    db.delete(unit)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Зведення ----------

@router.get("/overview")
def overview(db: Session = Depends(get_db), user: User = Depends(require_roles(Role.ADMIN, Role.COORDINATOR))):
    """Зведення без персональних даних, групи менші за k приховані.

    Технічний адміністратор бачить лише людей і підрозділи; хвилі й перевірки — уповноважений (своєї зони).
    """
    def counts(column):
        return {getattr(k, "value", k): n for k, n in db.execute(select(column, func.count()).group_by(column)) if k is not None}

    people = {
        "users": {
            "total": db.scalar(select(func.count()).select_from(User)),
            "by_role": counts(User.role), "by_category": counts(User.category),
            "inactive": db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(False))),
        },
        "units": {"total": db.scalar(select(func.count()).select_from(Unit))},
    }
    if user.role == Role.COORDINATOR:
        return {**people, "campaigns": [], "checks": None}
    campaigns = []
    for c in db.scalars(select(Campaign).order_by(Campaign.title)):
        if not campaign_visible(db, user, c):
            continue
        items = campaign_progress(c.id, db, user).items
        campaigns.append({
            "id": c.id, "title": c.title, "status": c.status.value, "unit_id": c.unit_id,
            "progress": [{"questionnaire_title": i.questionnaire_title, "submitted": i.submitted,
                          "eligible": i.eligible, "hidden": i.too_few_people} for i in items],
        })
    checks = {"findings_total": 0, "findings_open": 0}
    if inspect(db.bind).has_table("check_findings"):
        # Уповноважений зі своєю зоною — лише знахідки підрозділів зони, як і в GET /checks/findings.
        query = select(func.count()).select_from(CheckFinding)
        zone = zone_of(db, user)
        if zone is not None:
            query = query.where(CheckFinding.unit_id.in_(zone))
        checks["findings_total"] = db.scalar(query)
        checks["findings_open"] = db.scalar(query.where(CheckFinding.status == "new"))
    return {**people, "campaigns": campaigns, "checks": checks}


# ---------- Журнал дій ----------

@router.get("/audit-log", response_model=list[AuditLogOut])
def audit_log(
    entity: str | None = None,
    action: str | None = None,
    actor_id: uuid.UUID | None = None,
    date_from: datetime | None = Query(default=None, description="Від (включно), ISO 8601"),
    date_to: datetime | None = Query(default=None, description="До (не включно), ISO 8601"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0, le=10_000_000),
    db: Session = Depends(get_db),
    _: User = Depends(audit_readers),
):
    """Журнал дій, найновіші першими. Для сторінок: offset і limit."""
    query = select(AuditLog).order_by(AuditLog.seq.desc())
    if entity:
        query = query.where(AuditLog.entity == entity)
    if action:
        query = query.where(AuditLog.action == action)
    if actor_id:
        query = query.where(AuditLog.actor_id == actor_id)
    if date_from:
        query = query.where(AuditLog.at >= date_from)
    if date_to:
        query = query.where(AuditLog.at < date_to)
    rows = db.scalars(query.offset(offset).limit(limit)).all()
    # Імена й ролі одразу: аудиту список /admin/users недоступний, і журнал показував «Користувач …f2a2».
    ids = {r.actor_id for r in rows if r.actor_id is not None}
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    out = []
    for r in rows:
        item = AuditLogOut.model_validate(r)
        if r.actor_id in people:
            item.actor_name, item.actor_role = people[r.actor_id].display_name, people[r.actor_id].role.value
        out.append(item)
    return out


@router.post("/audit-log/verify", response_model=AuditVerifyOut)
def audit_verify(db: Session = Depends(get_db), user: User = Depends(audit_readers)):
    """Перевірка цілісності журналу: перераховує ланцюжок хешів від першого запису."""
    result = verify_chain(db)
    log_action(db, user, "verify", "audit_log", None, {"ok": result["ok"], "checked": result["checked"]})
    db.commit()
    return result


# ---------- Якір журналу: голова ланцюжка, прийнята аудитом ----------

@router.post("/audit-log/anchor", response_model=AnchorOut, status_code=status.HTTP_201_CREATED)
def accept_anchor(data: AnchorIn | None = None, db: Session = Depends(get_db),
                  user: User = Depends(require_roles(Role.AUDITOR))):
    """Аудитор приймає поточну голову ланцюжка (seq і hash) і зберігає її в себе: друк, окремий носій, лист.

    Перед прийняттям ланцюжок перевіряється. Якщо згодом журнал перепишуть (навіть разом із цією таблицею),
    звірка з копією аудитора (POST /admin/audit-log/verify-anchor) це покаже.
    """
    result = verify_chain(db)
    if not result["ok"]:
        raise ApiError(409, "Журнал уже пошкоджено: " + (result["reason"] or ""), code="chain_broken",
                       hint="Спершу натисніть «Перевірити цілісність» у «Журналі» й з'ясуйте причину пошкодження.")
    anchor = AuditAnchor(seq=result["checked"], hash=result["head_hash"] or "0" * 64, accepted_by_id=user.id,
                         note=(data.note if data else ""))
    db.add(anchor)
    db.flush()
    log_action(db, user, "accept_anchor", "audit_log", None, {"seq": anchor.seq, "hash": anchor.hash})
    db.commit()
    return anchor


@router.post("/audit-log/export-anchor", response_model=AnchorOut, status_code=status.HTTP_201_CREATED)
def export_anchor(db: Session = Depends(get_db), user: User = Depends(require_roles(Role.AUDITOR, Role.ADMIN))):
    """Експортувати голову журналу назовні зараз: файл у AUDIT_ANCHOR_DIR і/або мітка часу RFC 3161.

    Автопілот робить це щодня сам. 409 anchor_disabled — назовнішнє сховище не налаштовано.
    """
    try:
        anchor = audit_anchor.export_head(db, user, reason="manual")
    except audit_anchor.AnchorError as e:
        raise ApiError(409 if e.code in ("anchor_disabled", "chain_broken") else 502, str(e), code=e.code)
    except OSError as e:
        raise ApiError(502, f"Не вдалося записати файл якоря: {e}", code="anchor_write_failed")
    db.commit()
    return anchor


@router.get("/audit-log/anchors", response_model=list[AnchorOut])
def list_anchors(db: Session = Depends(get_db), _: User = Depends(audit_readers)):
    return db.scalars(select(AuditAnchor).order_by(AuditAnchor.accepted_at.desc())).all()


@router.post("/audit-log/verify-anchor")
def verify_anchor(data: AnchorCheckIn, db: Session = Depends(get_db), user: User = Depends(audit_readers)) -> dict:
    """Звірити копію аудитора (seq, hash) з журналом: чи запис №seq має саме цей хеш і чи цілий ланцюжок."""
    chain = verify_chain(db)
    row = db.scalar(select(AuditLog).where(AuditLog.seq == data.seq))
    matches = row is not None and row.hash == data.hash
    ok = matches and chain["ok"]
    reason = None
    if row is None:
        reason = f"Запису №{data.seq} у журналі немає: журнал скорочено або переписано"
    elif not matches:
        reason = f"Запис №{data.seq} має інший хеш: журнал переписано після прийняття якоря"
    elif not chain["ok"]:
        reason = chain["reason"]
    log_action(db, user, "verify_anchor", "audit_log", None, {"seq": data.seq, "ok": ok})
    db.commit()
    return {"ok": ok, "seq": data.seq, "matches": matches, "chain_ok": chain["ok"], "reason": reason}


# ---------- Хто дивився дочірні підрозділи ----------

@router.get("/result-views")
def result_views(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    actor_id: uuid.UUID | None = None,
    role: Role | None = None,
    unit_id: uuid.UUID | None = None,
    campaign_id: uuid.UUID | None = None,
    limit: int = Query(default=200, ge=1, le=2000),
    db: Session = Depends(get_db),
    user: User = Depends(audit_readers),
) -> dict:
    """Звіт для аудиту: хто дивився результати дочірніх підрозділів (не кореня хвилі й не свого підрозділу).

    Захист від колективного покарання: систематичний перегляд чужих підрозділів видно. Перегляди пише
    ensure_unit_access для кожного ендпойнта результатів (дашборд, результати, рекомендації, «Що, якщо», звіти,
    факти, ризики, «Питання перевірки», асистент). Фільтри: період, хто, роль, підрозділ, хвиля.
    """
    query = select(ResultView).order_by(ResultView.at.desc())
    zone = zone_of(db, user)
    if zone is not None:
        # Уповноважений чи аудит зі своєю зоною — лише перегляди підрозділів зони.
        query = query.where(ResultView.unit_id.in_(zone))
    if role:
        query = query.where(ResultView.actor_id.in_(select(User.id).where(User.role == role)))
    if unit_id:
        query = query.where(ResultView.unit_id == unit_id)
    if campaign_id:
        query = query.where(ResultView.campaign_id == campaign_id)
    if date_from:
        query = query.where(ResultView.at >= date_from)
    if date_to:
        query = query.where(ResultView.at < date_to)
    if actor_id:
        query = query.where(ResultView.actor_id == actor_id)
    rows = db.scalars(query.limit(limit)).all()
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r.actor_id for r in rows if r.actor_id})))}
    units = {u.id: u.name for u in db.scalars(select(Unit).where(Unit.id.in_({r.unit_id for r in rows})))}
    by_actor: dict = {}
    for r in rows:
        u = users.get(r.actor_id)
        item = by_actor.setdefault(str(r.actor_id), {"actor_id": str(r.actor_id), "login": u.login if u else None,
                                                    "role": u.role.value if u else None, "views": 0, "units": set()})
        item["views"] += 1
        item["units"].add(units.get(r.unit_id, str(r.unit_id)))
    summary = sorted(({**v, "units": sorted(v["units"])} for v in by_actor.values()), key=lambda x: -x["views"])
    return {
        "total": len(rows),
        "by_actor": summary,
        "items": [{"at": r.at, "actor_id": str(r.actor_id) if r.actor_id else None,
                   "login": users[r.actor_id].login if r.actor_id in users else None,
                   "unit_id": str(r.unit_id), "unit_name": units.get(r.unit_id), "endpoint": r.endpoint,
                   "campaign_id": str(r.campaign_id) if r.campaign_id else None} for r in rows],
    }
