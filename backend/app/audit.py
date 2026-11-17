"""Журнал дій з ланцюжком хешів.

Кожен запис містить seq, prev_hash і hash = sha256(prev_hash + канонічний JSON запису).
Голова ланцюжка (audit_head) блокується на час запису (SELECT ... FOR UPDATE у PostgreSQL),
тож паралельні запити не розгалужують ланцюжок.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditHead, AuditLog, User

GENESIS_HASH = "0" * 64
HEAD_ID = 1


def canonical_time(at: datetime) -> str:
    """Час у UTC з мікросекундами. SQLite повертає час без поясу, вважаємо його UTC."""
    at = at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at.astimezone(timezone.utc)
    return at.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def entry_hash(prev_hash: str, seq: int, at: datetime, actor_id: Any, action: str, entity: str,
               entity_id: str | None, details: dict) -> str:
    body = json.dumps(
        {
            "seq": seq,
            "at": canonical_time(at),
            "actor_id": str(actor_id) if actor_id is not None else None,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "details": details,
        },
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256((prev_hash + body).encode()).hexdigest()


def _head(db: Session) -> AuditHead:
    head = db.get(AuditHead, HEAD_ID, with_for_update=True)
    if head is None:
        head = AuditHead(id=HEAD_ID, seq=0, hash=GENESIS_HASH)
        db.add(head)
        db.flush()
    return head


def log_action(
    db: Session,
    actor: User | None,
    action: str,
    entity: str,
    entity_id: Any = None,
    details: dict | None = None,
) -> None:
    """Додає запис у журнал. Комітить той, хто викликав, разом з основною зміною."""
    # JSON-цикл, щоб хеш рахувався з того самого вигляду, який потім прочитається з БД.
    details = json.loads(json.dumps(details or {}, ensure_ascii=False, default=str))
    entity_id = str(entity_id) if entity_id is not None else None
    actor_id = actor.id if actor else None
    at = datetime.now(timezone.utc)

    head = _head(db)
    seq = head.seq + 1
    digest = entry_hash(head.hash, seq, at, actor_id, action, entity, entity_id, details)
    db.add(
        AuditLog(
            seq=seq,
            prev_hash=head.hash,
            hash=digest,
            at=at,
            actor_id=actor_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            details=details,
        )
    )
    head.seq = seq
    head.hash = digest


def verify_chain(db: Session) -> dict:
    """Перераховує ланцюжок від початку. Повертає перший зламаний запис, якщо є."""
    prev = GENESIS_HASH
    expected_seq = 1
    checked = 0
    for row in db.scalars(select(AuditLog).order_by(AuditLog.seq)):
        problem = None
        if row.seq != expected_seq:
            problem = f"пропущено записи: очікувався №{expected_seq}, знайдено №{row.seq}"
        elif row.prev_hash != prev:
            problem = "prev_hash не збігається з хешем попереднього запису"
        elif row.hash != entry_hash(row.prev_hash, row.seq, row.at, row.actor_id, row.action, row.entity,
                                    row.entity_id, row.details or {}):
            problem = "вміст запису змінено після внесення"
        if problem:
            return {"ok": False, "checked": checked, "broken_seq": row.seq, "reason": problem}
        prev = row.hash
        expected_seq += 1
        checked += 1

    head = db.get(AuditHead, HEAD_ID)
    if head is not None and (head.seq != checked or head.hash != prev):
        return {"ok": False, "checked": checked, "broken_seq": checked + 1,
                "reason": "останні записи видалено: голова ланцюжка не збігається з журналом"}
    return {"ok": True, "checked": checked, "broken_seq": None, "reason": None, "head_hash": prev}
