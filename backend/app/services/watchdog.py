"""Агент-черговий: «що впало, чому, як виправити».

Детермінований огляд стану системи для керівника й адміністратора:
- показники, що знизилися з минулої хвилі, з розкладом зміни за джерелами (вага × бал) і обмежувачем фактами;
- технічні збої: черга в тему 2, джерела фактів, що мовчать, ланцюжок журналу дій, помилки автопілота;
- процес: прострочені заходи, рекомендації без рішення, відкриті хвилі з низькою участю, нерозглянуті знахідки.

Кожен пункт має «чому» (правило й числа) і «як виправити» (конкретні кроки в системі). Без ШІ.
Автопілот раз на день кладе короткий підсумок у сповіщення адміністраторам (services/autopilot.py).
"""

import uuid
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import verify_chain
from app.clock import now, today
from app.config import get_settings
from app.models import (
    AutopilotEvent,
    Campaign,
    CampaignStatus,
    CheckFinding,
    ChecklistEntry,
    Indicator,
    Measure,
    OutboxMessage,
    QuestionnaireKind,
    RecommendationDecision,
    Role,
    Unit,
)
from app.services import methodology as m
from app.services.facts import months_back
from app.services.measures import OPEN_STATUSES, overdue_days
from app.services.plural import plural
from app.services.text import percent, points, short_questionnaire, shorten
from app.services.units import subtree_from, unit_tree

SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}
SILENT_MONTHS = 3
SOURCE_TITLES = {"staff": "особовий склад", "working_group": "робоча група", "expert": "експерти",
                 "checklist": "чек-лист"}


def fmt(value) -> str:
    if value is None:
        return "—"
    return f"{value:+.1f}".replace(".", ",") if isinstance(value, float) else str(value)


def plain(value) -> str:
    return "—" if value is None else f"{value:.1f}".replace(".", ",").replace(",0", "")


def item(id: str, category: str, severity: str, title: str, what: str, why: str, fix: list[str],
         view: str | None, data: dict | None = None) -> dict:
    return {"id": id, "category": category, "severity": severity, "title": title, "what": what, "why": why,
            "fix": fix, "link": {"view": view, "ref": id}, "data": data or {}}


def root_unit(db: Session) -> Unit | None:
    return db.scalars(select(Unit).where(Unit.parent_id.is_(None)).order_by(Unit.name)).first()


def snapshots(db: Session, unit_id: uuid.UUID):
    from app.services.results import unit_snapshots  # уникаємо циклічного імпорту
    return unit_snapshots(db, unit_id)


# ---------- Падіння й зростання: розклад за джерелами ----------

def decompose(prev: dict, cur: dict) -> list[dict]:
    """Внесок кожного джерела у зміну самооцінки компонента: w·S тепер − w·S тоді. Плюс зміна обрізання фактами."""
    p = {s["source"]: s for s in prev.get("sources", [])}
    c = {s["source"]: s for s in cur.get("sources", [])}
    parts = []
    for source in sorted(set(p) | set(c)):
        before = (p.get(source, {}).get("effective_weight") or 0) * (p.get(source, {}).get("score") or 0)
        after = (c.get(source, {}).get("effective_weight") or 0) * (c.get(source, {}).get("score") or 0)
        parts.append({"source": source, "title": SOURCE_TITLES.get(source, source),
                      "before": p.get(source, {}).get("score"), "after": c.get(source, {}).get("score"),
                      "contribution": round(after - before, 1)})
    cut_before = (prev.get("score") or 0) - (prev.get("self_score") or 0)
    cut_after = (cur.get("score") or 0) - (cur.get("self_score") or 0)
    if round(cut_after - cut_before, 1):
        parts.append({"source": "facts_cut", "title": "обмеження фактами", "before": round(cut_before, 1),
                      "after": round(cut_after, 1), "contribution": round(cut_after - cut_before, 1)})
    return sorted(parts, key=lambda x: x["contribution"])


def question_moves(prev: dict, cur: dict, component: str) -> list[dict]:
    before = {q["code"]: q.get("score") for q in prev.get("questions", []) if q.get("component") == component}
    moves = []
    for q in cur.get("questions", []):
        if q.get("component") != component or q["code"] not in before:
            continue
        if q.get("score") is None or before[q["code"]] is None:
            continue
        moves.append({"code": q["code"], "text": shorten(q["text"], 120), "before": before[q["code"]], "after": q["score"],
                      "delta": round(q["score"] - before[q["code"]], 1)})
    return sorted(moves, key=lambda x: x["delta"])


