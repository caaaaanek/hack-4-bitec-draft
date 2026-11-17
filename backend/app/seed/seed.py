"""Заповнення БД синтетичними демо-даними й анкетами з додатків Б і В.

Запуск: python -m app.seed.seed [--with-waves]
Повторний запуск нічого не дублює.
"""

import argparse
import json
import os
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import today as clock_today
from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    Indicator,
    Questionnaire,
    RespondentCategory,
    Role,
    Unit,
    User,
)
from app.schemas import QuestionnaireCreate
from app.seed.waves import WAVE_GAP_MONTHS, seed_waves
from app.security import hash_password
from app.services.facts import months_back
from app.services.methodology import FACTS_WINDOW_MONTHS
from app.services.questionnaires import build_sections, publish, validate_for_publish

DATA_DIR = Path(__file__).parent / "data"
QUESTIONNAIRE_FILES = [
    "nazk_maturity_wg.json",
    "nazk_maturity_staff.json",
    "nazk_maturity_expert.json",
    "nazk_checklist.json",
]

# Синтетична структура. Підрозділи без типів: ієрархію задає адміністратор.
ROOT_UNIT = "Організація (демо)"
UNITS = {
    ROOT_UNIT: None,
    "Підрозділ А": ROOT_UNIT,
    "Підрозділ Б": ROOT_UNIT,
    "Підрозділ А-1": "Підрозділ А",
    "Підрозділ А-2": "Підрозділ А",
    "Підрозділ Б-1": "Підрозділ Б",
    "Підрозділ В": ROOT_UNIT,
}


def get_or_create_unit(db: Session, name: str, parent: Unit | None) -> Unit:
    unit = db.scalar(select(Unit).where(Unit.name == name))
    if unit is None:
        unit = Unit(name=name, parent_id=parent.id if parent else None)
        db.add(unit)
        db.flush()
    return unit


def seed_units(db: Session) -> dict[str, Unit]:
    units: dict[str, Unit] = {}
    for name, parent_name in UNITS.items():
        units[name] = get_or_create_unit(db, name, units.get(parent_name) if parent_name else None)
    return units


# Повний демо-склад (python -m app.seed.seed): 10–15 осіб особового складу на підрозділ.
# Базові staff01…staff24 лишаються як були (по 4 на підрозділ), решта staff25+ доповнює до цих розмірів.
DEMO_STAFF_SIZES = {
    "Підрозділ А": 12,
    "Підрозділ Б": 14,
    "Підрозділ А-1": 10,
    "Підрозділ А-2": 13,
    "Підрозділ Б-1": 11,
    "Підрозділ В": 15,
}
BASE_STAFF = 24


def seed_users(db: Session, units: dict[str, Unit], password: str, staff_sizes: dict[str, int] | None = None) -> int:
    """Демо-користувачі. Без staff_sizes — компактний склад (24 особи, як у тестах)."""
    root = units[ROOT_UNIT]
    staff_units = [u for name, u in units.items() if name != ROOT_UNIT]
    people: list[tuple[str, str, Role, RespondentCategory | None, Unit | None]] = [
        ("admin", "Адміністратор (демо)", Role.ADMIN, None, None),
        ("commissioner", "Розробник анкет (демо)", Role.COMMISSIONER, None, None),
        ("leader", "Керівник (демо)", Role.LEADER, None, None),
        ("leader_a", "Керівник підрозділу А (демо)", Role.LEADER, None, units["Підрозділ А"]),
        ("auditor", "Аудитор (демо)", Role.AUDITOR, None, None),
        ("coordinator", "Координатор (демо)", Role.COORDINATOR, None, None),
    ]
    people += [(f"wg{i}", f"Член робочої групи {i}", Role.RESPONDENT, RespondentCategory.WORKING_GROUP, root) for i in range(1, 7)]
    people += [
        (f"staff{i:02d}", f"Респондент {i:02d}", Role.RESPONDENT, RespondentCategory.STAFF, staff_units[(i - 1) % len(staff_units)])
        for i in range(1, BASE_STAFF + 1)
    ]
    if staff_sizes:
        base_per_unit = {u.id: sum(1 for i in range(BASE_STAFF) if i % len(staff_units) == n) for n, u in enumerate(staff_units)}
        number = BASE_STAFF
        for name, size in staff_sizes.items():
            unit = units[name]
            for _ in range(size - base_per_unit[unit.id]):
                number += 1
                people.append((f"staff{number:02d}", f"Респондент {number:02d}", Role.RESPONDENT, RespondentCategory.STAFF, unit))
    people += [(f"expert{i}", f"Експерт {i}", Role.RESPONDENT, RespondentCategory.EXPERT, None) for i in range(1, 6)]

    created = 0
    for login, name, role, category, unit in people:
        if db.scalar(select(User.id).where(User.login == login)):
            continue
        db.add(
            User(
                login=login,
                display_name=name,
                password_hash=hash_password(password),
                role=role,
                category=category,
                unit_id=unit.id if unit else None,
            )
        )
        created += 1
    return created


