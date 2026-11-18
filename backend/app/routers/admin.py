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
from app.services.eligibility import open_frozen_campaigns_of
from app.services.units import subtree_from, subtree_ids, unit_tree
from app.security import hash_password, require_roles, revoke_all_tokens

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


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, db: Session = Depends(get_db), admin: User = Depends(managers)):
    if db.scalar(select(User).where(User.login == data.login)):
        raise HTTPException(status_code=409, detail="Такий логін уже існує")
    guard_privileged(admin, new_role=data.role)
    check_respondent_fields(data.role, data.category, data.unit_id, db)

    user = User(
        login=data.login,
        display_name=data.display_name,
        password_hash=hash_password(data.password),
        role=data.role,
        category=data.category,
        unit_id=data.unit_id,
    )
    db.add(user)
    db.flush()
    log_action(db, admin, "create", "user", user.id, {"login": user.login, "role": user.role.value})
    db.commit()
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    data: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(managers),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if user.id == admin.id and (data.role not in (None, admin.role) or data.is_active is False):
        raise HTTPException(status_code=422, detail="Не можна зняти роль адміна чи заблокувати самого себе")

    changes = data.model_dump(exclude_unset=True)
    guard_privileged(admin, target_role=user.role, new_role=changes.get("role"), target=user,
                     self_edit_fields=set(changes))
    structural = [f for f in ("unit_id", "category", "role") if f in changes and changes[f] != getattr(user, f)]
    if structural:
        busy = open_frozen_campaigns_of(db, user.id)
        if busy:
            # Інакше посеред хвилі зміниться склад груп і знаменник участі (див. docs/abuse-analysis.md).
            raise ApiError(409, "Людина в складі відкритої хвилі: " + ", ".join(c.title for c in busy),
                           code="campaign_open",
                           hint="Підрозділ, категорію чи роль можна змінити після закриття хвилі. Заблокувати можна й зараз.")
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
    log_action(db, admin, "update", "user", user.id, logged)
    db.commit()
    return user


# ---------- Підрозділи ----------

@router.get("/units", response_model=list[UnitOut])
def list_units(db: Session = Depends(get_db), _: User = Depends(managers)):
    return db.scalars(select(Unit).order_by(Unit.name)).all()


@router.post("/units", response_model=UnitOut, status_code=status.HTTP_201_CREATED)
def create_unit(data: UnitIn, db: Session = Depends(get_db), admin: User = Depends(managers)):
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
def update_unit(unit_id: uuid.UUID, data: UnitUpdate, db: Session = Depends(get_db), admin: User = Depends(managers)):
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
def delete_unit(unit_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(managers)):
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
