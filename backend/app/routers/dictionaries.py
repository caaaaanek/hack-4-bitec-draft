"""Довідники замість зашитих у код списків: категорії респондентів, посади, факти.

Читати може кожен, хто увійшов (конструктор, форми, трекер). Змінюють:
- категорії респондентів і посади — лише технічний адміністратор (coordinator);
- факти — уповноважений (admin).
Вага вбудованих категорій (staff, working_group, expert) задається лише методикою (methodology.SOURCE_WEIGHTS,
нова версія методики); вагу власних категорій задає довідник (weight_editable у відповіді).
Зміни пишуться в журнал дій.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.errors import ApiError
from app.models import FactDefinition, Position, RespondentCategoryDef, Role, User
from app.schemas import CategoryCode
from app.security import get_current_user, require_roles
from app.services import categories, fact_registry
from app.services import methodology as m

router = APIRouter(prefix="/dictionaries", tags=["dictionaries"])
# Категорії респондентів і посади — довідники людей: веде лише технічний адміністратор. Департамент категорії
# читає (GET) і спрямовує на них анкети (target_category), але не створює й не змінює (рішення 20.11).
managers = require_roles(Role.COORDINATOR)
position_editors = require_roles(Role.COORDINATOR)
# Факти (що приходить з інших систем і як впливає на індекс) — методика, а не люди: веде уповноважений.
fact_editors = require_roles(Role.ADMIN)

# Посади за замовчуванням (seed і порожній довідник).
DEFAULT_POSITIONS = [
    "Уповноважена особа з питань запобігання та виявлення корупції",
    "Голова робочої групи з розбудови доброчесності",
    "Начальник відділу кадрів",
    "Заступник керівника з навчальної роботи",
    "Начальник служби закупівель",
    "Начальник фінансово-економічного підрозділу",
    "Начальник юридичної служби",
    "Керівник підрозділу внутрішнього аудиту",
]


# ---------- Категорії ----------

class CategoryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: CategoryCode
    title: str = Field(min_length=1, max_length=100)
    weight: float | None = Field(default=None, gt=0, le=1,
                                 description="Вага як джерела самооцінки. Порожньо: лише для порівняння")


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=100)
    weight: float | None = Field(default=None, gt=0, le=1)
    active: bool | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    title: str
    weight: float | None
    builtin: bool
    active: bool
    external: bool = False
    in_index: bool = False
    # Вага вбудованої категорії — з методики (лише читання); власної — з довідника (змінюється PATCH).
    weight_editable: bool = False
    weight_source: str = Field(default="dictionary", description="methodology | dictionary")


def category_out(row: RespondentCategoryDef) -> CategoryOut:
    weight = m.SOURCE_WEIGHTS.get(row.code) if row.builtin else row.weight
    return CategoryOut(code=row.code, title=row.title, weight=weight, builtin=row.builtin, active=row.active,
                       external=categories.is_external(row.code), in_index=bool(weight) and row.active,
                       weight_editable=not row.builtin, weight_source="methodology" if row.builtin else "dictionary")


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = categories.all_defs(db)
    db.commit()
    return [category_out(r) for r in rows]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(data: CategoryIn, db: Session = Depends(get_db), user: User = Depends(managers)):
    """Нова категорія респондентів (наприклад, курсанти). Внутрішня: прив'язана до підрозділу.

    Без ваги — лише порівняння з іншими групами; з вагою — ще одне джерело самооцінки індексу.
    """
    categories.ensure_builtin(db)
    if db.get(RespondentCategoryDef, data.code) is not None or data.code in m.SOURCE_WEIGHTS:
        raise ApiError(409, f"Категорія «{data.code}» уже є", code="conflict")
    row = RespondentCategoryDef(code=data.code, title=data.title, weight=data.weight, builtin=False)
    db.add(row)
    log_action(db, user, "create", "category", data.code, {"title": data.title, "weight": data.weight})
    db.commit()
    return category_out(row)


@router.patch("/categories/{code}", response_model=CategoryOut)
def update_category(code: str, data: CategoryUpdate, db: Session = Depends(get_db), user: User = Depends(managers)):
    """Вага вбудованих категорій задана методикою і тут не змінюється (лише назва)."""
    categories.ensure_builtin(db)
    row = db.get(RespondentCategoryDef, code)
    if row is None:
        raise HTTPException(status_code=404, detail="Категорію не знайдено")
    changes = data.model_dump(exclude_unset=True)
    if row.builtin:
        # Форма редагування надсилає всі поля разом: незмінені вага й активність вбудованої категорії — не спроба
        # їх змінити (інакше перейменування вбудованої категорії завжди давало б 409).
        if "weight" in changes and changes["weight"] == m.SOURCE_WEIGHTS.get(row.code):
            changes.pop("weight")
        if "active" in changes and changes["active"] == row.active:
            changes.pop("active")
    if row.builtin and ({"weight", "active"} & changes.keys()):
        raise ApiError(409, "Вагу й активність вбудованої категорії задає методика", code="weight_from_methodology",
                       hint="Ваги вбудованих джерел змінюються лише в methodology.py з новою версією методики.")
    for key, value in changes.items():
        setattr(row, key, value)
    log_action(db, user, "update", "category", code, {k: v for k, v in changes.items()})
    db.commit()
    return category_out(row)


# ---------- Посади ----------

class PositionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=200)


class PositionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    active: bool


def ensure_positions(db: Session) -> None:
    if db.scalar(select(Position.id).limit(1)) is None:
        db.add_all(Position(title=t) for t in DEFAULT_POSITIONS)
        db.flush()


def position_out(p: Position) -> PositionOut:
    return PositionOut(id=str(p.id), title=p.title, active=p.active)


@router.get("/positions", response_model=list[PositionOut])
def list_positions(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Посади для поля «відповідальний» у заходах. Відповідальний — посада, не людина."""
    ensure_positions(db)
    db.commit()
    return [position_out(p) for p in db.scalars(select(Position).order_by(Position.title))]


