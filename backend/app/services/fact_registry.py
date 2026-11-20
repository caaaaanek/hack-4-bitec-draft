"""Факти з довідника fact_definitions поверх вбудованих у методиці.

methodology.FACTS — один словник для всього коду; тут він оновлюється на місці: вбудовані факти
лишаються як є, факти довідника додаються (або прибираються, якщо їх вимкнули). Оновлення —
на старті, після зміни довідника і перед прийомом факту та розрахунком хвилі (кілька процесів API).
"""

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.models import FactDefinition
from app.services import methodology as m

BUILTIN_FACTS: dict[str, dict] = {code: dict(spec) for code, spec in m.FACTS.items()}


def spec_of(row: FactDefinition) -> dict:
    return {"title": row.title, "component": row.component, "thresholds": list(row.thresholds),
            "numerator": row.numerator, "denominator": row.denominator, "rest": row.rest, "custom": True}


def refresh(db: Session) -> None:
    try:
        if not inspect(db.get_bind()).has_table("fact_definitions"):
            return
    except Exception:  # noqa: BLE001 — без таблиці (до міграцій) лишаються вбудовані факти
        return
    custom = {r.code: spec_of(r) for r in db.scalars(select(FactDefinition).where(FactDefinition.active.is_(True)))}
    for code in [c for c in m.FACTS if c not in BUILTIN_FACTS and c not in custom]:
        del m.FACTS[code]
    for code, spec in custom.items():
        if code not in BUILTIN_FACTS:
            m.FACTS[code] = spec


def validate_thresholds(values: list) -> str | None:
    if len(values) != 4:
        return "Потрібно рівно 4 межі (рівні 2, 3, 4, 5)"
    if any(not isinstance(v, int | float) or v < 0 or v > 100 for v in values):
        return "Межі — відсотки від 0 до 100"
    if list(values) != sorted(values) or len(set(values)) != 4:
        return "Межі мають строго зростати"
    return None
