"""Адмін-панель: користувачі, ролі, підрозділи, журнал дій."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action, verify_chain
from app.db import get_db
from app.models import AuditLog, Role, Unit, User
from app.schemas import AuditLogOut, AuditVerifyOut, UnitIn, UnitOut, UserCreate, UserOut, UserUpdate
from app.security import hash_password, require_roles

router = APIRouter(prefix="/admin", tags=["admin"])
admin_only = require_roles(Role.ADMIN)
audit_readers = require_roles(Role.ADMIN, Role.AUDITOR)


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
    _: User = Depends(admin_only),
):
    query = select(User).order_by(User.login)
    if role is not None:
        query = query.where(User.role == role)
    return db.scalars(query).all()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    if db.scalar(select(User).where(User.login == data.login)):
        raise HTTPException(status_code=409, detail="Такий логін уже існує")
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
    admin: User = Depends(admin_only),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if user.id == admin.id and (data.role not in (None, Role.ADMIN) or data.is_active is False):
        raise HTTPException(status_code=422, detail="Не можна зняти роль адміна чи заблокувати самого себе")

    changes = data.model_dump(exclude_unset=True)
    password = changes.pop("password", None)
    for field, value in changes.items():
        setattr(user, field, value)
    if password:
        user.password_hash = hash_password(password)
    check_respondent_fields(user.role, user.category, user.unit_id, db)

    logged = {k: (v.value if hasattr(v, "value") else str(v)) for k, v in changes.items()}
    if password:
        logged["password"] = "changed"
    log_action(db, admin, "update", "user", user.id, logged)
    db.commit()
    return user


# ---------- Підрозділи ----------

@router.get("/units", response_model=list[UnitOut])
def list_units(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    return db.scalars(select(Unit).order_by(Unit.name)).all()


@router.post("/units", response_model=UnitOut, status_code=status.HTTP_201_CREATED)
def create_unit(data: UnitIn, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    if data.parent_id is not None and db.get(Unit, data.parent_id) is None:
        raise HTTPException(status_code=422, detail="Батьківський підрозділ не знайдено")
    unit = Unit(name=data.name, parent_id=data.parent_id)
    db.add(unit)
    db.flush()
    log_action(db, admin, "create", "unit", unit.id, {"name": unit.name})
    db.commit()
    return unit


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
