"""Recommendations Tracker: заходи з відповідальним (посада), строком, статусом і доказом виконання."""

import re
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import today
from app.db import get_db
from app.errors import ApiError
from app.models import Campaign, Measure, MeasureStatus, Role, Unit, User
from app.security import RESULT_READERS, campaign_visible, ensure_unit_access, require_roles, visible_unit_filter
from app.services import measures as service
from app.services import methodology as m
from app.services import titles
from app.services.units import subtree_ids

router = APIRouter(prefix="/measures", tags=["measures"])
readers = require_roles(*RESULT_READERS)
leader_only = require_roles(Role.LEADER)


# Відповідальний — посада чи підрозділ, а не людина: «Прізвище І. Б.» чи «І. Б. Прізвище» не приймаються.
_UP, _LOW = "А-ЯІЇЄҐA-Z", "а-яіїєґa-z'’ʼ-"
PERSON_NAME = re.compile(
    rf"[{_UP}][{_LOW}]+\s+[{_UP}]\.\s?[{_UP}]\.|(?<![{_UP}{_LOW}])[{_UP}]\.\s?[{_UP}]\.\s?[{_UP}][{_LOW}]+")


def check_owner(value: str | None) -> str | None:
    if value is not None and PERSON_NAME.search(value):
        raise ValueError("owner: вкажіть посаду чи підрозділ відповідального, без ПІБ (оцінюється система, а не люди)")
    return value


# Дозволені переходи статусу заходу. Повернення з «виконано» чи «скасовано» і скасування — лише з причиною (reason).
TRANSITIONS: dict[MeasureStatus, set[MeasureStatus]] = {
    MeasureStatus.PLANNED: {MeasureStatus.IN_PROGRESS, MeasureStatus.DONE, MeasureStatus.CANCELLED},
    MeasureStatus.IN_PROGRESS: {MeasureStatus.PLANNED, MeasureStatus.DONE, MeasureStatus.CANCELLED},
    MeasureStatus.DONE: {MeasureStatus.IN_PROGRESS},
    MeasureStatus.CANCELLED: {MeasureStatus.PLANNED},
}


def needs_reason(old: MeasureStatus, new: MeasureStatus) -> bool:
    return old in (MeasureStatus.DONE, MeasureStatus.CANCELLED) or new == MeasureStatus.CANCELLED


def check_transition(old: MeasureStatus, new: MeasureStatus) -> None:
    if new != old and new not in TRANSITIONS[old]:
        allowed = ", ".join(f"{x.value} ({titles.measure_status(x)})" for x in sorted(TRANSITIONS[old])) or "—"
        raise ApiError(409, f"Зі статусу «{titles.measure_status(old)}» не можна перейти "
                            f"в «{titles.measure_status(new)}»",
                       code="bad_transition",
                       hint=f"Дозволено: {allowed}.")


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
        check_owner(self.owner)
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
    reason: str | None = Field(default=None, max_length=1000,
                               description="Причина: обов'язкова для скасування і повернення з done чи cancelled")

    @model_validator(mode="after")
    def owner_is_position(self):
        check_owner(self.owner)
        return self


class MeasureVerification(BaseModel):
    """Перевірка наступним оцінюванням: як змінився компонент заходу після його виконання."""

    status: str = Field(description="not_done | awaiting_wave | no_data | improved | worsened | within_error | check_data")
    title: str
    component: str | None
    previous: float | None
    current: float | None
    delta: float | None
    baseline_campaign_id: uuid.UUID | None
    next_campaign_id: uuid.UUID | None
    next_campaign_title: str | None
    rule: str


class ExternalDocument(BaseModel):
    name: str
    sha256: str
    verify_url: str | None = None


class MeasureExternal(BaseModel):
    """Стан заходу в Mitra (тема 2). Посилання ведуть лише на адресу Mitra з налаштувань."""

    source: str
    system: str
    id: str | None
    state: str | None
    state_title: str | None
    url: str | None
    note: str | None
    summary: str | None
    documents: list[ExternalDocument]
    updated_at: datetime | None


class MeasureHistoryItem(BaseModel):
    at: datetime
    action: str
    action_title: str
    actor: str | None = Field(description="Ім'я того, хто змінив; «Система» чи «Тема 2 (Mitra)» для автоматичних змін")
    status: str | None = None
    from_status: str | None = None
    reason: str | None = None
    evidence: str | None = None
    text: str = Field(description="Готовий рядок для картки: «Статус: в роботі → виконано. Доказ: …»")


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
    external: MeasureExternal | None = None
    created_at: datetime
    updated_at: datetime
    verification: MeasureVerification | None = None
    campaign_title: str | None = Field(default=None, description="Назва хвилі, з якої взято захід")
    history: list[MeasureHistoryItem] | None = Field(
        default=None, description="Лише в GET /measures/{id}: зміни з журналу дій, найстаріші першими")


class MeasureStats(BaseModel):
    total: int
    by_status: dict[str, int]
    overdue: int


