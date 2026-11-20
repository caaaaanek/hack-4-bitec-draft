"""Хвиля на автопілоті: увесь цикл без ручних кроків, крім рішень, які за методикою ухвалює людина.

Для хвилі з autopilot=True кожен tick():
1. Чернетку з настанням planned_open_on відкриває (той самий шлях, що й кнопка: services/lifecycle.py).
2. Відкритій хвилі кожні remind_every_days днів кладе нагадування ВСІМ учасникам (Notice для аудиторії):
   хто вже пройшов анкету, ніде не відстежується, тож нагадування нічого не розкриває.
3. Закриває, коли настав planned_close_on або в кожній анкеті участь ≥ close_at_percent (і не менше k).
4. Після закриття: знімки (у close_wave), підготовка Word-звіту за Додатком Г, сповіщення керівникам про
   рекомендації, що чекають рішення, учасникам — що узагальнені результати готові; черга теми 2.

Чого автопілот свідомо НЕ робить: не приймає й не відхиляє рекомендації і не створює заходів —
це рішення відповідальної посадової особи. У тему 2 йдуть лише заходи, які вже створила людина.

Раз на день (перший tick дня) автопілот також: публікує training_coverage з флешкарток за поточний місяць,
кладе адміністраторам підсумок агента-чергового, якщо є що виправити, і експортує голову журналу назовні
(services/audit_anchor.py), якщо задано AUDIT_ANCHOR_DIR чи AUDIT_ANCHOR_TSA_URL.
"""

import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import now, today
from app.config import get_settings
from app.errors import ApiError
from app.models import ApprovalRequest, AutopilotEvent, Campaign, CampaignStatus, GeneratedReport, Notice, Role, User
from app.services import approvals, audit_anchor, learning, lifecycle, watchdog
from app.services.plural import plural
from app.services.text import percent, short_questionnaire

log = logging.getLogger("app.autopilot")
DAILY = "daily"


def event(db: Session, campaign: Campaign | None, step: str, status: str, message: str, **details) -> dict:
    row = AutopilotEvent(campaign_id=campaign.id if campaign else None, at=now(), step=step, status=status,
                         message=message, details=jsonable_encoder(details))
    db.add(row)
    return {"campaign_id": str(campaign.id) if campaign else None, "campaign_title": campaign.title if campaign else None,
            "step": step, "status": status, "message": message}


def notice(db: Session, campaign: Campaign | None, audience: str, kind: str, title: str, body: str = "") -> None:
    db.add(Notice(campaign_id=campaign.id if campaign else None, audience=audience, kind=kind, title=title[:300],
                  body=body, created_at=now()))


def participation_reached(db: Session, campaign: Campaign) -> tuple[bool, str]:
    from app.routers.campaigns import progress  # уникаємо циклічного імпорту
    items = [i for i in progress(campaign.id, db, None).items if i.eligible]
    if not items or campaign.close_at_percent is None:
        return False, ""
    k = campaign.min_group_size
    short = [i for i in items if (i.percent or 0) < campaign.close_at_percent or (i.submitted or 0) < k]
    text = "; ".join(f"{short_questionnaire(i.questionnaire_title)}: {percent(i.percent)}" for i in items)
    return not short, text


def every_days(n: int) -> str:
    """«щодня» для 1, «кожні 3 дні», «кожні 5 днів» (а не «кожні 1 день»)."""
    if n == 1:
        return "щодня"
    word = plural(n, "день", "дні", "днів")
    return f"кожні {word}" if n % 10 != 1 or n % 100 == 11 else f"кожен {word}"


def remind_due(campaign: Campaign) -> bool:
    n = campaign.remind_every_days
    if not n or campaign.opened_on is None:
        return False
    last = campaign.last_reminder_on or campaign.opened_on
    return today() >= last + timedelta(days=n)


def prepare_report(db: Session, campaign: Campaign) -> GeneratedReport:
    from app.routers.reports import report_data  # уникаємо циклічного імпорту
    from app.services import report_templates
    report = report_data(db, campaign, None)
    report["template"] = report_templates.describe(report_templates.DEFAULT_TEMPLATE)
    content = report_templates.DOCX[report_templates.DEFAULT_TEMPLATE](jsonable_encoder(report))
    row = GeneratedReport(campaign_id=campaign.id, unit_id=campaign.unit_id, format="docx",
                          filename=f"integrity-report-{campaign.closed_on}.docx", content=content, created_at=now())
    db.add(row)
    db.flush()
    return row


