"""Сценарій «що, якщо»: як зміниться Integrity Index, якщо закрити пункти чек-листа, виконати заходи
або підтягнути факти до цільових значень.

Розрахунок тією ж функцією `scoring.compute`, що й знімок хвилі. Нічого не зберігається: ні знімків,
ні заходів, ні журналу. Опитування не моделюються: змінюються лише чек-лист і факти, бо вони детерміновані.
"""

import copy
import uuid
from dataclasses import replace

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Campaign, Measure
from app.services import methodology as m
from app.services import results, scoring, titles
from app.services.recommendations import catalog_measure
from app.services.scoring import fmt

DISCLAIMER = ("Прогноз, не результат. Відповіді працівників, робочої групи й експертів не моделюються: "
              "змінюються лише чек-лист і факти. Справжній індекс покаже наступна хвиля.")
CHECKLIST_TARGETS = ("full", "partial", "none")
TOP_LEVERS = 5
# Зміна, меншу за яку не вважаємо приростом (округлення до 0,1).
EPS = 0.05


class WhatIfError(Exception):
    def __init__(self, message: str, code: str, hint: str = ""):
        super().__init__(message)
        self.message, self.code, self.hint = message, code, hint


# ---------- Зміни вхідних даних ----------

def set_checklist(items: list[scoring.ChecklistItem], number: str, status: str) -> scoring.ChecklistItem:
    """Пункт чек-листа в новому стані. Повністю = підтверджено уповноваженим (100 балів)."""
    index = next(i for i, item in enumerate(items) if item.number == number)
    old = items[index]
    items[index] = replace(old, status=status, score=m.CHECKLIST_STATUS_SCORES[status], confirmed=True)
    return old


def closed(items: list[scoring.ChecklistItem], number: str) -> bool:
    item = next(i for i in items if i.number == number)
    return item.score == 100 and item.confirmed


def set_fact(facts: list[dict], indicator: str, percent: float) -> dict:
    """Факт із цільовою часткою: бал через пороги methodology.FACTS, як у звичайному розрахунку."""
    index = next(i for i, f in enumerate(facts) if f["indicator"] == indicator)
    old = facts[index]
    level = m.fact_level(indicator, percent)
    score = (level - 1) * m.POINTS_PER_LEVEL
    den = old["denominator"]
    facts[index] = {**old, "percent": round(percent, 1), "numerator": round(den * percent / 100), "level": level,
                    "score": score, "rule": f"Прогноз: {fmt(percent)}% → рівень {level} за порогами "
                                            f"{m.FACTS[indicator]['thresholds']} → {score:g} балів."}
    return old


def check_fact(facts: list[dict], indicator: str, percent: float) -> None:
    if indicator not in m.FACTS:
        raise WhatIfError(f"Невідомий факт {indicator}", "fact_unknown")
    if not 0 <= percent <= 100:
        raise WhatIfError("Цільове значення факту має бути від 0 до 100 %", "fact_out_of_range")
    fact = next((f for f in facts if f["indicator"] == indicator), None)
    if fact is None or fact["status"] == "no_denominator":
        raise WhatIfError(f"«{m.FACTS[indicator]['title']}»: немає даних, змінювати нічого", "fact_no_data")
    if fact["status"] != "ok":
        # Інакше різниця прогнозів непрямо розкрила б приховане значення групи, меншої за k.
        raise WhatIfError(f"«{m.FACTS[indicator]['title']}»: дані приховано (менше k), змінювати не можна",
                          "fact_hidden", "Подивіться сценарій для вищого підрозділу.")


