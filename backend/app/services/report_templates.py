"""Шаблони звіту хвилі. Усі будуються з того самого JSON `GET /campaigns/{id}/report`, без нових розрахунків.

- `appendix_g` — повний звіт за Додатком Г Рекомендацій НУОУ (крос-таблиці, збіги й розбіжності, висновок, пропозиції);
- `brief` — довідка керівнику на 1–2 сторінки: індекс, компоненти, головні ризики, рішення, які треба ухвалити;
- `measures` — звіт про стан виконання Плану заходів (Додаток Д): строки, прострочення, перевірка наступною хвилею;
- `dynamics` — порівняння з попередньою хвилею: індекс, компоненти, питання з найбільшою зміною.

Word (.docx) має окрему структуру для кожного шаблону; JSON, CSV і Excel однакові для всіх (повні дані звіту).
"""

import io

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt

from app.services import report_export as rx
from app.services.scoring import fmt

TEMPLATES: dict[str, dict] = {
    "appendix_g": {
        "title": "Звіт за Додатком Г",
        "description": "Повний звіт про результати опитувань за формою Додатку Г Рекомендацій НУОУ: "
                       "крос-таблиці РГ / ОС / експерти, збіги й розбіжності, висновок, пропозиції.",
        "audience": "робоча група, НАЗК",
    },
    "brief": {
        "title": "Довідка керівнику",
        "description": "Одна-дві сторінки: індекс і рівень, компоненти, що знизило оцінку, рекомендації без рішення.",
        "audience": "керівник закладу",
    },
    "measures": {
        "title": "Стан виконання Плану заходів",
        "description": "Заходи з Додатку Д: відповідальні, строки, прострочення, перевірка результату наступною хвилею.",
        "audience": "керівник, уповноважений, аудитор",
    },
    "dynamics": {
        "title": "Динаміка між хвилями",
        "description": "Порівняння з попередньою хвилею: індекс, компоненти, питання з найбільшою зміною, значущість змін.",
        "audience": "керівник, робоча група",
    },
}
DEFAULT_TEMPLATE = "appendix_g"
TEMPLATE_PATTERN = "^(" + "|".join(TEMPLATES) + ")$"
# Скільки питань з найбільшою зміною показувати в динаміці.
TOP_QUESTIONS = 8


def catalog() -> list[dict]:
    return [{"code": code, **meta} for code, meta in TEMPLATES.items()]


def describe(code: str) -> dict:
    return {"code": code, **TEMPLATES[code]}


def signed(value) -> str:
    if value is None:
        return "немає даних"
    return f"+{fmt(value)}" if value > 0 else fmt(value)


# ---------- спільні частини Word ----------

def _document() -> Document:
    doc = Document()
    for section in doc.sections:
        section.left_margin = section.right_margin = Cm(2)
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(12)
    return doc


