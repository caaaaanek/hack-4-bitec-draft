"""Технічні гарантії анонімності.

1. Буфер відповідей. Подання записує Participation (хто) і ResponsePool (що) разом,
   а в Response відповіді переносяться окремою транзакцією пачкою щонайменше з k
   перемішаних анкет. Так системні поля PostgreSQL (xmin транзакції, порядок рядків)
   у Response однакові для k людей і не вказують на конкретне подання.

2. Вторинне приховування (complementary suppression). Якщо показати підрозділ і
   його батька, а сестринська група менша за k, її можна обчислити різницею
   «батько − показані діти». Тому, коли прихований залишок батька від 1 до k−1,
   приховуємо ще й найменший показаний дочірній підрозділ, доки залишок не стане
   0 або ≥ k.
"""

import random
import uuid
from collections.abc import Hashable, Mapping

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Answer, Campaign, ResponsePool, Response

_rng = random.SystemRandom()


# ---------- 1. Буфер відповідей ----------

def pool_size(db: Session, campaign_id: uuid.UUID, questionnaire_id: uuid.UUID) -> int:
    return db.scalar(
        select(func.count()).select_from(ResponsePool).where(
            ResponsePool.campaign_id == campaign_id, ResponsePool.questionnaire_id == questionnaire_id
        )
    ) or 0


def _move(db: Session, rows: list[ResponsePool]) -> int:
    _rng.shuffle(rows)
    for row in rows:
        response = Response(
            campaign_id=row.campaign_id,
            questionnaire_id=row.questionnaire_id,
            category=row.category,
            unit_id=row.unit_id,
        )
        for a in row.answers:
            response.answers.append(
                Answer(
                    question_id=uuid.UUID(a["question_id"]),
                    option_id=uuid.UUID(a["option_id"]) if a.get("option_id") else None,
                    value=a.get("value"),
                )
            )
        db.add(response)
    if rows:
        db.execute(delete(ResponsePool).where(ResponsePool.id.in_([r.id for r in rows])))
    return len(rows)


def flush_pool(db: Session, campaign: Campaign, questionnaire_id: uuid.UUID) -> int:
    """Переносить частину буфера, коли в ньому не менше 2k анкет.

    Переноситься випадкова пачка розміром (розмір буфера − k) ≥ k, а k анкет лишається.
    Тому й остання пачка при закритті хвилі буде не меншою за k.
    """
    k = campaign.min_group_size
    rows = list(db.scalars(
        select(ResponsePool).where(
            ResponsePool.campaign_id == campaign.id, ResponsePool.questionnaire_id == questionnaire_id
        ).with_for_update()
    ))
    if len(rows) < 2 * k:
        return 0
    batch = _rng.sample(rows, len(rows) - k)
    return _move(db, batch)


def flush_all(db: Session, campaign: Campaign) -> int:
    """Переносить увесь буфер хвилі. Викликається при закритті."""
    rows = list(db.scalars(select(ResponsePool).where(ResponsePool.campaign_id == campaign.id)))
    by_questionnaire: dict[uuid.UUID, list[ResponsePool]] = {}
    for row in rows:
        by_questionnaire.setdefault(row.questionnaire_id, []).append(row)
    return sum(_move(db, batch) for batch in by_questionnaire.values())


# ---------- 2. Вторинне приховування ----------

def suppressed_nodes(
    children: Mapping[Hashable, list[Hashable]],
    direct: Mapping[Hashable, int],
    root: Hashable,
    k: int,
) -> set:
    """Вузли дерева, агрегати яких не можна показувати.

    children: вузол -> дочірні вузли; direct: кількість, що належить безпосередньо вузлу
    (без дочірніх). Вузол прихований, якщо його сума менша за k, якщо прихований батько,
    або якщо його довелося приховати, щоб прихований залишок батька не був від 1 до k−1.
    """
    totals: dict = {}

    def total(node) -> int:
        if node not in totals:
            totals[node] = direct.get(node, 0) + sum(total(c) for c in children.get(node, []))
        return totals[node]

    hidden: set = set()

    def hide_subtree(node) -> None:
        hidden.add(node)
        for c in children.get(node, []):
            hide_subtree(c)

    def visit(node) -> None:
        if total(node) < k:
            hide_subtree(node)
            return
        kids = children.get(node, [])
        small = [c for c in kids if total(c) < k]
        shown = sorted((c for c in kids if total(c) >= k), key=lambda c: (total(c), str(c)))
        residual = direct.get(node, 0) + sum(total(c) for c in small)
        extra = []
        while 0 < residual < k and shown:
            c = shown.pop(0)
            extra.append(c)
            residual += total(c)
        for c in small + extra:
            hide_subtree(c)
        for c in shown:
            visit(c)

    visit(root)
    return hidden
