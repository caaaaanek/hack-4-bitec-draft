"""Принцип двох осіб (FOUR_EYES_ENABLED, за замовчуванням увімкнено): одна людина лише просить, виконує
підтвердження іншої. Хто що підтверджує — APPROVERS (docs/backend.md, «Два адміністратори»):

| kind | хто просить | хто підтверджує |
|---|---|---|
| activate_users — нові облікові записи, імпорт | технічний адміністратор | уповноважений |
| user_role — привілейована роль, блокування чи підрозділ привілейованого запису | технічний адміністратор | уповноважений; якщо запис — уповноважений, то аудит |
| user_category — категорія (впливає на групи й k) | технічний адміністратор | уповноважений |
| user_invite — скидання пароля привілейованого запису | технічний адміністратор | уповноважений; запис уповноваженого — аудит. Посилання отримує той, хто підтвердив |
| unit_change — підрозділ у межах чернетки хвилі | технічний адміністратор | уповноважений |
| open_campaign — відкриття хвилі (підтверджувач бачить склад) | уповноважений | внутрішній аудит |

Технічний адміністратор нічого не підтверджує. Підтверджує не той, хто просив, і лише в межах своєї зони
(security.zone_of): уповноважений одного закладу не підтверджує людей іншого. Усе пишеться в журнал дій.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.errors import ApiError
from app.models import ApprovalRequest, Campaign, CampaignEligible, Role, User

PRIVILEGED = (Role.ADMIN, Role.COORDINATOR, Role.AUDITOR, Role.LEADER, Role.DEPARTMENT)
APPROVERS: dict[str, tuple[Role, ...]] = {
    "activate_users": (Role.ADMIN,),
    "user_role": (Role.ADMIN,),
    "user_category": (Role.ADMIN,),
    "user_invite": (Role.ADMIN,),
    "unit_change": (Role.ADMIN,),
    "open_campaign": (Role.AUDITOR,),
}
# Хто може бачити й вирішувати запити (хоч якогось виду).
APPROVER_ROLES = tuple(dict.fromkeys(r for roles in APPROVERS.values() for r in roles))
ROLE_TITLES = {Role.ADMIN: "уповноважений", Role.AUDITOR: "внутрішній аудит", Role.COORDINATOR: "технічний адміністратор"}


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


def approvers_for(db: Session, row: ApprovalRequest) -> tuple[Role, ...]:
    """Ролі, що підтверджують запит. Зміну облікового запису самого уповноваженого підтверджує аудит."""
    if row.kind in ("user_role", "user_category", "user_invite", "activate_users") and row.target_id:
        try:
            target = db.get(User, uuid.UUID(row.target_id))
        except ValueError:
            target = None
        if target is not None and target.role == Role.ADMIN:
            return (Role.AUDITOR,)
    return APPROVERS.get(row.kind, ())


def approvers_text(roles: tuple[Role, ...]) -> str:
    return ", ".join(ROLE_TITLES.get(r, r.value) for r in roles) or "нікому"


def units_of(db: Session, row: ApprovalRequest) -> set[uuid.UUID]:
    """Підрозділи, яких стосується запит: для перевірки зони підтверджувача."""
    payload = row.payload or {}
    ids: set[uuid.UUID] = set()
    try:
        if row.kind == "open_campaign" and row.target_id:
            campaign = db.get(Campaign, uuid.UUID(row.target_id))
            if campaign is not None:
                ids.add(campaign.unit_id)
        elif row.kind == "unit_change":
            for key in ("unit_id", "parent_id", "new_parent_id"):
                if payload.get(key):
                    ids.add(uuid.UUID(payload[key]))
        else:
            user_ids = payload.get("user_ids") or ([row.target_id] if row.target_id else [])
            for user in db.scalars(select(User).where(User.id.in_([uuid.UUID(x) for x in user_ids]))):
                if user.unit_id is not None:
                    ids.add(user.unit_id)
            new_unit = (payload.get("changes") or {}).get("unit_id")
            if new_unit:
                ids.add(uuid.UUID(new_unit))
    except ValueError:
        pass
    return ids


def can_decide(db: Session, row: ApprovalRequest, user: User) -> bool:
    from app.security import zone_of

    if user.role not in approvers_for(db, row) or row.requested_by_id == user.id:
        return False
    zone = zone_of(db, user)
    return zone is None or units_of(db, row) <= zone


def decide(db: Session, row: ApprovalRequest, approver: User, approve: bool, comment: str = "") -> ApprovalRequest:
    from app.security import zone_of

    if row.status != "pending":
        raise ApiError(409, "Запит уже розглянуто", code="decided")
    allowed = approvers_for(db, row)
    if row.requested_by_id == approver.id:
        raise ApiError(403, "Підтверджує не той, хто просив", code="same_person",
                       hint=f"Цей запит підтверджує: {approvers_text(allowed)} (принцип двох осіб).")
    if approver.role not in allowed:
        raise ApiError(403, "Цей запит підтверджує: " + approvers_text(allowed), code="forbidden_role")
    zone = zone_of(db, approver)
    if zone is not None and not units_of(db, row) <= zone:
        raise ApiError(403, "Запит стосується підрозділу поза вашою зоною", code="out_of_zone")
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
            if field == "role" and value:
                value = Role(value)
            elif field == "unit_id" and value:
                value = uuid.UUID(value)
            setattr(user, field, value)
        revoke_all_tokens(user)
    elif row.kind == "user_invite":
        from app.services import invites

        user = db.get(User, uuid.UUID(row.target_id))
        if user is None:
            raise ApiError(404, "Користувача вже немає")
        token, expires = invites.issue(db, user, approver)
        user.password_hash = invites.NO_PASSWORD
        revoke_all_tokens(user)
        # Посилання не зберігається: його один раз показує відповідь підтвердження (ApprovalOut.invite_link).
        db.info.setdefault("issued_invites", {})[row.id] = (invites.link(token), expires)
    elif row.kind == "unit_change":
        from app.services.units import apply_unit_change

        apply_unit_change(db, payload, approver)
    elif row.kind == "open_campaign":
        campaign = db.get(Campaign, uuid.UUID(row.target_id), with_for_update=True)
        if campaign is None:
            raise ApiError(404, "Хвилі вже немає")
        from app.clock import today

        if campaign.status.value == "draft" and (campaign.planned_open_on is None or campaign.planned_open_on <= today()):
            db.flush()
            lifecycle.open_wave(db, campaign, approver, via="four_eyes")
            from app.services import autopilot  # уникаємо циклічного імпорту

            autopilot.after_open(db, campaign, "four_eyes")
