"""Роль «Департамент» (МОУ): перегляд кількох закладів без рішень, кожен заклад окремо, без рейтингу.

Список закладів — за назвою, без індексів: щоб не з'явилося «таблиці лідерів» і порівняння закладів
між собою (індекс — інструмент розвитку, а не покарання). Відкривши заклад, Департамент бачить його
підсумок і динаміку лише відносно самого себе.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Campaign, CampaignStatus, Role, Unit, User
from app.security import allowed_units, require_roles
from app.services import results

router = APIRouter(prefix="/department", tags=["department"])
viewers = require_roles(Role.DEPARTMENT, Role.ADMIN, Role.AUDITOR)


def institutions_of(db: Session, user: User) -> set[uuid.UUID]:
    allowed = allowed_units(db, user)
    roots = set(db.scalars(select(Campaign.unit_id).distinct()))
    return roots if allowed is None else roots & allowed


@router.get("/institutions")
def list_institutions(db: Session = Depends(get_db), user: User = Depends(viewers)) -> list[dict]:
    """Заклади (корені хвиль) у зоні Департаменту. За назвою, без індексів і без рейтингу."""
    ids = institutions_of(db, user)
    out = []
    for unit in db.scalars(select(Unit).where(Unit.id.in_(ids)).order_by(Unit.name)) if ids else []:
        closed = db.scalars(select(Campaign).where(Campaign.unit_id == unit.id, Campaign.status == CampaignStatus.CLOSED)
                            .order_by(Campaign.closed_on.desc())).all()
        open_count = len(db.scalars(select(Campaign.id).where(Campaign.unit_id == unit.id,
                                                              Campaign.status == CampaignStatus.OPEN)).all())
        out.append({"unit_id": str(unit.id), "name": unit.name, "closed_waves": len(closed),
                    "open_waves": open_count, "last_closed_on": closed[0].closed_on.isoformat() if closed else None})
    return out


@router.get("/institutions/{unit_id}")
def institution(unit_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(viewers)) -> dict:
    """Один заклад: індекс останньої хвилі, достовірність, компоненти, динаміка відносно себе. Без дочірніх."""
    if unit_id not in institutions_of(db, user):
        raise HTTPException(status_code=403, detail="Заклад поза зоною Департаменту")
    unit = db.get(Unit, unit_id)
    history = results.unit_snapshots(db, unit_id)
    own = [(c, s) for c, s in history if c.unit_id == unit_id]
    if not own:
        return {"unit_id": str(unit_id), "name": unit.name, "latest": None, "trend": [],
                "note": "Ще немає закритої хвилі."}
    campaign, snap = own[-1]
    payload = snap.payload
    return {
        "unit_id": str(unit_id),
        "name": unit.name,
        "latest": {
            "campaign_id": str(campaign.id), "campaign_title": campaign.title,
            "closed_on": snap.closed_on.isoformat(), "methodology_version": snap.methodology_version,
            "index": payload["index"], "summary": results.scoring.management_summary(payload, None)[:3],
            "components": [{k: c[k] for k in ("code", "title", "score", "level", "zone", "reliability")}
                           for c in payload["components"]],
        },
        "trend": [{"campaign_title": c.title, "closed_on": s.closed_on.isoformat(), "index": s.index_score,
                   "reliability": s.reliability} for c, s in own],
        "note": "Динаміка — лише порівняння закладу із самим собою. Рейтингу закладів немає.",
    }