@router.post("/positions", response_model=PositionOut, status_code=status.HTTP_201_CREATED)
def create_position(data: PositionIn, db: Session = Depends(get_db), user: User = Depends(position_editors)):
    from app.routers.measures import PERSON_NAME  # той самий захист від ПІБ, що й у заходах

    title = data.title.strip()
    if PERSON_NAME.search(title):
        raise ApiError(422, "Вкажіть посаду, а не ПІБ", code="person_name")
    if db.scalar(select(Position.id).where(Position.title == title)):
        raise ApiError(409, "Така посада вже є", code="conflict")
    row = Position(title=title)
    db.add(row)
    db.flush()
    log_action(db, user, "create", "position", row.id, {"title": title})
    db.commit()
    return position_out(row)


@router.delete("/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_position(position_id: str, db: Session = Depends(get_db), user: User = Depends(position_editors)):
    """Посада зникає з вибору; заходи, де вона вже вказана, не змінюються."""
    import uuid

    try:
        row = db.get(Position, uuid.UUID(position_id))
    except ValueError:
        row = None
    if row is None:
        raise HTTPException(status_code=404, detail="Посаду не знайдено")
    row.active = False
    log_action(db, user, "deactivate", "position", row.id, {"title": row.title})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Факти ----------

class FactIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    title: str = Field(min_length=3, max_length=200)
    component: str
    thresholds: list[float] = Field(description="4 межі частки (%) для рівнів 2, 3, 4, 5")
    numerator: str = Field(default="так", max_length=100)
    denominator: str = Field(default="всього", max_length=100)
    rest: str = Field(default="решта", max_length=100)
    owner_sources: list[str] = Field(default_factory=list, max_length=10,
                                     description="Джерела, яким дозволено передавати факт. Порожньо — будь-яке")


class FactUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=3, max_length=200)
    thresholds: list[float] | None = None
    active: bool | None = None
    owner_sources: list[str] | None = Field(default=None, max_length=10)


