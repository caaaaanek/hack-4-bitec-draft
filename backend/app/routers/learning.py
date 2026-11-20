"""Флешкартки доброчесності (services/learning.py): колоди, проходження, агрегат охоплення, публікація показника."""

import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import today
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import Role, User
from app.security import RESULT_READERS, ensure_unit_access, get_current_user, home_unit, require_roles
from app.services import learning

router = APIRouter(prefix="/learning", tags=["learning"])
PERIOD = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class Card(BaseModel):
    id: str
    situation: str
    steps: list[str]
    why: str
    law: str


class DeckSummary(BaseModel):
    code: str
    title: str
    description: str
    component: str
    cards: int
    required: bool
    my_completed_on: date | None = Field(default=None, description="Коли я востаннє пройшов колоду")
    my_valid: bool = Field(default=False, description="Проходження ще чинне (у межах valid_days)")


class DecksOut(BaseModel):
    decks: list[DeckSummary]
    required: list[str]
    valid_days: int
    i_am_trained: bool
    source: str


class DeckOut(BaseModel):
    code: str
    title: str
    description: str
    component: str
    required: bool
    cards: list[Card]


class CompleteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seen: list[str] = Field(description="Ідентифікатори переглянутих карток: щоб зарахувати, потрібні всі")


class CompleteOut(BaseModel):
    deck: str
    completed_on: date
    i_am_trained: bool


class StatsOut(BaseModel):
    unit_id: uuid.UUID
    eligible: int | None
    trained: int | None
    percent: float | None
    suppressed: bool
    by_deck: dict[str, int | None]
    required: list[str]
    valid_days: int
    rule: str


class PublishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period: str | None = Field(default=None, description="YYYY-MM, за замовчуванням поточний місяць")


class PublishOut(BaseModel):
    period: str
    units: int
    numerator: int
    denominator: int


def deck_or_404(code: str) -> dict:
    d = learning.deck(code)
    if d is None:
        raise ApiError(404, "Колоду не знайдено", code="not_found")
    return d


def summaries(db: Session, user: User) -> DecksOut:
    mine = learning.my_status(db, user)

    def fresh(on: date | None) -> bool:
        return on is not None and (today() - on).days < learning.valid_days()

    decks = [DeckSummary(code=d["code"], title=d["title"], description=d["description"], component=d["component"],
                         cards=len(d["cards"]), required=d["code"] in learning.required(),
                         my_completed_on=mine.get(d["code"]), my_valid=fresh(mine.get(d["code"])))
             for d in learning.catalog()["decks"]]
    return DecksOut(decks=decks, required=learning.required(), valid_days=learning.valid_days(),
                    i_am_trained=user.id in learning.trained(db, today()), source=learning.catalog()["source"])


@router.get("/decks", response_model=DecksOut)
def list_decks(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Колоди й мій стан проходження. Свій стан бачить лише сама людина."""
    return summaries(db, user)


@router.get("/decks/{code}", response_model=DeckOut)
def get_deck(code: str, _: User = Depends(get_current_user)):
    d = deck_or_404(code)
    return {**d, "required": d["code"] in learning.required()}


@router.post("/decks/{code}/complete", response_model=CompleteOut)
def complete_deck(code: str, data: CompleteIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Позначити колоду пройденою. Зараховується, якщо переглянуто всі картки; відповіді не зберігаються."""
    d = deck_or_404(code)
    missing = {c["id"] for c in d["cards"]} - set(data.seen)
    if missing:
        raise ApiError(422, f"Переглянуто не всі картки: бракує {len(missing)}", code="validation_error",
                       hint="Перегорніть усі картки колоди.")
    row = learning.complete(db, user, code)
    # У журнал дій не пишемо: запис «хто пройшов колоду» склав би поіменний список навченості, а запобіжник А10
    # (docs/abuse-analysis.md) його забороняє. Свій стан бачить лише сама людина, решта — агрегат від k (/stats).
    db.commit()
    return CompleteOut(deck=code, completed_on=row.completed_on, i_am_trained=user.id in learning.trained(db, today()))


@router.get("/stats", response_model=StatsOut)
def learning_stats(unit_id: uuid.UUID | None = None, db: Session = Depends(get_db),
                   user: User = Depends(require_roles(*RESULT_READERS))):
    """Скільки людей пройшли навчання (агрегат з порогом k). Імен і поіменних списків немає."""
    if unit_id is None:
        unit_id = home_unit(db, user)
    if unit_id is None:
        raise ApiError(404, "Немає підрозділів", code="not_found")
    ensure_unit_access(db, user, unit_id)
    return learning.stats(db, unit_id, get_settings().min_group_size)


@router.post("/publish", response_model=PublishOut)
def publish_coverage(data: PublishIn, db: Session = Depends(get_db), user: User = Depends(require_roles(Role.ADMIN))):
    """Записати training_coverage за місяць з даних флешкарток (джерело learning). Автопілот робить це щодня."""
    if data.period and not PERIOD.match(data.period):
        raise ApiError(422, "period: YYYY-MM", code="validation_error")
    rows = learning.publish(db, data.period)
    period = data.period or f"{today():%Y-%m}"
    log_action(db, user, "publish", "indicator", None,
               {"indicator": learning.INDICATOR, "source": learning.SOURCE, "period": period, "units": len(rows)})
    db.commit()
    return PublishOut(period=period, units=len(rows), numerator=sum(r["numerator"] for r in rows),
                      denominator=sum(r["denominator"] for r in rows))
