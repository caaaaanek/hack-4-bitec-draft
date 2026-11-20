"""Reporting Module: звіт хвилі за структурою Додатку Г у JSON, CSV, Excel (.xlsx) або Word (.docx).

Шаблони звіту (`GET /report-templates`): Додаток Г, довідка керівнику, План заходів, динаміка.
"""

import csv
import io
import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from fastapi.encoders import jsonable_encoder
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.models import Measure, User
from app.routers.recommendations import build, closed_campaign, with_decisions
from app.security import RESULT_READERS, ensure_unit_access, require_roles
from app.services import measures as measures_service
from app.services import report_export, report_g, report_templates
from app.services.safe_export import SafeCsvWriter
from app.services.units import subtree_ids

router = APIRouter(tags=["reports"])


class ReportTemplateOut(BaseModel):
    code: str
    title: str
    description: str
    audience: str


@router.get("/report-templates", response_model=list[ReportTemplateOut])
def report_template_list(user: User = Depends(require_roles(*RESULT_READERS))):
    """Шаблони звіту хвилі. Код передається в `GET /campaigns/{id}/report?template=`."""
    return report_templates.catalog()


def report_data(db: Session, campaign, unit_id: uuid.UUID | None) -> dict:
    data, recs = build(db, campaign, unit_id)
    scope = uuid.UUID(data["unit_id"])
    measures = measures_service.to_dicts(db, db.scalars(
        select(Measure).where(Measure.unit_id.in_(subtree_ids(db, scope))).order_by(Measure.due_date)).all())
    report = {
        "unit_name": data["unit_name"],
        "report": {
            "title": f"Звіт за результатами визначення рівня доброчесності: {data['unit_name']}",
            "campaign_title": data["campaign_title"],
            "closed_on": data["closed_on"],
            "methodology_version": data["methodology_version"],
            "min_group_size": data["min_group_size"],
            "source": data["source"],
            "note": "Лише узагальнені дані. Групи, менші за поріг k, не показуються.",
        },
        "summary": data["summary"],
        "index": data["index"],
        "components": data["components"],
        "groups": data["groups"],
        "checklist": data["checklist"],
        "facts": data["facts"],
        "questions": data["questions"],
        "discrepancies": data["discrepancies"],
        "dynamics": data["dynamics"],
        "recommendations": with_decisions(db, campaign, scope, recs),
        "measures": measures,
    }
    report["appendix_g"] = report_g.build(db, report)
    return report


def to_csv(report: dict) -> str:
    """Одна таблиця «розділ; код; назва; значення; пояснення» — відкривається в Excel."""
    out = io.StringIO()
    out.write("﻿")  # BOM, щоб Excel правильно показав кирилицю
    w = SafeCsvWriter(csv.writer(out, delimiter=";"))
    w.writerow(["розділ", "код", "назва", "значення", "рівень / статус", "достовірність", "пояснення"])
    idx = report["index"]
    w.writerow(["індекс", "integrity_index", "Індекс доброчесності", idx["score"],
                (idx["level"] or {}).get("title", ""), idx["reliability"], idx["rule"]])
    w.writerow(["індекс", "integrity_index_self", "Без перевірки фактами", idx["self_score"], "", "", ""])
    for c in report["components"]:
        w.writerow(["компонент", c["code"], c["title"], c["score"], (c["level"] or {}).get("title", ""), c["reliability"], c["rule"]])
    for f in report["facts"]:
        w.writerow(["факт", f["indicator"], f["title"], f["percent"], f["status"], "", f["label"]])
    for q in report["questions"]:
        w.writerow(["питання", q["code"], q["text"], q["score"], (q.get("zone") or {}).get("title", ""), "", ""])
    for d in report["discrepancies"]:
        w.writerow(["розбіжність", d["type"], d["subject"], "", "", "", d["description"]])
    for r in report["recommendations"]:
        decision = (r.get("decision") or {}).get("decision", "")
        w.writerow(["рекомендація", r["code"], r["title"], r["priority_title"],
                    decision.value if hasattr(decision, "value") else decision, "", r["rule"]])
    for x in report["measures"]:
        status = x["status"].value if hasattr(x["status"], "value") else x["status"]
        w.writerow(["захід", x["catalog_number"] or "", x["title"], x["due_date"], status,
                    "прострочено" if x["overdue"] else "", x["owner"]])
    for line in report["summary"]:
        w.writerow(["висновок", "", line, "", "", "", ""])
    return out.getvalue()


@router.get("/campaigns/{campaign_id}/report")
def campaign_report(
    campaign_id: uuid.UUID,
    unit_id: uuid.UUID | None = None,
    format: str = Query(default="json", pattern="^(json|csv|xlsx|docx)$",
                        description="json для сторінки; csv, xlsx (Excel) або docx (Word) для завантаження"),
    template: str = Query(default=report_templates.DEFAULT_TEMPLATE, pattern=report_templates.TEMPLATE_PATTERN,
                          description="Шаблон (GET /report-templates). Змінює структуру Word; JSON, CSV і Excel — повні дані"),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """Звіт хвилі (структура Додатку Г): індекс, компоненти, факти, питання, розбіжності,
    динаміка, рекомендації з рішеннями, заходи з перевіркою наступною хвилею.
    Розділ `appendix_g`: крос-таблиці РГ / ОС / експерти, збіги й розбіжності, висновок, пропозиції.
    PDF друкує фронтенд (print.css)."""
    campaign = closed_campaign(db, campaign_id)
    ensure_unit_access(db, user, unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    report = report_data(db, campaign, unit_id)
    report["template"] = report_templates.describe(template)
    log_action(db, user, "export_report", "campaign", campaign.id,
               {"unit_id": str(unit_id or campaign.unit_id), "format": format, "template": template})
    db.commit()
    if format == "json":
        return jsonable_encoder(report)
    data = jsonable_encoder(report)
    if format == "docx":
        content, media = report_templates.DOCX[template](data), DOCX_MEDIA
    else:
        content, media = FILES[format](data)
    suffix = "" if template == report_templates.DEFAULT_TEMPLATE else f"-{template}"
    name = f"integrity-report{suffix}-{report['report']['closed_on']}.{format}"
    return Response(content=content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})


DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FILES = {
    "csv": lambda r: (to_csv(r), "text/csv; charset=utf-8"),
    "xlsx": lambda r: (report_export.to_xlsx(r), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
}
