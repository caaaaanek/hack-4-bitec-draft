"""Recommendations Engine: рекомендації за правилами і рішення керівника щодо них."""

import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import today, utcnow
from app.config import get_settings
from app.db import get_db
from app.models import Campaign, CampaignStatus, Measure, RecommendationDecision, RecommendationDecisionType, Role, User
from app.routers.measures import MeasureIn, MeasureOut, create_measure
from app.security import RESULT_READERS, ensure_unit_access, require_roles
from app.services import facts, results
from app.services import measures as measures_service
from app.services.recommendations import recommend

router = APIRouter(tags=["recommendations"])


class SuggestedMeasure(BaseModel):
    catalog_number: str | None
    title: str
    responsible: str
    indicator: str
    source: str


class DecisionOut(BaseModel):
    decision: RecommendationDecisionType
    comment: str
    decided_at: datetime


class RecommendationOut(BaseModel):
    code: str
    priority: str
    priority_title: str
    component: str | None
    component_title: str | None
    title: str
    description: str
    rule: str
    basis: dict
    suggested_measures: list[SuggestedMeasure]
    decision: DecisionOut | None = None
    measures: list[MeasureOut] = []


class RecommendationsOut(BaseModel):
    campaign_id: uuid.UUID
    unit_id: uuid.UUID
    unit_name: str
    methodology_version: str
    items: list[RecommendationOut]


class MeasureDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=500, description="За замовчуванням — перший запропонований захід")
    owner: str = Field(min_length=2, max_length=200)
    due_date: date | None = Field(default=None, description="За замовчуванням — через рік")
    catalog_number: str | None = None
    description: str = ""


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID | None = None
    decision: RecommendationDecisionType
    comment: str = Field(default="", max_length=2000)
    measure: MeasureDraft | None = Field(default=None, description="Створити захід одразу (лише для accepted)")

    @model_validator(mode="after")
    def reason_for_rejection(self):
        if self.decision != RecommendationDecisionType.ACCEPTED and not self.comment.strip():
            raise ValueError("Для рішень clarify і rejected потрібен коментар (обґрунтування)")
        if self.measure is not None and self.decision != RecommendationDecisionType.ACCEPTED:
            raise ValueError("Захід створюється лише для прийнятої рекомендації")
        return self


def closed_campaign(db: Session, campaign_id: uuid.UUID) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    if campaign.status != CampaignStatus.CLOSED:
        raise HTTPException(status_code=409, detail="Рекомендації доступні після закриття хвилі")
    return campaign


def build(db: Session, campaign: Campaign, unit_id: uuid.UUID | None) -> tuple[dict, list[dict]]:
    """Результати хвилі і рекомендації до них (з ризик-сигналами за 3 місяці до закриття)."""
    try:
        data = results.results_for(db, campaign, unit_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    scope = uuid.UUID(data["unit_id"])
    signals = facts.risk_signals(db, scope, 3, campaign.closed_on or today(), get_settings().min_group_size)
    return data, recommend(data, signals)


def with_decisions(db: Session, campaign: Campaign, unit_id: uuid.UUID, recs: list[dict]) -> list[dict]:
    decisions = {d.recommendation_code: d for d in db.scalars(select(RecommendationDecision).where(
        RecommendationDecision.campaign_id == campaign.id, RecommendationDecision.unit_id == unit_id))}
    linked: dict[str, list] = {}
    for x in db.scalars(select(Measure).where(Measure.campaign_id == campaign.id, Measure.unit_id == unit_id,
                                              Measure.recommendation_code.is_not(None))):
        linked.setdefault(x.recommendation_code, []).append(measures_service.to_dict(x))
    out = []
    for r in recs:
        d = decisions.get(r["code"])
        out.append({**r,
                    "decision": {"decision": d.decision, "comment": d.comment, "decided_at": d.decided_at} if d else None,
                    "measures": linked.get(r["code"], [])})
    return out


@router.get("/campaigns/{campaign_id}/recommendations", response_model=RecommendationsOut)
def list_recommendations(
    campaign_id: uuid.UUID,
    unit_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """Рекомендації за явними правилами для закритої хвилі. Кожна має `rule`: чому запропоновано."""
    campaign = closed_campaign(db, campaign_id)
    ensure_unit_access(db, user, unit_id or campaign.unit_id)
    data, recs = build(db, campaign, unit_id)
    scope = uuid.UUID(data["unit_id"])
    log_action(db, user, "view_recommendations", "campaign", campaign.id, {"unit_id": str(scope)})
    db.commit()
    return {"campaign_id": campaign.id, "unit_id": scope, "unit_name": data["unit_name"],
            "methodology_version": data["methodology_version"], "items": with_decisions(db, campaign, scope, recs)}


@router.post("/campaigns/{campaign_id}/recommendations/{code}/decision", response_model=RecommendationOut)
def decide(
    campaign_id: uuid.UUID,
    code: str,
    data: DecisionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(Role.LEADER)),
):
    """Рішення керівника: прийняти (і одразу створити захід), уточнити або відхилити з обґрунтуванням."""
    campaign = closed_campaign(db, campaign_id)
    ensure_unit_access(db, user, data.unit_id or campaign.unit_id)
    result, recs = build(db, campaign, data.unit_id)
    scope = uuid.UUID(result["unit_id"])
    rec = next((r for r in recs if r["code"] == code), None)
    if rec is None:
        raise HTTPException(status_code=404, detail="Такої рекомендації для цього підрозділу й хвилі немає")

    decision = db.scalar(select(RecommendationDecision).where(
        RecommendationDecision.campaign_id == campaign.id, RecommendationDecision.unit_id == scope,
        RecommendationDecision.recommendation_code == code))
    if decision is None:
        decision = RecommendationDecision(campaign_id=campaign.id, unit_id=scope, recommendation_code=code,
                                          decision=data.decision, decided_by_id=user.id)
        db.add(decision)
    decision.decision = data.decision
    decision.comment = data.comment.strip()
    decision.decided_by_id = user.id
    decision.decided_at = utcnow()
    db.flush()
    log_action(db, user, "decide", "recommendation", decision.id,
               {"code": code, "decision": data.decision.value, "unit_id": str(scope)})

    if data.measure is not None:
        suggested = rec["suggested_measures"][0] if rec["suggested_measures"] else None
        draft = data.measure
        title = draft.title or (suggested["title"] if suggested else rec["title"])
        due = draft.due_date or today() + timedelta(days=365)
        create_measure(db, user, MeasureIn(
            unit_id=scope, title=title, description=draft.description or rec["description"], owner=draft.owner,
            due_date=due, component=rec["component"],
            catalog_number=draft.catalog_number or (suggested or {}).get("catalog_number"),
            campaign_id=campaign.id, recommendation_code=code,
        ))
    db.commit()
    return with_decisions(db, campaign, scope, [rec])[0]