def _step(db: Session, out: list[dict], campaign: Campaign, record: bool, step: str, action, ok, fail: str) -> None:
    """Крок після закриття в окремій точці збереження: збій звіту чи рекомендацій не зриває саме закриття
    (на PostgreSQL помилка в транзакції інакше зіпсувала б і коміт закриття)."""
    try:
        with db.begin_nested():
            result = action()
        if record:
            text, details = ok(result)
            out.append(event(db, campaign, step, "ok", text, **details))
    except Exception as e:  # noqa: BLE001 — звіт і рекомендації можна зробити й вручну, цикл не має падати
        log.warning("Після закриття «%s»: %s не вдалося: %s", campaign.title, step, e)
        if record:
            out.append(event(db, campaign, step, "error", f"{fail}: {e}"))


def after_close(db: Session, campaign: Campaign, out: list[dict] | None = None, record: bool | None = None) -> None:
    """Після будь-якого закриття (кнопка, урна, автопілот): Word-звіт за Додатком Г, сповіщення керівникам про
    рекомендації й учасникам про результати. Події автопілота пишуться, лише коли він увімкнений для хвилі."""
    from app.routers.recommendations import build
    from app.services import measures as measures_service

    out = out if out is not None else []
    record = campaign.autopilot if record is None else record
    _step(db, out, campaign, record, "report", lambda: prepare_report(db, campaign),
          lambda report: (f"Звіт за Додатком Г підготовлено ({report.filename})", {"report_id": report.id}),
          "Звіт не підготовлено")

    def recommendations() -> tuple[int, int]:
        _, recs = build(db, campaign, None)
        high = sum(1 for r in recs if r.get("priority") == "high")
        notice(db, campaign, "leaders", "recommendations",
               f"Хвилю «{campaign.title}» закрито: {plural(len(recs), 'рекомендація чекає', 'рекомендації чекають', 'рекомендацій чекають')} рішення",
               f"Високого пріоритету: {high}. Рекомендацію приймає, уточнює чи відхиляє відповідальна посадова особа.")
        return len(recs), high

    _step(db, out, campaign, record, "recommendations", recommendations,
          lambda r: (f"Сформовано {plural(r[0], 'рекомендацію', 'рекомендації', 'рекомендацій')}; "
                     "рішення — за керівником (автопілот їх не приймає)", {"total": r[0], "high": r[1]}),
          "Рекомендації не сформовано")
    notice(db, campaign, "participants", "results",
           f"Хвилю «{campaign.title}» завершено: узагальнені результати доступні",
           f"Лише узагальнені дані груп не менше {campaign.min_group_size} осіб, без окремих відповідей.")
    if not record:
        return
    if get_settings().theme2_url:
        result = measures_service.send_pending(db)
        out.append(event(db, campaign, "theme2", "ok", "Черга заходів у тему 2 надіслана", **result))
    else:
        out.append(event(db, campaign, "theme2", "skipped",
                         "Тема 2 (Mitra) не підключена: заходи ведуться в нашому трекері"))


OPENED_BY = {"autopilot": "за планом", "four_eyes": "після підтвердження другою людиною", "manual": "вручну"}


def after_open(db: Session, campaign: Campaign, via: str = "manual", out: list[dict] | None = None) -> None:
    """Після будь-якого відкриття: сповіщення учасникам. Для хвилі на автопілоті — подія «Відкрито»
    (раніше відкриття через підтвердження аудиту лишало журнал автопілота на «Чекає підтвердження»)."""
    out = out if out is not None else []
    if campaign.autopilot:
        when = f" ({campaign.planned_open_on:%d.%m.%Y})" if via == "autopilot" and campaign.planned_open_on else ""
        out.append(event(db, campaign, "open", "ok", f"Хвилю відкрито {OPENED_BY.get(via, 'вручну')}{when}"))
    notice(db, campaign, "participants", "opened", f"Розпочато хвилю оцінювання «{campaign.title}»",
           (f"Пройдіть анкету до {campaign.planned_close_on:%d.%m.%Y}. " if campaign.planned_close_on else "")
           + f"Відповіді анонімні: результати показуються лише для груп не менше {campaign.min_group_size} осіб.")


