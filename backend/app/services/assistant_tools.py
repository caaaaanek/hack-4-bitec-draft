"""Інструменти асистента (tool calling): модель сама просить дані, бекенд їх дає.

Усі інструменти лише читають і виконуються від імені користувача, що питає: ті самі перевірки доступу
(керівник підрозділу бачить лише свій підрозділ), ті самі агрегати з порогом k, що й у звичайному API.
Нічого не змінюють. Віддають стислі дані, щоб вмістилися в контекст моделі.
"""

import json
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Measure, Role, Unit, User
from app.security import ensure_unit_access
from app.services import measures as measures_service
from app.services import methodology, results
from app.services.units import subtree_ids

MAX_RESULT_CHARS = 12000

_UNIT_PARAM = {"unit_id": {"type": "string", "description": "id підрозділу з list_units; без нього — підрозділ користувача"}}

TOOLS = [
    {"type": "function", "function": {
        "name": "get_methodology",
        "description": "Методика Integrity Index: ваги джерел, пороги фактів, правило реальності, рівні, достовірність.",
        "parameters": {"type": "object", "properties": {}}}},
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


class ToolError(Exception):
    """Помилка інструмента, яку варто показати моделі (наприклад, немає доступу чи немає закритої хвилі)."""


def _unit(db: Session, user: User, args: dict) -> uuid.UUID | None:
    raw = args.get("unit_id")
    if raw:
        try:
            unit_id = uuid.UUID(str(raw))
        except ValueError:
            raise ToolError("unit_id має бути id з list_units")
    elif user.role == Role.LEADER and user.unit_id is not None:
        unit_id = user.unit_id
    else:
        return None
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
    return {"units": [{"id": str(u.id), "name": u.name} for u in db.scalars(query)]}


def _methodology(*_) -> dict:
    data = methodology.as_dict()
    return {k: data[k] for k in ("version", "points_per_level", "source_weights", "reality_margin", "weak_link_max_gap",
                                 "significant_delta", "rules")} | {
        "facts": {code: {"title": f["title"], "thresholds": f["thresholds"]} for code, f in data["facts"].items()}}


_HANDLERS = {"get_methodology": _methodology, "list_units": _units, "get_results": _results,
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
        out = _HANDLERS[name](db, user, arguments if isinstance(arguments, dict) else {})
    except ToolError as e:
        out = {"error": str(e)}
    except HTTPException as e:
        out = {"error": e.detail if isinstance(e.detail, str) else "Дані недоступні"}
    except Exception:  # noqa: BLE001 — збій одного інструмента не має ламати відповідь; деталі моделі не потрібні
        db.rollback()
        out = {"error": "Дані тимчасово недоступні"}
    text = json.dumps(out, ensure_ascii=False, default=str)
    return text if len(text) <= MAX_RESULT_CHARS else text[:MAX_RESULT_CHARS] + "…(обрізано)"
