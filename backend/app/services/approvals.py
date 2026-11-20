"""Принцип двох осіб (FOUR_EYES_ENABLED): дії, які одна людина лише просить, а виконує підтвердження іншої.

- user_role / user_category: призначення привілейованої ролі чи зміна категорії (впливає на групи й індекс);
- activate_users: нові облікові записи (у т. ч. імпорт). Закриває атаку «n−1»: адміністратор не може сам
  створити k−1 підставних респондентів, щоб відніманням дізнатися відповідь однієї людини;
- open_campaign: відкриття хвилі зі складом учасників, який бачить підтверджувач.

Підтверджує не той, хто просив. Усе пишеться в журнал дій.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.errors import ApiError
from app.models import ApprovalRequest, Campaign, CampaignEligible, Role, User

PRIVILEGED = (Role.ADMIN, Role.COORDINATOR, Role.COMMISSIONER, Role.AUDITOR, Role.LEADER, Role.DEPARTMENT)
USER_APPROVERS = (Role.ADMIN, Role.COORDINATOR)
CAMPAIGN_APPROVERS = (Role.ADMIN, Role.COMMISSIONER, Role.AUDITOR)


def enabled() -> bool:
    return get_settings().four_eyes_enabled


def request(db: Session, actor: User | None, kind: str, target_id, payload: dict, summary: str) -> ApprovalRequest:
    """Новий запит (або вже наявний незавершений того самого виду для тієї самої цілі)."""
    target = str(target_id) if target_id is not None else None
    existing = db.scalar(select(ApprovalRequest).where(ApprovalRequest.kind == kind, ApprovalRequest.target_id == target,
                                                       ApprovalRequest.status == "pending"))
    if existing is not None:
        existing.payload = payload
        existing.summary = summary
        return existing
    row = ApprovalRequest(kind=kind, target_id=target, payload=payload, summary=summary,
                          requested_by_id=actor.id if actor else None)
    db.add(row)
    db.flush()
    log_action(db, actor, "request_approval", "approval", row.id, {"kind": kind, "target_id": target})
    return row


def open_approved(db: Session, campaign: Campaign) -> bool:
    return db.scalar(select(ApprovalRequest.id).where(
        ApprovalRequest.kind == "open_campaign", ApprovalRequest.target_id == str(campaign.id),
        ApprovalRequest.status == "approved")) is not None


def composition_summary(db: Session, campaign: Campaign) -> dict:
    """Що бачить підтверджувач відкриття: склад за анкетами і скільки облікових записів створено нещодавно."""
    recent_since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = db.execute(select(CampaignEligible.questionnaire_id, func.count()).where(
        CampaignEligible.campaign_id == campaign.id).group_by(CampaignEligible.questionnaire_id)).all()
    recent = db.scalar(select(func.count()).select_from(CampaignEligible).join(User, User.id == CampaignEligible.user_id)
                       .where(CampaignEligible.campaign_id == campaign.id, User.created_at >= recent_since)) or 0
    titles = {link.questionnaire_id: link.questionnaire.title for link in campaign.questionnaire_links}
    return {"eligible": {titles.get(q, str(q)): n for q, n in rows}, "created_last_30_days": recent}


def decide(db: Session, row: ApprovalRequest, approver: User, approve: bool, comment: str = "") -> ApprovalRequest:
    if row.status != "pending":
        raise ApiError(409, "Запит уже розглянуто", code="decided")
    if row.requested_by_id == approver.id:
        raise ApiError(403, "Підтверджує не той, хто просив", code="same_person",
                       hint="Попросіть іншого адміністратора (принцип двох осіб).")
    allowed = CAMPAIGN_APPROVERS if row.kind == "open_campaign" else USER_APPROVERS
    if approver.role not in allowed:
        raise ApiError(403, "Цей запит підтверджує: " + ", ".join(r.value for r in allowed), code="forbidden_role")
    row.status = "approved" if approve else "rejected"
    row.decided_by_id = approver.id
    row.decided_at = datetime.now(timezone.utc)
    row.comment = comment
    if approve:
        apply(db, row, approver)
    log_action(db, approver, "approve" if approve else "reject", "approval", row.id,
               {"kind": row.kind, "target_id": row.target_id, "comment": comment})
    return row


def apply(db: Session, row: ApprovalRequest, approver: User) -> None:
    from app.security import revoke_all_tokens
    from app.services import lifecycle
    from app.services.eligibility import freeze, open_frozen_campaigns_of

    payload = row.payload or {}
    if row.kind == "activate_users":
        users = list(db.scalars(select(User).where(User.id.in_([uuid.UUID(x) for x in payload.get("user_ids", [])]))))
        for user in users:
            user.is_active = True
        campaign_id = payload.get("campaign_id")
        if campaign_id:
            campaign = db.get(Campaign, uuid.UUID(campaign_id))
            if campaign is not None and campaign.eligible_frozen and campaign.status.value in ("draft", "open"):
                db.flush()
                freeze(db, campaign, users)
    elif row.kind in ("user_role", "user_category"):
        user = db.get(User, uuid.UUID(row.target_id))
        if user is None:
            raise ApiError(404, "Користувача вже немає")
        busy = open_frozen_campaigns_of(db, user.id)
        if busy:
            raise ApiError(409, "Людина в складі хвилі: " + ", ".join(c.title for c in busy), code="campaign_open",
                           hint="Підтвердьте після закриття хвилі.")
        for field, value in (payload.get("changes") or {}).items():
            setattr(user, field, Role(value) if field == "role" and value else value)
        revoke_all_tokens(user)
    elif row.kind == "open_campaign":
        campaign = db.get(Campaign, uuid.UUID(row.target_id), with_for_update=True)
        if campaign is None:
            raise ApiError(404, "Хвилі вже немає")
        from app.clock import today

        if campaign.status.value == "draft" and (campaign.planned_open_on is None or campaign.planned_open_on <= today()):
            db.flush()
            lifecycle.open_wave(db, campaign, approver, via="four_eyes")
