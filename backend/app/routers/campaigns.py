"""Хвилі оцінювання: створення, відкриття, закриття, контроль проходження."""

import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import today
from app.config import get_settings
from app.db import get_db
from app.models import (
    Campaign,
    CampaignQuestionnaire,
    CampaignStatus,
    Participation,
    Questionnaire,
    QuestionnaireKind,
    QuestionnaireStatus,
    Role,
    Unit,
    User,
)
from app.schemas import CampaignCreate, CampaignOut, CampaignProgress, ProgressItem
from app.security import require_roles
from app.services.anonymity import flush_all
from app.services.eligibility import is_eligible
from app.services.results import create_snapshots
from app.services.units import subtree_ids

router = APIRouter(prefix="/campaigns", tags=["campaigns"])
admin_only = require_roles(Role.ADMIN)
# commissioner, керівник і аудитор бачать список хвиль (для дашборда), але не прогрес проходження.
can_read = require_roles(Role.ADMIN, Role.COMMISSIONER, Role.LEADER, Role.AUDITOR)


def to_out(campaign: Campaign) -> CampaignOut:
    return CampaignOut(
        id=campaign.id,
        title=campaign.title,
        unit_id=campaign.unit_id,
        status=campaign.status,
        min_group_size=campaign.min_group_size,
        opened_on=campaign.opened_on,
        closed_on=campaign.closed_on,
        questionnaire_ids=[link.questionnaire_id for link in campaign.questionnaire_links],
    )


def get_or_404(db: Session, campaign_id: uuid.UUID) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    return campaign


@router.get("", response_model=list[CampaignOut])
def list_campaigns(db: Session = Depends(get_db), _: User = Depends(can_read)):
    return [to_out(c) for c in db.scalars(select(Campaign).order_by(Campaign.created_at.desc()))]


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(data: CampaignCreate, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    if db.get(Unit, data.unit_id) is None:
        raise HTTPException(status_code=422, detail="Підрозділ не знайдено")

    campaign = Campaign(
        title=data.title,
        unit_id=data.unit_id,
        min_group_size=data.min_group_size or get_settings().min_group_size,
        created_by_id=admin.id,
    )
    for q_id in dict.fromkeys(data.questionnaire_ids):
        questionnaire = db.get(Questionnaire, q_id)
        if questionnaire is None or questionnaire.status != QuestionnaireStatus.PUBLISHED:
            raise HTTPException(status_code=422, detail=f"Анкета {q_id} не знайдена або не опублікована")
        campaign.questionnaire_links.append(CampaignQuestionnaire(questionnaire_id=q_id))

    db.add(campaign)
    db.flush()
    log_action(db, admin, "create", "campaign", campaign.id, {"title": campaign.title})
    db.commit()
    return to_out(campaign)


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(campaign_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(can_read)):
    return to_out(get_or_404(db, campaign_id))


@router.post("/{campaign_id}/open", response_model=CampaignOut)
def open_campaign(campaign_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    campaign = get_or_404(db, campaign_id)
    if campaign.status != CampaignStatus.DRAFT:
        raise HTTPException(status_code=409, detail="Відкрити можна лише хвилю в статусі чернетки")
    campaign.status = CampaignStatus.OPEN
    campaign.opened_on = today()
    log_action(db, admin, "open", "campaign", campaign.id)
    db.commit()
    return to_out(campaign)


@router.post("/{campaign_id}/close", response_model=CampaignOut)
def close_campaign(campaign_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    campaign = get_or_404(db, campaign_id)
    if campaign.status != CampaignStatus.OPEN:
        raise HTTPException(status_code=409, detail="Закрити можна лише відкриту хвилю")
    campaign.status = CampaignStatus.CLOSED
    campaign.closed_on = today()
    # Залишок буфера відповідей переноситься в Response до розрахунку знімків.
    moved = flush_all(db, campaign)
    db.flush()
    # Знімок результатів фіксується в момент закриття і більше не змінюється.
    snapshots = create_snapshots(db, campaign)
    log_action(db, admin, "close", "campaign", campaign.id, {"snapshots": snapshots, "responses_moved": moved})
    db.commit()
    return to_out(campaign)


@router.get("/{campaign_id}/progress", response_model=CampaignProgress)
def progress(campaign_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(admin_only)):
    """Скільки людей пройшли анкети. Лише кількість, без імен.

    Для груп, менших за поріг хвилі, кількості не показуються.
    """
    campaign = get_or_404(db, campaign_id)
    units = subtree_ids(db, campaign.unit_id)
    users = db.scalars(select(User).where(User.role == Role.RESPONDENT, User.is_active.is_(True))).all()

    items = []
    for link in campaign.questionnaire_links:
        questionnaire = link.questionnaire
        if questionnaire.kind == QuestionnaireKind.CHECKLIST:
            continue  # стан чек-листа: GET /campaigns/{id}/checklist
        eligible = sum(1 for u in users if is_eligible(u, questionnaire, units))
        submitted = db.scalar(
            select(func.count()).select_from(Participation).where(
                Participation.campaign_id == campaign.id,
                Participation.questionnaire_id == questionnaire.id,
            )
        )
        visible = eligible >= campaign.min_group_size
        items.append(
            ProgressItem(
                questionnaire_id=questionnaire.id,
                questionnaire_title=questionnaire.title,
                target_category=questionnaire.target_category,
                eligible=eligible if visible else None,
                submitted=submitted if visible else None,
                percent=(round(100 * submitted / eligible, 1) if eligible else 0.0) if visible else None,
                too_few_people=not visible,
            )
        )
    return CampaignProgress(campaign_id=campaign.id, status=campaign.status, items=items)