def fact_moves(prev: dict, cur: dict, component: str) -> list[dict]:
    before = {f["indicator"]: f.get("percent") for f in prev.get("facts", []) if f.get("component") == component}
    out = []
    for f in cur.get("facts", []):
        if f.get("component") != component or f.get("percent") is None or before.get(f["indicator"]) is None:
            continue
        out.append({"indicator": f["indicator"], "title": f["title"], "before": before[f["indicator"]],
                    "after": f["percent"], "delta": round(f["percent"] - before[f["indicator"]], 1)})
    return sorted(out, key=lambda x: x["delta"])


def changes(db: Session, unit_id: uuid.UUID) -> list[dict]:
    pairs = snapshots(db, unit_id)
    if len(pairs) < 2:
        return [item("trend:not_enough", "drop", "info", "Динаміки ще немає",
                     "Для порівняння потрібні дві закриті хвилі цього підрозділу.",
                     f"Закритих хвиль зі знімком: {len(pairs)}.",
                     ["Запланувати наступну хвилю (автопілот: дата відкриття й закриття)."], "manage")]
    (c_prev, s_prev), (c_cur, s_cur) = pairs[-2], pairs[-1]
    prev, cur = s_prev.payload or {}, s_cur.payload or {}
    by_code = {c["code"]: c for c in prev.get("components", [])}
    out, rises = [], []
    for comp in cur.get("components", []):
        old = by_code.get(comp["code"])
        if not old or comp.get("score") is None or old.get("score") is None:
            continue
        delta = round(comp["score"] - old["score"], 1)
        if abs(delta) <= m.SIGNIFICANT_DELTA:
            continue
        parts = decompose(old, comp)
        qs = question_moves(prev, cur, comp["code"])
        fs = fact_moves(prev, cur, comp["code"])
        data = {"component": comp["code"], "before": old["score"], "after": comp["score"], "delta": delta,
                "contributions": parts, "questions": qs[:3] if delta < 0 else qs[-3:][::-1],
                "facts": fs, "previous_campaign": c_prev.title, "current_campaign": c_cur.title}
        if delta < 0:
            worst = [p for p in parts if p["contribution"] < 0][:2]
            why = "; ".join(f"{p['title']}: {fmt(p['contribution'])} бала" for p in worst) or "зміна в кількох джерелах"
            if qs:
                why += f". Найбільше впало питання «{qs[0]['text']}» ({fmt(qs[0]['delta'])})"
            fixes = [f"Відкрити «Розклад індексу» → «{comp['title']}»: перевірити джерела з від'ємним внеском."]
            if any(p["source"] == "facts_cut" for p in worst):
                fixes.append("Обмеження фактами посилилось: розібрати відкриті випадки в «Джерелах» (КІ, закупівлі).")
            fixes.append(f"Рекомендації хвилі «{c_cur.title}» для «{comp['title']}» → прийняти й створити заходи.")
            out.append(item(f"drop:{comp['code']}", "drop", "critical" if delta < -2 * m.SIGNIFICANT_DELTA else "warning",
                            f"«{comp['title']}» знизився на {plain(-delta)}",
                            f"{plain(old['score'])} → {plain(comp['score'])} між «{c_prev.title}» і «{c_cur.title}».",
                            why + ".", fixes, "trends", data))
        else:
            best = [p for p in reversed(parts) if p["contribution"] > 0][:2]
            rises.append(item(f"rise:{comp['code']}", "rise", "info", f"«{comp['title']}» зріс на {plain(delta)}",
                              f"{plain(old['score'])} → {plain(comp['score'])}.",
                              "Найбільший внесок: " + ("; ".join(f"{p['title']} {fmt(p['contribution'])}" for p in best)
                                                       or "кілька джерел") + ".",
                              ["Перевірити виконані заходи цього компонента: вони стали причиною чи збіг?"],
                              "trends", data))
    if not out:
        out.append(item("drop:none", "drop", "info", "Падінь немає",
                        f"Жоден компонент не знизився більше ніж на {plain(m.SIGNIFICANT_DELTA)} бала між "
                        f"«{c_prev.title}» і «{c_cur.title}».", "Правило значущості методики.", [], "trends"))
    return out + rises


