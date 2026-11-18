"""Автопілот хвилі (services/autopilot.py) і сповіщення для користувачів."""

import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import now
from app.db import get_db
from app.errors import ApiError
from app.models import (
    Campaign,
    CampaignEligible,
    CampaignStatus,
    GeneratedReport,
    Notice,
    Role,
    User,
)
from app.security import RESULT_READERS, ensure_unit_access, get_current_user, require_roles
from app.services import autopilot
from app.services.units import subtree_from, unit_tree

router = APIRouter(tags=["autopilot"])
admin_only = require_roles(Role.ADMIN)
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class AutopilotIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    planned_open_on: date | None = Field(default=None, description="Коли відкрити (для чернетки)")
    planned_close_on: date | None = Field(default=None, description="Коли закрити, якщо участь не набереться раніше")
    close_at_percent: float | None = Field(default=None, ge=1, le=100,
                                           description="Закрити раніше, коли в кожній анкеті участь ≥ цього відсотка")
    remind_every_days: int | None = Field(default=None, ge=1, le=60, description="Нагадувати всім учасникам кожні N днів")

    @model_validator(mode="after")
    def dates(self):
        if self.planned_open_on and self.planned_close_on and self.planned_close_on <= self.planned_open_on:
            raise ValueError("planned_close_on має бути пізніше за planned_open_on")
        if self.enabled and not (self.planned_close_on or self.close_at_percent):
            raise ValueError("Для автопілота потрібна дата закриття або поріг участі")
        return self


class AutopilotEventOut(BaseModel):
    at: datetime
    step: str
    status: str
    message: str
    details: dict


class AutopilotOut(BaseModel):
    campaign_id: uuid.UUID
    campaign_title: str
    status: CampaignStatus
    enabled: bool
    planned_open_on: date | None
    planned_close_on: date | None
    close_at_percent: float | None
    remind_every_days: int | None
    last_reminder_on: date | None
    plan: list[str] = Field(description="Що автопілот зробить далі")
    report_ready: bool = Field(description="Чи підготовлено Word-звіт після закриття")
    events: list[AutopilotEventOut]


class TickEvent(BaseModel):
    campaign_id: str | None
    campaign_title: str | None
    step: str
    status: str
    message: str


class TickOut(BaseModel):
    events: list[TickEvent]


class NoticeOut(BaseModel):
    id: uuid.UUID
    campaign_id: uuid.UUID | None
    audience: str
    kind: str
    title: str
    body: str
    created_at: datetime


def get_campaign(db: Session, campaign_id: uuid.UUID) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise ApiError(404, "Хвилю не знайдено", code="not_found")
    return campaign


def state(db: Session, campaign: Campaign) -> AutopilotOut:
    ready = db.scalar(select(GeneratedReport.id).where(GeneratedReport.campaign_id == campaign.id).limit(1)) is not None
    return AutopilotOut(
        campaign_id=campaign.id, campaign_title=campaign.title, status=campaign.status, enabled=campaign.autopilot,
        planned_open_on=campaign.planned_open_on, planned_close_on=campaign.planned_close_on,
        close_at_percent=campaign.close_at_percent, remind_every_days=campaign.remind_every_days,
        last_reminder_on=campaign.last_reminder_on, plan=autopilot.plan(campaign), report_ready=ready,
        events=[AutopilotEventOut(at=e.at, step=e.step, status=e.status, message=e.message, details=e.details or {})
                for e in autopilot.campaign_events(db, campaign.id)])


@router.get("/campaigns/{campaign_id}/autopilot", response_model=AutopilotOut)
def get_autopilot(campaign_id: uuid.UUID, db: Session = Depends(get_db),
                  _: User = Depends(require_roles(Role.ADMIN, Role.COORDINATOR, Role.AUDITOR))):
    """План автопілота хвилі, що він зробить далі, і журнал його кроків."""
    return state(db, get_campaign(db, campaign_id))


