"""Технічні гарантії анонімності.

1. Зашифрований буфер відповідей. Подання записує Participation (хто) і ResponsePool (що)
   в одній транзакції, тож у PostgreSQL ці рядки мають однаковий xmin, а нова відповідь
   у буфері збігається з новим записом участі за часом. Тому вміст буфера (відповіді й
   підрозділ) шифрується AES-GCM ключем, якого в БД немає (POOL_ENCRYPTION_KEY або
   похідний від JWT_SECRET). Без ключа рядок буфера — лише «хтось із категорії подав анкету».
   Шифротекст не містить часу (на відміну від Fernet), nonce випадковий.

2. Один перенос при закритті. Відповіді лежать у буфері до закриття хвилі (результати
   відкритої хвилі однаково недоступні), а тоді переносяться в Response однією транзакцією,
   перемішаними. Усі відповіді хвилі мають один xmin і випадковий порядок.

3. Узагальнення підрозділу при зберіганні. У Response підрозділ записується не точний,
   а «підрозділ зберігання»: найближчий вищий підрозділ, під яким назбиралося щонайменше
   k відповідей цієї анкети (generalize()). Тож рядок таблиці не можна приписати людині
   з малого підрозділу навіть з прямим доступом до БД.

4. Вторинне приховування (complementary suppression). Якщо показати підрозділ і
   його батька, а сестринська група менша за k, її можна обчислити різницею
   «батько − показані діти». Тому, коли прихований залишок батька від 1 до k−1,
   приховуємо ще й найменший показаний дочірній підрозділ, доки залишок не стане
   0 або ≥ k.
"""

import base64
import hashlib
import json
import os
import random
import uuid
from collections.abc import Hashable, Mapping

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Answer, Campaign, RespondentCategory, Response, ResponsePool
from app.services.units import subtree_from, unit_tree

_rng = random.SystemRandom()

POOL_FORMAT = 1


# ---------- 1. Шифрування буфера ----------

def _key() -> bytes:
    return hashlib.sha256(get_settings().pool_key_material.encode()).digest()


def seal(payload: dict, urn_public_key: str | None = None) -> dict:
    """Шифрує вміст рядка буфера. Повертає JSON-сумісний конверт.

    urn_public_key: хвиля з «урною» (services/urn.py) — шифрування відкритим ключем хвилі, розшифрувати
    можна лише закритим ключем, відновленим із двох частин власників.
    """
    if urn_public_key:
        from app.services import urn

        return urn.seal(payload, urn_public_key)
    nonce = os.urandom(12)
    data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    ct = AESGCM(_key()).encrypt(nonce, data, b"response_pool")
    return {"v": POOL_FORMAT, "n": base64.b64encode(nonce).decode(), "c": base64.b64encode(ct).decode()}


def unseal(row: ResponsePool, urn_key: bytes | None = None) -> tuple[list, uuid.UUID | None]:
    """(відповіді, підрозділ). Підтримує й старі незашифровані рядки (список відповідей)."""
    box = row.answers
    if isinstance(box, list):  # рядки до міграції 0007
        return box, row.unit_id
    if box.get("v") == 2:
        from app.services import urn

        if urn_key is None:
            raise ValueError("Відповідь в урні: потрібен ключ, відновлений із частин власників")
        payload = urn.unseal(box, urn_key)
    else:
        payload = json.loads(AESGCM(_key()).decrypt(base64.b64decode(box["n"]), base64.b64decode(box["c"]),
                                                    b"response_pool"))
    unit = payload.get("unit_id")
    return payload["answers"], uuid.UUID(unit) if unit else None


def pool_size(db: Session, campaign_id: uuid.UUID, questionnaire_id: uuid.UUID) -> int:
    return db.scalar(
        select(func.count()).select_from(ResponsePool).where(
            ResponsePool.campaign_id == campaign_id, ResponsePool.questionnaire_id == questionnaire_id
        )
    ) or 0


# ---------- 2. Узагальнення підрозділу ----------

def generalize(
    children: Mapping[Hashable, list[Hashable]],
    direct: Mapping[Hashable, int],
    root: Hashable,
    k: int,
) -> dict:
    """Підрозділ -> підрозділ зберігання.

    Знизу вгору: вузол, під яким (разом з ще не розміщеними дочірніми) назбиралося ≥ k, стає
    підрозділом зберігання для них; менші групи піднімаються до батька. Якщо в корені лишилося
    від 1 до k−1, до кореня приєднуються найменші вже розміщені групи, доки не стане ≥ k.
    Підрозділи без жодної відповіді в результат не потрапляють.
    """
    label: dict = {}

    def visit(node) -> tuple[list, int]:
        pending = [node] if direct.get(node, 0) else []
        count = direct.get(node, 0)
        for child in children.get(node, []):
            p, c = visit(child)
            pending += p
            count += c
        if count >= k:
            for u in pending:
                label[u] = node
            return [], 0
        return pending, count

    pending, count = visit(root)
    for u in pending:
        label[u] = root
    if 0 < count < k:
        sizes: dict = {}
        for u, target in label.items():
            if target != root:
                sizes[target] = sizes.get(target, 0) + direct.get(u, 0)
        for target in sorted(sizes, key=lambda t: (sizes[t], str(t))):
            if count >= k:
                break
            for u, t in label.items():
                if t == target:
                    label[u] = root
            count += sizes[target]
    return label


# ---------- 3. Перенос буфера ----------

def flush_all(db: Session, campaign: Campaign, urn_key: bytes | None = None) -> int:
    """Переносить увесь буфер хвилі в Response однією транзакцією. Викликається при закритті.

    Для кожної анкети: розшифрувати, узагальнити підрозділи за фактичною кількістю відповідей,
    перемішати, записати. Експерти зовнішні: підрозділу в їхніх відповідях немає.
    """
    rows = list(db.scalars(select(ResponsePool).where(ResponsePool.campaign_id == campaign.id)))
    children, _ = unit_tree(db)
    campaign_units = subtree_from(children, campaign.unit_id)
    by_questionnaire: dict[uuid.UUID, list[tuple[ResponsePool, list, uuid.UUID | None]]] = {}
    for row in rows:
        answers, unit = unseal(row, urn_key)
        if unit is not None and unit not in campaign_units:
            unit = campaign.unit_id  # підрозділ видалили чи перенесли: лише в корінь хвилі
        by_questionnaire.setdefault(row.questionnaire_id, []).append((row, answers, unit))

    moved = 0
    for items in by_questionnaire.values():
        direct: dict[uuid.UUID, int] = {}
        for row, _, unit in items:
            if row.category != RespondentCategory.EXPERT and unit is not None:
                direct[unit] = direct.get(unit, 0) + 1
        label = generalize(children, direct, campaign.unit_id, campaign.min_group_size)
        _rng.shuffle(items)
        for row, answers, unit in items:
            stored = None if row.category == RespondentCategory.EXPERT or unit is None else label.get(unit, campaign.unit_id)
            response = Response(campaign_id=row.campaign_id, questionnaire_id=row.questionnaire_id,
                                category=row.category, unit_id=stored)
            for a in answers:
                response.answers.append(Answer(
                    question_id=uuid.UUID(a["question_id"]),
                    option_id=uuid.UUID(a["option_id"]) if a.get("option_id") else None,
                    value=a.get("value"),
                    variant=a.get("variant"),
                ))
            db.add(response)
            moved += 1
    if rows:
        db.execute(delete(ResponsePool).where(ResponsePool.campaign_id == campaign.id))
    return moved


# ---------- 4. Вторинне приховування ----------

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
