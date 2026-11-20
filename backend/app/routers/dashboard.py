"""Executive Dashboard: усе для одного екрана керівника одним запитом."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ApiError
from app.models import Campaign, CampaignStatus, IndexSnapshot, Role, Unit, User
from app.routers.indicators import RiskSignal
from app.routers.measures import MeasureStats
from app.routers.recommendations import RecommendationOut, with_decisions
from app.schemas_results import IndexOut, Level, Significance, Zone
from app.security import RESULT_READERS, ensure_unit_access, require_roles
from app.services import facts, results
from app.services import measures as measures_service
from app.services.recommendations import recommend
from app.services.units import unit_tree

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
    has_index: bool  # false: точка без індексу, на графіку розрив, а не нуль


class WaveOption(BaseModel):
    id: uuid.UUID
    title: str
    closed_on: date | None
    unit_name: str
    has_index: bool
    is_current: bool


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
    # Картка «Що люди бояться сказати прямо» (детектор відвертості) і сигнали підгонки (детектор Гудхарта).
    candor_card: list[str] = []
    candor_flags: list[str] = []
    gaming_signals: list[dict] = []


def default_scopes(db: Session, unit_id: uuid.UUID | None) -> list[uuid.UUID]:
    """Для кого шукати хвилю: заданий підрозділ, а без нього корінь дерева (а не корінь будь-якої хвилі)."""
    if unit_id is not None:
        return [unit_id]
    children, _ = unit_tree(db)
    return children.get(None, [])


def pick_wave(db: Session, campaign_id: uuid.UUID | None, unit_id: uuid.UUID | None) -> tuple[Campaign, uuid.UUID]:
    """Хвиля і підрозділ, для якого її показувати.

    Без campaign_id «поточна» хвиля — остання закрита, де для підрозділу є знімок з індексом (якщо індексу не
    було ніде — остання закрита зі знімком підрозділу, з null). Хвиля з однією
    анкетою для дочірнього підрозділу не підміняє повну хвилю закладу.
    """
    if campaign_id is not None:
        campaign = db.get(Campaign, campaign_id)
        if campaign is None:
            raise HTTPException(status_code=404, detail="Хвилю не знайдено")
        if campaign.status != CampaignStatus.CLOSED:
            raise HTTPException(status_code=409, detail="Результати доступні після закриття хвилі")
        return campaign, unit_id or campaign.unit_id
    scopes = default_scopes(db, unit_id)

    def latest(with_index: bool):
        query = (select(Campaign, IndexSnapshot.unit_id)
                 .join(IndexSnapshot, IndexSnapshot.campaign_id == Campaign.id)
                 .where(IndexSnapshot.unit_id.in_(scopes), Campaign.status == CampaignStatus.CLOSED)
                 .order_by(Campaign.closed_on.desc(), Campaign.created_at.desc())
                 .limit(1))
        if with_index:
            query = query.where(IndexSnapshot.index_score.is_not(None))
        return db.execute(query).first()

    # Індексу в підрозділі не було в жодній хвилі (наприклад, груп менше k): показуємо останню закриту з null,
    # підміни тут немає — повнішої хвилі для цього підрозділу просто не існує.
    row = (latest(True) or latest(False)) if scopes else None
    if row is None:
        raise ApiError(404, "Для цього підрозділу ще немає закритої хвилі з індексом", code="no_indexed_wave",
                       hint="Індекс з'являється після закриття хвилі, що охоплює підрозділ. "
                            "Хвилі без індексу можна обрати у списку хвиль.")
    return row[0], row[1]


def pick_campaign(db: Session, campaign_id: uuid.UUID | None, unit_id: uuid.UUID | None) -> Campaign:
    return pick_wave(db, campaign_id, unit_id)[0]


def default_unit(db: Session, user: User, unit_id: uuid.UUID | None) -> uuid.UUID | None:
    # Уповноважений і аудит зі своєю зоною, як і керівник, за замовчуванням дивляться свій підрозділ:
    # корінь дерева поза їхньою зоною, і без цього дашборд одразу відповідав 403.
    if unit_id is None and user.role in (Role.LEADER, Role.ADMIN, Role.AUDITOR):
        return user.unit_id
    if unit_id is None and user.role == Role.DEPARTMENT:
        raise ApiError(422, "Оберіть заклад", code="unit_required",
                       hint="Департамент дивиться кожен заклад окремо: оберіть його в розділі «Заклади».")
    return unit_id


@router.get("/dashboard/waves", response_model=list[WaveOption])
def dashboard_waves(
    unit_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """Закриті хвилі, що охоплюють підрозділ, від нових до старих: для перемикача хвилі в «Огляді».

    Хвилі без індексу (одна анкета, замало відповідей) теж у списку з has_index=false: фронтенд показує їх
    неактивними. is_current — та, яку GET /dashboard відкриває без campaign_id.
    """
    unit_id = default_unit(db, user, unit_id)
    scopes = default_scopes(db, unit_id)
    if not scopes:
        return []
    scope = scopes[0] if unit_id is None else unit_id
    ensure_unit_access(db, user, scope, purpose="waves")
    try:
        current = pick_wave(db, None, scope)[0].id
    except ApiError:
        current = None
    unit_names = dict(db.execute(select(Unit.id, Unit.name)).all())
    snapshots = results.unit_snapshots(db, scope)
    return [
        {"id": c.id, "title": c.title, "closed_on": c.closed_on, "unit_name": unit_names.get(c.unit_id, ""),
         "has_index": s.index_score is not None, "is_current": c.id == current}
        for c, s in reversed(snapshots)
    ]


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
    unit_id = default_unit(db, user, unit_id)
    campaign, scope_id = pick_wave(db, campaign_id, unit_id)
    ensure_unit_access(db, user, scope_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    try:
        data = results.results_for(db, campaign, scope_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    scope = uuid.UUID(data["unit_id"])
    db.commit()
    # Той самий поріг k, що й в індексі хвилі (а не загальний за замовчуванням).
    signals = facts.risk_signals(db, scope, 3, campaign.closed_on, campaign.min_group_size)
    recs = recommend(data, signals)
    dyn = data.get("dynamics")
    trend = [
        {"campaign_id": c.id, "campaign_title": c.title, "closed_on": s.closed_on, "index": s.index_score,
         "index_self": s.index_self, "reliability": s.reliability, "has_index": s.index_score is not None}
        for c, s in results.unit_snapshots(db, scope)
    ]
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
        "candor_card": (data.get("candor") or {}).get("card", []),
        "candor_flags": (data.get("candor") or {}).get("flags", []),
        "gaming_signals": (data.get("goodhart") or {}).get("signals", []),
    }