# ---------- Технічні збої ----------

def technical_items(db: Session) -> list[dict]:
    out = []
    chain = verify_chain(db)
    if not chain["ok"]:
        out.append(item("tech:audit_chain", "technical", "critical", "Журнал дій пошкоджено",
                        f"Ланцюжок хешів зламано на записі №{chain['broken_seq']}.",
                        f"Перевірено записів: {chain['checked']}. Причина: {chain['reason']}.",
                        ["Не видаляти й не правити записи в БД вручну.",
                         "Зберегти копію БД і передати аудитору: це ознака втручання поза застосунком."], "audit"))
    unsent = db.scalars(select(OutboxMessage).where(OutboxMessage.sent_at.is_(None))).all()
    failing = [x for x in unsent if x.attempts > 0]
    if failing:
        last = max(failing, key=lambda x: x.attempts)
        out.append(item("tech:theme2", "technical", "warning", "Тема 2 не приймає заходи",
                        f"Не надіслано повідомлень: {len(unsent)}, з них з помилками: {len(failing)}.",
                        f"Остання помилка: {(last.last_error or '—')[:200]}",
                        ["Попросити технічного адміністратора перевірити адресу й ключ Mitra в налаштуваннях.",
                         "Повторити надсилання: «Інтеграції» → «Надіслати повторно».",
                         "Заходи тим часом ведуться в нашому трекері — роботу це не зупиняє."], "manage",
                        {"unsent": len(unsent), "failing": len(failing)}))
    elif unsent and not get_settings().theme2_url:
        out.append(item("tech:theme2_off", "technical", "info", "Тема 2 не підключена",
                        f"У черзі заходів для теми 2: {len(unsent)}.", "Адресу Mitra не задано.",
                        ["Якщо інтеграція потрібна — технічний адміністратор задає адресу й ключ Mitra; черга "
                         "відправиться сама."],
                        "manage", {"unsent": len(unsent)}))
    recent = set(months_back(today(), SILENT_MONTHS))
    for code, spec in m.FACTS.items():
        last = db.scalar(select(func.max(Indicator.period)).where(Indicator.indicator == code))
        if last is None:
            out.append(item(f"tech:source:{code}", "technical", "info", f"Немає даних: «{spec['title']}»",
                            "Жодне джерело ще не передало цей показник.", "Без фактів компонент рахується лише за "
                            "самооцінкою.",
                            ["Попросити технічного адміністратора підключити джерело."],
                            None))
        elif last not in recent and last < min(recent):
            out.append(item(f"tech:source:{code}", "technical", "warning", f"Джерело мовчить: «{spec['title']}»",
                            f"Останні дані — за {last}.",
                            f"Немає жодного запису за останні {SILENT_MONTHS} місяці.",
                            ["Перевірити, чи система-джерело надсилає дані і чи не відкликано її ключ.",
                             "Попросити технічного адміністратора перевірити підключення джерела."], None,
                            {"last": last}))
    since = now() - timedelta(days=7)
    errors = db.scalars(select(AutopilotEvent).where(AutopilotEvent.status == "error", AutopilotEvent.at >= since)
                        .order_by(AutopilotEvent.at.desc())).all()
    if errors:
        e = errors[0]
        out.append(item("tech:autopilot", "technical", "warning", "Автопілот не зміг виконати крок",
                        f"Помилок за тиждень: {len(errors)}. Остання: крок «{e.step}».", e.message[:300],
                        ["Відкрити журнал автопілота хвилі й виправити причину (наприклад, порожній склад).",
                         "Повторити: «Автопілот» → «Виконати крок зараз»."], "manage",
                        {"campaign_id": str(e.campaign_id) if e.campaign_id else None}))
    new_findings = db.scalar(select(func.count()).select_from(CheckFinding).where(CheckFinding.status == "new")) or 0
    if new_findings:
        out.append(item("tech:findings", "technical", "info", "Знахідки модуля «Перевірки» чекають розгляду",
                        f"Нерозглянутих знахідок: {new_findings}.",
                        "Доки знахідку не розглянуто, вона рахується як «не розібрано» в показниках КІ й закупівель.",
                        ["Позначити знахідки «Розглянуто» або «Відхилено» з коментарем.",
                         "Натиснути «Записати показники» на екрані «Перевірки»."], "checks", {"new": new_findings}))
    return out


# ---------- Процес ----------

