"""Прийом фактів з інших систем і їх перегляд.

Передаються лише агрегати "X з Y". Будь-яке зайве поле (наприклад, ім'я
людини) відхиляється з 422.
"""

import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import Indicator, Role, Unit, User
from app.clock import today
from app.security import RESULT_READERS, ensure_unit_access, get_current_user, keys_equal, require_roles, zone_of
from app.services import fact_registry, facts, methodology as m

router = APIRouter(tags=["indicators"])
INT32_MAX = 2**31 - 1
optional_token = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


class IndicatorIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="Місяць у форматі YYYY-MM")
    indicator: str
    # Колонки INTEGER (у PostgreSQL 32 біти): більше значення давало 500 при записі.
    numerator: int = Field(ge=0, le=INT32_MAX)
    denominator: int = Field(ge=0, le=INT32_MAX)
    source: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.-]+$")
    why: str = Field(default="", max_length=1000)
    extra_counts: dict[str, int] = Field(default_factory=dict, description="Лише для показу, на бал не впливає")

    @field_validator("indicator")
    @classmethod
    def known_indicator(cls, value: str) -> str:
        # Факти довідника (fact_definitions) перевіряються в обробнику, після оновлення реєстру з БД.
        if value not in m.FACTS and not re.fullmatch(r"[a-z][a-z0-9_]{1,63}", value):
            raise ValueError(f"Невідомий показник. Дозволені: {', '.join(m.FACTS)}")
        return value

    @field_validator("extra_counts")
    @classmethod
    def plain_counts(cls, value: dict[str, int]) -> dict[str, int]:
        if len(value) > 10:
            raise ValueError("Не більше 10 додаткових лічильників")
        for key, count in value.items():
            if not re.fullmatch(r"[a-z_]{1,32}", key) or count < 0:
                raise ValueError("Ключі лише латиницею (a-z, _), значення лише невід'ємні цілі")
        return value

    @model_validator(mode="after")
    def numerator_not_above_denominator(self):
        if self.numerator > self.denominator:
            raise ValueError("numerator не може бути більшим за denominator")
        return self


class IndicatorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    unit_id: uuid.UUID
    period: str
    indicator: str
    numerator: int
    denominator: int
    source: str
    why: str
    extra_counts: dict


class FactOut(BaseModel):
    indicator: str
    title: str
    component: str
    periods: str
    sources: list[str]
    status: str  # ok / too_few_people / no_denominator
    numerator: int | None
    denominator: int | None
    percent: float | None
    level: int | None
    score: float | None
    extra_counts: dict
    label: str
    rule: str


class RiskSignal(BaseModel):
    indicator: str
    title: str
    status: str
    found: int | None
    handled: int | None
    pending: int | None
    previous_found: int | None
    change: int | None
    extra_counts: dict


class IntegrationActor:
    """Хто передає факт: користувач-адмін або інша система з ключем, прив'язаним до джерела."""

    def __init__(self, user: User | None = None, source: str | None = None, any_source: bool = False):
        self.user = user
        self.source = source
        self.any_source = any_source


