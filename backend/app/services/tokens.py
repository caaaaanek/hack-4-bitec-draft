"""Одноразові посилання для анонімного проходження.

Токен — 32 випадкові байти (secrets.token_urlsafe), у БД лише його sha256. Підібрати чи
відновити токен із БД неможливо, а сам токен не пов'язаний ні з людиною, ні з відповіддю.

Хто кому роздав посилання, система не знає і не зберігає. Навіть якщо адміністратор
веде такий список поза системою, з БД видно лише «посилання використано», а відповідь
лежить окремо, без посилання, і переноситься в Response перемішаною пачкою ≥ k.
"""

import hashlib
import secrets
import uuid
from collections.abc import Callable, Iterable

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import AccessToken, Campaign

TOKEN_BYTES = 32


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue(db: Session, campaign: Campaign, questionnaire_id: uuid.UUID, unit_id: uuid.UUID | None,
          count: int) -> list[str]:
    tokens = [secrets.token_urlsafe(TOKEN_BYTES) for _ in range(count)]
    db.add_all(
        AccessToken(campaign_id=campaign.id, questionnaire_id=questionnaire_id, unit_id=unit_id,
                    token_hash=hash_token(t))
        for t in tokens
    )
    return tokens


def find(db: Session, token: str) -> AccessToken | None:
    if not token or len(token) > 128:
        return None
    return db.scalar(select(AccessToken).where(AccessToken.token_hash == hash_token(token)))


def consume(db: Session, token_row: AccessToken) -> bool:
    """Позначає посилання використаним. Атомарно: з двох паралельних подань пройде одне."""
    result = db.execute(
        update(AccessToken)
        .where(AccessToken.id == token_row.id, AccessToken.used.is_(False), AccessToken.revoked.is_(False))
        .values(used=True)
    )
    return result.rowcount == 1


def revoke_unused(db: Session, campaign_id: uuid.UUID, questionnaire_id: uuid.UUID, unit_id: uuid.UUID | None) -> int:
    query = update(AccessToken).where(
        AccessToken.campaign_id == campaign_id,
        AccessToken.questionnaire_id == questionnaire_id,
        AccessToken.used.is_(False),
        AccessToken.revoked.is_(False),
    )
    query = query.where(AccessToken.unit_id.is_(None) if unit_id is None else AccessToken.unit_id == unit_id)
    return db.execute(query.values(revoked=True)).rowcount


def revoke_unused_all_units(db: Session, campaign_id: uuid.UUID, questionnaire_id: uuid.UUID) -> int:
    return db.execute(
        update(AccessToken).where(
            AccessToken.campaign_id == campaign_id,
            AccessToken.questionnaire_id == questionnaire_id,
            AccessToken.used.is_(False),
            AccessToken.revoked.is_(False),
        ).values(revoked=True)
    ).rowcount


def load(db: Session, campaign_id: uuid.UUID) -> list[AccessToken]:
    return list(db.scalars(select(AccessToken).where(AccessToken.campaign_id == campaign_id)))


def counts(rows: Iterable[AccessToken], questionnaire_id: uuid.UUID,
           in_scope: Callable[[uuid.UUID | None], bool] = lambda _: True) -> tuple[int, int]:
    """(видано й не відкликано, використано) для анкети в межах області."""
    eligible = submitted = 0
    for t in rows:
        if t.questionnaire_id != questionnaire_id or not in_scope(t.unit_id):
            continue
        if t.used:
            submitted += 1
            eligible += 1
        elif not t.revoked:
            eligible += 1
    return eligible, submitted
