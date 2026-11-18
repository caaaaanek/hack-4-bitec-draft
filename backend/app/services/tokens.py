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

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from app.models import AccessToken, Campaign, QrLink

TOKEN_BYTES = 32
QR_CODE_BYTES = 12
# Скільки форм можна відкрити скануванням на одного очікуваного учасника: решта — це не люди, а скрипт.
QR_OPEN_FACTOR = 3


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


def issue_qr_link(db: Session, campaign: Campaign, questionnaire_id: uuid.UUID, unit_id: uuid.UUID | None,
                  expected: int) -> QrLink:
    link = QrLink(campaign_id=campaign.id, questionnaire_id=questionnaire_id, unit_id=unit_id, expected=expected,
                  code=secrets.token_urlsafe(QR_CODE_BYTES))
    db.add(link)
    return link


def open_by_scan(db: Session, link: QrLink) -> str | None:
    """Свіжий одноразовий токен для того, хто відсканував QR. None — ліміт відкритих форм вичерпано."""
    opened = db.scalar(select(func.count()).select_from(AccessToken).where(AccessToken.qr_link_id == link.id)) or 0
    if opened >= link.expected * QR_OPEN_FACTOR:
        return None
    token = secrets.token_urlsafe(TOKEN_BYTES)
    db.add(AccessToken(campaign_id=link.campaign_id, questionnaire_id=link.questionnaire_id, unit_id=link.unit_id,
                       token_hash=hash_token(token), qr_link_id=link.id))
    return token


def find_qr(db: Session, code: str) -> QrLink | None:
    if not code or len(code) > 64:
        return None
    return db.scalar(select(QrLink).where(QrLink.code == code))


def qr_stats(db: Session, link_id: uuid.UUID) -> tuple[int, int]:
    """(відкрито форм, завершено). Покинуті форми — різниця; ні на кого вони не вказують."""
    rows = db.execute(
        select(func.count(), func.coalesce(func.sum(case((AccessToken.used.is_(True), 1), else_=0)), 0))
        .where(AccessToken.qr_link_id == link_id)
    ).one()
    return int(rows[0]), int(rows[1])


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
           in_scope: Callable[[uuid.UUID | None], bool] = lambda _: True,
           qr_links: Iterable[QrLink] = ()) -> tuple[int, int]:
    """(мали пройти, використано) для анкети в межах області.

    Звичайні посилання: видані й не відкликані. Посилання зі сканування QR у «мали пройти» не йдуть
    (їх відкрито стільки, скільки було сканів): замість них очікувана кількість із самого QR.
    Використані завжди рахуються, тож перевищення очікуваного видно як участь понад 100 %.
    """
    eligible = submitted = 0
    for t in rows:
        if t.questionnaire_id != questionnaire_id or not in_scope(t.unit_id):
            continue
        if t.used:
            submitted += 1
            if t.qr_link_id is None:
                eligible += 1
        elif not t.revoked and t.qr_link_id is None:
            eligible += 1
    for link in qr_links:
        if link.questionnaire_id == questionnaire_id and in_scope(link.unit_id):
            eligible += link.expected
    return eligible, submitted


def load_qr_links(db: Session, campaign_id: uuid.UUID) -> list[QrLink]:
    return list(db.scalars(select(QrLink).where(QrLink.campaign_id == campaign_id)))
