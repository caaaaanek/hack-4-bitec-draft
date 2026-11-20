"""Інструменти керівника й аудиту поверх знімка хвилі, без нових балів:

- next_level_plan — «Шлях до наступного рівня»: мінімальний набір заходів (жадібно, тією ж compute, що й
  знімок), щоб індекс досяг наступного рівня зрілості; формат Плану заходів (Додаток Д): захід,
  відповідальний (посада), строк, індикатор, очікуваний ефект;
- briefing — «Брифінг за 30 секунд»: одна сторінка для вищого керівника — 3 числа, 3 ризики, 3 рішення;
- audit_lottery — «Лотерея перевірок»: доказово випадковий вибір пунктів чек-листа для глибокої перевірки
  аудитом. Зерно — хеш знімка закритої хвилі: ніхто не передбачить і не змінить вибір, кожен його перевірить;
- sensitivity — перевірка стійкості ваг: як змінюється індекс при зміні кожної ваги джерела на ±10 %.
"""

import copy
import hashlib
import io
import json
import uuid
from datetime import timedelta

from sqlalchemy.orm import Session

from app.clock import today
from app.models import Campaign
from app.services import methodology as m
from app.services import results
from app.services.recommendations import catalog_measure, recommend
from app.services.scoring import fmt
from app.services.what_if import set_checklist, set_fact

PLAN_MAX_STEPS = 15
# Строк заходу за замовчуванням: до наступної хвилі (піврічний цикл).
DEFAULT_DUE_DAYS = 180
SENSITIVITY_STEP = 0.10


# ---------- Шлях до наступного рівня ----------

def _candidates(inputs, items, facts):
    for item in items or []:
        if item.score == 100 and item.confirmed:
            continue
        yield "checklist", item.number, item
    for fact in facts:
        if fact["status"] == "ok" and fact["level"] < 5:
            yield "fact", fact["indicator"], fact


def next_level_plan(db: Session, campaign: Campaign, unit_id: uuid.UUID | None) -> dict:
    inputs = results.load_inputs(db, campaign, unit_id)
    base = inputs.compute(reuse_surveys=True)
    index = base["index"]
    if index["score"] is None:
        return {"status": "insufficient_data", "steps": [], "note": "Недостатньо даних для розрахунку індексу."}
    current = index["level"]["level"]
    if current >= 5:
        return {"status": "top", "current_level": index["level"], "steps": [],
                "note": "Заклад уже на найвищому рівні: план — підтримувати досягнуте."}
    target = current + 1
    items = copy.deepcopy(inputs.checklist) if inputs.checklist is not None else None
    facts = copy.deepcopy(inputs.facts)
    steps = []
    score = index["score"]
    reached = False
    for _ in range(PLAN_MAX_STEPS):
        best = None
        for kind, key, obj in _candidates(inputs, items, facts):
            t_items, t_facts = copy.deepcopy(items), copy.deepcopy(facts)
            if kind == "checklist":
                set_checklist(t_items, key, "full")
            else:
                set_fact(t_facts, key, float(m.FACTS[key]["thresholds"][obj["level"] - 1]))
            res = inputs.compute(checklist=t_items, facts=t_facts, reuse_surveys=True)
            gain = (res["index"]["score"] or 0) - score
            if gain > 0.05 and (best is None or gain > best[0]):
                best = (gain, kind, key, obj, t_items, t_facts, res)
        if best is None:
            break
        gain, kind, key, obj, items, facts, res = best
        score = res["index"]["score"]
        if kind == "checklist":
            measure = catalog_measure(key) or {}
            steps.append({"kind": "checklist", "number": key, "title": measure.get("title") or obj.text,
                          "responsible": measure.get("responsible") or "Уповноважена особа",
                          "indicator": measure.get("indicator") or f"Пункт {key} чек-листа впроваджено повністю й підтверджено",
                          "component": obj.component, "gain": round(gain, 1), "index_after": round(score, 1),
                          "level_after": res["index"]["level"]["level"]})
        else:
            spec = m.FACTS[key]
            steps.append({"kind": "fact", "number": None,
                          "title": f"Підтягнути «{spec['title']}» до {fmt(spec['thresholds'][obj['level'] - 1])}%",
                          "responsible": "Власник системи-джерела факту", "component": spec["component"],
                          "indicator": f"{spec['title']}: не нижче {fmt(spec['thresholds'][obj['level'] - 1])}%",
                          "gain": round(gain, 1), "index_after": round(score, 1),
                          "level_after": res["index"]["level"]["level"]})
        if res["index"]["level"]["level"] >= target:
            reached = True
            break
    due = today() + timedelta(days=DEFAULT_DUE_DAYS)
    for n, step in enumerate(steps, start=1):
        step["no"] = n
        step["due_date"] = due.isoformat()
    note = None
    if not reached:
        note = ("Лише заходами з чек-листа й фактами наступного рівня не досягти: обмежує самооцінка особового "
                "складу чи найслабший компонент. Потрібні заходи культури, ефект яких покаже наступна хвиля.")
    return {
        "status": "reached" if reached else "partial",
        "campaign_id": str(campaign.id), "unit_id": str(inputs.scope),
        "unit_name": inputs.wave.unit_names.get(inputs.scope, ""),
        "current_level": index["level"], "target_level": m.level_by_number(target),
        "index": index["score"], "index_after": round(score, 1), "steps": steps, "note": note,
        "rule": "Жадібний підбір: на кожному кроці захід з найбільшим приростом індексу (тією ж compute, що й "
                "знімок), доки не досягнуто наступного рівня. Опитування не моделюються. Формат — План заходів "
                "(Додаток Д): захід, відповідальний (посада), строк, індикатор виконання.",
    }