def tick_campaign(db: Session, campaign: Campaign) -> list[dict]:
    out: list[dict] = []
    if campaign.status == CampaignStatus.DRAFT:
        if campaign.planned_open_on and campaign.planned_open_on <= today():
            if approvals.enabled() and not approvals.open_approved(db, campaign):
                return out + request_open(db, campaign)
            try:
                lifecycle.open_wave(db, campaign, None, via="autopilot")
                after_open(db, campaign, "autopilot", out)
            except ApiError as e:
                already = db.scalar(select(AutopilotEvent.id).where(
                    AutopilotEvent.campaign_id == campaign.id, AutopilotEvent.step == "open",
                    AutopilotEvent.status == "error", AutopilotEvent.at >= now() - timedelta(days=1)))
                if not already:
                    out.append(event(db, campaign, "open", "error", f"Не вдалося відкрити: {e.detail}"))
        return out
    if campaign.status != CampaignStatus.OPEN:
        return out
    due = campaign.planned_close_on is not None and campaign.planned_close_on <= today()
    reached, text = participation_reached(db, campaign)
    if due or reached:
        reason = (f"настав строк ({campaign.planned_close_on:%d.%m.%Y})" if due
                  else f"участь досягла {percent(campaign.close_at_percent)} у кожній анкеті ({text})")
        if campaign.urn_enabled:
            # «Урна»: автопілот хвилю сам не закриє — ключа немає ні в кого, крім власників частин.
            if not campaign.urn_close_requested:
                from app.services import urn

                urn.request_close(db, campaign, None)
                out.append(event(db, campaign, "close", "skipped",
                                 f"Час закривати ({reason}): чекаємо частин ключа урни від двох власників"))
            return out
        details = lifecycle.close_wave(db, campaign, None, via="autopilot")
        out.append(event(db, campaign, "close", "ok", f"Хвилю закрито: {reason}", **details))
        after_close(db, campaign, out, record=True)
        return out
    if remind_due(campaign):
        notice(db, campaign, "participants", "reminder", f"Нагадування: триває хвиля «{campaign.title}»",
               (f"Анкету можна пройти до {campaign.planned_close_on:%d.%m.%Y}. " if campaign.planned_close_on else "")
               + "Якщо ви вже відповіли — дякуємо, повторно нічого робити не треба.")
        campaign.last_reminder_on = today()
        out.append(event(db, campaign, "reminder", "ok", "Нагадування надіслано всім учасникам хвилі (без відстеження, "
                         "хто вже пройшов)"))
    return out


def daily(db: Session) -> list[dict]:
    """Раз на день: охоплення навчанням з флешкарток і підсумок агента-чергового адміністраторам."""
    start = now().replace(hour=0, minute=0, second=0, microsecond=0)
    if db.scalar(select(AutopilotEvent.id).where(AutopilotEvent.campaign_id.is_(None), AutopilotEvent.step == DAILY,
                                                 AutopilotEvent.at >= start)):
        return []
    out = []
    rows = learning.publish(db)
    report = watchdog.digest(db, None, role=Role.ADMIN)  # сповіщення йде уповноваженим: лише їхні пункти
    if report["status"] != "ok":
        notice(db, None, "admins", "digest", f"Агент-черговий: {report['summary']}",
               "\n".join(f"• {x['title']}" for x in report["items"] if x["severity"] != "info")[:4000])
    anchor = audit_anchor.daily_export(db)
    out.append(event(db, None, DAILY, "ok",
                     f"Охоплення навчанням оновлено ({plural(len(rows), 'підрозділ', 'підрозділи', 'підрозділів')}); "
                     f"агент-черговий: {report['summary']}" + (f"; {anchor}" if anchor else ""),
                     digest_status=report["status"]))
    return out


def request_open(db: Session, campaign: Campaign) -> list[dict]:
    """Принцип двох осіб: автопілот хвилю не відкриває сам, а просить підтвердження (open_campaign) від імені того,
    хто створив хвилю. Відкриє її підтвердження аудиту або наступний крок після нього."""
    pending = db.scalar(select(ApprovalRequest).where(ApprovalRequest.kind == "open_campaign",
                                                      ApprovalRequest.target_id == str(campaign.id),
                                                      ApprovalRequest.status == "pending"))
    if pending is not None:
        return []
    try:
        lifecycle.check_group_sizes(db, campaign)
    except ApiError as e:
        return [event(db, campaign, "open", "error", f"Не вдалося відкрити: {e.detail}")]
    summary = approvals.composition_summary(db, campaign)
    creator = db.get(User, campaign.created_by_id) if campaign.created_by_id else None
    row = approvals.request(db, creator, "open_campaign", campaign.id, summary,
                            f"Відкрити хвилю «{campaign.title}» за планом автопілота: склад "
                            + ", ".join(f"{k} — {v}" for k, v in summary["eligible"].items())
                            + f"; нових облікових записів за 30 днів: {summary['created_last_30_days']}")
    return [event(db, campaign, "open", "waiting",
                  "Чекає на підтвердження відкриття внутрішнім аудитом (принцип двох осіб)",
                  approval_id=str(row.id))]