@router.put("/campaigns/{campaign_id}/autopilot", response_model=AutopilotOut)
def set_autopilot(campaign_id: uuid.UUID, data: AutopilotIn, db: Session = Depends(get_db),
                  admin: User = Depends(admin_only)):
    """Увімкнути чи вимкнути автопілот і задати план (дати, поріг участі, частоту нагадувань)."""
    campaign = get_campaign(db, campaign_id)
    if campaign.status == CampaignStatus.CLOSED:
        raise ApiError(409, "Хвилю вже закрито", code="conflict")
    if campaign.status == CampaignStatus.OPEN and data.planned_open_on and data.planned_open_on != campaign.planned_open_on:
        raise ApiError(409, "Хвиля вже відкрита: дату відкриття змінити не можна", code="conflict")
    campaign.autopilot = data.enabled
    campaign.planned_open_on = data.planned_open_on if campaign.status == CampaignStatus.DRAFT else campaign.planned_open_on
    campaign.planned_close_on = data.planned_close_on
    campaign.close_at_percent = data.close_at_percent
    campaign.remind_every_days = data.remind_every_days
    log_action(db, admin, "autopilot", "campaign", campaign.id, data.model_dump(mode="json"))
    db.commit()
    return state(db, campaign)


@router.post("/autopilot/tick", response_model=TickOut)
def run_tick(db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    """Виконати крок автопілота зараз (фоново він іде кожні AUTOPILOT_INTERVAL_SECONDS)."""
    events = autopilot.tick(db)
    autopilot.audit_tick(db, admin, events)
    db.commit()
    return TickOut(events=events)


@router.get("/campaigns/{campaign_id}/autopilot/report")
def download_prepared_report(campaign_id: uuid.UUID, db: Session = Depends(get_db),
                             user: User = Depends(require_roles(*RESULT_READERS))):
    """Word-звіт, який автопілот підготував при закритті хвилі (свіжий звіт: GET /campaigns/{id}/report)."""
    campaign = get_campaign(db, campaign_id)
    ensure_unit_access(db, user, campaign.unit_id)
    row = db.scalars(select(GeneratedReport).where(GeneratedReport.campaign_id == campaign.id)
                     .order_by(GeneratedReport.created_at.desc())).first()
    if row is None:
        raise ApiError(404, "Звіт ще не підготовлено", code="not_found",
                       hint="Автопілот готує звіт при закритті хвилі; вручну — GET /campaigns/{id}/report?format=docx.")
    log_action(db, user, "export_report", "campaign", campaign.id, {"format": "docx", "prepared": True})
    db.commit()
    return Response(content=row.content, media_type=DOCX,
                    headers={"Content-Disposition": f'attachment; filename="{row.filename}"'})


# ---------- Сповіщення ----------

def audiences(user: User) -> set[str]:
    if user.role in (Role.ADMIN, Role.COORDINATOR):
        return {"admins", "leaders"}
    if user.role in (Role.LEADER, Role.AUDITOR, Role.COMMISSIONER):
        return {"leaders"}
    return {"participants"}


@router.get("/me/notifications", response_model=list[NoticeOut])
def my_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Сповіщення за 30 днів для моєї ролі: нагадування й підсумки хвиль, підсумок агента-чергового.

    Нагадування адресовані всім учасникам хвилі, а не тим, хто ще не пройшов: так нічого не розкривається.
    """
    since = now() - timedelta(days=30)
    rows = db.scalars(select(Notice).where(Notice.audience.in_(audiences(user)), Notice.created_at >= since)
                      .order_by(Notice.created_at.desc()).limit(200)).all()
    children = unit_tree(db)[0]
    mine = set(db.scalars(select(CampaignEligible.campaign_id).where(CampaignEligible.user_id == user.id)))
    out = []
    for n in rows:
        if n.campaign_id is not None:
            campaign = db.get(Campaign, n.campaign_id)
            covered = campaign is not None and user.unit_id is not None and \
                user.unit_id in subtree_from(children, campaign.unit_id)
            if n.audience == "participants" and n.campaign_id not in mine and not (covered and not campaign.eligible_frozen):
                continue
            if n.audience == "leaders" and user.role == Role.LEADER and user.unit_id is not None and not covered:
                continue
        out.append(n)
        if len(out) == 50:
            break
    return out