def plan_docx(plan: dict) -> bytes:
    from docx import Document

    doc = Document()
    doc.add_heading("План заходів: шлях до наступного рівня зрілості", level=1)
    if plan.get("current_level"):
        doc.add_paragraph(f"{plan.get('unit_name', '')}. Поточний рівень: {plan['current_level']['level']} "
                          f"«{plan['current_level']['title']}». Цільовий: "
                          f"{plan['target_level']['level']} «{plan['target_level']['title']}»." if plan.get("target_level")
                          else plan.get("note") or "")
    table = doc.add_table(rows=1, cols=5)
    table.style = "Table Grid"
    for cell, title in zip(table.rows[0].cells, ["№", "Захід", "Відповідальний (посада)", "Строк", "Індикатор виконання"]):
        cell.text = title
    for s in plan["steps"]:
        row = table.add_row().cells
        row[0].text, row[1].text, row[2].text = str(s["no"]), s["title"], s["responsible"]
        row[3].text, row[4].text = s["due_date"], s["indicator"]
    if plan.get("note"):
        doc.add_paragraph(plan["note"])
    doc.add_paragraph("Чернетка, сформована системою. Затверджує керівник; відповідальні — посади, не особи.")
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


# ---------- Брифінг за 30 секунд ----------

def briefing(data: dict, signals: list[dict] | None = None) -> dict:
    idx = data["index"]
    groups = [g for g in data.get("groups", []) if g.get("participation_percent") is not None]
    participation = round(sum(g["participation_percent"] for g in groups) / len(groups), 1) if groups else None
    numbers = [
        {"label": "Індекс доброчесності", "value": idx["score"],
         "text": f"{fmt(idx['score'])} зі 100, рівень {idx['level']['level']}" if idx["score"] is not None else "—"},
        {"label": "Достовірність", "value": idx["reliability"], "text": idx["reliability"]},
        {"label": "Участь", "value": participation, "text": f"{fmt(participation)}%" if participation is not None else "—"},
    ]
    risks = []
    for c in sorted([c for c in data["components"] if c["score"] is not None], key=lambda c: c["score"])[:2]:
        risks.append(f"{c['title']}: {fmt(c['score'])} ({c['zone']['title'].lower()})"
                     + (" — самооцінку не підтверджують факти" if c.get("cut_by_facts") else ""))
    for reason in idx.get("reliability_reasons", []):
        if len(risks) >= 3:
            break
        risks.append(reason)
    candor_card = ((data.get("candor") or {}).get("card") or [])
    if len(risks) < 3 and candor_card:
        risks.append(candor_card[0])
    recs = recommend(data, signals or [])
    decisions = [{"title": r["title"], "priority": r["priority_title"]} for r in recs[:3]]
    return {"unit_name": data.get("unit_name"), "campaign_title": data.get("campaign_title"),
            "closed_on": data.get("closed_on"), "numbers": numbers, "risks": risks[:3], "decisions": decisions,
            "rule": "3 числа (індекс, достовірність, участь), 3 найбільші ризики (найслабші компоненти й причини "
                    "достовірності), 3 рішення (перші рекомендації за пріоритетом)."}