class FactDefOut(BaseModel):
    code: str
    title: str
    component: str
    thresholds: list[float]
    numerator: str
    denominator: str
    rest: str
    builtin: bool
    active: bool = True
    owner_sources: list[str] = Field(default_factory=list,
                                     description="Хто передає факт (POST /indicators). Порожньо — будь-яке джерело")


def owners_of(code: str) -> list[str]:
    return list(fact_registry.owners(code) or ())


def owners_text(sources: list[str] | None) -> str | None:
    clean = [s.strip() for s in sources or [] if s.strip()]
    for s in clean:
        if not re.fullmatch(r"[a-z][a-z0-9_-]{1,31}", s):
            raise ApiError(422, f"owner_sources: «{s}» — латиниця, цифри, _ або -", code="invalid")
    return ",".join(clean) or None


@router.get("/facts", response_model=list[FactDefOut])
def list_facts(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Факти методики: вбудовані (methodology.py) і додані в довідник, з джерелами-власниками."""
    fact_registry.refresh(db)
    out = [FactDefOut(code=c, builtin=True, owner_sources=owners_of(c),
                      **{k: s[k] for k in ("title", "component", "thresholds", "numerator", "denominator", "rest")})
           for c, s in fact_registry.BUILTIN_FACTS.items()]
    for r in db.scalars(select(FactDefinition).order_by(FactDefinition.code)):
        out.append(fact_out(r))
    return out


def fact_out(r: FactDefinition) -> FactDefOut:
    return FactDefOut(code=r.code, title=r.title, component=r.component, thresholds=r.thresholds,
                      numerator=r.numerator, denominator=r.denominator, rest=r.rest, builtin=False, active=r.active,
                      owner_sources=owners_of(r.code) if r.active else list(fact_registry.parse_owners(r.owner_sources)))


def check_fact(component: str | None, thresholds: list | None) -> None:
    if component is not None and component not in m.COMPONENTS:
        raise ApiError(422, f"component: один із {', '.join(m.COMPONENTS)}", code="invalid")
    if thresholds is not None and (problem := fact_registry.validate_thresholds(thresholds)):
        raise ApiError(422, problem, code="invalid")


@router.post("/facts", response_model=FactDefOut, status_code=status.HTTP_201_CREATED)
def create_fact(data: FactIn, db: Session = Depends(get_db), user: User = Depends(fact_editors)):
    """Новий факт для правила реальності. Після цього інші системи можуть передавати його в POST /indicators."""
    check_fact(data.component, data.thresholds)
    if data.code in fact_registry.BUILTIN_FACTS or db.get(FactDefinition, data.code) is not None:
        raise ApiError(409, f"Факт «{data.code}» уже є", code="conflict")
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,63}", data.code):
        raise ApiError(422, "code: латиниця, цифри, _", code="invalid")
    row = FactDefinition(**data.model_dump(exclude={"owner_sources"}), owner_sources=owners_text(data.owner_sources))
    db.add(row)
    log_action(db, user, "create", "fact_definition", data.code, data.model_dump())
    db.commit()
    fact_registry.refresh(db)
    return fact_out(row)


@router.patch("/facts/{code}", response_model=FactDefOut)
def update_fact(code: str, data: FactUpdate, db: Session = Depends(get_db), user: User = Depends(fact_editors)):
    """Змінюються лише факти довідника. Вбудовані змінює методика (нова версія)."""
    row = db.get(FactDefinition, code)
    if row is None:
        raise ApiError(404 if code not in fact_registry.BUILTIN_FACTS else 409,
                       "Вбудований факт змінює лише методика" if code in fact_registry.BUILTIN_FACTS
                       else "Факт не знайдено")
    changes = data.model_dump(exclude_unset=True)
    check_fact(None, changes.get("thresholds"))
    if "owner_sources" in changes:
        changes["owner_sources"] = owners_text(changes["owner_sources"])
    for key, value in changes.items():
        setattr(row, key, value)
    log_action(db, user, "update", "fact_definition", code, changes)
    db.commit()
    fact_registry.refresh(db)
    return fact_out(row)
