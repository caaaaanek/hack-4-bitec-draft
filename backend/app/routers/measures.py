"""Recommendations Tracker: заходи з відповідальним (посада), строком, статусом і доказом виконання."""

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import today
from app.db import get_db
from app.models import Campaign, Measure, MeasureStatus, Role, Unit, User
from app.security import RESULT_READERS, ensure_unit_access, require_roles
from app.services import measures as service
from app.services import methodology as m
from app.services.units import subtree_ids

router = APIRouter(prefix="/measures", tags=["measures"])
readers = require_roles(*RESULT_READERS)
leader_only = require_roles(Role.LEADER)


class MeasureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    title: str = Field(min_length=3, max_length=500)
    description: str = Field(default="", max_length=4000)
    owner: str = Field(min_length=2, max_length=200, description="Посада чи підрозділ відповідального, без ПІБ")
    due_date: date
    component: str | None = None
    catalog_number: str | None = Field(default=None, max_length=16, description="Пункт типового плану (Додаток Д)")
    campaign_id: uuid.UUID | None = None
    recommendation_code: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def known_component(self):
        if self.component is not None and self.component not in m.COMPONENTS:
            raise ValueError(f"component: одне з {', '.join(m.COMPONENTS)}")
        return self


class MeasureUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=3, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    owner: str | None = Field(default=None, min_length=2, max_length=200)
    due_date: date | None = None
    status: MeasureStatus | None = None
    done_on: date | None = None
    evidence: str | None = Field(default=None, max_length=2000)


class MeasureOut(BaseModel):
    id: uuid.UUID
    unit_id: uuid.UUID
    campaign_id: uuid.UUID | None
    recommendation_code: str | None
    component: str | None
    catalog_number: str | None
    title: str
    description: str
    owner: str
    due_date: date
    status: MeasureStatus
    done_on: date | None
    evidence: str
    overdue: bool
    overdue_days: int | None
    external_id: str | None
    external_source: str | None
    created_at: datetime
    updated_at: datetime


class MeasureStats(BaseModel):
    total: int
    by_status: dict[str, int]
    overdue: int


def create_measure(db: Session, user: User, data: MeasureIn) -> Measure:
    if db.get(Unit, data.unit_id) is None:
        raise HTTPException(status_code=422, detail="Підрозділ не знайдено")
    ensure_unit_access(db, user, data.unit_id)
    if data.campaign_id is not None and db.get(Campaign, data.campaign_id) is None:
        raise HTTPException(status_code=422, detail="Хвилю не знайдено")
    measure = Measure(**data.model_dump(), created_by_id=user.id, status=MeasureStatus.PLANNED)
    db.add(measure)
    db.flush()
    service.enqueue_measure(db, measure)
    log_action(db, user, "create", "measure", measure.id,
               {"unit_id": str(measure.unit_id), "recommendation": measure.recommendation_code, "due_date": measure.due_date})
    return measure


def get_or_404(db: Session, measure_id: uuid.UUID, user: User) -> Measure:
    measure = db.get(Measure, measure_id)
    if measure is None:
        raise HTTPException(status_code=404, detail="Захід не знайдено")
    ensure_unit_access(db, user, measure.unit_id)
    return measure


@router.get("", response_model=list[MeasureOut])
def list_measures(
    unit_id: uuid.UUID | None = Query(default=None, description="Підрозділ разом із дочірніми"),
    status_: MeasureStatus | None = Query(default=None, alias="status"),
    campaign_id: uuid.UUID | None = None,
    overdue: bool | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(readers),
):
    scope = unit_id or (user.unit_id if user.role == Role.LEADER else None)
    query = select(Measure).order_by(Measure.due_date, Measure.created_at)
    if scope is not None:
        ensure_unit_access(db, user, scope)
        query = query.where(Measure.unit_id.in_(subtree_ids(db, scope)))
    if status_ is not None:
        query = query.where(Measure.status == status_)
    if campaign_id is not None:
        query = query.where(Measure.campaign_id == campaign_id)
    items = [service.to_dict(x) for x in db.scalars(query)]
    if overdue is not None:
        items = [i for i in items if i["overdue"] == overdue]
    return items


@router.get("/stats", response_model=MeasureStats)
def measure_stats(unit_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(readers)):
    ensure_unit_access(db, user, unit_id)
    return service.stats(db, unit_id)


@router.get("/{measure_id}", response_model=MeasureOut)
def get_measure(measure_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(readers)):
    return service.to_dict(get_or_404(db, measure_id, user))


@router.post("", response_model=MeasureOut, status_code=status.HTTP_201_CREATED)
def post_measure(data: MeasureIn, db: Session = Depends(get_db), user: User = Depends(leader_only)):
    measure = create_measure(db, user, data)
    db.commit()
    return service.to_dict(measure)


@router.patch("/{measure_id}", response_model=MeasureOut)
def patch_measure(measure_id: uuid.UUID, data: MeasureUpdate, db: Session = Depends(get_db), user: User = Depends(leader_only)):
    """Зміна заходу. Позначити виконаним можна лише з доказом виконання."""
    measure = get_or_404(db, measure_id, user)
    changes = data.model_dump(exclude_unset=True)
    for field in ("title", "description", "owner", "due_date", "evidence"):
        if field in changes and changes[field] is not None:
            setattr(measure, field, changes[field].strip() if isinstance(changes[field], str) else changes[field])

    new_status = changes.get("status")
    if new_status == MeasureStatus.DONE:
        if not measure.evidence:
            raise HTTPException(status_code=422, detail="Щоб позначити захід виконаним, додайте доказ виконання (evidence)")
        done_on = changes.get("done_on") or today()
        if done_on > today():
            raise HTTPException(status_code=422, detail="Дата виконання не може бути в майбутньому")
        measure.done_on = done_on
    elif new_status is not None:
        measure.done_on = None
    if new_status is not None:
        measure.status = new_status

    service.enqueue_measure(db, measure)
    log_action(db, user, "update", "measure", measure.id,
               {k: (v.value if hasattr(v, "value") else str(v)) for k, v in changes.items() if k != "description"})
    db.commit()
    return service.to_dict(measure)
