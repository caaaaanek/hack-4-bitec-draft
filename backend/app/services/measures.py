"""Трекер заходів і синхронізація з темою 2 через вихідну чергу (outbox)."""

import json
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import today, utcnow
from app.config import get_settings
from app.models import Measure, MeasureStatus, OutboxMessage
from app.services.units import subtree_from, unit_tree

OPEN_STATUSES = (MeasureStatus.PLANNED, MeasureStatus.IN_PROGRESS)
THEME2 = "theme2"
MAX_ATTEMPTS = 20


def overdue_days(measure: Measure, on: date | None = None) -> int | None:
    on = on or today()
    if measure.status in OPEN_STATUSES and measure.due_date < on:
        return (on - measure.due_date).days
    return None


def to_dict(measure: Measure) -> dict:
    days = overdue_days(measure)
    return {
        "id": measure.id,
        "unit_id": measure.unit_id,
        "campaign_id": measure.campaign_id,
        "recommendation_code": measure.recommendation_code,
        "component": measure.component,
        "catalog_number": measure.catalog_number,
        "title": measure.title,
        "description": measure.description,
        "owner": measure.owner,
        "due_date": measure.due_date,
        "status": measure.status,
        "done_on": measure.done_on,
        "evidence": measure.evidence,
        "overdue": days is not None,
        "overdue_days": days,
        "external_id": measure.external_id,
        "external_source": measure.external_source,
        "created_at": measure.created_at,
        "updated_at": measure.updated_at,
    }


def stats(db: Session, unit_id: uuid.UUID) -> dict:
    """Скільки заходів у підрозділі (з дочірніми) за статусами і скільки прострочено."""
    children, _ = unit_tree(db)
    units = subtree_from(children, unit_id)
    rows = db.scalars(select(Measure).where(Measure.unit_id.in_(units))).all()
    by_status = {s.value: 0 for s in MeasureStatus}
    for r in rows:
        by_status[r.status.value] += 1
    return {"total": len(rows), "by_status": by_status, "overdue": sum(1 for r in rows if overdue_days(r) is not None)}


# ---------- Тема 2: вихідна черга ----------

def theme2_payload(measure: Measure) -> dict:
    """Лише те, що потрібно трекеру колег. Без імен: відповідальний — посада."""
    return {
        "id": str(measure.id),
        "unit_id": str(measure.unit_id),
        "title": measure.title,
        "description": measure.description,
        "component": measure.component,
        "catalog_number": measure.catalog_number,
        "owner": measure.owner,
        "due_date": measure.due_date.isoformat(),
        "status": measure.status.value,
        "done_on": measure.done_on.isoformat() if measure.done_on else None,
        "source": "integrity-dashboard",
    }


def enqueue_measure(db: Session, measure: Measure) -> bool:
    """Ставить захід у чергу для теми 2, якщо інтеграцію ввімкнено."""
    if not get_settings().theme2_url:
        return False
    db.add(OutboxMessage(target=THEME2, topic="measure.upsert", payload=theme2_payload(measure)))
    return True


Sender = Callable[[str, dict], dict]


def http_sender(topic: str, payload: dict) -> dict:
    """POST {THEME2_URL}/measures. Відповідь може містити id заходу в їхній системі."""
    settings = get_settings()
    request = urllib.request.Request(
        settings.theme2_url.rstrip("/") + "/measures",
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "X-Integration-Key": settings.theme2_api_key, "X-Topic": topic},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=settings.theme2_timeout_seconds) as response:  # noqa: S310 (адреса з конфігу)
        body = response.read()
    return json.loads(body) if body else {}


def send_pending(db: Session, sender: Sender | None = None, limit: int = 100) -> dict:
    """Надсилає повідомлення з черги. Помилка одного не зупиняє решту; невдалі повторяться пізніше."""
    sender = sender or http_sender
    sent, failed = 0, 0
    pending = db.scalars(
        select(OutboxMessage)
        .where(OutboxMessage.target == THEME2, OutboxMessage.sent_at.is_(None), OutboxMessage.attempts < MAX_ATTEMPTS)
        .order_by(OutboxMessage.created_at)
        .limit(limit)
    ).all()
    for message in pending:
        message.attempts += 1
        try:
            answer = sender(message.topic, message.payload) or {}
        except (urllib.error.URLError, OSError, ValueError) as e:
            message.last_error = str(e)[:500]
            failed += 1
            continue
        message.sent_at = utcnow()
        message.last_error = ""
        sent += 1
        external_id = answer.get("id") if isinstance(answer, dict) else None
        if external_id:
            measure = db.get(Measure, uuid.UUID(message.payload["id"]))
            if measure is not None and not measure.external_id:
                measure.external_id = str(external_id)
                measure.external_source = THEME2
    db.commit()
    return {"sent": sent, "failed": failed, "pending": pending_count(db)}


def pending_count(db: Session) -> int:
    return len(db.scalars(select(OutboxMessage.id).where(OutboxMessage.target == THEME2, OutboxMessage.sent_at.is_(None))).all())
