"""Трекер заходів і синхронізація з темою 2 через вихідну чергу (outbox)."""

import json
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.clock import today, utcnow
from app.config import get_settings
from app.models import Measure, MeasureStatus, OutboxMessage
from app.services import methodology as m
from app.services.units import subtree_from, unit_tree

OPEN_STATUSES = (MeasureStatus.PLANNED, MeasureStatus.IN_PROGRESS)
THEME2 = "theme2"
MAX_ATTEMPTS = 20


def overdue_days(measure: Measure, on: date | None = None) -> int | None:
    on = on or today()
    if measure.status in OPEN_STATUSES and measure.due_date < on:
        return (on - measure.due_date).days
    return None


def to_dict(measure: Measure, verification: dict | None = None) -> dict:
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
        "verification": verification,
    }


# ---------- Перевірка наступним оцінюванням ----------

VERIFY_RULE = (
    "Порівнюється бал компонента заходу у знімку підрозділу: хвиля, з якої взято захід, і перша хвиля, "
    "закрита після його виконання. Правило значущості методики: зміна менша за {delta:g} балів в межах похибки, "
    "достовірність C в одній із хвиль означає «перевірити дані». Захід лише один із чинників зміни."
)


def _component(snapshot, code: str) -> tuple[float | None, str | None]:
    for c in (snapshot.payload or {}).get("components", []):
        if c.get("code") == code:
            return c.get("score"), c.get("reliability")
    return None, None


def verify(db: Session, measure: Measure, cache: dict | None = None) -> dict:
    """Чи змінився компонент заходу в наступній хвилі після виконання. Нічого не рахує заново, лише знімки."""
    from app.services.results import unit_snapshots  # уникаємо циклічного імпорту

    rule = VERIFY_RULE.format(delta=m.SIGNIFICANT_DELTA)
    base = {"status": "no_data", "title": "немає даних", "component": measure.component, "previous": None,
            "current": None, "delta": None, "baseline_campaign_id": None, "next_campaign_id": None,
            "next_campaign_title": None, "rule": rule}
    if measure.status != MeasureStatus.DONE or measure.done_on is None:
        return {**base, "status": "not_done", "title": "перевіримо після виконання"}
    if measure.component not in m.COMPONENTS:
        return {**base, "title": "захід не прив'язаний до компонента"}
    cache = cache if cache is not None else {}
    if measure.unit_id not in cache:
        cache[measure.unit_id] = unit_snapshots(db, measure.unit_id)
    history = cache[measure.unit_id]

    baseline = None
    if measure.campaign_id is not None:
        baseline = next(((c, s) for c, s in history if c.id == measure.campaign_id), None)
    if baseline is None:  # захід без хвилі: остання хвиля, закрита до його створення
        created = measure.created_at.date()
        earlier = [(c, s) for c, s in history if s.closed_on <= created]
        baseline = earlier[-1] if earlier else None
    if baseline is None:
        return {**base, "title": "немає знімка хвилі, з якої взято захід"}

    after = next(((c, s) for c, s in history if s.closed_on >= measure.done_on and s.closed_on > baseline[1].closed_on), None)
    if after is None:
        return {**base, "status": "awaiting_wave", "title": "чекає наступної хвилі", "baseline_campaign_id": baseline[0].id}

    prev, prev_rel = _component(baseline[1], measure.component)
    cur, cur_rel = _component(after[1], measure.component)
    d = None if prev is None or cur is None else round(cur - prev, 1)
    sig = m.significance(d, [prev_rel, cur_rel])
    return {**base, "status": sig["code"], "title": sig["title"], "previous": prev, "current": cur, "delta": d,
            "baseline_campaign_id": baseline[0].id, "next_campaign_id": after[0].id, "next_campaign_title": after[0].title}


def to_dicts(db: Session, measures: list[Measure]) -> list[dict]:
    """Заходи з перевіркою наступним оцінюванням (знімки підрозділу читаються один раз)."""
    cache: dict = {}
    return [to_dict(x, verify(db, x, cache)) for x in measures]


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
    return db.scalar(select(func.count()).select_from(OutboxMessage)
                     .where(OutboxMessage.target == THEME2, OutboxMessage.sent_at.is_(None))) or 0
