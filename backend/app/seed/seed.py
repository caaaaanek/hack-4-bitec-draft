"""Заповнення БД синтетичними демо-даними й анкетами з додатків Б і В.

Запуск: python -m app.seed.seed
Повторний запуск нічого не дублює.
"""

import json
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


def seed_users(db: Session, units: dict[str, Unit], password: str) -> int:
    root = units[ROOT_UNIT]
    staff_units = [u for name, u in units.items() if name != ROOT_UNIT]
    people: list[tuple[str, str, Role, RespondentCategory | None, Unit | None]] = [
        ("admin", "Адміністратор (демо)", Role.ADMIN, None, None),
        ("commissioner", "Розробник анкет (демо)", Role.COMMISSIONER, None, None),
        ("leader", "Керівник (демо)", Role.LEADER, None, None),
        ("leader_a", "Керівник підрозділу А (демо)", Role.LEADER, None, units["Підрозділ А"]),
        ("auditor", "Аудитор (демо)", Role.AUDITOR, None, None),
    ]
    people += [(f"wg{i}", f"Член робочої групи {i}", Role.RESPONDENT, RespondentCategory.WORKING_GROUP, root) for i in range(1, 7)]
    people += [
        (f"staff{i:02d}", f"Респондент {i:02d}", Role.RESPONDENT, RespondentCategory.STAFF, staff_units[(i - 1) % len(staff_units)])
        for i in range(1, 25)
    ]
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


def seed_indicators(db: Session, units: dict[str, Unit], today: date | None = None) -> int:
    """Факти за 12 місяців для всіх підрозділів, крім кореневого. Детерміновано, без випадковості."""
    periods = months_back(today or clock_today(), FACTS_WINDOW_MONTHS)
    created = 0
    for u_index, (name, unit) in enumerate(units.items()):
        if name == ROOT_UNIT:
            continue
        for p_index, period in enumerate(periods):
            for code, pattern in DEMO_FACTS.items():
                numerator, denominator = pattern[(u_index + p_index) % len(pattern)]
                exists = db.scalar(
                    select(Indicator.id).where(Indicator.unit_id == unit.id, Indicator.period == period, Indicator.indicator == code)
                )
                if exists:
                    continue
                db.add(Indicator(unit_id=unit.id, period=period, indicator=code, numerator=numerator,
                                 denominator=denominator, source="demo-mock", why="Синтетичні демо-дані"))
                created += 1
    return created


def main() -> None:
    password = get_settings().demo_password
    if len(password) < 8:
        raise SystemExit("Задайте DEMO_PASSWORD (щонайменше 8 символів) у .env")
    with SessionLocal() as db:
        units = seed_units(db)
        users = seed_users(db, units, password)
        questionnaires = seed_questionnaires(db)
        indicators = seed_indicators(db, units)
        db.commit()
    print(f"Підрозділів: {len(units)}, нових користувачів: {users}, нових анкет: {questionnaires}, фактів: {indicators}")


if __name__ == "__main__":
    main()
