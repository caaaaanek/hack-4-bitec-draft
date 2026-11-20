"""Інструменти асистента (tool calling): модель сама просить дані, бекенд їх дає.

Усі інструменти лише читають і виконуються від імені користувача, що питає: ті самі перевірки доступу
(керівник підрозділу бачить лише свій підрозділ), ті самі агрегати з порогом k, що й у звичайному API.
Нічого не змінюють. Віддають стислі дані, щоб вмістилися в контекст моделі.
"""

import json
import uuid
from functools import lru_cache
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Measure, Role, Unit, User
from app.security import ensure_unit_access, home_unit, visible_unit_filter
from app.services import measures as measures_service
from app.services import methodology, results
from app.services.units import subtree_ids

MAX_RESULT_CHARS = 12000

_UNIT_PARAM = {"unit_id": {"type": "string", "description": (
    "Необов'язково. Не передавай, якщо підрозділ не названо: тоді береться підрозділ користувача "
    "(для керівника підрозділу) або вся організація. Для конкретного підрозділу — id або назва з list_units.")}}

TOOLS = [
    {"type": "function", "function": {
        "name": "get_methodology",
        "description": "Методика Integrity Index: ваги джерел, пороги фактів, правило реальності, рівні, достовірність.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "explain_term",
        "description": "Словник термінів теми (Рекомендації НУОУ, НАЗК, методика системи): визначення і джерело. "
                       "Виклич, коли питають «що таке…» або коли пояснюєш термін. Без term — перелік усіх термінів.",
        "parameters": {"type": "object", "properties": {"term": {
            "type": "string", "description": "Термін або його частина, наприклад «правило реальності» чи «Додаток Б»"}}}}},
    {"type": "function", "function": {
        "name": "list_units",
        "description": "Підрозділи, доступні користувачу: id і назва.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "get_results",
        "description": "Результати останньої закритої хвилі: індекс, компоненти (S самооцінка, F факти, L зараховано), "
                       "прапорці, достовірність, факти «X з Y», розбіжності, висновок. Кожне число з поясненням rule.",
        "parameters": {"type": "object", "properties": dict(_UNIT_PARAM)}}},
    {"type": "function", "function": {
        "name": "get_recommendations",
        "description": "Рекомендації за правилами для останньої закритої хвилі: пріоритет, чому (rule), рішення керівника.",
        "parameters": {"type": "object", "properties": dict(_UNIT_PARAM)}}},
    {"type": "function", "function": {
        "name": "get_measures",
        "description": "Заходи трекера: відповідальний (посада), строк, статус, прострочення, перевірка наступною хвилею.",
        "parameters": {"type": "object", "properties": dict(_UNIT_PARAM)}}},
    {"type": "function", "function": {
        "name": "get_history",
        "description": "Динаміка підрозділу за всі закриті хвилі: індекс, компоненти, зміна і її значущість.",
        "parameters": {"type": "object", "properties": dict(_UNIT_PARAM)}}},
]

TOOL_NAMES = {t["function"]["name"] for t in TOOLS}
# Довідкові інструменти без даних підрозділів: access_scope до них не додається.
UNSCOPED_TOOLS = {"get_methodology", "explain_term"}


class ToolError(Exception):
    """Помилка інструмента, яку варто показати моделі (наприклад, немає доступу чи немає закритої хвилі)."""


def _unit(db: Session, user: User, args: dict) -> uuid.UUID | None:
    raw = str(args.get("unit_id") or "").strip()
    if raw:
        try:
            unit_id = uuid.UUID(raw)
        except ValueError:
            # Модель могла передати назву підрозділу замість id — шукаємо за назвою. Порівняння в Python:
            # lower() у SQLite не знає кирилиці.
            wanted = raw.casefold()
            unit_id = next((u.id for u in db.scalars(select(Unit)) if u.name.casefold() == wanted), None)
            if unit_id is None:
                raise ToolError(f"Підрозділ «{raw}» не знайдено. Виклич без unit_id або візьми назву з list_units")
    else:
        # Без unit_id — підрозділ користувача за замовчуванням (свій чи корінь дерева), і доступ перевіряється
        # так само, як з явним unit_id. Раніше None означало «корінь без перевірки»: департамент чи зональний
        # уповноважений отримували через асистента дані всієї організації, усі заходи й історію кореня.
        unit_id = home_unit(db, user)
        if unit_id is None:
            raise ToolError("Підрозділів ще немає")
    if db.get(Unit, unit_id) is None:
        raise ToolError("Такого підрозділу немає")
    ensure_unit_access(db, user, unit_id)
    return unit_id


