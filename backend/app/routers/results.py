"""Результати оцінювання: Integrity Index, знімки хвиль, динаміка, екран учасника."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.models import Campaign, CampaignStatus, Role, Unit, User
from app.schemas import UnitOut
from app.schemas_results import CampaignResultsOut, CompareOut, HistoryOut, ParticipantResultOut
from app.security import RESULT_READERS, ensure_unit_access, get_current_user, require_roles
from app.services import methodology, results
from app.services.eligibility import is_eligible
from app.services.units import subtree_ids

router = APIRouter(tags=["results"])
can_view = require_roles(*RESULT_READERS)


@router.get("/methodology")
def get_methodology(_: User = Depends(get_current_user)) -> dict:
    """Методика розрахунку: ваги, пороги, рівні, правила. Доступна всім, хто увійшов."""
    return methodology.as_dict()


def closed_campaign(db: Session, campaign_id: uuid.UUID) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    if campaign.status != CampaignStatus.CLOSED:
        raise HTTPException(status_code=409, detail="Результати доступні після закриття хвилі")
    return campaign


@router.get("/campaigns/{campaign_id}/results", response_model=CampaignResultsOut)
def campaign_results(
    campaign_id: uuid.UUID,
    unit_id: uuid.UUID | None = None,
    recalculate: bool = Query(default=False, description="Перерахувати за поточною методикою (знімок не змінюється)"),
    db: Session = Depends(get_db),
    user: User = Depends(can_view),
):
    """Результати хвилі для всього підрозділу хвилі або для дочірнього (unit_id).

    За замовчуванням береться незмінний знімок, зроблений при закритті хвилі.
    """
    campaign = closed_campaign(db, campaign_id)
    ensure_unit_access(db, user, unit_id or campaign.unit_id)
    try:
        data = results.results_for(db, campaign, unit_id, recalculate)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    log_action(db, user, "view_results", "campaign", campaign.id,
               {"unit_id": data["unit_id"], "recalculate": recalculate})
    db.commit()
    return data


@router.get("/units", response_model=list[UnitOut])
def list_units(db: Session = Depends(get_db), _: User = Depends(can_view)):
    """Дерево підрозділів (id, name, parent_id) для вибору області перегляду."""
    return db.scalars(select(Unit).order_by(Unit.name)).all()


def unit_or_404(db: Session, unit_id: uuid.UUID, user: User | None = None) -> Unit:
    unit = db.get(Unit, unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Підрозділ не знайдено")
    if user is not None:
        ensure_unit_access(db, user, unit_id)
    return unit


@router.get("/units/{unit_id}/history", response_model=HistoryOut)
def unit_history(unit_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(can_view)):
    """Динаміка підрозділу за всі хвилі: лише порівняння із самим собою."""
    unit = unit_or_404(db, unit_id, user)
    points = []
    previous = None
    for campaign, snap in results.unit_snapshots(db, unit_id):
        payload = snap.payload
        d = results.delta(snap.index_score, previous.index_score) if previous else None
        sig = methodology.significance(d, [previous.reliability, snap.reliability]) if previous else None
        points.append({
            "campaign_id": campaign.id,
            "campaign_title": campaign.title,
            "closed_on": snap.closed_on,
            "methodology_version": snap.methodology_version,
            "index": snap.index_score,
            "index_self": snap.index_self,
            "reliability": snap.reliability,
            "components": {c["code"]: c["score"] for c in payload["components"]},
            "measures_done": results.measures_done_between(
                db, unit_id, previous.closed_on if previous else None, snap.closed_on),
            "delta": d,
            "significance": sig,
        })
        previous = snap
    log_action(db, user, "view_history", "unit", unit.id)
    db.commit()
    return {"unit_id": unit.id, "unit_name": unit.name, "points": points}


@router.get("/units/{unit_id}/compare", response_model=CompareOut)
def compare_waves(
    unit_id: uuid.UUID,
    from_campaign: uuid.UUID,
    to_campaign: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(can_view),
):
    """Порівняння двох будь-яких хвиль одного підрозділу (картки з дельтами і радар 'було / стало')."""
    unit_or_404(db, unit_id, user)
    before = results.get_snapshot(db, from_campaign, unit_id)
    after = results.get_snapshot(db, to_campaign, unit_id)
    if before is None or after is None:
        raise HTTPException(status_code=404, detail="Для цього підрозділу немає знімка однієї з хвиль")
    data = results.compare_payloads(before.payload, after.payload)
    prev_c = {c["code"]: c["score"] for c in before.payload["components"]}
    log_action(db, user, "compare", "unit", unit_id, {"from": str(from_campaign), "to": str(to_campaign)})
    db.commit()
    return {
        **data,
        "current_campaign_id": after.payload["campaign_id"],
        "current_title": after.payload["campaign_title"],
        "current_index": after.index_score,
        "current_reliability": after.reliability,
        "radar": [{"code": c["code"], "title": c["title"], "before": prev_c.get(c["code"]), "after": c["score"]}
                  for c in after.payload["components"]],
    }


def brief(data: dict) -> dict:
    return {
        "unit_id": data["unit_id"],
        "unit_name": data["unit_name"],
        "sufficient": data["index"]["score"] is not None,
        "index": data["index"],
        "components": [{k: c[k] for k in ("code", "title", "score", "level", "zone")} for c in data["components"]],
    }


@router.get("/me/results", response_model=list[ParticipantResultOut])
def my_results(db: Session = Depends(get_db), user: User = Depends(require_roles(Role.RESPONDENT))):
    """Екран учасника: узагальнені результати хвилі і свого підрозділу, без деталей відповідей."""
    out = []
    closed = db.scalars(select(Campaign).where(Campaign.status == CampaignStatus.CLOSED).order_by(Campaign.created_at.desc()))
    for campaign in closed:
        units = subtree_ids(db, campaign.unit_id)
        if not any(is_eligible(user, link.questionnaire, units) for link in campaign.questionnaire_links):
            continue
        whole = results.results_for(db, campaign, None)
        my_unit = None
        if user.unit_id and user.unit_id != campaign.unit_id and user.unit_id in units:
            my_unit = brief(results.results_for(db, campaign, user.unit_id))
        dyn = whole["dynamics"]
        out.append({
            "campaign_id": campaign.id,
            "campaign_title": campaign.title,
            "closed_on": campaign.closed_on,
            "institution": brief(whole),
            "my_unit": my_unit,
            "index_delta": dyn["index_delta"] if dyn else None,
            "summary": whole["summary"][:2],
        })
    return out
