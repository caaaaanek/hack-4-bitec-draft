"""Звіт хвилі файлом: Word (.docx) за структурою Додатку Г і Excel (.xlsx) з таблицями.

Обидва формати будуються з того самого JSON, що й `GET /campaigns/{id}/report`, без нових розрахунків.
Бібліотеки працюють локально, без зовнішніх сервісів (закритий контур).
"""

import io

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.services.safe_export import safe_row
from app.services.scoring import fmt
from app.services.titles import DECISION_TITLES, MEASURE_STATUS_TITLES

CATEGORY_SHORT = {"working_group": "РГ", "staff": "ОС", "expert": "Експерти"}
STATUS_TITLES = MEASURE_STATUS_TITLES


def pct(value) -> str:
    return "" if value is None else f"{fmt(value)}%"


def num(value) -> str:
    return "немає даних" if value is None else fmt(value)


def day(iso) -> str:
    """2026-05-19 → 19.05.2026."""
    text = str(iso or "")
    return ".".join(reversed(text.split("-"))) if len(text) == 10 else text


def val(x) -> str:
    """Значення enum або рядок."""
    return getattr(x, "value", x) or ""


# ---------- Word ----------

TABLE_FONT = Pt(9)


def shape_table(table, widths_cm: list[float]) -> None:
    """Фіксована ширина колонок і дрібніший шрифт, щоб довгі варіанти відповідей не розтягували звіт."""
    table.autofit = False
    for column, width in zip(table.columns, widths_cm, strict=True):
        column.width = Cm(width)  # LibreOffice бере ширину з сітки таблиці
    for row in table.rows:
        for cell, width in zip(row.cells, widths_cm, strict=True):
            cell.width = Cm(width)
            for p in cell.paragraphs:
                for run in p.runs:
                    run.font.size = TABLE_FONT
    for cell in table.rows[0].cells:
        for p in cell.paragraphs:
            for run in p.runs:
                run.bold = True

