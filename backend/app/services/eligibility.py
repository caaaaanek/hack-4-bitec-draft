import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Campaign,
    CampaignEligible,
    CampaignParticipant,
    CampaignStatus,
    Questionnaire,
    QuestionnaireKind,
    RespondentCategory,
    Role,
    User,
)


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


# ---------- Склад, зафіксований при відкритті хвилі ----------

def frozen_of(db: Session, campaign: Campaign) -> dict[uuid.UUID, dict[uuid.UUID, tuple]] | None:
    """questionnaire_id -> {user_id: (unit_id, category)} або None, якщо склад не зафіксовано
    (хвиля за посиланнями або хвиля, створена до міграції 0011 і ще не відкрита)."""
    if not campaign.eligible_frozen:
        return None
    result: dict[uuid.UUID, dict[uuid.UUID, tuple]] = {
        link.questionnaire_id: {} for link in campaign.questionnaire_links}
    for row in db.scalars(select(CampaignEligible).where(CampaignEligible.campaign_id == campaign.id)):
        result.setdefault(row.questionnaire_id, {})[row.user_id] = (row.unit_id, row.category)
    return result


def freeze(db: Session, campaign: Campaign, users: list[User] | None = None) -> int:
    """Фіксує склад: кожен, хто зараз за правилом (чи явним складом) має проходити анкету.

    users: додати лише цих людей (імпорт у відкриту хвилю), інакше всіх активних респондентів.
    """
    from app.services.units import subtree_ids  # уникаємо циклічного імпорту

    if users is None:
        users = list(db.scalars(select(User).where(User.role == Role.RESPONDENT, User.is_active.is_(True))))
    units = subtree_ids(db, campaign.unit_id)
    participants = participants_of(db, campaign)
    existing = {(r.questionnaire_id, r.user_id) for r in db.scalars(
        select(CampaignEligible).where(CampaignEligible.campaign_id == campaign.id))}
    added = 0
    for link in campaign.questionnaire_links:
        q = link.questionnaire
        if q.kind == QuestionnaireKind.CHECKLIST:
            continue
        for user in users:
            if (q.id, user.id) in existing or not is_eligible(user, q, units, participants):
                continue
            db.add(CampaignEligible(
                campaign_id=campaign.id, questionnaire_id=q.id, user_id=user.id, category=user.category,
                unit_id=None if user.category == RespondentCategory.EXPERT else user.unit_id))
            existing.add((q.id, user.id))
            added += 1
    campaign.eligible_frozen = True
    return added


def can_answer(user: User, questionnaire: Questionnaire, campaign_units: set[uuid.UUID],
               participants: set[uuid.UUID] | None, frozen: dict | None) -> bool:
    """Чи може людина проходити анкету: за зафіксованим складом, якщо він є, інакше за правилом."""
    if frozen is None:
        return is_eligible(user, questionnaire, campaign_units, participants)
    return user.is_active and user.role == Role.RESPONDENT and user.id in frozen.get(questionnaire.id, {})


def refreeze(db: Session, campaign: Campaign) -> int:
    """Перефіксувати склад чернетки (змінилися область, анкети чи явний склад). Відкриту хвилю не чіпає."""
    from sqlalchemy import delete

    if campaign.status != CampaignStatus.DRAFT:
        return 0
    db.execute(delete(CampaignEligible).where(CampaignEligible.campaign_id == campaign.id))
    from app.models import AccessMode

    if campaign.access_mode != AccessMode.LOGIN:
        campaign.eligible_frozen = False
        return 0
    return freeze(db, campaign)


def open_frozen_campaigns_of(db: Session, user_id: uuid.UUID) -> list[Campaign]:
    """Чернетки й відкриті хвилі, у зафіксованому складі яких є ця людина.

    Склад фіксується з моменту створення хвилі: між створенням і відкриттям не можна непомітно
    «підкинути» людей у групу, змінивши їм підрозділ чи категорію.
    """
    return list(db.scalars(
        select(Campaign).join(CampaignEligible, CampaignEligible.campaign_id == Campaign.id)
        .where(CampaignEligible.user_id == user_id,
               Campaign.status.in_([CampaignStatus.OPEN, CampaignStatus.DRAFT])).distinct()))
