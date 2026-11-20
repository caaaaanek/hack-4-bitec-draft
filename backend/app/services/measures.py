"""Трекер заходів і синхронізація з темою 2 через вихідну чергу (outbox)."""

import json
import logging
import re
import threading
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.clock import today, utcnow
from app.config import get_settings
from app.models import AuditLog, Campaign, Measure, MeasureStatus, OutboxMessage, Unit, User
from app.services import methodology as m
from app.services import titles
from app.services.units import subtree_from, unit_tree

OPEN_STATUSES = (MeasureStatus.PLANNED, MeasureStatus.IN_PROGRESS)
THEME2 = "theme2"
MAX_ATTEMPTS = 20
log = logging.getLogger(__name__)


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
        "external": external_view(measure),
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
    """Заходи з перевіркою наступним оцінюванням (знімки підрозділу читаються один раз) і назвою хвилі:
    у трекері заходи різних хвиль з однаковою назвою інакше не розрізнити."""
    cache: dict = {}
    ids = {x.campaign_id for x in measures if x.campaign_id is not None}
    names = dict(db.execute(select(Campaign.id, Campaign.title).where(Campaign.id.in_(ids))).all()) if ids else {}
    return [{**to_dict(x, verify(db, x, cache)), "campaign_title": names.get(x.campaign_id)} for x in measures]


HISTORY_ACTIONS = {"create": "Створено", "update": "Змінено", "external_status": "Оновлення з теми 2"}


def history(db: Session, measure: Measure) -> list[dict]:
    """Історія заходу з журналу дій (найстаріші першими): хто, коли, статус «було → стало», причина, доказ.

    Раніше картка заходу брала історію з локального демо-журналу і писала «змін не було» після реальних змін.
    """
    rows = db.scalars(select(AuditLog).where(AuditLog.entity == "measure", AuditLog.entity_id == str(measure.id))
                      .order_by(AuditLog.seq)).all()
    actor_ids = {r.actor_id for r in rows if r.actor_id is not None}
    people = dict(db.execute(select(User.id, User.display_name).where(User.id.in_(actor_ids))).all()) if actor_ids else {}
    out = []
    for r in rows:
        d = r.details or {}
        status, before = d.get("status"), d.get("from_status")
        parts = []
        if r.action == "create":
            parts.append("Захід створено")
        if status and before and status != before:
            parts.append(f"Статус: {titles.measure_status(before)} → {titles.measure_status(status)}")
        elif status and r.action != "create":
            parts.append(f"Статус: {titles.measure_status(status)}")
        for field, label in (("owner", "Відповідальний"), ("due_date", "Строк"), ("done_on", "Виконано")):
            if d.get(field) and r.action != "create":
                parts.append(f"{label}: {d[field]}")
        if d.get("evidence"):
            parts.append(f"Доказ: {d['evidence']}")
        if d.get("reason"):
            parts.append(f"Причина: {d['reason']}")
        actor = people.get(r.actor_id) if r.actor_id else ("Тема 2 (Mitra)" if r.action == "external_status" else "Система")
        out.append({"at": r.at, "action": r.action, "action_title": HISTORY_ACTIONS.get(r.action, r.action),
                    "actor": actor, "status": status, "from_status": before, "reason": d.get("reason"),
                    "evidence": d.get("evidence"), "text": ". ".join(parts) or HISTORY_ACTIONS.get(r.action, r.action)})
    return out


def stats(db: Session, unit_id: uuid.UUID) -> dict:
    """Скільки заходів у підрозділі (з дочірніми) за статусами і скільки прострочено."""
    children, _ = unit_tree(db)
    units = subtree_from(children, unit_id)
    rows = db.scalars(select(Measure).where(Measure.unit_id.in_(units))).all()
    by_status = {s.value: 0 for s in MeasureStatus}
    for r in rows:
        by_status[r.status.value] += 1
    return {"total": len(rows), "by_status": by_status, "overdue": sum(1 for r in rows if overdue_days(r) is not None)}


