"""Інструменти поверх знімка хвилі: шлях до наступного рівня, брифінг, лотерея перевірок, стійкість ваг,
детектор відвертості й детектор Гудхарта. Нових балів не рахують; кожен результат має `rule`."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.models import Campaign, CampaignStatus, Role, User
from app.security import RESULT_READERS, ensure_unit_access, require_roles
from app.services import facts, planning, results

router = APIRouter(tags=["insights"])
readers = require_roles(*RESULT_READERS)
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def closed(db: Session, campaign_id: uuid.UUID) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    if campaign.status != CampaignStatus.CLOSED:
        raise HTTPException(status_code=409, detail="Доступно після закриття хвилі")
    return campaign


def scoped(db: Session, user: User, campaign: Campaign, unit_id: uuid.UUID | None, endpoint: str) -> dict:
    ensure_unit_access(db, user, unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    try:
        data = results.results_for(db, campaign, unit_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    db.commit()
    return data


@router.get("/campaigns/{campaign_id}/candor")
def candor_card(campaign_id: uuid.UUID, unit_id: uuid.UUID | None = None, db: Session = Depends(get_db),
                user: User = Depends(readers)) -> dict:
    """«Що люди бояться сказати прямо»: непрямі оцінки з інтервалом, «дзеркала», картка для «Огляду»,
    а також сигнали детектора Гудхарта. Знімки до методики 2.3 цих розділів не мають."""
    campaign = closed(db, campaign_id)
    data = scoped(db, user, campaign, unit_id, "candor")
    return {"unit_id": data["unit_id"], "unit_name": data["unit_name"], "candor": data.get("candor"),
            "goodhart": data.get("goodhart")}


@router.get("/campaigns/{campaign_id}/next-level-plan", responses={200: {"content": {DOCX: {}}}})
def next_level_plan(campaign_id: uuid.UUID, unit_id: uuid.UUID | None = None,
                    format: str = Query(default="json", pattern="^(json|docx)$"),
                    db: Session = Depends(get_db), user: User = Depends(readers)):
    """«Шлях до наступного рівня»: мінімальний набір заходів (формат Додатку Д), з посадами й строками; docx — Word."""
    campaign = closed(db, campaign_id)
    ensure_unit_access(db, user, unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    try:
        plan = planning.next_level_plan(db, campaign, unit_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        db.rollback()
    if format == "docx":
        return Response(planning.plan_docx(plan), media_type=DOCX,
                        headers={"Content-Disposition": 'attachment; filename="next-level-plan.docx"'})
    return plan


@router.get("/campaigns/{campaign_id}/briefing", responses={200: {"content": {DOCX: {}}}})
def briefing(campaign_id: uuid.UUID, unit_id: uuid.UUID | None = None,
             format: str = Query(default="json", pattern="^(json|docx)$"),
             db: Session = Depends(get_db), user: User = Depends(readers)):
    """«Брифінг за 30 секунд»: 3 числа, 3 ризики, 3 рішення. docx — одна сторінка Word."""
    campaign = closed(db, campaign_id)
    data = scoped(db, user, campaign, unit_id, "briefing")
    signals = facts.risk_signals(db, uuid.UUID(data["unit_id"]), 3, campaign.closed_on, campaign.min_group_size)
    b = planning.briefing(data, signals)
    if format == "docx":
        return Response(planning.briefing_docx(b), media_type=DOCX,
                        headers={"Content-Disposition": 'attachment; filename="briefing.docx"'})
    return b


@router.get("/campaigns/{campaign_id}/audit-lottery")
def audit_lottery(campaign_id: uuid.UUID, count: int = Query(default=5, ge=1, le=20), db: Session = Depends(get_db),
                  user: User = Depends(require_roles(Role.ADMIN, Role.AUDITOR))) -> dict:
    """«Лотерея перевірок»: які пункти чек-листа аудит перевіряє глибоко. Зерно — хеш знімка закритої хвилі."""
    campaign = closed(db, campaign_id)
    snap = results.get_snapshot(db, campaign.id, campaign.unit_id)
    if snap is None:
        raise HTTPException(status_code=404, detail="Немає знімка хвилі")
    out = planning.audit_lottery(snap.payload, count)
    log_action(db, user, "audit_lottery", "campaign", campaign.id, {"seed": out["seed"], "count": count,
                                                                     "items": [i["number"] for i in out["items"]]})
    db.commit()
    return {"campaign_id": str(campaign.id), **out}


@router.get("/campaigns/{campaign_id}/sensitivity")
def weight_sensitivity(campaign_id: uuid.UUID, unit_id: uuid.UUID | None = None, db: Session = Depends(get_db),
                       user: User = Depends(readers)) -> dict:
    """Перевірка стійкості ваг індексу: кожна вага джерела ±10 % → індекс і рівень."""
    campaign = closed(db, campaign_id)
    ensure_unit_access(db, user, unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    try:
        return planning.sensitivity(db, campaign, unit_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        db.rollback()
