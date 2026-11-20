"""Флешкартки доброчесності: колоди синтетичних ситуацій і показник «охоплення навчанням» з даних системи.

- Людина гортає колоду й позначає її пройденою. Відповіді на окремі картки не зберігаються.
- «Пройшов навчання» = пройшов усі обов'язкові колоди за останні VALID_DAYS днів.
- training_coverage рахується з цих записів, а не з моку: X з Y по підрозділу, де Y — активні учасники
  (особовий склад і робоча група; експерти зовнішні). Назовні — лише агрегати з порогом k.
"""

import json
import uuid
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import today
from app.models import Indicator, RespondentCategory, Role, TrainingCompletion, User
from app.services import fact_registry
from app.services.facts import months_back
from app.services.units import subtree_from, unit_tree

DECKS_FILE = Path(__file__).resolve().parent.parent / "seed" / "data" / "flashcards.json"
SOURCE = "learning"
INDICATOR = "training_coverage"
LEARNERS = (RespondentCategory.STAFF, RespondentCategory.WORKING_GROUP)


@lru_cache
def catalog() -> dict:
    data = json.loads(DECKS_FILE.read_text(encoding="utf-8"))
    data["by_code"] = {d["code"]: d for d in data["decks"]}
    return data


def required() -> list[str]:
    return list(catalog()["required"])


def valid_days() -> int:
    return int(catalog()["valid_days"])


def deck(code: str) -> dict | None:
    return catalog()["by_code"].get(code)


def complete(db: Session, user: User, code: str, on: date | None = None) -> TrainingCompletion:
    on = on or today()
    row = db.scalar(select(TrainingCompletion).where(TrainingCompletion.user_id == user.id,
                                                     TrainingCompletion.deck == code,
                                                     TrainingCompletion.completed_on == on))
    if row is None:
        row = TrainingCompletion(user_id=user.id, deck=code, completed_on=on)
        db.add(row)
        db.flush()
    return row


def my_status(db: Session, user: User) -> dict[str, date]:
    """Остання дата проходження кожної колоди цією людиною (бачить лише вона сама)."""
    out: dict[str, date] = {}
    for code, on in db.execute(select(TrainingCompletion.deck, TrainingCompletion.completed_on)
                               .where(TrainingCompletion.user_id == user.id)):
        if code not in out or on > out[code]:
            out[code] = on
    return out


def trained(db: Session, as_of: date) -> set[uuid.UUID]:
    """Хто на дату as_of пройшов усі обов'язкові колоди за останні valid_days днів."""
    start = as_of - timedelta(days=valid_days() - 1)
    need = set(required())
    done: dict[uuid.UUID, set[str]] = {}
    for user_id, code in db.execute(select(TrainingCompletion.user_id, TrainingCompletion.deck).where(
            TrainingCompletion.completed_on >= start, TrainingCompletion.completed_on <= as_of,
            TrainingCompletion.deck.in_(need))):
        done.setdefault(user_id, set()).add(code)
    return {u for u, codes in done.items() if codes >= need}


def learners(db: Session) -> list[User]:
    return list(db.scalars(select(User).where(User.role == Role.RESPONDENT, User.is_active.is_(True),
                                              User.category.in_(LEARNERS), User.unit_id.is_not(None))))


def month_end(period: str) -> date:
    y, mth = int(period[:4]), int(period[5:7])
    first_next = date(y + (mth == 12), mth % 12 + 1, 1)
    return first_next - timedelta(days=1)


def publish(db: Session, period: str | None = None) -> list[dict]:
    """Записує training_coverage за місяць для кожного підрозділу з учасниками: X пройшли з Y.

    На кінець місяця (або сьогодні, якщо місяць поточний). Повторний виклик перезаписує.
    """
    period = period or f"{today():%Y-%m}"
    as_of = min(month_end(period), today())
    done = trained(db, as_of)
    per_unit: dict[uuid.UUID, list[int]] = {}
    for u in learners(db):
        counts = per_unit.setdefault(u.unit_id, [0, 0])
        counts[1] += 1
        counts[0] += u.id in done
    out = []
    if not fact_registry.may_write(INDICATOR, SOURCE):
        return out  # власник охоплення навчанням у цьому розгортанні інша система (FACT_OWNERS)
    for unit_id, (num, den) in sorted(per_unit.items(), key=lambda x: str(x[0])):
        row = db.scalar(select(Indicator).where(Indicator.unit_id == unit_id, Indicator.period == period,
                                                Indicator.indicator == INDICATOR))
        if row is None:
            row = Indicator(unit_id=unit_id, period=period, indicator=INDICATOR)
            db.add(row)
        row.numerator, row.denominator, row.source = num, den, SOURCE
        row.why = f"Флешкартки: пройшли всі обов'язкові колоди ({', '.join(required())}) на {as_of:%d.%m.%Y}"
        row.extra_counts = {}
        out.append({"unit_id": unit_id, "numerator": num, "denominator": den})
    db.flush()
    return out


def stats(db: Session, scope: uuid.UUID, k: int) -> dict:
    """Агрегат для керівника: скільки людей підрозділу (з дочірніми) пройшли навчання. Менше k — приховано."""
    units = subtree_from(unit_tree(db)[0], scope)
    people = [u for u in learners(db) if u.unit_id in units]
    done = trained(db, today())
    eligible = len(people)
    ok = eligible >= k
    n_done = sum(1 for u in people if u.id in done)
    by_deck = {}
    start = today() - timedelta(days=valid_days() - 1)
    ids = {u.id for u in people}
    for d in catalog()["decks"]:
        users = set(db.scalars(select(TrainingCompletion.user_id).where(
            TrainingCompletion.deck == d["code"], TrainingCompletion.completed_on >= start)))
        by_deck[d["code"]] = len(users & ids) if ok else None
    return {
        "unit_id": scope, "eligible": eligible if ok else None, "trained": n_done if ok else None,
        "percent": round(100 * n_done / eligible, 1) if ok and eligible else None,
        "suppressed": not ok, "by_deck": by_deck, "required": required(), "valid_days": valid_days(),
        "rule": f"Пройшов навчання — усі обов'язкові колоди ({', '.join(required())}) за останні {valid_days()} днів. "
                f"Групи менші за k = {k} не показуються.",
    }


def recent_periods(n: int = 1) -> list[str]:
    return months_back(today(), n)