# ---------- Тема 2 (Mitra): вихідна черга ----------
# Контракт: docs/contracts/integra-mitra.yaml. Ми шлемо захід, Mitra кладе його у «вхідні» координатора;
# координатор пов'язує його із заходом антикорупційної програми або відхиляє. Статус повертається вебхуком.

CONTRACT = "integra-mitra/1"
_UNIT_CODES_FILE = Path(__file__).resolve().parents[2] / "adapters" / "units.json"


@lru_cache(maxsize=1)
def _unit_codes() -> dict[str, str]:
    """Назва підрозділу → код зі спільного з темою 2 довідника units.json."""
    try:
        data = json.loads(_UNIT_CODES_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {name: code for code, name in data.items()}


def _unit_info(db: Session | None, unit_id: uuid.UUID) -> dict:
    info: dict = {"id": str(unit_id), "code": None, "name": None, "path": []}
    if db is None:
        return info
    path, current, seen = [], db.get(Unit, unit_id), set()
    while current is not None and current.id not in seen:
        seen.add(current.id)
        path.append(current.name)
        current = db.get(Unit, current.parent_id) if current.parent_id else None
    path.reverse()
    if path:
        info.update(name=path[-1], path=path, code=_unit_codes().get(path[-1]))
    return info


def theme2_payload(measure: Measure, db: Session | None = None) -> dict:
    """Лише те, що потрібно трекеру колег. Без імен: відповідальний — посада."""
    public = get_settings().public_url.rstrip("/")
    component = m.COMPONENTS.get(measure.component or "", {})
    return {
        "contract": CONTRACT,
        "id": str(measure.id),
        "unit_id": str(measure.unit_id),
        "unit": _unit_info(db, measure.unit_id),
        "title": measure.title,
        "description": measure.description,
        "component": measure.component,
        "component_title": component.get("title"),
        "catalog_number": measure.catalog_number,
        "recommendation_code": measure.recommendation_code,
        "owner": measure.owner,
        "due_date": measure.due_date.isoformat(),
        "status": measure.status.value,
        "done_on": measure.done_on.isoformat() if measure.done_on else None,
        "integra_url": f"{public}/tracker?measure={measure.id}" if public else None,
        "source": "integrity-dashboard",
    }


def enqueue_measure(db: Session, measure: Measure) -> bool:
    """Ставить захід у чергу для теми 2, якщо інтеграцію ввімкнено.

    Зміна, яка прийшла від самої Mitra (вебхук), назад не відсилається: інакше системи пінгують одна одну."""
    if not get_settings().theme2_url:
        return False
    db.add(OutboxMessage(target=THEME2, topic="measure.upsert", payload=theme2_payload(measure, db)))
    return True


Sender = Callable[[str, dict], dict]


class PermanentError(Exception):
    """Mitra відхилила повідомлення (4xx): повтор не допоможе, потрібна людина."""


def http_sender(topic: str, payload: dict) -> dict:
    """POST {THEME2_URL}/measures. Відповідь може містити id заходу в їхній системі."""
    settings = get_settings()
    request = urllib.request.Request(
        settings.theme2_url.rstrip("/") + "/measures",
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "X-Integration-Key": settings.theme2_api_key, "X-Topic": topic,
                 "X-Contract": CONTRACT},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.theme2_timeout_seconds) as response:  # noqa: S310 (адреса з конфігу)
            body = response.read()
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode(errors="replace")
        if 400 <= e.code < 500 and e.code not in (408, 409, 425, 429):
            raise PermanentError(f"HTTP {e.code}: {detail}") from e
        raise OSError(f"HTTP {e.code}: {detail}") from e
    return json.loads(body) if body else {}