def tick(db: Session) -> list[dict]:
    """Один прохід автопілота. Комітить сам; кожна хвиля — окремою транзакцією, щоб помилка однієї не зупиняла інших."""
    out: list[dict] = []
    ids = list(db.scalars(select(Campaign.id).where(Campaign.autopilot.is_(True),
                                                    Campaign.status.in_([CampaignStatus.DRAFT, CampaignStatus.OPEN]))
                          .order_by(Campaign.created_at)))
    for cid in ids:
        campaign = db.scalars(select(Campaign).where(Campaign.id == cid).with_for_update(skip_locked=True)).first()
        if campaign is None:
            continue
        try:
            out += tick_campaign(db, campaign)
            db.commit()
        except Exception as e:  # noqa: BLE001
            db.rollback()
            log.exception("autopilot: хвиля %s", cid)
            campaign = db.get(Campaign, cid)
            out.append(event(db, campaign, "tick", "error", f"Помилка кроку: {e}"))
            db.commit()
    try:
        out += daily(db)
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("autopilot: щоденний крок")
        out.append(event(db, None, DAILY, "error", f"Помилка щоденного кроку: {e}"))
        db.commit()
    return out


def plan(campaign: Campaign) -> list[str]:
    """Що автопілот зробить далі — людською мовою, для екрана хвилі."""
    if not campaign.autopilot:
        return ["Автопілот вимкнено: хвиля відкривається й закривається вручну."]
    steps = []
    if campaign.status == CampaignStatus.DRAFT:
        steps.append(f"Відкриє {campaign.planned_open_on:%d.%m.%Y}." if campaign.planned_open_on
                     else "Дату відкриття не задано — відкрийте вручну або задайте дату відкриття.")
    if campaign.status in (CampaignStatus.DRAFT, CampaignStatus.OPEN):
        if campaign.remind_every_days:
            steps.append("Нагадуватиме всім учасникам " + every_days(campaign.remind_every_days) + ".")
        close = []
        if campaign.planned_close_on:
            close.append(f"{campaign.planned_close_on:%d.%m.%Y}")
        if campaign.close_at_percent:
            close.append(f"раніше, коли в кожній анкеті участь досягне {campaign.close_at_percent:g}%")
        steps.append("Закриє " + " або ".join(close) + "." if close else "Дату закриття не задано.")
        steps.append("Після закриття: знімки, звіт Word за Додатком Г, сповіщення керівникам і учасникам, черга теми 2.")
        steps.append("Рекомендації приймає людина: автопілот їх не приймає й заходів не створює.")
    if campaign.status == CampaignStatus.CLOSED:
        steps.append("Хвилю закрито; автопілот більше нічого не робить.")
    return steps


# ---------- Фоновий потік ----------

_stop = threading.Event()
_thread: threading.Thread | None = None


_next_tick_at: datetime | None = None


def next_tick_at() -> datetime | None:
    """Коли фоновий потік зробить наступний крок. None — потік не запущено (AUTOPILOT_INTERVAL_SECONDS=0)."""
    return _next_tick_at if _thread is not None and _thread.is_alive() else None


def _loop(interval: float) -> None:
    from app.db import SessionLocal
    global _next_tick_at
    # Реальний час, а не app.clock.now(): той у демо може бути «заморожений».
    _next_tick_at = datetime.now(timezone.utc) + timedelta(seconds=interval)
    while not _stop.wait(interval):
        _next_tick_at = datetime.now(timezone.utc) + timedelta(seconds=interval)
        try:
            with SessionLocal() as db:
                tick(db)
        except Exception:  # noqa: BLE001
            log.exception("autopilot: tick")


def start() -> None:
    """Запускається в lifespan, якщо AUTOPILOT_INTERVAL_SECONDS > 0."""
    global _thread
    interval = get_settings().autopilot_interval_seconds
    if interval <= 0 or (_thread and _thread.is_alive()):
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, args=(interval,), name="autopilot", daemon=True)
    _thread.start()
    log.info("autopilot: кожні %s с", interval)


def stop() -> None:
    _stop.set()


def audit_tick(db: Session, actor, events: list[dict]) -> None:
    log_action(db, actor, "tick", "autopilot", None, {"events": len(events)})


def campaign_events(db: Session, campaign_id: uuid.UUID, limit: int = 100) -> list[AutopilotEvent]:
    return list(db.scalars(select(AutopilotEvent).where(AutopilotEvent.campaign_id == campaign_id)
                           .order_by(AutopilotEvent.at.desc()).limit(limit)))
