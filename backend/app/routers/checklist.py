"""Контрольний чек-лист (додаток Б): інституційна оцінка.

Член робочої групи вносить статус пункту і доказ, commissioner підтверджує.
Так вносить і підтверджує завжди різні люди: commissioner не є членом робочої групи.
Це не анонімна анкета: оцінюється заклад, а не люди, тому видно, хто вніс і хто підтвердив.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.models import (
    Campaign,
    CampaignStatus,
    ChecklistEntry,
    ChecklistStatus,
    Questionnaire,
    QuestionnaireKind,
    RespondentCategory,
    Role,
    User,
)
from app.security import get_current_user, require_roles
from app.services import methodology as m

router = APIRouter(prefix="/campaigns/{campaign_id}/checklist", tags=["checklist"])


class EntryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ChecklistStatus
    evidence: str = Field(default="", max_length=2000)
    comment: str = Field(default="", max_length=2000)


class ChecklistItemOut(BaseModel):
    question_id: uuid.UUID
    code: str
    number: str
    component: str | None
    text: str
    indicator: str
    status: ChecklistStatus | None
    evidence: str
    comment: str
    entered_at: datetime | None
    confirmed: bool
    confirmed_at: datetime | None
    score: float | None


class ChecklistOut(BaseModel):
    campaign_id: uuid.UUID
    questionnaire_id: uuid.UUID
    total: int
    filled: int
    confirmed: int
    items: list[ChecklistItemOut]


def is_working_group(user: User) -> bool:
    return user.role == Role.RESPONDENT and user.category == RespondentCategory.WORKING_GROUP and user.is_active


def can_view(user: User) -> bool:
    return user.role in (Role.ADMIN, Role.COMMISSIONER) or is_working_group(user)


def item_score(entry: ChecklistEntry | None) -> float | None:
    if entry is None:
        return None
    if entry.status == ChecklistStatus.FULL and entry.confirmed_by_id is None:
        return m.UNCONFIRMED_FULL_SCORE
    return m.CHECKLIST_STATUS_SCORES[entry.status.value]


def to_item(question, entry: ChecklistEntry | None) -> ChecklistItemOut:
    number = m.checklist_item_number(question.code) or question.code
    return ChecklistItemOut(
        question_id=question.id,
        code=question.code,
        number=number,
        component=m.checklist_component(number),
        text=question.text,
        indicator=question.help_text,
        status=entry.status if entry else None,
        evidence=entry.evidence if entry else "",
        comment=entry.comment if entry else "",
        entered_at=entry.entered_at if entry else None,
        confirmed=bool(entry and entry.confirmed_by_id),
        confirmed_at=entry.confirmed_at if entry else None,
        score=item_score(entry),
    )


def checklist_of(db: Session, campaign_id: uuid.UUID) -> tuple[Campaign, Questionnaire]:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    for link in campaign.questionnaire_links:
        if link.questionnaire.kind == QuestionnaireKind.CHECKLIST:
            return campaign, link.questionnaire
    raise HTTPException(status_code=404, detail="У цій хвилі немає чек-листа")


def find_question(questionnaire: Questionnaire, question_id: uuid.UUID):
    for section in questionnaire.sections:
        for question in section.questions:
            if question.id == question_id:
                return question
    raise HTTPException(status_code=404, detail="Пункт не належить до чек-листа хвилі")


def entry_of(db: Session, campaign_id, question_id) -> ChecklistEntry | None:
    return db.scalar(
        select(ChecklistEntry).where(ChecklistEntry.campaign_id == campaign_id, ChecklistEntry.question_id == question_id)
    )


@router.get("", response_model=ChecklistOut)
def get_checklist(campaign_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not can_view(user):
        raise HTTPException(status_code=403, detail="Недостатньо прав")
    campaign, questionnaire = checklist_of(db, campaign_id)
    entries = {
        e.question_id: e for e in db.scalars(select(ChecklistEntry).where(ChecklistEntry.campaign_id == campaign.id))
    }
    items = [to_item(q, entries.get(q.id)) for section in questionnaire.sections for q in section.questions]
    return ChecklistOut(
        campaign_id=campaign.id,
        questionnaire_id=questionnaire.id,
        total=len(items),
        filled=sum(1 for i in items if i.status is not None),
        confirmed=sum(1 for i in items if i.confirmed),
        items=items,
    )


@router.put("/{question_id}", response_model=ChecklistItemOut)
def set_entry(
    campaign_id: uuid.UUID,
    question_id: uuid.UUID,
    data: EntryIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Член робочої групи вносить або змінює статус пункту. Зміна знімає підтвердження."""
    if not is_working_group(user):
        raise HTTPException(status_code=403, detail="Вносити чек-лист може лише член робочої групи")
    campaign, questionnaire = checklist_of(db, campaign_id)
    if campaign.status != CampaignStatus.OPEN:
        raise HTTPException(status_code=409, detail="Хвиля не відкрита")
    question = find_question(questionnaire, question_id)

    entry = entry_of(db, campaign.id, question.id)
    if entry is None:
        entry = ChecklistEntry(campaign_id=campaign.id, question_id=question.id, entered_by_id=user.id, status=data.status)
        db.add(entry)
    entry.status = data.status
    entry.evidence = data.evidence.strip()
    entry.comment = data.comment.strip()
    entry.entered_by_id = user.id
    entry.entered_at = datetime.now(timezone.utc)
    entry.confirmed_by_id = None
    entry.confirmed_at = None
    db.flush()
    log_action(db, user, "set", "checklist_entry", entry.id, {"item": question.code, "status": data.status.value})
    db.commit()
    return to_item(question, entry)


@router.post("/{question_id}/confirm", response_model=ChecklistItemOut)
def confirm_entry(
    campaign_id: uuid.UUID,
    question_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(Role.COMMISSIONER)),
):
    """Підтвердити пункт можна лише за наявності доказу."""
    campaign, questionnaire = checklist_of(db, campaign_id)
    if campaign.status != CampaignStatus.OPEN:
        raise HTTPException(status_code=409, detail="Хвиля не відкрита")
    question = find_question(questionnaire, question_id)
    entry = entry_of(db, campaign.id, question.id)
    if entry is None:
        raise HTTPException(status_code=409, detail="Пункт ще не заповнено")
    if not entry.evidence:
        raise HTTPException(status_code=422, detail="Без доказу пункт підтвердити не можна")
    if entry.entered_by_id == user.id:
        raise HTTPException(status_code=409, detail="Не можна підтверджувати власний запис")
    entry.confirmed_by_id = user.id
    entry.confirmed_at = datetime.now(timezone.utc)
    log_action(db, user, "confirm", "checklist_entry", entry.id, {"item": question.code})
    db.commit()
    return to_item(question, entry)


@router.delete("/{question_id}/confirm", response_model=ChecklistItemOut)
def revoke_confirmation(
    campaign_id: uuid.UUID,
    question_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(Role.COMMISSIONER)),
):
    campaign, questionnaire = checklist_of(db, campaign_id)
    if campaign.status != CampaignStatus.OPEN:
        raise HTTPException(status_code=409, detail="Хвиля не відкрита")
    question = find_question(questionnaire, question_id)
    entry = entry_of(db, campaign.id, question.id)
    if entry is None or entry.confirmed_by_id is None:
        raise HTTPException(status_code=409, detail="Пункт не підтверджено")
    entry.confirmed_by_id = None
    entry.confirmed_at = None
    log_action(db, user, "revoke_confirm", "checklist_entry", entry.id, {"item": question.code})
    db.commit()
    return to_item(question, entry)
