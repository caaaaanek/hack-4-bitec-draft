import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Unit

Children = dict[uuid.UUID | None, list[uuid.UUID]]


def unit_tree(db: Session) -> tuple[Children, dict[uuid.UUID, uuid.UUID | None]]:
    """(батько -> діти, підрозділ -> батько) одним запитом."""
    children: Children = {}
    parents: dict[uuid.UUID, uuid.UUID | None] = {}
    for unit_id, parent_id in db.execute(select(Unit.id, Unit.parent_id)):
        children.setdefault(parent_id, []).append(unit_id)
        parents[unit_id] = parent_id
    for kids in children.values():
        kids.sort(key=str)
    return children, parents


def subtree_from(children: Children, root_id: uuid.UUID) -> set[uuid.UUID]:
    result: set[uuid.UUID] = set()
    stack = [root_id]
    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.add(current)
        stack.extend(children.get(current, []))
    return result


def subtree_ids(db: Session, root_id: uuid.UUID) -> set[uuid.UUID]:
    """ID підрозділу і всіх його дочірніх підрозділів на будь-якій глибині."""
    children, _ = unit_tree(db)
    return subtree_from(children, root_id)


def top_root(parents: dict[uuid.UUID, uuid.UUID | None], unit_id: uuid.UUID) -> uuid.UUID:
    seen = set()
    current = unit_id
    while parents.get(current) is not None and current not in seen:
        seen.add(current)
        current = parents[current]
    return current


def campaigns_covering(db: Session, unit_ids: set[uuid.UUID], statuses=None) -> list:
    """Хвилі (за замовчуванням чернетки й відкриті), область яких зачіпає хоча б один із підрозділів."""
    from app.models import Campaign, CampaignStatus

    statuses = statuses or (CampaignStatus.DRAFT, CampaignStatus.OPEN)
    children, _ = unit_tree(db)
    return [c for c in db.scalars(select(Campaign).where(Campaign.status.in_(statuses)))
            if subtree_from(children, c.unit_id) & unit_ids]


def apply_unit_change(db: Session, payload: dict, actor) -> None:
    """Виконати підтверджений запит unit_change (створити, перенести чи видалити підрозділ у межах чернетки хвилі).

    Перед виконанням перевіряє ще раз: якщо хвиля тим часом відкрилася, зміна вже не застосовується (409).
    Склад зачеплених чернеток перефіксовується.
    """
    from app.audit import log_action
    from app.errors import ApiError
    from app.models import CampaignStatus
    from app.services.eligibility import refreeze

    op = payload.get("op")
    unit_id = uuid.UUID(payload["unit_id"]) if payload.get("unit_id") else None
    parent_id = uuid.UUID(payload["parent_id"]) if payload.get("parent_id") else None
    affected = (subtree_ids(db, unit_id) if unit_id and db.get(Unit, unit_id) else set()) | ({parent_id} if parent_id else set())
    if campaigns_covering(db, affected, (CampaignStatus.OPEN,)):
        raise ApiError(409, "Хвиля вже відкрита: структуру змінити не можна", code="campaign_open")
    drafts = campaigns_covering(db, affected, (CampaignStatus.DRAFT,))
    if op == "create":
        unit = Unit(name=payload["name"], parent_id=parent_id)
        db.add(unit)
        db.flush()
        log_action(db, actor, "create", "unit", unit.id, {"name": unit.name, "via": "four_eyes"})
    elif op == "move":
        unit = db.get(Unit, unit_id)
        if unit is None:
            raise ApiError(404, "Підрозділу вже немає")
        if parent_id is not None and parent_id in subtree_ids(db, unit.id):
            raise ApiError(422, "Не можна перенести підрозділ у самого себе чи в дочірній", code="unit_cycle")
        log_action(db, actor, "update", "unit", unit.id,
                   {"parent_id": {"from": str(unit.parent_id) if unit.parent_id else None,
                                  "to": str(parent_id) if parent_id else None}, "via": "four_eyes"})
        unit.parent_id = parent_id
    elif op == "delete":
        unit = db.get(Unit, unit_id)
        if unit is None:
            raise ApiError(404, "Підрозділу вже немає")
        log_action(db, actor, "delete", "unit", unit.id, {"name": unit.name, "via": "four_eyes"})
        db.delete(unit)
    else:
        raise ApiError(422, f"Невідома зміна підрозділу: {op}")
    db.flush()
    for campaign in drafts:
        refreeze(db, campaign)
