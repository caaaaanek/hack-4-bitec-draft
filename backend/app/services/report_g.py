"""Звіт за шаблоном Додатку Г Рекомендацій НУОУ.

Розділи шаблону: крос-таблиці відсоткових розподілів (РГ, ОС, експерти) → збіги й розбіжності →
висновок (рівень зрілості, ефективні напрями, напрями для уваги, факти) → пропозиції
(поточний і цільовий рівень, першочергові заходи з Додатку Д).

Тут лише складання вже порахованих даних знімка. Нових балів не рахуємо; кожен текст має `rule`.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Question, Section
from app.services import methodology as m
from app.services.scoring import fmt

# Порівнюємо РГ і ОС, як у шаблоні; експерти показуються окремою колонкою.
CATEGORY_ORDER = ["working_group", "staff", "expert"]
COMPARE = ("working_group", "staff")
SECTION_TITLES = {**{code: c["title"] for code, c in m.COMPONENTS.items()}, "overall": "Рівень зрілості доброчесності"}
SECTION_ORDER = [*m.COMPONENTS, "overall"]
EFFECTIVE_COUNT = 2
ATTENTION_COUNT = 3


def level_title(level: int) -> str:
    return f"{level} «{m.level_by_number(level)['title']}»"


def question_order(db: Session, questions: list[dict]) -> dict[str, tuple[int, int]]:
    """Порядок питань як в анкеті: (позиція розділу, позиція питання). Беремо анкету з найбільшою кількістю питань."""
    ids = {b["questionnaire_id"] for q in questions for b in q["by_category"]}
    wanted = {q["code"] for q in questions}  # без розділу «Відвертість»: його в індексі й звіті немає
    best: dict[str, tuple[int, int]] = {}
    for qid in ids:
        rows = db.execute(
            select(Question.code, Section.position, Question.position)
            .join(Section, Question.section_id == Section.id)
            .where(Section.questionnaire_id == uuid.UUID(str(qid)))
        ).all()
        order = {code: (sp, qp) for code, sp, qp in rows if code in wanted}
        if len(order) > len(best):
            best = order
    return best


def modal(distribution: list[dict]) -> dict | None:
    """Варіант з найбільшою часткою. За рівності беремо нижчий рівень (обережна оцінка)."""
    if not distribution or not any(o["percent"] for o in distribution):
        return None
    top = max(distribution, key=lambda o: (o["percent"], -o["option_score"]))
    return {"level": int(top["option_score"]), "percent": top["percent"]}


def agreement(by_cat: dict[str, dict]) -> dict:
    """Збіг чи розбіжність між РГ і ОС за правилом, яке видно в звіті."""
    gap = m.CATEGORY_GAP_POINTS
    rule = (f"Збіг: найчастіший рівень у РГ і ОС однаковий. Розбіжність: різниця середніх балів РГ і ОС більша за {gap:g}. "
            "Інакше часткова розбіжність. За однакової частки береться нижчий рівень.")
    wg, st = by_cat.get("working_group"), by_cat.get("staff")
    if wg is None or st is None:
        missing = "робочої групи" if wg is None else "особового складу"
        return {"type": "insufficient", "title": "порівняння неможливе",
                "text": f"Немає даних {missing}: група менша за поріг анонімності або не опитувалась.", "delta": None, "rule": rule}
    mw, ms = modal(wg["distribution"]), modal(st["distribution"])
    d = None if wg["score"] is None or st["score"] is None else round(wg["score"] - st["score"], 1)
    if mw is None or ms is None:
        return {"type": "insufficient", "title": "порівняння неможливе", "text": "Немає відповідей на це питання.", "delta": d, "rule": rule}
    if mw["level"] == ms["level"]:
        kind, title = "consensus", "збіг"
        text = (f"Обидві групи найчастіше обирають рівень {level_title(mw['level'])}: "
                f"{fmt(mw['percent'])}% РГ і {fmt(ms['percent'])}% ОС.")
    else:
        kind, title = ("divergence", "розбіжність") if d is not None and abs(d) > gap else ("partial", "часткова розбіжність")
        text = (f"РГ найчастіше обирає рівень {level_title(mw['level'])} ({fmt(mw['percent'])}%), "
                f"ОС рівень {level_title(ms['level'])} ({fmt(ms['percent'])}%).")
    if d is not None and d != 0:
        who = "РГ" if d > 0 else "ОС"
        text += f" {who} оцінює вище на {fmt(abs(d))} бала."
    expert = by_cat.get("expert")
    if expert is not None and (me := modal(expert["distribution"])) is not None:
        text += f" Експерти найчастіше обирають рівень {level_title(me['level'])} ({fmt(me['percent'])}%)."
    return {"type": kind, "title": title, "text": text, "delta": d, "rule": rule}


def crosstable(q: dict) -> tuple[list[str], list[dict]]:
    """Рядок на варіант: текст, рівень за моделлю НАЗК і частка кожної категорії."""
    by_cat = {b["category"]: b for b in q["by_category"]}
    categories = [c for c in CATEGORY_ORDER if c in by_cat]
    first = by_cat[categories[0]]["distribution"] if categories else []
    rows = []
    for i, option in enumerate(first):
        level = int(option["option_score"])
        rows.append({
            "option": option["option_text"],
            "level": level,
            "level_title": m.level_by_number(level)["title"],
            "percent": {c: by_cat[c]["distribution"][i]["percent"] if i < len(by_cat[c]["distribution"]) else None
                        for c in categories},
        })
    return categories, rows


def build(db: Session, report: dict) -> dict:
    questions = report["questions"]
    order = question_order(db, questions)
    sections: dict[str, list[dict]] = {code: [] for code in SECTION_ORDER}
    counts = {"consensus": 0, "partial": 0, "divergence": 0, "insufficient": 0}
    for q in sorted(questions, key=lambda x: order.get(x["code"], (99, 99))):
        section = q["component"] if q["component"] in m.COMPONENTS else "overall"
        categories, rows = crosstable(q)
        agree = agreement({b["category"]: b for b in q["by_category"]})
        counts[agree["type"]] += 1
        sections.setdefault(section, []).append({
            "code": q["code"],
            "text": q["text"],
            "score": q["score"],
            "categories": [{"category": c, "title": m.SOURCE_TITLES.get(c, c),
                            "n": next(b["n"] for b in q["by_category"] if b["category"] == c)} for c in categories],
            "rows": rows,
            "agreement": agree,
        })
    out_sections = []
    for code in SECTION_ORDER:
        items = sections.get(code) or []
        for i, item in enumerate(items, start=1):
            item["number"] = f"{SECTION_ORDER.index(code) + 1}.{i}"
        out_sections.append({"code": code, "title": SECTION_TITLES[code], "questions": items})

    return {
        "template": "Додаток Г Рекомендацій НУОУ (2025): звіт про результати опитувань з визначення поточного рівня зрілості доброчесності",
        "participants": participants(report["groups"]),
        "sections": out_sections,
        "agreement_counts": counts,
        "conclusion": conclusion(report),
        "proposals": proposals(report),
    }


def participants(groups: list[dict]) -> list[dict]:
    """Хто відповідав. Для груп, менших за поріг, кількостей не показуємо."""
    out = []
    for g in sorted(groups, key=lambda x: CATEGORY_ORDER.index(x["category"]) if x["category"] in CATEGORY_ORDER else 9):
        hidden = g.get("suppressed") or not g.get("sufficient")
        out.append({
            "category": g["category"],
            "title": g["title"],
            "submitted": None if hidden else g.get("submitted"),
            "eligible": None if hidden else g.get("eligible"),
            "participation_percent": None if hidden else g.get("participation_percent"),
            "included": not hidden,
            "text": ("Група менша за поріг анонімності, її відповіді враховано у вищому підрозділі." if hidden else
                     f"Анкету пройшли {g['submitted']} з {g['eligible']} респондентів ({fmt(g['participation_percent'])}%)."),
        })
    return out


def conclusion(report: dict) -> dict:
    index = report["index"]
    components = [c for c in report["components"] if c["score"] is not None]
    level = (index.get("level") or {}).get("level")
    if level is None:
        text = "Даних недостатньо, щоб визначити рівень зрілості: жодна група не досягла порогу анонімності."
    else:
        parts = ", ".join(f"{c['title']} {fmt(c['score'])} (рівень {level_title(c['level']['level'])})" for c in components)
        text = (f"На основі відповідей усіх груп респондентів, чек-листа й фактів за розділами «Культура», «Система» "
                f"та «Підзвітність» загальний рівень зрілості доброчесності оцінено як {level_title(level)}, "
                f"індекс доброчесності {fmt(index['score'])} зі 100, достовірність {index['reliability']}. За напрямами: {parts}.")
    ranked = sorted((q for q in report["questions"] if q["component"] in m.COMPONENTS and q["score"] is not None),
                    key=lambda q: q["score"])
    pick = lambda q: {"code": q["code"], "text": q["text"], "score": q["score"]}  # noqa: E731
    # Списки не перетинаються: коли питань мало, одне й те саме потрапляло і в «ефективні», і в «для уваги».
    attention = ranked[:ATTENTION_COUNT]
    effective = [q for q in reversed(ranked[ATTENTION_COUNT:][-EFFECTIVE_COUNT:])]
    facts = [f["label"] for f in report["facts"] if f.get("status") == "ok" and f.get("label")]
    return {
        "level": index.get("level"),
        "index": index["score"],
        "reliability": index["reliability"],
        "reliability_reasons": index.get("reliability_reasons", []),
        "components": [{"code": c["code"], "title": c["title"], "score": c["score"], "level": c["level"]} for c in components],
        "text": text,
        "effective": [pick(q) for q in effective],
        "attention": [pick(q) for q in attention],
        "facts": facts,
        "rule": (f"Ефективні напрями: {EFFECTIVE_COUNT} питання з найвищим середнім балом усіх груп. "
                 f"Напрями для уваги: {ATTENTION_COUNT} з найнижчим. Факти: показники з інших систем за 12 місяців."),
    }


def proposals(report: dict) -> dict:
    current = (report["index"].get("level") or {}).get("level")
    if current is None:
        return {"current_level": None, "target_level": None, "items": [], "priorities": [], "rule": ""}
    target = min(current + 1, 5)
    cur, tgt = m.level_by_number(current), m.level_by_number(target)
    items = [
        f"Врахувати отримані результати та поточний рівень зрілості «{cur['title']}» під час розробки Плану заходів "
        "забезпечення функціонування на засадах прозорості та доброчесності.",
        (f"Передбачити заходи для зміцнення досягнень і переходу від поточного рівня «{cur['title']}» "
         f"до цільового рівня «{tgt['title']}»." if target > current else
         "Підтримувати досягнутий рівень «Оптимізуючий» і вдосконалювати процеси на основі даних."),
    ]
    priorities = []
    for r in report.get("recommendations", []):
        if r.get("priority") != "high":
            continue
        decision = (r.get("decision") or {}).get("decision")
        priorities.append({
            "code": r["code"],
            "title": r["title"],
            "rule": r["rule"],
            "decision": getattr(decision, "value", decision),
            "measures": [f"{x['catalog_number']}. {x['title']}" if x.get("catalog_number") else x["title"]
                         for x in r.get("suggested_measures", [])],
        })
    return {
        "current_level": cur,
        "target_level": tgt,
        "items": items,
        "priorities": priorities,
        "rule": "Цільовий рівень: поточний + 1 (не вище 5). Першочергові напрями: рекомендації з високим пріоритетом, заходи з Додатку Д.",
    }