def apply(db: Session, inputs: results.Inputs, measure_ids: list[uuid.UUID], checklist: dict[str, str],
          facts: dict[str, float]) -> tuple[list | None, list[dict], list[dict]]:
    """Копії чек-листа й фактів зі змінами і перелік того, що застосовано (з поясненнями)."""
    items = copy.deepcopy(inputs.checklist) if inputs.checklist is not None else None
    fact_list = copy.deepcopy(inputs.facts)
    numbers = {i.number for i in items} if items is not None else set()
    applied: list[dict] = []

    def checklist_note(number: str) -> str | None:
        if items is None:
            return "Пункт чек-листа впливає на індекс закладу загалом, а не підрозділу: відкрийте сценарій для закладу."
        if number not in numbers:
            return None
        return ""

    if measure_ids:
        rows = db.scalars(select(Measure).where(Measure.id.in_(measure_ids))).all()
        # Захід поза підрозділом сценарію — так само «не знайдено»: ні назви, ні самого факту існування
        # чужого заходу керівник підрозділу з помилки не дізнається.
        rows = [r for r in rows if r.unit_id in inputs.units]
        found = {r.id for r in rows}
        missing = [str(x) for x in measure_ids if x not in found]
        if missing:
            raise WhatIfError("Заходи не знайдено в цьому підрозділі", "measure_not_found", ", ".join(missing))
        for x in rows:
            entry = {"kind": "measure", "id": str(x.id), "title": x.title, "catalog_number": x.catalog_number}
            note = checklist_note(x.catalog_number) if x.catalog_number else None
            if note is None:
                entry.update(effect=False, note="На розрахунок не впливає: захід не прив'язаний до пункту чек-листа. "
                                                 "Ефект перевіримо наступною хвилею.")
            elif note:
                entry.update(effect=False, note=note)
            elif x.catalog_number in checklist:
                entry.update(effect=False, note=f"Пункт {x.catalog_number} уже задано в сценарії окремо.")
            elif closed(items, x.catalog_number):
                entry.update(effect=False, note=f"Пункт чек-листа {x.catalog_number} уже закрито й підтверджено: "
                                                "на індекс не вплине.")
            else:
                old = set_checklist(items, x.catalog_number, "full")
                entry.update(effect=True, note=f"Пункт чек-листа {x.catalog_number}: "
                                               f"{titles.checklist_status(old.status)}"
                                               f"{'' if old.confirmed else ' (не підтверджено)'} → повністю, підтверджено.")
            applied.append(entry)

    for number, status in checklist.items():
        if status not in CHECKLIST_TARGETS:
            allowed = ", ".join(f"{code} ({title})" for code, title in titles.CHECKLIST_STATUS_SHORT.items())
            raise WhatIfError(f"Стан пункту {number} «{status}» не підтримується. Можливо: {allowed}", "checklist_status")
        note = checklist_note(number)
        if note is None:
            raise WhatIfError(f"Пункту чек-листа {number} немає в цій хвилі", "checklist_unknown")
        if note:
            applied.append({"kind": "checklist", "number": number, "effect": False, "note": note})
            continue
        old = set_checklist(items, number, status)
        applied.append({"kind": "checklist", "number": number, "effect": True, "title": old.text,
                        "note": f"{titles.checklist_status(old.status)} → {titles.checklist_status(status)}, "
                                "підтверджено."})

    for indicator, percent in facts.items():
        check_fact(fact_list, indicator, percent)
        old = set_fact(fact_list, indicator, percent)
        new = next(f for f in fact_list if f["indicator"] == indicator)
        applied.append({"kind": "fact", "indicator": indicator, "effect": new["score"] != old["score"],
                        "title": m.FACTS[indicator]["title"],
                        "note": f"{fmt(old['percent'])}% → {fmt(percent)}%: рівень {old['level']} → {new['level']}, "
                                f"бал {old['score']:g} → {new['score']:g}."})
    return items, fact_list, applied


# ---------- Розрахунок і порівняння ----------

def summary(result: dict) -> dict:
    idx = result["index"]
    return {
        "index": {"score": idx["score"], "self_score": idx["self_score"], "level": idx.get("level"),
                  "reliability": idx.get("reliability")},
        "components": [{"code": c["code"], "title": c["title"], "score": c["score"], "self_score": c["self_score"],
                        "facts_score": c["facts_score"], "cut_by_facts": c["cut_by_facts"], "level": c.get("level"),
                        "rule": c["rule"]} for c in result["components"]],
    }


def diff(a, b):
    return None if a is None or b is None else round(b - a, 1)


def explain(base: dict, scen: dict, touched: set[str]) -> dict[str, str]:
    """Пояснення до кожного компонента: чому зріс чи чому ні."""
    notes = {}
    for b, s in zip(base["components"], scen["components"], strict=True):
        d = diff(b["score"], s["score"])
        if b["code"] not in touched:
            notes[b["code"]] = "У сценарії не змінювали." if not d else s["rule"]
        elif d and abs(d) >= EPS:
            notes[b["code"]] = f"{b['title']}: {fmt(b['score'])} → {fmt(s['score'])}. {s['rule']}"
        elif s["cut_by_facts"] and s["facts_score"] is not None:
            ceiling = s["facts_score"] + m.REALITY_MARGIN
            notes[b["code"]] = (f"{b['title']} не зросла: стелю задають факти {fmt(s['facts_score'])} + "
                                f"{fmt(m.REALITY_MARGIN)} = {fmt(ceiling)}. Папером не підняти, потрібні зміни у фактах.")
        else:
            notes[b["code"]] = f"{b['title']}: зміни в сценарії на бал не вплинули. {s['rule']}"
    return notes


