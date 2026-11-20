"""Адмін-панель: користувачі, ролі, підрозділи, журнал дій."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import exists, func, inspect, select, text
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
    IndexSnapshot,
    Indicator,
    Measure,
    RecommendationDecision,
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
from app.routers.campaigns import progress as campaign_progress
from app.services import categories
from app.services.eligibility import open_frozen_campaigns_of
from app.services.units import subtree_from, subtree_ids, unit_tree
from app.config import get_settings
from app.security import hash_password, require_people_manager, require_roles, revoke_all_tokens
from app.services import approvals, audit_anchor, invites

router = APIRouter(prefix="/admin", tags=["admin"])
managers = require_roles(Role.ADMIN, Role.COORDINATOR)  # користувачі, підрозділи, зведення
audit_readers = require_roles(Role.ADMIN, Role.COORDINATOR, Role.AUDITOR)


# Адміністратора й координатора створює, змінює і призначає лише адміністратор. Інакше координатор
# видав би собі чи іншому роль admin або скинув би пароль адміна (ескалація прав).
PRIVILEGED_ROLES = (Role.ADMIN, Role.COORDINATOR)


def guard_privileged(actor: User, target_role: Role | None = None, new_role: Role | None = None,
                     target: User | None = None, self_edit_fields: set[str] | None = None) -> None:
    if actor.role == Role.ADMIN:
        return
    if new_role in PRIVILEGED_ROLES:
        raise ApiError(403, "Роль адміністратора чи координатора призначає лише адміністратор", code="forbidden_role")
    if target_role in PRIVILEGED_ROLES:
        # Себе координатор може змінити лише в межах імені й пароля.
        if target is not None and target.id == actor.id and self_edit_fields is not None \
                and self_edit_fields <= {"display_name", "password"}:
            return
        raise ApiError(403, "Обліковий запис адміністратора чи координатора змінює лише адміністратор",
                       code="forbidden_role")


def check_respondent_fields(role: Role, category, unit_id, db: Session) -> None:
    if role == Role.RESPONDENT and category is None:
        raise HTTPException(status_code=422, detail="Для респондента потрібна категорія")
    if category is not None and not categories.exists(db, category):
        raise ApiError(422, f"Категорії «{category}» немає в довіднику", code="unknown_category",
                       hint="Додайте її: POST /dictionaries/categories.")
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
    """Створити обліковий запис.

    - Без пароля (рекомендовано): відповідь містить одноразове запрошення, і людина ставить пароль сама.
      ADMIN_SETS_PASSWORDS=false дозволяє лише так.
    - FOUR_EYES_ENABLED=true: обліковий запис створюється неактивним, доки його не підтвердить друга
      людина (POST /admin/approvals/{id}/approve). Так закривається атака «n−1» підставними респондентами.
    """
    if db.scalar(select(User).where(User.login == data.login)):
        raise HTTPException(status_code=409, detail="Такий логін уже існує")
    guard_privileged(admin, new_role=data.role)
    check_respondent_fields(data.role, data.category, data.unit_id, db)
    settings = get_settings()
    if data.password and not settings.admin_sets_passwords:
        raise ApiError(422, "Пароль задає сама людина за запрошенням", code="password_by_invite",
                       hint="Створіть обліковий запис без пароля: відповідь міститиме посилання-запрошення.")

    user = User(
        login=data.login,
        display_name=data.display_name,
        password_hash=hash_password(data.password) if data.password else invites.NO_PASSWORD,
        role=data.role,
        category=data.category,
        unit_id=data.unit_id,
        is_active=not approvals.enabled(),
    )
    db.add(user)
    db.flush()
    log_action(db, admin, "create", "user", user.id, {"login": user.login, "role": user.role.value,
                                                      "invite": not data.password})
    extra = {}
    if not data.password:
        token, expires = invites.issue(db, user, admin)
        extra.update(invite_link=invites.link(token), invite_expires_at=expires)
    if approvals.enabled():
        req = approvals.request(db, admin, "activate_users", user.id, {"user_ids": [str(user.id)]},
                                f"Новий обліковий запис {user.login} ({user.role.value}"
                                + (f", {user.category}" if user.category else "") + ")")
        extra["pending_approval_id"] = req.id
    db.commit()
    return user_out(user, **extra)


@router.post("/users/{user_id}/invite", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
def reissue_invite(user_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_people_manager)):
    """Нове запрошення (забув пароль, не встиг за строк). Попередні невикористані перестають діяти.
    Поточний пароль діє, доки людина не поставить новий за запрошенням."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    guard_privileged(admin, target_role=user.role, target=user, self_edit_fields=set())
    token, expires = invites.issue(db, user, admin)
    log_action(db, admin, "invite", "user", user.id, {})
    db.commit()
    return InviteOut(user_id=user.id, invite_link=invites.link(token), invite_token=token, expires_at=expires)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    data: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_people_manager),
):
    """Змінити обліковий запис. З FOUR_EYES_ENABLED привілейована роль і зміна категорії не застосовуються
    одразу: створюється запит, який підтверджує друга людина (pending_approval_id у відповіді)."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if user.id == admin.id and (data.role not in (None, admin.role) or data.is_active is False):
        raise HTTPException(status_code=422, detail="Не можна зняти роль адміна чи заблокувати самого себе")

    changes = data.model_dump(exclude_unset=True)
    guard_privileged(admin, target_role=user.role, new_role=changes.get("role"), target=user,
                     self_edit_fields=set(changes))
    if changes.get("password") and not get_settings().admin_sets_passwords and user.id != admin.id:
        raise ApiError(422, "Пароль задає сама людина за запрошенням", code="password_by_invite",
                       hint="POST /admin/users/{id}/invite — нове запрошення.")
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
        if deferred:
            kind = "user_role" if "role" in deferred else "user_category"
            pending = approvals.request(db, admin, kind, user.id, {"changes": deferred},
                                        f"{user.login}: " + ", ".join(f"{k} → {v}" for k, v in deferred.items()))
            for key in deferred:
                changes.pop(key, None)
    password = changes.pop("password", None)
    for field, value in changes.items():
        setattr(user, field, value)
    if password:
        user.password_hash = hash_password(password)
    if password or changes.get("is_active") is False:
        revoke_all_tokens(user)  # старі сесії з попереднім паролем чи після блокування більше не діють
    check_respondent_fields(user.role, user.category, user.unit_id, db)

    logged = {k: (v.value if hasattr(v, "value") else str(v)) for k, v in changes.items()}
    if password:
        logged["password"] = "changed"
    if pending is not None:
        logged["pending_approval"] = str(pending.id)
    log_action(db, admin, "update", "user", user.id, logged)
    db.commit()
    return user_out(user, pending_approval_id=pending.id if pending else None)


# ---------- Принцип двох осіб ----------

@router.get("/approvals", response_model=list[ApprovalOut])
def list_approvals(status_filter: str | None = Query(default="pending", alias="status",
                                                     pattern="^(pending|approved|rejected)$"),
                   db: Session = Depends(get_db),
                   _: User = Depends(require_roles(Role.ADMIN, Role.COORDINATOR, Role.COMMISSIONER, Role.AUDITOR))):
    """Запити на підтвердження другою людиною (FOUR_EYES_ENABLED)."""
    query = select(ApprovalRequest).order_by(ApprovalRequest.requested_at.desc())
    if status_filter:
        query = query.where(ApprovalRequest.status == status_filter)
    return db.scalars(query.limit(500)).all()


def approval_or_404(db: Session, approval_id: uuid.UUID) -> ApprovalRequest:
    row = db.get(ApprovalRequest, approval_id, with_for_update=True)
    if row is None:
        raise HTTPException(status_code=404, detail="Запит не знайдено")
    return row


@router.post("/approvals/{approval_id}/approve", response_model=ApprovalOut)
def approve(approval_id: uuid.UUID, data: ApprovalDecisionIn | None = None, db: Session = Depends(get_db),
            user: User = Depends(require_roles(Role.ADMIN, Role.COORDINATOR, Role.COMMISSIONER, Role.AUDITOR))):
    """Підтвердити: дія виконується від імені того, хто підтвердив. Підтверджує не той, хто просив."""
    row = approvals.decide(db, approval_or_404(db, approval_id), user, True, (data.comment if data else ""))
    db.commit()
    return row


@router.post("/approvals/{approval_id}/reject", response_model=ApprovalOut)
def reject(approval_id: uuid.UUID, data: ApprovalDecisionIn | None = None, db: Session = Depends(get_db),
           user: User = Depends(require_roles(Role.ADMIN, Role.COORDINATOR, Role.COMMISSIONER, Role.AUDITOR))):
    row = approvals.decide(db, approval_or_404(db, approval_id), user, False, (data.comment if data else ""))
    db.commit()
    return row


# ---------- Підрозділи ----------

@router.get("/units", response_model=list[UnitOut])
def list_units(db: Session = Depends(get_db), _: User = Depends(managers)):
    return db.scalars(select(Unit).order_by(Unit.name)).all()


@router.post("/units", response_model=UnitOut, status_code=status.HTTP_201_CREATED)
def create_unit(data: UnitIn, db: Session = Depends(get_db), admin: User = Depends(require_people_manager)):
    if data.parent_id is not None and db.get(Unit, data.parent_id) is None:
        raise HTTPException(status_code=422, detail="Батьківський підрозділ не знайдено")
    unit = Unit(name=data.name, parent_id=data.parent_id)
    db.add(unit)
    db.flush()
    log_action(db, admin, "create", "unit", unit.id, {"name": unit.name})
    db.commit()
    return unit


def open_campaigns_covering(db: Session, unit_ids: set[uuid.UUID]) -> list[Campaign]:
    children, _ = unit_tree(db)
    result = []
    for campaign in db.scalars(select(Campaign).where(Campaign.status == CampaignStatus.OPEN)):
        if subtree_from(children, campaign.unit_id) & unit_ids:
            result.append(campaign)
    return result


@router.patch("/units/{unit_id}", response_model=UnitOut)
def update_unit(unit_id: uuid.UUID, data: UnitUpdate, db: Session = Depends(get_db),
                admin: User = Depends(require_people_manager)):
    """Перейменувати або перенести підрозділ (parent_id: null — зробити кореневим).

    Переносити не можна в самого себе чи в свій дочірній підрозділ, а також поки відкрита хвиля,
    що охоплює старе чи нове місце: інакше зміниться склад груп посеред збору відповідей.
    Знімки закритих хвиль не змінюються.
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
        busy = open_campaigns_covering(db, affected)
        if busy:
            raise ApiError(409, "Підрозділ входить у відкриту хвилю: " + ", ".join(c.title for c in busy),
                           code="campaign_open", hint="Перенесіть підрозділ після закриття хвилі.")
        logged["parent_id"] = {"from": str(unit.parent_id) if unit.parent_id else None,
                               "to": str(new_parent) if new_parent else None}
        unit.parent_id = new_parent
    if logged:
        log_action(db, admin, "update", "unit", unit.id, logged)
    db.commit()
    return unit


