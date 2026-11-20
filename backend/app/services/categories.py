"""Довідник категорій респондентів.

Вбудовані категорії (робоча група, особовий склад, експерти) мають ваги з методики (methodology.SOURCE_WEIGHTS).
Адміністратор додає інші (наприклад, курсантів): без ваги категорія лише порівнюється з іншими, з вагою
стає ще одним джерелом самооцінки. Нові категорії внутрішні: прив'язані до підрозділу, як особовий склад.
Зовнішня (без підрозділу) лише вбудована категорія «експерти».
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RespondentCategory, RespondentCategoryDef
from app.services import methodology as m

BUILTIN = {
    RespondentCategory.WORKING_GROUP.value: "Робоча група",
    RespondentCategory.STAFF.value: "Особовий склад",
    RespondentCategory.EXPERT.value: "Експерти",
}


def is_external(code: str | None) -> bool:
    """Зовнішня категорія: відповіді без підрозділу, рахуються лише на рівні всієї хвилі."""
    return code == RespondentCategory.EXPERT


def ensure_builtin(db: Session) -> None:
    """Вбудовані категорії в довіднику (seed і перший запит). Не перезаписує назв, які змінив адміністратор."""
    existing = set(db.scalars(select(RespondentCategoryDef.code)))
    for code, title in BUILTIN.items():
        if code not in existing:
            db.add(RespondentCategoryDef(code=code, title=title, weight=m.SOURCE_WEIGHTS.get(code), builtin=True))
    db.flush()


def all_defs(db: Session, active_only: bool = False) -> list[RespondentCategoryDef]:
    ensure_builtin(db)
    query = select(RespondentCategoryDef).order_by(RespondentCategoryDef.builtin.desc(), RespondentCategoryDef.code)
    if active_only:
        query = query.where(RespondentCategoryDef.active.is_(True))
    return list(db.scalars(query))


def exists(db: Session, code: str | None, active_only: bool = True) -> bool:
    if code is None:
        return True
    if code in BUILTIN:
        return True
    row = db.get(RespondentCategoryDef, code)
    return row is not None and (row.active or not active_only)


def titles(db: Session) -> dict[str, str]:
    result = dict(m.SOURCE_TITLES)
    for row in db.scalars(select(RespondentCategoryDef)):
        if not row.builtin:
            result[row.code] = row.title.lower()
    return result


def weights(db: Session) -> dict[str, float]:
    """Ваги джерел самооцінки: методика (вбудовані + чек-лист) і категорії з довідника, яким задано вагу.

    Вагу вбудованих категорій змінює лише методика (methodology.py): довідник для них не діє.
    """
    result = dict(m.SOURCE_WEIGHTS)
    for row in db.scalars(select(RespondentCategoryDef).where(RespondentCategoryDef.builtin.is_(False),
                                                              RespondentCategoryDef.active.is_(True))):
        if row.weight:
            result[row.code] = float(row.weight)
    return result