def integration_or_admin(
    token: str | None = Depends(optional_token),
    x_integration_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> IntegrationActor:
    """Факти може передавати інша система (ключ інтеграції) або адмін.

    Ключ із INTEGRATION_KEYS прив'язаний до одного джерела. Спільний INTEGRATION_API_KEY
    дозволяє будь-яке джерело (застарілий спосіб, для демо).
    """
    settings = get_settings()
    if x_integration_key:
        for source, key in settings.integration_key_map.items():
            if keys_equal(x_integration_key, key):
                return IntegrationActor(source=source)
        if keys_equal(x_integration_key, settings.integration_api_key):
            return IntegrationActor(any_source=True)
        raise HTTPException(status_code=401, detail="Невірний ключ інтеграції")
    if token is None:
        raise HTTPException(status_code=401, detail="Потрібна авторизація")
    user = get_current_user(token, db)
    if user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Недостатньо прав")
    return IntegrationActor(user=user, any_source=True)


@router.post("/indicators", response_model=IndicatorOut, status_code=status.HTTP_201_CREATED)
def post_indicator(data: IndicatorIn, db: Session = Depends(get_db), actor: IntegrationActor = Depends(integration_or_admin)):
    """Приймає або оновлює факт за місяць (одна пара підрозділ + місяць + показник)."""
    if not actor.any_source and data.source != actor.source:
        raise HTTPException(status_code=403, detail=f"Цей ключ дозволяє передавати лише джерело «{actor.source}»")
    fact_registry.refresh(db)
    if data.indicator not in m.FACTS:
        raise ApiError(422, [{"path": "indicator", "message": f"Невідомий показник. Дозволені: {', '.join(m.FACTS)}"}],
                       code="unknown_indicator", hint="Новий показник додає уповноважений у «Довідники» → «Факти».")
    if db.get(Unit, data.unit_id) is None:
        raise HTTPException(status_code=422, detail="Підрозділ не знайдено")
    if actor.user is not None:
        # Уповноважений зі своєю зоною передає факти лише своїх підрозділів (як і запускає перевірки).
        ensure_unit_access(db, actor.user, data.unit_id, "manage")
    if not actor.any_source and not fact_registry.may_write(data.indicator, data.source):
        allowed = ", ".join(fact_registry.owners(data.indicator) or ())
        raise ApiError(409, f"Показник «{data.indicator}» передає лише джерело: {allowed}", code="not_fact_owner",
                       hint="Власника факту задає методика (fact_registry.BUILTIN_OWNERS), довідник фактів "
                            "або FACT_OWNERS у налаштуваннях розгортання.")
    row = db.scalar(
        select(Indicator).where(
            Indicator.unit_id == data.unit_id, Indicator.period == data.period, Indicator.indicator == data.indicator
        )
    )
    if row is not None and not actor.any_source and row.source != actor.source:
        # Ключ джерела дозволяє писати лише свої показники: інакше одне джерело (чи викрадений ключ одного
        # джерела) могло б тихо переписати факт іншого й змінити індекс. Якщо в факту кілька власників,
        # хто першим передав показник підрозділу за місяць, той ним і володіє; переписати чужий може лише
        # адмін або спільний ключ.
        raise ApiError(409, f"Цей показник за {data.period} передало джерело «{row.source}»", code="source_conflict",
                       hint="Ключ джерела може оновлювати лише показники, які передало саме це джерело.")
    if row is None:
        row = Indicator(unit_id=data.unit_id, period=data.period, indicator=data.indicator)
        db.add(row)
    for field in ("numerator", "denominator", "source", "why", "extra_counts"):
        setattr(row, field, getattr(data, field))
    db.flush()
    log_action(db, actor.user, "upsert", "indicator", row.id,
               {"indicator": data.indicator, "period": data.period, "source": data.source})
    db.commit()
    return row


class IntegrationUnitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None


@router.get("/indicators/units", response_model=list[IntegrationUnitOut])
def integration_units(db: Session = Depends(get_db), actor: IntegrationActor = Depends(integration_or_admin)):
    """Довідник підрозділів для адаптерів джерел: зіставити свої коди з unit_id. Лише id, назва, батько."""
    query = select(Unit).order_by(Unit.name)
    zone = zone_of(db, actor.user) if actor.user is not None else None
    if zone is not None:
        query = query.where(Unit.id.in_(zone))
    return db.scalars(query).all()


def check_unit(db: Session, unit_id: uuid.UUID, user: User) -> Unit:
    unit = db.get(Unit, unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Підрозділ не знайдено")
    ensure_unit_access(db, user, unit_id)
    return unit


@router.get("/units/{unit_id}/indicators", response_model=list[FactOut])
def unit_facts(
    unit_id: uuid.UUID,
    months: int = Query(default=12, description="3, 6 або 12"),
    end: date | None = Query(default=None, description="Дата, не пізніше сьогодні (за замовчуванням сьогодні). Період закінчується останнім "
                             "завершеним кварталом перед нею: місяць окремо не запитати"),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """Факти підрозділу (разом із дочірніми) у форматі 'X з Y'."""
    if months not in (3, 6, 12):
        raise HTTPException(status_code=422, detail="months: 3, 6 або 12")
    check_unit(db, unit_id, user)
    # Не пізніше сьогодні: майбутній end захопив би поточний незавершений квартал.
    periods = facts.window(min(end or today(), today()), months)
    return facts.aggregate_for_unit(db, unit_id, periods, get_settings().min_group_size)


@router.get("/units/{unit_id}/risk-signals", response_model=list[RiskSignal])
def risk_signals(
    unit_id: uuid.UUID,
    months: int = Query(default=3, description="3, 6 або 12"),
    end: date | None = Query(default=None, description="Дата, не пізніше сьогодні; період закінчується останнім завершеним кварталом перед нею"),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """Панель ризик-сигналів: сирі кількості знайденого і їх зміна до попереднього періоду.

    На індекс не впливає: кількість знайдених проблем не є поганою оцінкою.
    """
    if months not in (3, 6, 12):
        raise HTTPException(status_code=422, detail="months: 3, 6 або 12")
    check_unit(db, unit_id, user)
    return facts.risk_signals(db, unit_id, months, min(end or today(), today()), get_settings().min_group_size)
