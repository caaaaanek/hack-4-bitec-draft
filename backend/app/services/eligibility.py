import uuid

from app.models import Questionnaire, RespondentCategory, Role, User


def is_eligible(user: User, questionnaire: Questionnaire, campaign_units: set[uuid.UUID]) -> bool:
    """Чи має користувач проходити цю анкету в межах хвилі.

    Правило: активний респондент, його категорія збігається з цільовою категорією
    анкети, а підрозділ входить у підрозділ хвилі. Експерти зовнішні, тому
    підрозділ для них не перевіряється.
    """
    if not user.is_active or user.role != Role.RESPONDENT:
        return False
    if user.category != questionnaire.target_category:
        return False
    if user.category == RespondentCategory.EXPERT:
        return True
    return user.unit_id in campaign_units