def create_measure(db: Session, user: User, data: MeasureIn) -> Measure:
    if db.get(Unit, data.unit_id) is None:
        raise HTTPException(status_code=422, detail="Підрозділ не знайдено")
    ensure_unit_access(db, user, data.unit_id, "manage")
    if data.campaign_id is not None:
        campaign = db.get(Campaign, data.campaign_id)
        # campaign_id у тілі: campaign_zone_guard його не перевіряє, тож хвиля поза зоною — як відсутня.
        if campaign is None or not campaign_visible(db, user, campaign):
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
    ensure_unit_access(db, user, measure.unit_id, "manage")
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
    # Керівник, а також уповноважений і аудит зі своєю зоною — за замовчуванням лише свій підрозділ і піддерево.
    scope = unit_id or (user.unit_id if user.role in (Role.LEADER, Role.ADMIN, Role.AUDITOR) else None)
    query = select(Measure).order_by(Measure.due_date, Measure.created_at)
    if scope is not None:
        ensure_unit_access(db, user, scope, "manage")
        query = query.where(Measure.unit_id.in_(subtree_ids(db, scope)))
    else:
        # Департамент (і будь-хто з обмеженою зоною) без unit_id — лише заклади своєї зони, а не всі заходи.
        visible = visible_unit_filter(db, user)
        if visible is not None:
            query = query.where(Measure.unit_id.in_(visible))
    if status_ is not None:
        query = query.where(Measure.status == status_)
    if campaign_id is not None:
        query = query.where(Measure.campaign_id == campaign_id)
    items = service.to_dicts(db, db.scalars(query).all())
    if overdue is not None:
        items = [i for i in items if i["overdue"] == overdue]
    return items


@router.get("/stats", response_model=MeasureStats)
def measure_stats(unit_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(readers)):
    ensure_unit_access(db, user, unit_id, "manage")
    return service.stats(db, unit_id)


@router.get("/{measure_id}", response_model=MeasureOut)
def get_measure(measure_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(readers)):
    """Захід з історією змін (`history`) і доказом виконання (`evidence`, `done_on`)."""
    measure = get_or_404(db, measure_id, user)
    return {**service.to_dicts(db, [measure])[0], "history": service.history(db, measure)}


@router.post("", response_model=MeasureOut, status_code=status.HTTP_201_CREATED)
def post_measure(data: MeasureIn, db: Session = Depends(get_db), user: User = Depends(leader_only)):
    measure = create_measure(db, user, data)
    db.commit()
    return service.to_dicts(db, [measure])[0]


@router.patch("/{measure_id}", response_model=MeasureOut)
def patch_measure(measure_id: uuid.UUID, data: MeasureUpdate, db: Session = Depends(get_db), user: User = Depends(leader_only)):
    """Зміна заходу. Виконаним — лише з доказом; переходи статусів — за TRANSITIONS; скасування й повернення
    з «виконано» чи «скасовано» — з причиною, яка йде в журнал дій."""
    measure = get_or_404(db, measure_id, user)
    changes = data.model_dump(exclude_unset=True)
    reason = (changes.pop("reason", None) or "").strip()
    old_status = measure.status
    new_status = changes.get("status")
    if new_status is not None and new_status != old_status:
        check_transition(old_status, new_status)
        if needs_reason(old_status, new_status) and len(reason) < 3:
            raise ApiError(422, "Вкажіть причину зміни статусу (reason)", code="reason_required",
                           hint="Скасування і повернення виконаного чи скасованого заходу фіксуються з причиною.")
    for field, minimum in (("title", 3), ("owner", 2)):
        # Обмеження min_length перевіряються до strip(): «  ab  » проходило як назва з двох літер.
        if isinstance(changes.get(field), str) and len(changes[field].strip()) < minimum:
            raise ApiError(422, f"{field}: щонайменше {minimum} символи без пробілів по краях", code="invalid")
    for field in ("title", "description", "owner", "due_date", "evidence"):
        if field in changes and changes[field] is not None:
            setattr(measure, field, changes[field].strip() if isinstance(changes[field], str) else changes[field])

    if (new_status or measure.status) == MeasureStatus.DONE and not (measure.evidence or "").strip():
        raise HTTPException(status_code=422, detail="Щоб позначити захід виконаним, додайте доказ виконання (evidence)")
    if new_status == MeasureStatus.DONE and old_status != MeasureStatus.DONE:
        done_on = changes.get("done_on") or today()
        if done_on > today():
            raise HTTPException(status_code=422, detail="Дата виконання не може бути в майбутньому")
        measure.done_on = done_on
    elif new_status is not None and new_status != MeasureStatus.DONE:
        measure.done_on = None
    if new_status is not None:
        measure.status = new_status

    service.enqueue_measure(db, measure)
    logged = {k: (v.value if hasattr(v, "value") else str(v)) for k, v in changes.items() if k != "description"}
    if new_status is not None and new_status != old_status:
        logged["from_status"] = old_status.value
    if reason:
        logged["reason"] = reason
    log_action(db, user, "update", "measure", measure.id, logged)
    db.commit()
    return service.to_dicts(db, [measure])[0]