def process(db: Session, units: set[uuid.UUID], scope: uuid.UUID, decisions: bool = True) -> list[dict]:
    """decisions=False — не рахувати «Рекомендації без рішення» (це розрахунок результатів хвилі)."""
    out = []
    measures = db.scalars(select(Measure).where(Measure.unit_id.in_(units))).all()
    overdue = sorted([x for x in measures if overdue_days(x) is not None], key=lambda x: -overdue_days(x))
    if overdue:
        out.append(item("process:overdue", "process", "warning", f"Прострочено заходів: {len(overdue)}",
                        "; ".join(f"«{shorten(x.title, 80)}» — {overdue_days(x)} дн." for x in overdue[:3]),
                        "Захід у статусі «заплановано» чи «виконується» після строку.",
                        ["Для кожного: виконати з доказом, перенести строк з причиною або скасувати з причиною."],
                        "tracker", {"count": len(overdue)}))
    soon = [x for x in measures if x.status in OPEN_STATUSES and today() <= x.due_date <= today() + timedelta(days=7)]
    if soon:
        out.append(item("process:due_soon", "process", "info", f"Строк спливає за тиждень: {len(soon)}",
                        "; ".join(f"«{shorten(x.title, 80)}» до {x.due_date:%d.%m}" for x in soon[:3]),
                        "Строк заходу в найближчі 7 днів.", ["Перевірити готовність доказів."], "tracker"))

    latest = None
    for c in db.scalars(select(Campaign).where(Campaign.status == CampaignStatus.CLOSED)
                        .order_by(Campaign.closed_on.desc(), Campaign.created_at.desc())):
        if scope in subtree_from(unit_tree(db)[0], c.unit_id):
            latest = c
            break
    if latest is not None and decisions:
        from app.services.recommendations import recommend
        from app.services.results import results_for
        from app.services import facts
        try:
            data = results_for(db, latest, scope)
            recs = recommend(data, facts.risk_signals(db, scope, 3, latest.closed_on, latest.min_group_size))
        except ValueError:
            recs = []
        decided = set(db.scalars(select(RecommendationDecision.recommendation_code).where(
            RecommendationDecision.campaign_id == latest.id, RecommendationDecision.unit_id == scope)))
        waiting = [r for r in recs if r["code"] not in decided]
        if waiting:
            high = [r for r in waiting if r.get("priority") == "high"]
            out.append(item("process:decisions", "process", "warning" if high else "info",
                            f"Рекомендації без рішення: {len(waiting)}",
                            f"Хвиля «{latest.title}»; високого пріоритету: {len(high)}.",
                            "Рекомендації пропонує система, а приймає чи відхиляє відповідальна посадова особа.",
                            ["Відкрити «Рекомендації» і для кожної: прийняти (із заходом), уточнити чи відхилити з "
                             "обґрунтуванням."], "recs", {"campaign_id": str(latest.id), "waiting": len(waiting)}))

    for c in db.scalars(select(Campaign).where(Campaign.status == CampaignStatus.OPEN)):
        if c.unit_id not in units and scope not in subtree_from(unit_tree(db)[0], c.unit_id):
            continue
        from app.routers.campaigns import progress
        try:
            items = progress(c.id, db, None).items
        except Exception:  # noqa: BLE001 — зведення не має падати через одну хвилю
            continue
        low = [i for i in items if i.percent is not None and i.percent < m.PARTICIPATION_MIN_PERCENT]
        days_left = (c.planned_close_on - today()).days if c.planned_close_on else None
        if low and (days_left is None or days_left <= 3):
            out.append(item(f"process:participation:{c.id}", "process", "warning",
                            f"Низька участь у хвилі «{c.title}»",
                            "; ".join(f"{short_questionnaire(i.questionnaire_title)}: {percent(i.percent)}"
                                      for i in low[:3]),
                            (f"До запланованого закриття: {plural(days_left, 'день', 'дні', 'днів')}."
                             if days_left is not None else "Дату закриття не заплановано.")
                            + f" Поріг надійності — {percent(m.PARTICIPATION_MIN_PERCENT)}.",
                            ["Нагадати всім учасникам (автопілот: нагадування кожні N днів).",
                             "Подовжити строк, якщо участь не набирається: результати з низькою участю мають гіршу "
                             "достовірність."], "manage", {"campaign_id": str(c.id)}))
        checklists = [link.questionnaire for link in c.questionnaire_links
                      if link.questionnaire.kind == QuestionnaireKind.CHECKLIST]
        if checklists:
            total = sum(len(s.questions) for s in checklists[0].sections)
            entries = db.scalars(select(ChecklistEntry).where(ChecklistEntry.campaign_id == c.id)).all()
            unfilled = max(total - len(entries), 0)
            unconfirmed = sum(1 for e in entries if e.confirmed_by_id is None)
            if unfilled or unconfirmed:
                out.append(item(f"process:checklist:{c.id}", "process", "info",
                                f"Чек-лист хвилі «{c.title}» не завершено",
                                f"Не заповнено: {unfilled} з {total}, не підтверджено: {unconfirmed}.",
                                f"Непідтверджене «повністю» рахується як {points(m.UNCONFIRMED_FULL_SCORE)}.",
                                ["Робоча група вносить, комісія підтверджує з доказом."], "checklist",
                                {"campaign_id": str(c.id), "unfilled": unfilled, "unconfirmed": unconfirmed}))
    return out