def _header(doc: Document, report: dict, kind: str) -> None:
    meta = report["report"]
    title = doc.add_heading(TEMPLATES[kind]["title"].upper(), level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub = doc.add_paragraph(report["unit_name"])
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph(f"Хвиля оцінювання: {meta['campaign_title']}, закрита {rx.day(meta['closed_on'])}. "
                      f"Методика індексу доброчесності версії {meta['methodology_version']}.")


def _footer(doc: Document, report: dict) -> bytes:
    doc.add_paragraph()
    doc.add_paragraph("Підготував  ____________________   «___» ____________ 20__ року")
    doc.add_paragraph(report["report"]["note"] + " Усі числа розраховано правилами методики; поле «як пораховано» "
                      "є в повному звіті.").runs[0].italic = True
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def _table(doc: Document, header: list[str], rows: list[list[str]], widths: list[float]):
    table = doc.add_table(rows=1, cols=len(header))
    table.style = "Table Grid"
    for cell, text in zip(table.rows[0].cells, header, strict=True):
        cell.text = text
    for row in rows:
        for cell, text in zip(table.add_row().cells, row, strict=True):
            cell.text = "" if text is None else str(text)
    rx.shape_table(table, widths)
    return table


def _measure_status(x: dict) -> str:
    status = rx.STATUS_TITLES.get(rx.val(x["status"]), rx.val(x["status"]))
    if x.get("overdue"):
        status += f" (прострочено{', ' + str(x['overdue_days']) + ' дн.' if x.get('overdue_days') else ''})"
    return status


def _verification(x: dict) -> str:
    v = x.get("verification") or {}
    if not v:
        return ""
    text = v.get("title", "")
    if v.get("delta") is not None:
        text += f": {rx.num(v.get('previous'))} → {rx.num(v.get('current'))}"
    return text


# ---------- Довідка керівнику ----------

def brief_docx(report: dict) -> bytes:
    doc = _document()
    _header(doc, report, "brief")
    idx = report["index"]
    level = (idx.get("level") or {}).get("title", "")

    doc.add_heading("Головне", level=1)
    # Висновки вже сформульовані правилами (summary); тут лише вони, без власних формулювань.
    for text in report["summary"] or [f"Індекс доброчесності {rx.num(idx['score'])} зі 100, рівень «{level}»."]:
        doc.add_paragraph(text, style="List Bullet")

    doc.add_heading("Компоненти", level=1)
    _table(doc, ["Компонент", "Самооцінка", "Факти", "Зараховано", "Рівень", "Достовірність"],
           [[c["title"], rx.num(c["self_score"]), rx.num(c["facts_score"]), rx.num(c["score"]),
             (c.get("level") or {}).get("title", ""), c["reliability"]] for c in report["components"]],
           [4.0, 2.5, 2.2, 2.5, 3.0, 2.3])

    risks = [c for c in report["components"] if c.get("cut_by_facts")]
    cut_titles = tuple(f"{c['title']}:" for c in risks)
    reasons = [r for r in idx.get("reliability_reasons") or [] if not r.startswith(cut_titles) or not cut_titles]
    if risks or reasons or report["discrepancies"]:
        doc.add_heading("Що знизило оцінку", level=1)
        for c in risks:
            doc.add_paragraph(f"{c['title']}: {c['rule']}", style="List Bullet")
        for r in reasons:
            doc.add_paragraph(r, style="List Bullet")
        for d in report["discrepancies"][:3]:
            doc.add_paragraph(f"{d['subject']}: {d['description']}", style="List Bullet")

    pending = [r for r in report["recommendations"] if not r.get("decision")]
    doc.add_heading("Потрібне рішення керівника", level=1)
    if pending:
        _table(doc, ["Пріоритет", "Рекомендація", "Підстава"],
               [[r["priority_title"], r["title"], r["rule"]] for r in pending[:6]], [2.4, 6.6, 7.5])
        if len(pending) > 6:
            doc.add_paragraph(f"Ще {len(pending) - 6} рекомендацій нижчого пріоритету — на екрані «Рекомендації».")
    else:
        doc.add_paragraph("Усі рекомендації вже мають рішення.")

    overdue = [x for x in report["measures"] if x.get("overdue")]
    if report["measures"]:
        done = sum(1 for x in report["measures"] if rx.val(x["status"]) == "done")
        doc.add_paragraph(f"План заходів: виконано {done} з {len(report['measures'])}, прострочено {len(overdue)}.")
    return _footer(doc, report)


# ---------- Стан виконання Плану заходів ----------

def measures_docx(report: dict) -> bytes:
    doc = _document()
    _header(doc, report, "measures")
    items = report["measures"]
    if not items:
        doc.add_paragraph("Заходів для цього підрозділу ще не заплановано.")
        return _footer(doc, report)

    counts: dict[str, int] = {}
    for x in items:
        counts[rx.val(x["status"])] = counts.get(rx.val(x["status"]), 0) + 1
    overdue = [x for x in items if x.get("overdue")]
    doc.add_heading("Підсумок", level=1)
    doc.add_paragraph(f"Усього заходів: {len(items)} (" + ", ".join(
        f"{rx.STATUS_TITLES.get(k, k)} {v}" for k, v in counts.items()) + f"). Прострочено: {len(overdue)}.")

    doc.add_heading("Перелік заходів", level=1)
    _table(doc, ["№ (Д)", "Захід", "Відповідальний", "Строк", "Стан", "Перевірка наступною хвилею"],
           [[x.get("catalog_number") or "", x["title"], x["owner"], rx.day(x["due_date"]), _measure_status(x), _verification(x)]
            for x in items], [1.4, 5.2, 3.4, 2.0, 2.4, 2.6])

    if overdue:
        doc.add_heading("Прострочені заходи", level=1)
        for x in overdue:
            doc.add_paragraph(f"{x['title']} — {x['owner']}, строк {rx.day(x['due_date'])}"
                              + (f", прострочено на {x['overdue_days']} дн." if x.get("overdue_days") else "."),
                              style="List Bullet")

    checked = [x for x in items if (x.get("verification") or {}).get("delta") is not None]
    if checked:
        doc.add_heading("Чи дали заходи результат", level=1)
        doc.add_paragraph("Перевірка: бал компонента, на який спрямовано захід, у хвилі після виконання порівняно з хвилею, "
                          "з якої виникла рекомендація.")
        for x in checked:
            doc.add_paragraph(f"{x['title']}: {_verification(x)}", style="List Bullet")
    return _footer(doc, report)


# ---------- Динаміка між хвилями ----------

def dynamics_docx(report: dict) -> bytes:
    doc = _document()
    _header(doc, report, "dynamics")
    dyn = report.get("dynamics") or {}
    idx = report["index"]
    if not dyn.get("previous_campaign_id"):
        doc.add_paragraph("Попередньої закритої хвилі для цього підрозділу немає: динаміку буде видно після наступної хвилі.")
        doc.add_paragraph(f"Поточний індекс доброчесності: {rx.num(idx['score'])} зі 100.")
        return _footer(doc, report)

    doc.add_heading("Індекс", level=1)
    sig = (dyn.get("index_significance") or {}).get("title", "")
    doc.add_paragraph(f"«{dyn['previous_title']}» ({rx.day(dyn['previous_closed_on'])}): {rx.num(dyn['previous_index'])}, "
                      f"достовірність {dyn.get('previous_reliability') or '—'}. Зараз: {rx.num(idx['score'])}, "
                      f"достовірність {idx['reliability']}. Зміна {signed(dyn.get('index_delta'))} бала"
                      + (f" ({sig})." if sig else "."))
    if dyn.get("rule"):
        doc.add_paragraph(dyn["rule"]).runs[0].italic = True
    versions = sorted(set(dyn.get("methodology_versions") or []))
    if len(versions) > 1:
        doc.add_paragraph(f"Увага: хвилі пораховано різними версіями методики ({', '.join(versions)}); порівнюйте обережно.")

    doc.add_heading("Компоненти", level=1)
    _table(doc, ["Компонент", "Було", "Стало", "Зміна", "Оцінка зміни"],
           [[c["title"], rx.num(c.get("previous")), rx.num(c.get("current")), signed(c.get("delta")),
             (c.get("significance") or {}).get("title", "")] for c in dyn.get("components", [])],
           [4.5, 2.5, 2.5, 2.5, 4.5])

    questions = [q for q in dyn.get("questions", []) if q.get("delta") is not None]
    if questions:
        texts = {q["code"]: q["text"] for q in report.get("questions", []) if q.get("code")}
        top = sorted(questions, key=lambda q: abs(q["delta"]), reverse=True)[:TOP_QUESTIONS]
        doc.add_heading("Питання з найбільшою зміною", level=1)
        _table(doc, ["Питання", "Було", "Стало", "Зміна"],
               [[texts.get(q["code"], q["code"]), rx.num(q["previous"]), rx.num(q["current"]), signed(q["delta"])]
                for q in top], [10.0, 2.2, 2.2, 2.1])
    return _footer(doc, report)


DOCX = {
    "appendix_g": rx.to_docx,
    "brief": brief_docx,
    "measures": measures_docx,
    "dynamics": dynamics_docx,
}
