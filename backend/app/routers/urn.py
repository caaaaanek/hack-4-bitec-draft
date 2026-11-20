"""«Урна з трьома ключами» (services/urn.py): налаштування, видача частин, церемонія відкриття урни."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ApiError
from app.models import Campaign, Role, UrnShare, User
from app.security import get_current_user, require_roles
from app.services import urn

router = APIRouter(prefix="/campaigns/{campaign_id}/urn", tags=["urn"])


class UrnSetupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    holder_ids: list[uuid.UUID] = Field(min_length=3, max_length=3,
                                        description="Уповноважений, внутрішній аудит, представник особового складу")


class ShareIn(BaseModel):
    share: str = Field(min_length=10, max_length=400)


def campaign_or_404(db: Session, campaign_id: uuid.UUID, lock: bool = False) -> Campaign:
    campaign = db.get(Campaign, campaign_id, with_for_update=lock)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    return campaign


def is_holder(db: Session, campaign: Campaign, user: User) -> bool:
    return db.scalar(select(UrnShare.holder_id).where(UrnShare.campaign_id == campaign.id,
                                                      UrnShare.holder_id == user.id)) is not None


@router.get("")
def urn_status(campaign_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    campaign = campaign_or_404(db, campaign_id)
    if user.role not in (Role.ADMIN, Role.AUDITOR) and not is_holder(db, campaign, user):
        raise HTTPException(status_code=403, detail="Недостатньо прав")
    return urn.status_of(db, campaign)


@router.put("")
def urn_setup(campaign_id: uuid.UUID, data: UrnSetupIn, db: Session = Depends(get_db),
              admin: User = Depends(require_roles(Role.ADMIN))) -> dict:
    """Увімкнути урну для чернетки: ключ хвилі ділиться на 3 частини (2 з 3), сервер ключа не зберігає."""
    campaign = campaign_or_404(db, campaign_id, lock=True)
    holders = list(db.scalars(select(User).where(User.id.in_(data.holder_ids))))
    if len(holders) != 3:
        raise ApiError(422, "Власників не знайдено", code="urn_holders")
    urn.setup(db, campaign, holders, admin)
    db.commit()
    return urn.status_of(db, campaign)


@router.delete("")
def urn_disable(campaign_id: uuid.UUID, db: Session = Depends(get_db),
                admin: User = Depends(require_roles(Role.ADMIN))) -> dict:
    campaign = campaign_or_404(db, campaign_id, lock=True)
    urn.disable(db, campaign, admin)
    db.commit()
    return urn.status_of(db, campaign)


@router.get("/my-share")
def my_share(campaign_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Забрати свою частину ключа. Видається один раз: збережіть її (друк, QR, окремий носій)."""
    campaign = campaign_or_404(db, campaign_id)
    share = urn.take_share(db, campaign, user)
    db.commit()
    return {"share": share, "fingerprint": urn.fingerprint(campaign.urn_public_key),
            "note": "Частина видається один раз і на сервері більше не зберігається. Без двох частин з трьох "
                    "відповіді хвилі не розшифрувати."}


@router.post("/shares")
def submit_share(campaign_id: uuid.UUID, data: ShareIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)) -> dict:
    """«Церемонія відкриття урни»: власник повертає частину. Друга частина відновлює ключ і закриває хвилю."""
    campaign = campaign_or_404(db, campaign_id, lock=True)
    try:
        result = urn.submit_share(db, campaign, user, data.share)
    except ApiError as e:
        if e.code == "urn_mismatch":
            # Частини не відновили ключ: їх скинуто, і це треба зберегти. Без коміту відкат повертав надіслані
            # частини (разом із чужою чи зміненою), і кожна наступна спроба знову давала urn_mismatch — хвиля
            # з урною не закривалася ніколи.
            db.commit()
        raise
    db.commit()
    return result
