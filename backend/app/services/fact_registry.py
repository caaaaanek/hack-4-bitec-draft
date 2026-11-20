"""Факти з довідника fact_definitions поверх вбудованих у методиці.

methodology.FACTS — один словник для всього коду; тут він оновлюється на місці: вбудовані факти
лишаються як є, факти довідника додаються (або прибираються, якщо їх вимкнули). Оновлення —
на старті, після зміни довідника і перед прийомом факту та розрахунком хвилі (кілька процесів API).
"""

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import FactDefinition
from app.services import methodology as m

BUILTIN_FACTS: dict[str, dict] = {code: dict(spec) for code, spec in m.FACTS.items()}

# Хто має право передавати вбудований факт (аудит 20.11, В7). Один факт може мати кількох власників, якщо
# заклад обирає джерело (власний модуль чи зовнішня система). Тоді серед власників діє «хто перший за місяць».
# Не-власник отримує 409 not_fact_owner. Замінити для розгортання: FACT_OWNERS у налаштуваннях.
# «Декларації вчасно» рахує модуль «Перевірки» з реєстру декларацій НАЗК: кадрова ІС (atestat) його не передає.
BUILTIN_OWNERS: dict[str, tuple[str, ...]] = {
    "declarations_on_time": ("checks",),
    "hiring_checks": ("atestat",),
    "coi_reviewed": ("checks", "artemida"),
    "procurement_flags_reviewed": ("checks", "procurement"),
    "training_coverage": ("learning", "training"),
    "reports_handled": ("reports",),
    "program_measures_on_time": ("mitra",),
}

# Власники фактів довідника (fact_definitions.owner_sources); оновлюється в refresh().
_custom_owners: dict[str, tuple[str, ...]] = {}


def parse_owners(value: str | None) -> tuple[str, ...]:
    return tuple(s.strip() for s in (value or "").split(",") if s.strip())


def owners(code: str) -> tuple[str, ...] | None:
    """Джерела-власники факту. None — власника не задано (будь-яке джерело, перший за місяць)."""
    override = get_settings().fact_owner_map.get(code)
    if override:
        return override
    if code in BUILTIN_OWNERS:
        return BUILTIN_OWNERS[code]
    return _custom_owners.get(code) or None


def may_write(code: str, source: str) -> bool:
    found = owners(code)
    return found is None or source in found


def spec_of(row: FactDefinition) -> dict:
    return {"title": row.title, "component": row.component, "thresholds": list(row.thresholds),
            "numerator": row.numerator, "denominator": row.denominator, "rest": row.rest, "custom": True}


def refresh(db: Session) -> None:
    try:
        if not inspect(db.get_bind()).has_table("fact_definitions"):
            return
    except Exception:  # noqa: BLE001 — без таблиці (до міграцій) лишаються вбудовані факти
        return
    rows = list(db.scalars(select(FactDefinition).where(FactDefinition.active.is_(True))))
    custom = {r.code: spec_of(r) for r in rows}
    _custom_owners.clear()
    _custom_owners.update({r.code: parse_owners(r.owner_sources) for r in rows if parse_owners(r.owner_sources)})
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
