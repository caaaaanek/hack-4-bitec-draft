"""Проходження анкет респондентом."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    Campaign,
    CampaignQuestionnaire,
    CampaignStatus,
    Participation,
    Questionnaire,
    QuestionnaireKind,
    Role,
    User,
)
from app.schemas import AssignmentOut, FormOut, SubmissionIn, SubmissionOut
from app.security import require_roles
from app.services.anonymity import flush_pool
from app.services.eligibility import is_eligible
from app.services.responses import save_submission, validate_submission
from app.services.units import subtree_ids

router = APIRouter(tags=["respond"])
respondent_only = require_roles(Role.RESPONDENT)


def already_submitted(db: Session, campaign_id, questionnaire_id, user_id) -> bool:
    return db.scalar(
        select(Participation.id).where(
            Participation.campaign_id == campaign_id,
            Participation.questionnaire_id == questionnaire_id,
            Participation.user_id == user_id,
        )
    ) is not None


def load_assignment(db: Session, user: User, campaign_id: uuid.UUID, questionnaire_id: uuid.UUID):
    campaign = db.get(Campaign, campaign_id)
    link = db.get(CampaignQuestionnaire, (campaign_id, questionnaire_id))
    if campaign is None or link is None:
        raise HTTPException(status_code=404, detail="Анкету в цій хвилі не знайдено")
    if campaign.status != CampaignStatus.OPEN:
        raise HTTPException(status_code=409, detail="Хвиля не відкрита для проходження")
    questionnaire = link.questionnaire
    if questionnaire.kind == QuestionnaireKind.CHECKLIST:
        raise HTTPException(status_code=409, detail="Чек-лист заповнюється через /campaigns/{id}/checklist")
    if not is_eligible(user, questionnaire, subtree_ids(db, campaign.unit_id)):
        raise HTTPException(status_code=403, detail="Ця анкета призначена іншій категорії або підрозділу")
    return campaign, questionnaire


@router.get("/me/assignments", response_model=list[AssignmentOut])
def my_assignments(db: Session = Depends(get_db), user: User = Depends(respondent_only)):
    result = []
    for campaign in db.scalars(select(Campaign).where(Campaign.status == CampaignStatus.OPEN)):
        units = subtree_ids(db, campaign.unit_id)
        for link in campaign.questionnaire_links:
            questionnaire: Questionnaire = link.questionnaire
            if is_eligible(user, questionnaire, units):
                result.append(
                    AssignmentOut(
                        campaign_id=campaign.id,
                        campaign_title=campaign.title,
                        questionnaire_id=questionnaire.id,
                        questionnaire_title=questionnaire.title,
                        kind=questionnaire.kind,
                        submitted=already_submitted(db, campaign.id, questionnaire.id, user.id),
                    )
                )
    return result


@router.get("/campaigns/{campaign_id}/questionnaires/{questionnaire_id}/form", response_model=FormOut)
def get_form(
    campaign_id: uuid.UUID,
    questionnaire_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(respondent_only),
):
    """Анкета для заповнення. Бали варіантів не віддаються, щоб не підказувати 'правильну' відповідь."""
    campaign, questionnaire = load_assignment(db, user, campaign_id, questionnaire_id)
    return FormOut(
        campaign_id=campaign.id,
        questionnaire_id=questionnaire.id,
        title=questionnaire.title,
        description=questionnaire.description,
        sections=questionnaire.sections,
    )


@router.post(
    "/campaigns/{campaign_id}/questionnaires/{questionnaire_id}/responses",
    response_model=SubmissionOut,
    status_code=status.HTTP_201_CREATED,
)
def submit(
    campaign_id: uuid.UUID,
    questionnaire_id: uuid.UUID,
    data: SubmissionIn,
    db: Session = Depends(get_db),
    user: User = Depends(respondent_only),
):
    campaign, questionnaire = load_assignment(db, user, campaign_id, questionnaire_id)
    if already_submitted(db, campaign.id, questionnaire.id, user.id):
        raise HTTPException(status_code=409, detail="Ви вже пройшли цю анкету")

    issues = validate_submission(questionnaire, data.answers)
    if issues:
        raise HTTPException(status_code=422, detail=[i.model_dump() for i in issues])

    # Подання респондента навмисно не пишемо в журнал дій: запис із часом і
    # користувачем дозволив би зіставити його з відповіддю.
    submitted_on = save_submission(db, campaign, questionnaire, user, data.answers)
    db.commit()
    # Окрема транзакція: відповіді переносяться з буфера пачкою щонайменше з k анкет.
    if flush_pool(db, campaign, questionnaire.id):
        db.commit()
    return SubmissionOut(submitted_on=submitted_on)