def seed_questionnaires(db: Session) -> int:
    created = 0
    for file_name in QUESTIONNAIRE_FILES:
        data = QuestionnaireCreate.model_validate(json.loads((DATA_DIR / file_name).read_text(encoding="utf-8")))
        if db.scalar(select(Questionnaire.id).where(Questionnaire.code == data.code)):
            continue
        questionnaire = Questionnaire(
            code=data.code,
            version=1,
            title=data.title,
            description=data.description,
            kind=data.kind,
            target_category=data.target_category,
            sections=build_sections(data.sections),
        )
        issues = validate_for_publish(questionnaire)
        if issues:
            raise ValueError(f"{file_name}: {issues}")
        publish(questionnaire)
        db.add(questionnaire)
        created += 1
    return created


# Джерело кожного факту — та сама система, що й в адаптерах (adapters/sources.py), щоб у демо було видно,
# звідки береться показник. Тест test_seed_fact_sources_match_adapters стежить за відповідністю.
FACT_SOURCES = {
    "coi_reviewed": "artemida",
    "declarations_on_time": "atestat",
    "hiring_checks": "atestat",
    "training_coverage": "training",
    "procurement_flags_reviewed": "procurement",
    "reports_handled": "reports",
}

# Синтетичні факти за місяць для кожного підрозділу: (з них, всього).
# Підібрано так, щоб частки були близькі до прикладу з методики:
# навчання ~72%, декларації ~96%, КІ ~55%, закупівлі ~40%, повідомлення ~80%, перевірка ~90%.
DEMO_FACTS = {
    "training_coverage": [(5, 7), (5, 7), (6, 8)],
    "declarations_on_time": [(24, 25), (24, 25), (24, 25)],
    "coi_reviewed": [(1, 2), (1, 2), (2, 3)],
    "procurement_flags_reviewed": [(1, 3), (1, 2), (0, 0)],
    "reports_handled": [(1, 1), (0, 1), (1, 1), (2, 2), (1, 1)],
    "hiring_checks": [(2, 2), (1, 1), (2, 3), (2, 2)],
}


# Факти старші за останні 12 місяців (потрібні для хвилі «пів року тому»): розбір гірший,
# щоб у динаміці було видно покращення після заходів.
DEMO_FACTS_EARLY = {
    "training_coverage": [(4, 7), (5, 8), (4, 7)],
    "declarations_on_time": [(22, 25), (23, 25), (22, 25)],
    "coi_reviewed": [(1, 3), (0, 2), (1, 2)],
    "procurement_flags_reviewed": [(0, 3), (1, 3), (0, 0)],
    "reports_handled": [(0, 1), (1, 2), (1, 1), (1, 2), (0, 1)],
    "hiring_checks": [(1, 2), (1, 1), (2, 3), (1, 2)],
}


def seed_indicators(db: Session, units: dict[str, Unit], today: date | None = None,
                    months: int = FACTS_WINDOW_MONTHS) -> int:
    """Факти за `months` місяців для всіх підрозділів, крім кореневого. Детерміновано, без випадковості.

    Останні 12 місяців — DEMO_FACTS, старші — DEMO_FACTS_EARLY.
    """
    periods = months_back(today or clock_today(), months)
    early = len(periods) - FACTS_WINDOW_MONTHS
    created = 0
    for u_index, (name, unit) in enumerate(units.items()):
        if name == ROOT_UNIT:
            continue
        for p_index, period in enumerate(periods):
            patterns = DEMO_FACTS_EARLY if p_index < early else DEMO_FACTS
            for code, pattern in patterns.items():
                numerator, denominator = pattern[(u_index + p_index - early) % len(pattern)]
                exists = db.scalar(
                    select(Indicator.id).where(Indicator.unit_id == unit.id, Indicator.period == period, Indicator.indicator == code)
                )
                if exists:
                    continue
                db.add(Indicator(unit_id=unit.id, period=period, indicator=code, numerator=numerator,
                                 denominator=denominator, source=FACT_SOURCES[code],
                                 why="Синтетичні демо-дані (seed)"))
                created += 1
    return created


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Синтетичні демо-дані")
    parser.add_argument("--with-waves", action="store_true",
                        help="Ще дві закриті хвилі, рішення керівника й заходи (або SEED_WITH_WAVES=1)")
    args = parser.parse_args(argv)
    with_waves = args.with_waves or os.environ.get("SEED_WITH_WAVES", "").lower() in ("1", "true", "yes")

    password = get_settings().demo_password
    if len(password) < 8:
        raise SystemExit("Задайте DEMO_PASSWORD (щонайменше 8 символів) у .env")
    months = FACTS_WINDOW_MONTHS + (WAVE_GAP_MONTHS if with_waves else 0)
    with SessionLocal() as db:
        units = seed_units(db)
        users = seed_users(db, units, password, DEMO_STAFF_SIZES)
        questionnaires = seed_questionnaires(db)
        indicators = seed_indicators(db, units, months=months)
        db.commit()
    print(f"Підрозділів: {len(units)}, нових користувачів: {users}, нових анкет: {questionnaires}, фактів: {indicators}")
    if with_waves:
        for line in seed_waves():
            print(line)


if __name__ == "__main__":
    main()