def _campaign(db: Session, unit_id: uuid.UUID | None):
    from app.routers.dashboard import pick_campaign  # уникаємо циклічного імпорту

    return pick_campaign(db, None, unit_id)


def _level(x) -> str | None:
    return (x or {}).get("title")


def _results(db: Session, user: User, args: dict) -> dict:
    unit_id = _unit(db, user, args)
    campaign = _campaign(db, unit_id)
    try:
        data = results.results_for(db, campaign, unit_id)
    except ValueError as e:
        raise ToolError(str(e))
    idx = data["index"]
    return {
        "wave": data["campaign_title"], "closed_on": str(data["closed_on"]), "unit": data["unit_name"],
        "k": data["min_group_size"], "methodology_version": data["methodology_version"],
        "index": {"score": idx["score"], "self_score": idx["self_score"], "level": _level(idx["level"]),
                  "reliability": idx["reliability"], "reliability_reasons": idx["reliability_reasons"], "rule": idx["rule"]},
        "components": [
            {"title": c["title"], "S_self": c["self_score"], "F_facts": c["facts_score"], "L_counted": c["score"],
             "level": _level(c["level"]), "cut_by_facts": c["cut_by_facts"], "reliability": c["reliability"],
             "flags": [f["title"] for f in c["flags"]], "sources": {s["title"]: s["weight"] for s in c["sources"]},
             "rule": c["rule"]}
            for c in data["components"]
        ],
        "facts": [f["label"] for f in data["facts"]],
        "discrepancies": [d["description"] for d in data.get("discrepancies", [])],
        "summary": data["summary"],
    }


def _recommendations(db: Session, user: User, args: dict) -> dict:
    from app.routers.recommendations import build, with_decisions

    unit_id = _unit(db, user, args)
    campaign = _campaign(db, unit_id)
    data, recs = build(db, campaign, unit_id)
    items = with_decisions(db, campaign, uuid.UUID(data["unit_id"]), recs)
    return {"wave": data["campaign_title"], "unit": data["unit_name"], "items": [
        {"title": r["title"], "priority": r["priority_title"], "component": r.get("component_title"), "rule": r["rule"],
         "decision": (r.get("decision") or {}).get("decision"), "measures": len(r.get("measures") or [])}
        for r in items[:12]]}


def _measures(db: Session, user: User, args: dict) -> dict:
    unit_id = _unit(db, user, args)
    query = select(Measure).order_by(Measure.due_date)
    if unit_id is not None:
        query = query.where(Measure.unit_id.in_(subtree_ids(db, unit_id)))
    items = measures_service.to_dicts(db, db.scalars(query).all())
    return {"items": [
        {"title": x["title"], "owner": x["owner"], "due_date": str(x["due_date"]),
         "status": getattr(x["status"], "value", x["status"]), "overdue_days": x["overdue_days"],
         "verification": (x.get("verification") or {}).get("title")}
        for x in items[:20]], "total": len(items)}


def _history(db: Session, user: User, args: dict) -> dict:
    unit_id = _unit(db, user, args)
    if unit_id is None:
        unit_id = _campaign(db, None).unit_id
    points, previous = [], None
    for campaign, snap in results.unit_snapshots(db, unit_id):
        d = results.delta(snap.index_score, previous.index_score) if previous else None
        sig = methodology.significance(d, [previous.reliability, snap.reliability]) if previous else None
        points.append({"wave": campaign.title, "closed_on": str(snap.closed_on), "index": snap.index_score,
                       "index_self": snap.index_self, "reliability": snap.reliability, "delta": d,
                       "significance": (sig or {}).get("title"),
                       "components": {c["title"]: c["score"] for c in snap.payload["components"]}})
        previous = snap
    return {"unit": db.get(Unit, unit_id).name, "points": points}


def _units(db: Session, user: User, _: dict) -> dict:
    query = select(Unit).order_by(Unit.name)
    if user.role == Role.LEADER and user.unit_id is not None:
        query = query.where(Unit.id.in_(subtree_ids(db, user.unit_id)))
    else:
        visible = visible_unit_filter(db, user)
        if visible is not None:
            query = query.where(Unit.id.in_(visible))
    return {"units": [{"id": str(u.id), "name": u.name} for u in db.scalars(query)]}


