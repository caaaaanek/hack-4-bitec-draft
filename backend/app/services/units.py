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