@router.delete("/units/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
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
    log_action(db, admin, "delete", "unit", unit.id, {"name": unit.name})
    db.delete(unit)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Зведення ----------

@router.get("/overview")
def overview(db: Session = Depends(get_db), _: User = Depends(managers)):
    """Зведення для координатора: без персональних даних, групи менші за k приховані."""
    def counts(column):
        return {getattr(k, "value", k): n for k, n in db.execute(select(column, func.count()).group_by(column)) if k is not None}

    campaigns = []
    for c in db.scalars(select(Campaign).order_by(Campaign.title)):
        items = campaign_progress(c.id, db, _).items
        campaigns.append({
            "id": c.id, "title": c.title, "status": c.status.value, "unit_id": c.unit_id,
            "progress": [{"questionnaire_title": i.questionnaire_title, "submitted": i.submitted,
                          "eligible": i.eligible, "hidden": i.too_few_people} for i in items],
        })
    checks = {"findings_total": 0, "findings_open": 0}
    if inspect(db.bind).has_table("check_findings"):
        checks["findings_total"] = db.scalar(text("select count(*) from check_findings"))
        checks["findings_open"] = db.scalar(text("select count(*) from check_findings where status = 'new'"))
    return {
        "users": {
            "total": db.scalar(select(func.count()).select_from(User)),
            "by_role": counts(User.role), "by_category": counts(User.category),
            "inactive": db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(False))),
        },
        "units": {"total": db.scalar(select(func.count()).select_from(Unit))},
        "campaigns": campaigns,
        "checks": checks,
    }


# ---------- Журнал дій ----------

@router.get("/audit-log", response_model=list[AuditLogOut])
def audit_log(
    entity: str | None = None,
    action: str | None = None,
    actor_id: uuid.UUID | None = None,
    date_from: datetime | None = Query(default=None, description="Від (включно), ISO 8601"),
    date_to: datetime | None = Query(default=None, description="До (не включно), ISO 8601"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
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
    return db.scalars(query.offset(offset).limit(limit)).all()


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
                       hint="Спершу розберіться з пошкодженням (POST /admin/audit-log/verify).")
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
    _: User = Depends(audit_readers),
) -> dict:
    """Звіт для аудиту: хто дивився результати дочірніх підрозділів (не кореня хвилі й не свого підрозділу).

    Захист від колективного покарання: систематичний перегляд чужих підрозділів видно. Перегляди пише
    ensure_unit_access для кожного ендпойнта результатів (дашборд, результати, рекомендації, «Що, якщо», звіти,
    факти, ризики, «Питання перевірки», асистент). Фільтри: період, хто, роль, підрозділ, хвиля.
    """
    query = select(ResultView).order_by(ResultView.at.desc())
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