GLOSSARY_PATH = Path(__file__).resolve().parent.parent / "data" / "glossary.json"
MAX_TERMS = 3


@lru_cache
def glossary() -> list[dict]:
    """Словник термінів (app/data/glossary.json): term, aliases, definition, source."""
    return json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))["terms"]


def _norm(text: str) -> str:
    text = text.casefold().replace("’", "'").replace("ʼ", "'").replace("`", "'")
    return " ".join(text.replace("«", " ").replace("»", " ").replace('"', " ").replace("?", " ").split())


def find_terms(query: str) -> list[dict]:
    """Точний збіг з назвою чи синонімом, інакше — терміни, що містяться в запиті або містять його."""
    q = _norm(query)
    if not q:
        return []
    names = [(t, [_norm(t["term"])] + [_norm(a) for a in t.get("aliases", [])]) for t in glossary()]
    exact = [t for t, ns in names if q in ns]
    if exact:
        return exact[:MAX_TERMS]
    # Однолітерні синоніми (A, B, C) лише для точного збігу, інакше «а» знайдеться в кожному запиті.
    partial = [t for t, ns in names if any((len(n) >= 3 and n in q) or (len(q) >= 3 and q in n) for n in ns)]
    # Довший збіг точніший: «конфлікт інтересів» раніше за «інтерес».
    partial.sort(key=lambda t: -max((len(n) for n in [_norm(t["term"])] + [_norm(a) for a in t.get("aliases", [])]
                                     if n in q), default=0))
    return partial[:MAX_TERMS]


def _explain_term(_db, _user, args: dict) -> dict:
    raw = str(args.get("term") or "").strip()
    if not raw:
        return {"terms": [t["term"] for t in glossary()]}
    found = find_terms(raw)
    if not found:
        return {"error": f"Терміна «{raw}» у словнику немає. Не вигадуй визначення; скажи, що його немає у словнику.",
                "terms": [t["term"] for t in glossary()]}
    return {"items": [{k: t[k] for k in ("term", "definition", "source")} for t in found]}


def _methodology(*_) -> dict:
    data = methodology.as_dict()
    return {k: data[k] for k in ("version", "points_per_level", "source_weights", "reality_margin", "weak_link_max_gap",
                                 "significant_delta", "rules")} | {
        "facts": {code: {"title": f["title"], "thresholds": f["thresholds"]} for code, f in data["facts"].items()},
        "reliability_grades": data["reliability"]["grades"],
        "reliability_flags": {code: {"title": f["title"], "explain": f["explain"]}
                              for code, f in data["reliability"]["flags"].items()}}


_HANDLERS = {"get_methodology": _methodology, "explain_term": _explain_term, "list_units": _units, "get_results": _results,
             "get_recommendations": _recommendations, "get_measures": _measures, "get_history": _history}


def run_tool(db: Session, user: User, name: str, arguments) -> str:
    """Виконує інструмент і повертає JSON-рядок для моделі. Помилки доступу й даних теж повертаються моделі текстом."""
    if name not in _HANDLERS:
        return json.dumps({"error": f"Невідомий інструмент {name}"}, ensure_ascii=False)
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments or "{}")
        except ValueError:
            arguments = {}
    try:
        args = arguments if isinstance(arguments, dict) else {}
        out = _HANDLERS[name](db, user, args)
        if (user.role == Role.LEADER and user.unit_id is not None and isinstance(out, dict)
                and name not in UNSCOPED_TOOLS):
            # Керівник підрозділу бачить лише свою зону: кажемо це моделі прямо, щоб вона не назвала
            # дані підрозділу «даними всієї організації».
            own = db.get(Unit, user.unit_id)
            out["access_scope"] = (f"Користувач бачить лише «{own.name}» і дочірні підрозділи. Дані інших підрозділів "
                                   "і всієї організації йому недоступні.")
    except ToolError as e:
        out = {"error": str(e)}
    except HTTPException as e:
        out = {"error": e.detail if isinstance(e.detail, str) else "Дані недоступні"}
    except Exception:  # noqa: BLE001 — збій одного інструмента не має ламати відповідь; деталі моделі не потрібні
        db.rollback()
        out = {"error": "Дані тимчасово недоступні"}
    text = json.dumps(out, ensure_ascii=False, default=str)
    return text if len(text) <= MAX_RESULT_CHARS else text[:MAX_RESULT_CHARS] + "…(обрізано)"