def touched_components(items: list | None, base_items: list | None, facts: list[dict], base_facts: list[dict]) -> set[str]:
    codes = set()
    for new, old in zip(items or [], base_items or [], strict=True):
        if (new.score, new.confirmed) != (old.score, old.confirmed) and new.component:
            codes.add(new.component)
    for new, old in zip(facts, base_facts, strict=True):
        if new.get("score") != old.get("score") or new.get("percent") != old.get("percent"):
            codes.add(new["component"])
    return codes


def options(inputs: results.Inputs) -> dict:
    """Що можна змінювати: пункти чек-листа і факти з порогами (для перемикачів і повзунків фронтенду)."""
    return {
        "checklist": [{"number": i.number, "text": i.text, "component": i.component, "status": i.status,
                       "score": i.score, "confirmed": i.confirmed} for i in inputs.checklist or []],
        "checklist_note": None if inputs.checklist is not None else
        "Чек-лист оцінює заклад загалом і змінюється лише в сценарії для всього закладу.",
        "facts": [{"indicator": f["indicator"], "title": f["title"], "component": f["component"],
                   "status": f["status"], "percent": f["percent"], "level": f["level"], "score": f["score"],
                   "thresholds": m.FACTS[f["indicator"]]["thresholds"], "editable": f["status"] == "ok"}
                  for f in inputs.facts],
    }


def levers(inputs: results.Inputs, base_index: float | None) -> list[dict]:
    """Найсильніші важелі: кожен незакритий пункт чек-листа (повністю + підтверджено) і кожен факт
    до наступного порогу. Приріст індексу рахується тією ж compute; повертаються топ-5 з приростом > 0."""
    if base_index is None:
        return []
    found = []
    for item in inputs.checklist or []:
        if item.score == 100 and item.confirmed:
            continue
        items = copy.deepcopy(inputs.checklist)
        set_checklist(items, item.number, "full")
        res = inputs.compute(checklist=items)
        measure = catalog_measure(item.number)
        found.append({"kind": "checklist", "number": item.number, "title": item.text, "component": item.component,
                      "change": f"пункт {item.number}: {titles.checklist_status(item.status)} → повністю, підтверджено",
                      "scenario": {"checklist": {item.number: "full"}}, "index": res["index"]["score"],
                      "measure": measure})
    for fact in inputs.facts:
        if fact["status"] != "ok" or fact["level"] >= 5:
            continue
        target = float(m.FACTS[fact["indicator"]]["thresholds"][fact["level"] - 1])
        facts = copy.deepcopy(inputs.facts)
        set_fact(facts, fact["indicator"], target)
        res = inputs.compute(facts=facts)
        found.append({"kind": "fact", "indicator": fact["indicator"], "title": fact["title"],
                      "component": fact["component"],
                      "change": f"{fmt(fact['percent'])}% → {fmt(target)}% (рівень {fact['level']} → {fact['level'] + 1})",
                      "scenario": {"facts": {fact["indicator"]: target}}, "index": res["index"]["score"],
                      "measure": None})
    for x in found:
        x["delta_index"] = diff(base_index, x["index"])
    useful = [x for x in found if x["delta_index"] is not None and x["delta_index"] >= EPS]
    useful.sort(key=lambda x: (-x["delta_index"], x["kind"], x.get("number") or x.get("indicator")))
    return useful[:TOP_LEVERS]


def simulate(db: Session, campaign: Campaign, unit_id: uuid.UUID | None, measure_ids: list[uuid.UUID],
             checklist: dict[str, str], facts: dict[str, float], with_levers: bool = True) -> dict:
    inputs = results.load_inputs(db, campaign, unit_id)
    base_res = inputs.compute()
    items, fact_list, applied = apply(db, inputs, measure_ids, checklist, facts)
    scen_res = inputs.compute(checklist=items, facts=fact_list)
    base, scen = summary(base_res), summary(scen_res)
    touched = touched_components(items, inputs.checklist, fact_list, inputs.facts)
    notes = explain(base, scen, touched)
    for c in scen["components"]:
        c["explanation"] = notes[c["code"]]
    return {
        "campaign_id": str(campaign.id),
        "unit_id": str(inputs.scope),
        "unit_name": inputs.wave.unit_names.get(inputs.scope, ""),
        "at_root": inputs.checklist is not None,
        "baseline": base,
        "scenario": scen,
        "delta": {"index": diff(base["index"]["score"], scen["index"]["score"]),
                  "components": {b["code"]: diff(b["score"], s["score"])
                                 for b, s in zip(base["components"], scen["components"], strict=True)}},
        "applied": applied,
        "levers": levers(inputs, base["index"]["score"]) if with_levers else [],
        "options": options(inputs),
        "disclaimer": DISCLAIMER,
    }