def briefing_docx(b: dict) -> bytes:
    from docx import Document

    doc = Document()
    doc.add_heading(f"Брифінг: {b.get('unit_name') or ''}", level=1)
    doc.add_paragraph(f"{b.get('campaign_title') or ''}, {b.get('closed_on') or ''}")
    doc.add_heading("3 числа", level=2)
    for n in b["numbers"]:
        doc.add_paragraph(f"{n['label']}: {n['text']}", style="List Bullet")
    doc.add_heading("3 ризики", level=2)
    for r in b["risks"]:
        doc.add_paragraph(r, style="List Bullet")
    doc.add_heading("3 рішення", level=2)
    for d in b["decisions"]:
        doc.add_paragraph(f"{d['title']} ({d['priority']})", style="List Bullet")
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


# ---------- Лотерея перевірок ----------

def snapshot_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                                     default=str).encode()).hexdigest()


def draw(seed: str, population: list[str], count: int) -> list[str]:
    """Детермінований вибір без повторів: порядок за sha256(зерно ‖ номер пункту)."""
    ranked = sorted(population, key=lambda x: hashlib.sha256(f"{seed}:{x}".encode()).hexdigest())
    return ranked[:count]


def audit_lottery(payload: dict, count: int) -> dict:
    checklist = payload.get("checklist") or {}
    items = [i for i in checklist.get("items", []) if i.get("status")]
    seed = snapshot_hash(payload)
    picked = set(draw(seed, [i["number"] for i in items], count))
    chosen = [i for i in items if i["number"] in picked]
    chosen.sort(key=lambda i: hashlib.sha256(f"{seed}:{i['number']}".encode()).hexdigest())
    return {
        "seed": seed, "count": len(chosen), "population": len(items),
        "items": [{"number": i["number"], "text": i["text"], "status": i["status"], "confirmed": i["confirmed"]}
                  for i in chosen],
        "rule": "Зерно — sha256 канонічного JSON знімка закритої хвилі (корінь). Пункти впорядковуються за "
                "sha256(зерно:номер), береться перші count. Знімок незмінний, тож вибір не підкрутити, а кожен може "
                "його перерахувати. Під перевірку може потрапити будь-який заповнений пункт.",
    }


# ---------- Стійкість ваг ----------

def sensitivity(db: Session, campaign: Campaign, unit_id: uuid.UUID | None) -> dict:
    inputs = results.load_inputs(db, campaign, unit_id)
    base = inputs.compute()
    base_score = base["index"]["score"]
    rows = []
    if base_score is None:
        return {"index": None, "rows": [], "note": "Недостатньо даних"}
    base_weights = dict(inputs.weights)
    for source, weight in base_weights.items():
        for sign in (-1, 1):
            changed = dict(base_weights)
            changed[source] = weight * (1 + sign * SENSITIVITY_STEP)
            inputs.weights = changed
            res = inputs.compute()
            rows.append({"source": source, "change": f"{'+' if sign > 0 else '−'}{round(SENSITIVITY_STEP * 100)}%",
                         "weight": round(changed[source], 4), "index": res["index"]["score"],
                         "delta": round((res["index"]["score"] or 0) - base_score, 2),
                         "level": res["index"]["level"]["level"] if res["index"]["level"] else None})
    inputs.weights = base_weights
    deltas = [abs(r["delta"]) for r in rows]
    level_changes = [r for r in rows if r["level"] != base["index"]["level"]["level"]]
    return {
        "index": base_score, "level": base["index"]["level"], "rows": rows,
        "max_abs_delta": max(deltas) if deltas else 0.0,
        "level_stable": not level_changes,
        "verdict": ("Стійко: зміна кожної ваги на ±10 % не змінює рівня, найбільший зсув "
                    f"{fmt(max(deltas) if deltas else 0)} бала." if not level_changes else
                    "Чутливо: зміна ваги " + ", ".join(sorted({r['source'] for r in level_changes}))
                    + " на ±10 % змінює рівень. Обговоріть ваги перед затвердженням."),
        "rule": "Кожна вага джерела по черзі змінюється на ±10 % (інші без змін; ваги нормуються в розрахунку), "
                "індекс перераховується тією ж compute.",
    }
