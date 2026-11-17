import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Campaign, CampaignParticipant, Questionnaire, RespondentCategory, Role, User


def participants_of(db: Session, campaign: Campaign) -> set[uuid.UUID] | None:
    """Явний склад учасників хвилі або None, якщо учасники визначаються правилом (категорія + підрозділ)."""
    if not campaign.explicit_participants:
        return None
    return set(db.scalars(select(CampaignParticipant.user_id).where(CampaignParticipant.campaign_id == campaign.id)))


def is_eligible(
    user: User,
    questionnaire: Questionnaire,
    campaign_units: set[uuid.UUID],
    participants: set[uuid.UUID] | None = None,
) -> bool:
    """Чи має користувач проходити цю анкету в межах хвилі.

    Правило: активний респондент, його категорія збігається з цільовою категорією
    анкети, а підрозділ входить у підрозділ хвилі. Експерти зовнішні, тому
    підрозділ для них не перевіряється. Якщо у хвилі явний склад учасників
    (participants не None), людина ще й має бути в ньому.
    """
    if not user.is_active or user.role != Role.RESPONDENT:
        return False
    if participants is not None and user.id not in participants:
        return False
    if user.category != questionnaire.target_category:
        return False
    if user.category == RespondentCategory.EXPERT:
        return True
    return user.unit_id in campaign_units