# ---------- Хто може виправити ----------

def _confirmers() -> set[Role]:
    from app.routers.checklist import confirmer_roles  # уникаємо циклічного імпорту

    return set(confirmer_roles())


def audience(item_id: str) -> set[Role]:
    """Ролі, які можуть виправити пункт (і мають екран, куди веде link.view). Решті пункт не віддається.

    Падіння, рекомендації й заходи — керівник (рішення й заходи приймає він); технічні збої, участь і план
    наступної хвилі — уповноважений; цілісність журналу — уповноважений і аудит; чек-лист — підтверджувачі
    (CHECKLIST_CONFIRMERS). Департамент нічого з цього не виправляє, тож сигналів не отримує.
    """
    if item_id.startswith(("drop:", "rise:", "process:overdue", "process:due_soon", "process:decisions")):
        return {Role.LEADER}
    if item_id == "tech:audit_chain":
        return {Role.ADMIN, Role.AUDITOR}
    if item_id.startswith("process:checklist:"):
        return _confirmers()
    if item_id.startswith(("tech:", "process:participation:", "trend:")):
        return {Role.ADMIN}
    return set()


def digest(db: Session, unit_id: uuid.UUID | None, role: Role | None = None, include_info: bool = False) -> dict:
    """role: лише пункти, які ця роль може виправити (None — усі, для внутрішнього використання).
    include_info: додати інформаційні пункти («падінь немає», «зросло на…»); за замовчуванням лише критичні
    й попередження, і counts без info."""
    root = root_unit(db)
    scope = unit_id or (root.id if root else None)

    def wants(*roles: Role) -> bool:
        return role is None or role in roles

    items: list[dict] = []
    unit_name = None
    if scope is not None:
        unit = db.get(Unit, scope)
        unit_name = unit.name if unit else None
        units = subtree_from(unit_tree(db)[0], scope)
        if wants(Role.LEADER, Role.ADMIN):
            items += changes(db, scope)
        if wants(Role.LEADER, Role.ADMIN, *_confirmers()):
            items += process(db, units, scope, decisions=wants(Role.LEADER))
    if wants(Role.ADMIN, Role.AUDITOR):
        items += technical_items(db)
    if role is not None:
        items = [x for x in items if role in audience(x["id"])]
    if not include_info:
        items = [x for x in items if x["severity"] != "info"]
    items.sort(key=lambda x: (SEVERITY_ORDER[x["severity"]], x["category"], x["id"]))
    shown = SEVERITY_ORDER if include_info else {k: v for k, v in SEVERITY_ORDER.items() if k != "info"}
    counts = {s: sum(1 for x in items if x["severity"] == s) for s in shown}
    status = "critical" if counts["critical"] else "attention" if counts["warning"] else "ok"
    head = {"critical": "Є критичні проблеми", "attention": "Є що виправити", "ok": "Усе гаразд"}[status]
    summary = f"{head}: критичних {counts['critical']}, попереджень {counts['warning']}" + (
        f", до відома {counts['info']}." if include_info else ".")
    return {"generated_at": now().isoformat(timespec="seconds"), "unit_id": scope, "unit_name": unit_name,
            "status": status, "summary": summary, "counts": counts, "items": items,
            "note": "Огляд зібрано явними правилами з даних системи; ШІ не використовується."}
