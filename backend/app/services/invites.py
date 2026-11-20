"""Одноразові запрошення: людина сама ставить пароль, адміністратор паролів не знає і не зайде замість неї.

Токен показується один раз (у відповіді адміністратору, щоб передати людині); у БД лише sha256.
Нове запрошення анулює попередні невикористані. Пароль змінюється лише в момент використання.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User, UserInvite

# Хеш, якого не дасть жоден пароль: обліковий запис без пароля, доки людина не скористається запрошенням.
NO_PASSWORD = "!invite-pending"


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def link(token: str) -> str:
    return f"{get_settings().public_url.rstrip('/')}/invite/{token}"


def issue(db: Session, user: User, actor: User | None) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    db.execute(update(UserInvite).where(UserInvite.user_id == user.id, UserInvite.used_at.is_(None))
               .values(expires_at=now))
    token = secrets.token_urlsafe(32)
    expires = now + timedelta(hours=get_settings().invite_ttl_hours)
    db.add(UserInvite(user_id=user.id, token_hash=digest(token), expires_at=expires,
                      created_by_id=actor.id if actor else None))
    return token, expires


def find_valid(db: Session, token: str) -> UserInvite | None:
    row = db.scalar(select(UserInvite).where(UserInvite.token_hash == digest(token or "")))
    if row is None or row.used_at is not None:
        return None
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    return row if expires > datetime.now(timezone.utc) else None