def send_pending(db: Session, sender: Sender | None = None, limit: int = 100) -> dict:
    """Надсилає повідомлення з черги. Помилка одного не зупиняє решту; невдалі повторяться пізніше.

    Повідомлення одного заходу йдуть по порядку: якщо раннє не пройшло, пізніші цього заходу чекають."""
    sender = sender or http_sender
    sent, failed = 0, 0
    pending = db.scalars(
        select(OutboxMessage)
        .where(OutboxMessage.target == THEME2, OutboxMessage.sent_at.is_(None), OutboxMessage.attempts < MAX_ATTEMPTS)
        .order_by(OutboxMessage.created_at)
        .limit(limit)
    ).all()
    blocked: set[str] = set()
    for message in pending:
        measure_key = str(message.payload.get("id"))
        if measure_key in blocked:
            continue
        message.attempts += 1
        try:
            answer = sender(message.topic, message.payload) or {}
        except PermanentError as e:
            message.last_error = str(e)[:500]
            message.attempts = MAX_ATTEMPTS  # не повторювати: Mitra відхилила вміст
            failed += 1
            continue
        except (urllib.error.URLError, OSError, ValueError) as e:
            message.last_error = str(e)[:500]
            failed += 1
            blocked.add(measure_key)
            continue
        message.sent_at = utcnow()
        message.last_error = ""
        sent += 1
        external_id = answer.get("id") if isinstance(answer, dict) else None
        if external_id:
            measure = db.get(Measure, uuid.UUID(message.payload["id"]))
            if measure is not None and not measure.external_id:
                measure.external_id = str(external_id)[:128]
                measure.external_source = THEME2
                measure.external_state = measure.external_state or "inbox"
    db.commit()
    return {"sent": sent, "failed": failed, "pending": pending_count(db)}


def pending_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(OutboxMessage)
                     .where(OutboxMessage.target == THEME2, OutboxMessage.sent_at.is_(None),
                            OutboxMessage.attempts < MAX_ATTEMPTS)) or 0


def failed_messages(db: Session, limit: int = 20) -> list[OutboxMessage]:
    """Повідомлення, які Mitra відхилила або які вичерпали спроби: їх треба розібрати вручну."""
    return list(db.scalars(select(OutboxMessage)
                           .where(OutboxMessage.target == THEME2, OutboxMessage.sent_at.is_(None),
                                  OutboxMessage.attempts >= MAX_ATTEMPTS)
                           .order_by(OutboxMessage.created_at.desc()).limit(limit)))


def retry_failed(db: Session) -> int:
    """Повернути відхилені повідомлення в чергу (після виправлення на боці Mitra)."""
    items = failed_messages(db, limit=1000)
    for message in items:
        message.attempts = 0
    db.flush()  # сесії без autoflush: інакше send_pending їх не побачить
    return len(items)


# ---------- Тема 2 (Mitra): фонове надсилання ----------

_sync_stop = threading.Event()
_sync_thread: threading.Thread | None = None


MAX_SYNC_BACKOFF_SECONDS = 900.0


def next_sync_wait(base: float, current: float, result: dict | None) -> float:
    """Пауза до наступного кроку черги. Поки Mitra недоступна (нічого не надіслано, є збої), пауза подвоюється
    до MAX_SYNC_BACKOFF_SECONDS. Інакше MAX_ATTEMPTS спроб згоріли б за MAX_ATTEMPTS × base секунд
    (20 × 10 с ≈ 3 хв простою Mitra), і всі заходи потрапили б у «відхилені», які треба повертати вручну."""
    if result is None or (result.get("failed") and not result.get("sent")):
        return min(max(current, base) * 2, max(MAX_SYNC_BACKOFF_SECONDS, base))
    return base


def _sync_loop(interval: float) -> None:
    from app.db import SessionLocal
    wait = interval
    while not _sync_stop.wait(wait):
        result: dict | None = {}
        try:
            with SessionLocal() as db:
                if pending_count(db):
                    result = send_pending(db)
        except Exception:  # noqa: BLE001
            log.exception("theme2: sync")
            result = None
        wait = next_sync_wait(interval, wait, result)


