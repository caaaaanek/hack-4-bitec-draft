"""Перший запуск: два адміністратори.

Уповноважений (admin) і технічний адміністратор (coordinator) — два облікові записи двох людей. З принципом
двох осіб одна людина нікого не додасть: облікові записи, які створює технічний адміністратор, активує
уповноважений. Тому:

- seed у робочому режимі (SEED_DEMO=false) створює обох з одноразовими запрошеннями (без пароля з env);
- поки активного уповноваженого немає, технічний адміністратор може створити лише його, і цей запис
  активний одразу (більше нікому підтвердити). Будь-який інший обліковий запис — 409 bootstrap_incomplete.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import Role, User


def active_admins(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == Role.ADMIN,
                                                                  User.is_active.is_(True))) or 0


def ensure_ready(db: Session, actor: User, new_role: Role) -> None:
    """409, якщо ще немає уповноваженого, а створюють когось іншого."""
    from app.services import approvals

    if approvals.enabled() and new_role != Role.ADMIN and active_admins(db) == 0:
        raise ApiError(409, "Спершу потрібен уповноважений: він підтверджує нові облікові записи",
                       code="bootstrap_incomplete",
                       hint="Створіть обліковий запис з роллю admin і передайте запрошення уповноваженому.")