def to_docx(report: dict) -> bytes:
    g = report["appendix_g"]
    meta = report["report"]
    doc = Document()
    for section in doc.sections:
        section.left_margin = section.right_margin = Cm(2)
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(12)

    for line in ("ЗАТВЕРДЖУЮ", "Голова робочої групи", "____________________", "«___» ____________ 20__ року"):
        p = doc.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    title = doc.add_heading("ЗВІТ", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub = doc.add_paragraph(f"про результати опитувань з визначення поточного рівня зрілості доброчесності: {report['unit_name']}")
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph(f"Хвиля оцінювання: {meta['campaign_title']}, закрита {day(meta['closed_on'])}. "
                      f"Методика індексу доброчесності версії {meta['methodology_version']}.")

    doc.add_heading("Учасники опитування", level=1)
    for p in g["participants"]:
        doc.add_paragraph(f"{p['title']}: {p['text']}", style="List Bullet")
    doc.add_paragraph(f"Анонімність: результати показуються лише для груп від {meta['min_group_size']} респондентів. "
                      "Відповіді зберігаються окремо від того, хто їх надав.")

    doc.add_heading("Обробка матеріалів опитування", level=1)
    for line in ("побудова порівняльних (крос-) таблиць на основі відсоткових розподілів відповідей;",
                 "порівняння даних з пошуком збігів (консенсусів) і виявленням розбіжностей;",
                 "формулювання висновків про поточний рівень зрілості за напрямами Культура, Система, Підзвітність;",
                 "виявлення сильних сторін і слабких місць як підґрунтя для Плану заходів."):
        doc.add_paragraph(line, style="List Bullet")

    doc.add_heading("Основна частина", level=1)
    for section in g["sections"]:
        if not section["questions"]:
            continue
        doc.add_heading(f"Розділ {section['questions'][0]['number'].split('.')[0]}. {section['title']}", level=2)
        for q in section["questions"]:
            doc.add_heading(f"{q['number']}. {q['text']}", level=3)
            cats = q["categories"]
            table = doc.add_table(rows=1, cols=2 + len(cats))
            table.style = "Table Grid"
            head = table.rows[0].cells
            head[0].text = "Варіант відповіді"
            for i, c in enumerate(cats):
                head[1 + i].text = f"{c['title'].capitalize()}, % (n={c['n']})"
            head[-1].text = "Рівень зрілості (модель НАЗК)"
            for row in q["rows"]:
                cells = table.add_row().cells
                cells[0].text = row["option"]
                for i, c in enumerate(cats):
                    cells[1 + i].text = pct(row["percent"].get(c["category"]))
                cells[-1].text = f"{row['level']}. {row['level_title']}"
            shape_table(table, [16.5 - 1.8 * len(cats) - 3.0, *([1.8] * len(cats)), 3.0])
            agree = q["agreement"]
            p = doc.add_paragraph()
            p.add_run(f"{agree['title'].capitalize()}. ").bold = True
            p.add_run(agree["text"])

    c = g["conclusion"]
    doc.add_heading("Висновок", level=1)
    doc.add_paragraph(c["text"])
    if c["facts"]:
        doc.add_paragraph("Факти, що засвідчують оцінку:")
        for f in c["facts"]:
            doc.add_paragraph(f, style="List Bullet")
    if c["reliability_reasons"]:
        doc.add_paragraph(f"Достовірність {c['reliability']}, причини:")
        for r in c["reliability_reasons"]:
            doc.add_paragraph(r, style="List Bullet")
    doc.add_paragraph("Найбільш ефективні напрями:").runs[0].bold = True
    for i, q in enumerate(c["effective"], start=1):
        doc.add_paragraph(f"{i}. {q['text']} ({num(q['score'])})")
    doc.add_paragraph("Напрями, що потребують більшої уваги:").runs[0].bold = True
    for i, q in enumerate(c["attention"], start=1):
        doc.add_paragraph(f"{i}. {q['text']} ({num(q['score'])})")

    pr = g["proposals"]
    doc.add_heading("Пропозиції", level=1)
    for i, item in enumerate(pr["items"], start=1):
        doc.add_paragraph(f"{i}. {item}")
    if pr["priorities"]:
        doc.add_paragraph("Першочергові напрями Плану заходів (Додаток Д):").runs[0].bold = True
        for r in pr["priorities"]:
            doc.add_paragraph(f"{r['title']}. Підстава: {r['rule']}", style="List Bullet")
            for x in r["measures"]:
                doc.add_paragraph(x, style="List Bullet 2")

    if report["measures"]:
        doc.add_heading("Стан виконання заходів", level=1)
        table = doc.add_table(rows=1, cols=5)
        table.style = "Table Grid"
        for cell, text in zip(table.rows[0].cells, ("Захід", "Відповідальний", "Строк", "Статус", "Перевірка наступною хвилею"), strict=True):
            cell.text = text
        for x in report["measures"]:
            cells = table.add_row().cells
            cells[0].text = x["title"]
            cells[1].text = x["owner"]
            cells[2].text = day(x["due_date"])
            cells[3].text = STATUS_TITLES.get(val(x["status"]), val(x["status"])) + (" (прострочено)" if x["overdue"] else "")
            v = x.get("verification") or {}
            cells[4].text = v.get("title", "") + (f": {num(v.get('previous'))} → {num(v.get('current'))}" if v.get("delta") is not None else "")
        shape_table(table, [5.4, 3.6, 2.2, 2.7, 2.6])

    doc.add_paragraph()
    doc.add_paragraph("Заступник голови робочої групи  ____________________")
    doc.add_paragraph(meta["note"]).runs[0].italic = True
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


# ---------- Excel ----------

HEAD = Font(bold=True)
HEAD_FILL = PatternFill("solid", fgColor="DDE7F3")
WRAP = Alignment(wrap_text=True, vertical="top")


def _sheet(wb: Workbook, title: str, header: list[str], rows: list[list], widths: list[int]):
    ws = wb.create_sheet(title)
    ws.append(safe_row(header))
    for cell in ws[1]:
        cell.font, cell.fill, cell.alignment = HEAD, HEAD_FILL, WRAP
    for row in rows:
        ws.append(safe_row(row))
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = WRAP
    ws.freeze_panes = "A2"
    return ws


def to_xlsx(report: dict) -> bytes:
    g = report["appendix_g"]
    meta = report["report"]
    wb = Workbook()
    wb.remove(wb.active)
    c = g["conclusion"]

    summary = [["Звіт", meta["title"]], ["Хвиля", meta["campaign_title"]], ["Закрита", meta["closed_on"]],
               ["Індекс доброчесності", c["index"]], ["Рівень зрілості", (c["level"] or {}).get("title", "")],
               ["Достовірність", c["reliability"]]]
    summary += [[x["title"], x["score"]] for x in c["components"]]
    summary += [["Висновок", c["text"]]] + [["Висновок", line] for line in report["summary"]]
    summary += [["Учасники", p["title"] + ": " + p["text"]] for p in g["participants"]]
    summary += [["Цільовий рівень", (g["proposals"]["target_level"] or {}).get("title", "")]]
    _sheet(wb, "Підсумок", ["Показник", "Значення"], summary, [28, 110])

    rows = []
    for section in g["sections"]:
        for q in section["questions"]:
            for r in q["rows"]:
                rows.append([section["title"], q["number"], q["text"], r["option"], r["level"], r["level_title"],
                             *(r["percent"].get(k) for k in CATEGORY_SHORT)])
            rows.append([section["title"], q["number"], q["text"], q["agreement"]["title"], None, None, None, None, None])
    _sheet(wb, "Крос-таблиці", ["Розділ", "№", "Питання", "Варіант відповіді / висновок", "Рівень", "Назва рівня",
                                *(f"{v}, %" for v in CATEGORY_SHORT.values())], rows, [14, 6, 40, 70, 8, 14, 10, 10, 10])

    rows = [[q["number"], q["text"], q["agreement"]["title"], q["agreement"]["delta"], q["agreement"]["text"]]
            for s in g["sections"] for q in s["questions"]]
    _sheet(wb, "Збіги і розбіжності", ["№", "Питання", "Результат", "РГ − ОС, бали", "Опис"], rows, [6, 40, 20, 12, 80])

    rows = [[x["code"], x["title"], x["score"], (x.get("level") or {}).get("title", ""), x["reliability"], x["rule"]]
            for x in report["components"]]
    _sheet(wb, "Компоненти", ["Код", "Компонент", "Бал", "Рівень", "Достовірність", "Як пораховано"], rows, [16, 16, 8, 14, 12, 90])

    rows = [[f["title"], f.get("percent"), f.get("status"), f.get("label"), f.get("rule")] for f in report["facts"]]
    _sheet(wb, "Факти", ["Показник", "%", "Статус", "Опис", "Правило"], rows, [36, 8, 12, 60, 60])

    rows = [[r["priority_title"], r.get("component_title") or "", r["title"], r["rule"],
             DECISION_TITLES.get(val((r.get("decision") or {}).get("decision")), ""),
             "; ".join(x["title"] for x in r.get("suggested_measures", []))] for r in report["recommendations"]]
    _sheet(wb, "Рекомендації", ["Пріоритет", "Компонент", "Рекомендація", "Чому", "Рішення", "Заходи з Додатку Д"],
           rows, [10, 14, 50, 60, 12, 70])

    rows = []
    for x in report["measures"]:
        v = x.get("verification") or {}
        rows.append([x.get("catalog_number") or "", x["title"], x["owner"], x["due_date"],
                     STATUS_TITLES.get(val(x["status"]), val(x["status"])), "так" if x["overdue"] else "",
                     v.get("title", ""), v.get("previous"), v.get("current"), v.get("delta")])
    _sheet(wb, "Заходи", ["Пункт Д", "Захід", "Відповідальний", "Строк", "Статус", "Прострочено",
                          "Перевірка наступною хвилею", "Було", "Стало", "Зміна"], rows, [8, 50, 26, 12, 12, 11, 22, 8, 8, 8])

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
