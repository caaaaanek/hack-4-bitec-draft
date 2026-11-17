"""Reporting Module: звіт хвилі за структурою Додатку Г у JSON або CSV (для Excel)."""

import csv
import io
import uuid

from fastapi import APIRouter, Depends, Query
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
from app.services.units import subtree_ids

router = APIRouter(tags=["reports"])


def report_data(db: Session, campaign, unit_id: uuid.UUID | None) -> dict:
    data, recs = build(db, campaign, unit_id)
    scope = uuid.UUID(data["unit_id"])
    measures = [measures_service.to_dict(x) for x in db.scalars(
        select(Measure).where(Measure.unit_id.in_(subtree_ids(db, scope))).order_by(Measure.due_date))]
    return {
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


def to_csv(report: dict) -> str:
    """Одна таблиця «розділ; код; назва; значення; пояснення» — відкривається в Excel."""
    out = io.StringIO()
    out.write("﻿")  # BOM, щоб Excel правильно показав кирилицю
    w = csv.writer(out, delimiter=";")
    w.writerow(["розділ", "код", "назва", "значення", "рівень / статус", "достовірність", "пояснення"])
    idx = report["index"]
    w.writerow(["індекс", "integrity_index", "Integrity Index", idx["score"],
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
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """Звіт хвилі (структура Додатку Г): індекс, компоненти, факти, питання, розбіжності,
    динаміка, рекомендації з рішеннями, заходи. PDF друкує фронтенд (print.css)."""
    campaign = closed_campaign(db, campaign_id)
    ensure_unit_access(db, user, unit_id or campaign.unit_id)
    report = report_data(db, campaign, unit_id)
    log_action(db, user, "export_report", "campaign", campaign.id, {"unit_id": str(unit_id or campaign.unit_id), "format": format})
    db.commit()
    if format == "csv":
        name = f"integrity-report-{report['report']['closed_on']}.csv"
        return Response(content=to_csv(report), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})
    return jsonable_encoder(report)
