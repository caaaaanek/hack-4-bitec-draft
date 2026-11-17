"""Executive Dashboard: усе для одного екрана керівника одним запитом."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.db import get_db
from app.models import Campaign, CampaignStatus, Role, User
from app.routers.indicators import RiskSignal
from app.routers.measures import MeasureStats
from app.routers.recommendations import RecommendationOut, with_decisions
from app.schemas_results import IndexOut, Level, Significance, Zone
from app.security import RESULT_READERS, ensure_unit_access, require_roles
from app.services import facts, results
from app.services import measures as measures_service
from app.services.recommendations import recommend
from app.services.units import subtree_ids

router = APIRouter(tags=["dashboard"])


class DashboardComponent(BaseModel):
    code: str
    title: str
    score: float | None
    self_score: float | None
    facts_score: float | None
    level: Level | None
    zone: Zone | None
    reliability: str
    cut_by_facts: bool
    rule: str


class DashboardGroup(BaseModel):
    category: str
    sufficient: bool
    participation_percent: float | None
    suppressed: bool = False


class TrendPoint(BaseModel):
    campaign_id: uuid.UUID
    campaign_title: str
    closed_on: date
    index: float | None
    index_self: float | None
    reliability: str


class DashboardOut(BaseModel):
    campaign_id: uuid.UUID
    campaign_title: str
    closed_on: date | None
    unit_id: uuid.UUID
    unit_name: str
    methodology_version: str
    index: IndexOut
    components: list[DashboardComponent]
    groups: list[DashboardGroup]
    summary: list[str]
    index_delta: float | None
    index_significance: Significance | None
    trend: list[TrendPoint]
    recommendations: list[RecommendationOut]
    recommendations_total: int
    measures: MeasureStats
    risk_signals: list[RiskSignal]


def pick_campaign(db: Session, campaign_id: uuid.UUID | None, unit_id: uuid.UUID | None) -> Campaign:
    if campaign_id is not None:
        campaign = db.get(Campaign, campaign_id)
        if campaign is None:
            raise HTTPException(status_code=404, detail="Хвилю не знайдено")
        if campaign.status != CampaignStatus.CLOSED:
            raise HTTPException(status_code=409, detail="Результати доступні після закриття хвилі")
        return campaign
    closed = db.scalars(select(Campaign).where(Campaign.status == CampaignStatus.CLOSED)
                        .order_by(Campaign.closed_on.desc(), Campaign.created_at.desc())).all()
    for campaign in closed:
        if unit_id is None or unit_id in subtree_ids(db, campaign.unit_id):
            return campaign
    raise HTTPException(status_code=404, detail="Ще немає жодної закритої хвилі для цього підрозділу")


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    campaign_id: uuid.UUID | None = None,
    unit_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """Індекс, компоненти, динаміка, топ-рекомендації, заходи й ризик-сигнали.

    За замовчуванням: остання закрита хвиля; для керівника з підрозділом — його підрозділ.
    """
    if unit_id is None and user.role == Role.LEADER:
        unit_id = user.unit_id
    campaign = pick_campaign(db, campaign_id, unit_id)
    scope_id = unit_id or campaign.unit_id
    ensure_unit_access(db, user, scope_id)
    try:
        data = results.results_for(db, campaign, scope_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    scope = uuid.UUID(data["unit_id"])
    k = get_settings().min_group_size
    signals = facts.risk_signals(db, scope, 3, campaign.closed_on, k)
    recs = recommend(data, signals)
    dyn = data.get("dynamics")
    trend = [
        {"campaign_id": c.id, "campaign_title": c.title, "closed_on": s.closed_on, "index": s.index_score,
         "index_self": s.index_self, "reliability": s.reliability}
        for c, s in results.unit_snapshots(db, scope)
    ]
    log_action(db, user, "view_dashboard", "campaign", campaign.id, {"unit_id": str(scope)})
    db.commit()
    return {
        "campaign_id": campaign.id,
        "campaign_title": campaign.title,
        "closed_on": campaign.closed_on,
        "unit_id": scope,
        "unit_name": data["unit_name"],
        "methodology_version": data["methodology_version"],
        "index": data["index"],
        "components": data["components"],
        "groups": data["groups"],
        "summary": data["summary"],
        "index_delta": dyn["index_delta"] if dyn else None,
        "index_significance": dyn["index_significance"] if dyn else None,
        "trend": trend,
        "recommendations": with_decisions(db, campaign, scope, recs[:5]),
        "recommendations_total": len(recs),
        "measures": measures_service.stats(db, scope),
        "risk_signals": signals,
    }
