"""Recommendations Engine: рекомендації за правилами і рішення керівника щодо них."""

import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import today, utcnow
from app.db import get_db
from app.models import (
    Campaign,
    CampaignStatus,
    Measure,
    MeasureStatus,
    RecommendationDecision,
    RecommendationDecisionType,
    Role,
    User,
)
from app.routers.measures import MeasureIn, MeasureOut, check_owner, create_measure
from app.security import RESULT_READERS, ensure_unit_access, require_roles
from app.services import facts, results, titles
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
    rank: int = Field(description="Місце в списку за пріоритетом (1 — найважливіша)")
    group: str = Field(description="Код компонента або general — для групування на екрані")
    group_title: str
    covers: list[str] = Field(default=[], description="Коди повторів, злитих у цю рекомендацію")
    collapsed: bool = Field(default=False, description="За межами ?top: показувати згорнутою")
    decision: DecisionOut | None = None
    measures: list[MeasureOut] = []


class RecommendationGroup(BaseModel):
    group: str
    title: str
    count: int


class RecommendationsOut(BaseModel):
    campaign_id: uuid.UUID
    unit_id: uuid.UUID
    unit_name: str
    methodology_version: str
    total: int
    groups: list[RecommendationGroup]
    items: list[RecommendationOut]


class MeasureDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Обмеження ті самі, що в MeasureIn: інакше коротка назва чи задовгий номер проходили сюди
    # й падали вже в обробнику на MeasureIn (ValidationError → 500 замість 422).
    title: str | None = Field(default=None, min_length=3, max_length=500,
                              description="За замовчуванням — перший запропонований захід")
    owner: str = Field(min_length=2, max_length=200)
    due_date: date | None = Field(default=None, description="За замовчуванням — через рік")
    catalog_number: str | None = Field(default=None, max_length=16)
    description: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def owner_is_position(self):
        check_owner(self.owner)
        return self


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
    signals = facts.risk_signals(db, scope, 3, campaign.closed_on or today(), campaign.min_group_size)
    return data, recommend(data, signals)


def with_decisions(db: Session, campaign: Campaign, unit_id: uuid.UUID, recs: list[dict]) -> list[dict]:
    decisions = {d.recommendation_code: d for d in db.scalars(select(RecommendationDecision).where(
        RecommendationDecision.campaign_id == campaign.id, RecommendationDecision.unit_id == unit_id))}
    linked: dict[str, list] = {}
    rows = db.scalars(select(Measure).where(Measure.campaign_id == campaign.id, Measure.unit_id == unit_id,
                                            Measure.recommendation_code.is_not(None))).all()
    for x, item in zip(rows, measures_service.to_dicts(db, rows), strict=True):
        linked.setdefault(x.recommendation_code, []).append(item)
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
    top: int | None = Query(default=None, ge=1, le=100, description="Скільки показати розгорнутими; решта — collapsed"),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """Рекомендації за явними правилами для закритої хвилі. Кожна має `rule`: чому запропоновано.

    Без повторів, з `rank` за пріоритетом і `group` за компонентом; `?top=5` згортає решту (`collapsed`).
    """
    campaign = closed_campaign(db, campaign_id)
    ensure_unit_access(db, user, unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    data, recs = build(db, campaign, unit_id)
    scope = uuid.UUID(data["unit_id"])
    groups: dict[str, dict] = {}
    for r in recs:
        g = groups.setdefault(r["group"], {"group": r["group"], "title": r["group_title"], "count": 0})
        g["count"] += 1
    items = [{**r, "collapsed": top is not None and r["rank"] > top} for r in with_decisions(db, campaign, scope, recs)]
    return {"campaign_id": campaign.id, "unit_id": scope, "unit_name": data["unit_name"],
            "methodology_version": data["methodology_version"], "total": len(recs),
            "groups": list(groups.values()), "items": items}


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
    ensure_unit_access(db, user, data.unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    # Рішення щодо рекомендацій хвилі — по черзі: подвійний клік «Прийняти» не створить два рішення чи два заходи.
    db.get(Campaign, campaign.id, with_for_update=True, populate_existing=True)
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

    linked = list(db.scalars(select(Measure).where(
        Measure.campaign_id == campaign.id, Measure.unit_id == scope, Measure.recommendation_code == code)))
    if data.decision != RecommendationDecisionType.ACCEPTED:
        # Рекомендацію більше не прийнято: її незавершені заходи скасовуються (з причиною в журналі), щоб не
        # висіли простроченими, не рахувалися в плані й не йшли в тему 2. Виконані лишаються як є.
        reason = f"Рішення щодо рекомендації змінено на «{titles.decision(data.decision)}»: {decision.comment}"[:500]
        for measure in linked:
            if measure.status in (MeasureStatus.PLANNED, MeasureStatus.IN_PROGRESS):
                old_status = measure.status
                measure.status = MeasureStatus.CANCELLED
                measure.done_on = None
                measures_service.enqueue_measure(db, measure)
                log_action(db, user, "update", "measure", measure.id,
                           {"status": MeasureStatus.CANCELLED.value, "from_status": old_status.value, "reason": reason})

    # Захід створюється, лише якщо в рекомендації ще немає жодного нескасованого: повторне «Прийняти»
    # (подвійний клік, повернення до рішення) не плодить дублікати.
    if data.measure is not None and not any(m.status != MeasureStatus.CANCELLED for m in linked):
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