def start_sync() -> None:
    """Запускається в lifespan, якщо задано THEME2_URL і THEME2_SYNC_SECONDS > 0."""
    global _sync_thread
    settings = get_settings()
    if not settings.theme2_url or settings.theme2_sync_seconds <= 0 or (_sync_thread and _sync_thread.is_alive()):
        return
    _sync_stop.clear()
    _sync_thread = threading.Thread(target=_sync_loop, args=(settings.theme2_sync_seconds,), name="theme2-sync",
                                    daemon=True)
    _sync_thread.start()
    log.info("theme2: черга надсилається кожні %s с", settings.theme2_sync_seconds)


def stop_sync() -> None:
    _sync_stop.set()


# ---------- Тема 2 (Mitra): вхідні статуси ----------

# Стан у Mitra → наш статус. None: наш статус не змінюється, стан лише показується в трекері.
EXTERNAL_STATES: dict[str, tuple[MeasureStatus | None, str]] = {
    "inbox": (None, "у вхідних координатора Mitra"),
    "linked": (None, "пов'язано із заходом програми в Mitra"),
    "rejected": (None, "координатор Mitra відхилив"),
    "planned": (None, "заплановано в Mitra"),
    "in_progress": (MeasureStatus.IN_PROGRESS, "виконується в Mitra"),
    "on_review": (MeasureStatus.IN_PROGRESS, "на погодженні в Mitra"),
    "returned": (MeasureStatus.IN_PROGRESS, "повернуто на доопрацювання в Mitra"),
    "done": (MeasureStatus.DONE, "виконано в Mitra"),
    "partial": (MeasureStatus.IN_PROGRESS, "частково виконано в Mitra"),
    "not_done": (MeasureStatus.IN_PROGRESS, "не виконано в Mitra"),
}
# Старий формат вебхука: одразу наш статус.
LEGACY_STATES = {"cancelled": (MeasureStatus.CANCELLED, "скасовано в темі 2")}
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ExternalUpdateError(ValueError):
    def __init__(self, status_code: int, message: str, code: str):
        super().__init__(message)
        self.status_code, self.code = status_code, code


def public_origin() -> str | None:
    settings = get_settings()
    raw = settings.theme2_public_url or settings.theme2_url
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


def trusted_link(url: str | None) -> str | None:
    """Посилання з Mitra показуємо лише якщо воно веде на саму Mitra: доказ не можна підмінити адресою деінде."""
    if not url:
        return None
    origin = public_origin()
    parts = urlsplit(url)
    if origin is None or f"{parts.scheme}://{parts.netloc}".lower() != origin:
        raise ExternalUpdateError(422, f"Посилання має вести на Mitra ({origin or 'THEME2_PUBLIC_URL не задано'})",
                                  "untrusted_link")
    return url


def evidence_text(summary: str, documents: list[dict]) -> str:
    lines = [summary.strip()] if summary.strip() else []
    lines += [f"{d['name']} (sha256 {d['sha256'][:12]}…)" for d in documents]
    return "\n".join(lines)


def find_measure(db: Session, measure_id: uuid.UUID | None, external_id: str | None) -> Measure | None:
    if measure_id is not None:
        measure = db.get(Measure, measure_id)
        if measure is not None and (not external_id or not measure.external_id or measure.external_id == external_id):
            return measure
        if measure is not None:  # id наш, але Mitra вже пов'язала його з іншим своїм записом
            raise ExternalUpdateError(409, "measure_id і external_id вказують на різні заходи", "id_mismatch")
    if external_id:
        return db.scalar(select(Measure).where(Measure.external_id == external_id))
    return None


def apply_external_update(db: Session, measure: Measure, *, state: str, external_id: str | None,
                          occurred_at: datetime | None, done_on: date | None, comment: str,
                          summary: str, documents: list[dict], url: str | None) -> dict:
    """Застосувати подію з Mitra. Ідемпотентно: повтор тієї ж події нічого не змінює.

    Наш статус змінюється лише за TRANSITIONS трекера; якщо перехід недозволений, стан Mitra все одно
    зберігається й показується, а відповідь 200 (інакше Mitra повторювала б подію без кінця)."""
    from app.routers.measures import TRANSITIONS  # уникаємо циклічного імпорту

    mapping = EXTERNAL_STATES.get(state) or LEGACY_STATES.get(state)
    if mapping is None:
        raise ExternalUpdateError(422, f"Невідомий стан: {state}", "unknown_state")
    target, title = mapping
    if occurred_at is not None and occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    last = measure.external_updated_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if occurred_at is not None and last is not None and occurred_at < last:
        return {"id": str(measure.id), "status": measure.status.value, "changed": False, "reason": "stale"}

    for d in documents:
        if not SHA256.match(d["sha256"]):
            raise ExternalUpdateError(422, f"Документ «{d['name']}»: sha256 — 64 шістнадцяткові символи", "bad_sha256")
        d["verify_url"] = trusted_link(d.get("verify_url"))
    url = trusted_link(url)
    if target == MeasureStatus.DONE and not (summary.strip() or documents):
        raise ExternalUpdateError(422, "Виконання підтверджується доказом: опис результату або документ",
                                  "evidence_required")
    if done_on is not None and done_on > today():
        raise ExternalUpdateError(422, "Дата виконання не може бути в майбутньому", "done_on_in_future")

    before = (measure.status, measure.external_state, measure.external_id, measure.external_note,
              measure.external_evidence, measure.external_url, measure.evidence, measure.done_on)
    if external_id and not measure.external_id:
        measure.external_id = external_id
    measure.external_source = THEME2
    measure.external_state = state
    measure.external_note = comment.strip()
    if url:
        measure.external_url = url
    if summary.strip() or documents:
        measure.external_evidence = {"summary": summary.strip(), "documents": documents}

    status_note = None
    if target is not None and target != measure.status:
        if target in TRANSITIONS[measure.status]:
            measure.status = target
            if target == MeasureStatus.DONE:
                measure.evidence = evidence_text(summary, documents)
                measure.done_on = done_on or today()
            else:
                measure.done_on = None
        else:
            status_note = (f"наш статус «{titles.measure_status(measure.status)}» не змінено: перехід у "
                           f"«{titles.measure_status(target)}» недозволений")
    elif target == MeasureStatus.DONE and (summary.strip() or documents):
        measure.evidence = evidence_text(summary, documents)  # нові документи до вже виконаного заходу
    if occurred_at is not None:
        measure.external_updated_at = occurred_at

    after = (measure.status, measure.external_state, measure.external_id, measure.external_note,
             measure.external_evidence, measure.external_url, measure.evidence, measure.done_on)
    return {"id": str(measure.id), "status": measure.status.value, "external_state": state,
            "state_title": title, "changed": before != after, "from_status": before[0].value,
            **({"note": status_note} if status_note else {})}


def external_view(measure: Measure) -> dict | None:
    if not measure.external_source and not measure.external_id:
        return None
    state = measure.external_state
    title = (EXTERNAL_STATES.get(state or "") or LEGACY_STATES.get(state or "") or (None, None))[1]
    evidence = measure.external_evidence or {}
    return {
        "source": measure.external_source or THEME2,
        "system": "Mitra",
        "id": measure.external_id,
        "state": state,
        "state_title": title or ("надіслано в Mitra" if measure.external_id else None),
        "url": measure.external_url,
        "note": measure.external_note or None,
        "summary": evidence.get("summary") or None,
        "documents": evidence.get("documents") or [],
        "updated_at": measure.external_updated_at,
    }
