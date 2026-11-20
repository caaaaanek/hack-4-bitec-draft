"""Хвилі оцінювання (Assessment Manager): створення, зміна чернетки, учасники, одноразові посилання,
відкриття, закриття, контроль проходження."""

import csv
import io
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.audit import log_action
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import (
    AccessMode,
    AccessToken,
    Campaign,
    CampaignParticipant,
    CampaignQuestionnaire,
    CampaignStatus,
    Participation,
    QrLink,
    Questionnaire,
    QuestionnaireKind,
    QuestionnaireStatus,
    RespondentCategory,
    Role,
    Unit,
    User,
)
from app.schemas import (
    CampaignCreate,
    CampaignOut,
    CampaignProgress,
    CampaignUpdate,
    ImportOut,
    IssuedToken,
    ParticipantOut,
    ParticipantsIn,
    ParticipantsOut,
    ProgressItem,
    QrLinkIn,
    QrLinkOut,
    TokensIn,
    TokensOut,
    TokensRevokeIn,
    TokensRevokeOut,
)
from app.security import campaign_visible, ensure_in_zone, require_roles
from app.services import tokens as token_service
from app.services import approvals, autopilot, categories, lifecycle
from app.services.eligibility import freeze, frozen_of, is_eligible, participants_of, refreeze
from app.services.safe_export import SafeCsvWriter
from app.services.units import subtree_ids

router = APIRouter(prefix="/campaigns", tags=["campaigns"])
admin_only = require_roles(Role.ADMIN)
# Керівник і аудитор бачать список хвиль (для дашборда), але не прогрес проходження.
# Кожен — лише хвилі своєї зони (security.campaign_visible; окрема хвиля — campaign_zone_guard).
can_read = require_roles(Role.ADMIN, Role.LEADER, Role.AUDITOR)


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
        access_mode=campaign.access_mode,
        explicit_participants=campaign.explicit_participants,
        has_checklist=any(link.questionnaire.kind == QuestionnaireKind.CHECKLIST
                          for link in campaign.questionnaire_links),
        urn_enabled=campaign.urn_enabled,
        urn_close_requested=campaign.urn_close_requested,
        eligible_frozen=campaign.eligible_frozen,
    )


def check_staff_token_only(db: Session, campaign: Campaign) -> None:
    """STAFF_TOKEN_ONLY=true: особовий склад проходить лише за QR чи посиланнями (логін видає факт участі)."""
    if not get_settings().staff_token_only or campaign.access_mode != AccessMode.LOGIN:
        return
    linked = [db.get(Questionnaire, link.questionnaire_id) for link in campaign.questionnaire_links]
    staff = [q.title for q in linked if q is not None and q.target_category == RespondentCategory.STAFF]
    if staff:
        raise ApiError(422, "Анкети особового складу проходять лише анонімно: " + ", ".join(staff),
                       code="staff_token_only",
                       hint="Створіть окрему хвилю з access_mode = token (QR або одноразові посилання) для особового "
                            "складу; логін лишається для робочої групи й експертів.")


def get_or_404(db: Session, campaign_id: uuid.UUID) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    return campaign


def get_locked_or_404(db: Session, campaign_id: uuid.UUID) -> Campaign:
    """Хвиля з блокуванням рядка (SELECT ... FOR UPDATE) до кінця транзакції.

    Відкриття й закриття змінюють статус: без блокування адмін і автопілот (або подвійний клік) обидва бачили б
    «відкрита», і другий падав би на унікальності знімків з 500. З блокуванням другий чекає, бачить новий статус
    і отримує звичайний 409.
    """
    campaign = db.get(Campaign, campaign_id, with_for_update=True, populate_existing=True)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    return campaign


@router.get("", response_model=list[CampaignOut])
def list_campaigns(db: Session = Depends(get_db), user: User = Depends(can_read)):
    query = (select(Campaign)
             .options(selectinload(Campaign.questionnaire_links).selectinload(CampaignQuestionnaire.questionnaire))
             .order_by(Campaign.created_at.desc()))
    return [to_out(c) for c in db.scalars(query) if campaign_visible(db, user, c)]


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(data: CampaignCreate, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    if db.get(Unit, data.unit_id) is None:
        raise HTTPException(status_code=422, detail="Підрозділ не знайдено")
    ensure_in_zone(db, admin, data.unit_id)

    campaign = Campaign(
        title=data.title,
        unit_id=data.unit_id,
        min_group_size=data.min_group_size or get_settings().min_group_size,
        access_mode=data.access_mode,
        explicit_participants=False,
        created_by_id=admin.id,
    )
    set_questionnaires(db, campaign, data.questionnaire_ids)
    check_staff_token_only(db, campaign)

    db.add(campaign)
    db.flush()
    # Склад фіксується з моменту створення: між створенням і відкриттям не «підкинути» людей у групи.
    frozen = freeze(db, campaign) if campaign.access_mode == AccessMode.LOGIN else 0
    log_action(db, admin, "create", "campaign", campaign.id,
               {"title": campaign.title, "access_mode": campaign.access_mode.value, "eligible_frozen": frozen})
    db.commit()
    return to_out(campaign)


def set_questionnaires(db: Session, campaign: Campaign, questionnaire_ids: list[uuid.UUID]) -> None:
    links = []
    for q_id in dict.fromkeys(questionnaire_ids):
        questionnaire = db.get(Questionnaire, q_id)
        if questionnaire is None or questionnaire.status != QuestionnaireStatus.PUBLISHED:
            raise HTTPException(status_code=422, detail=f"Анкета {q_id} не знайдена або не опублікована")
        links.append(CampaignQuestionnaire(questionnaire_id=q_id))
    campaign.questionnaire_links = links


def active_tokens(db: Session, campaign_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).select_from(AccessToken).where(
        AccessToken.campaign_id == campaign_id, AccessToken.revoked.is_(False))) or 0


@router.patch("/{campaign_id}", response_model=CampaignOut)
def update_campaign(campaign_id: uuid.UUID, data: CampaignUpdate, db: Session = Depends(get_db),
                    admin: User = Depends(admin_only)):
    """Змінити хвилю. Лише чернетку: після відкриття склад анкет і область не змінюються."""
    campaign = get_or_404(db, campaign_id)
    if campaign.status != CampaignStatus.DRAFT:
        raise ApiError(409, "Змінювати можна лише хвилю в статусі чернетки", code="not_draft",
                       hint="Створіть нову хвилю.")
    changes = data.model_dump(exclude_unset=True)
    for key in ("unit_id", "questionnaire_ids", "access_mode", "title", "min_group_size"):
        if key in changes and changes[key] is None:
            raise HTTPException(status_code=422, detail=f"Поле {key} не може бути порожнім")
    structural = {"unit_id", "questionnaire_ids", "access_mode"} & changes.keys()
    if structural and active_tokens(db, campaign.id):
        raise ApiError(409, "Для хвилі вже видано посилання", code="tokens_issued",
                       hint="Спершу відкличте видані посилання, потім змінюйте область чи анкети.")
    if "unit_id" in changes:
        if db.get(Unit, changes["unit_id"]) is None:
            raise HTTPException(status_code=422, detail="Підрозділ не знайдено")
        ensure_in_zone(db, admin, changes["unit_id"])
        campaign.unit_id = changes["unit_id"]
    if "questionnaire_ids" in changes:
        set_questionnaires(db, campaign, changes["questionnaire_ids"])
    for key in ("title", "min_group_size", "access_mode"):
        if key in changes:
            setattr(campaign, key, changes[key])
    check_staff_token_only(db, campaign)
    if structural:
        db.flush()
        refreeze(db, campaign)
    log_action(db, admin, "update", "campaign", campaign.id,
               {k: (v.value if hasattr(v, "value") else [str(x) for x in v] if isinstance(v, list) else str(v))
                for k, v in changes.items()})
    db.commit()
    return to_out(campaign)


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(campaign_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(can_read)):
    return to_out(get_or_404(db, campaign_id))


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(campaign_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    """Видалити чернетку (наприклад, щоб звільнити людей зі складу, зафіксованого при створенні)."""
    campaign = get_locked_or_404(db, campaign_id)
    if campaign.status != CampaignStatus.DRAFT:
        raise ApiError(409, "Видалити можна лише чернетку", code="not_draft")
    if active_tokens(db, campaign.id):
        raise ApiError(409, "Для хвилі вже видано посилання", code="tokens_issued",
                       hint="Відкличте посилання, потім видаляйте.")
    log_action(db, admin, "delete", "campaign", campaign.id, {"title": campaign.title})
    from app.models import (AccessToken as _T, AutopilotEvent, BlindKey, CampaignEligible, ChecklistAssignment,
                            Notice, QrLink as _Q, UrnShare)

    for model in (CampaignEligible, CampaignParticipant, ChecklistAssignment, UrnShare, BlindKey, _T, _Q,
                  AutopilotEvent, Notice):
        db.execute(delete(model).where(model.campaign_id == campaign.id))
    db.delete(campaign)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{campaign_id}/open", response_model=CampaignOut)
def open_campaign(campaign_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    """Відкрити хвилю. FOUR_EYES_ENABLED: перший виклик створює запит (pending_approval_id), хвилю відкриває
    підтвердження другої людини, яка бачить склад учасників і скільки облікових записів створено нещодавно."""
    campaign = get_locked_or_404(db, campaign_id)
    if approvals.enabled() and campaign.status == CampaignStatus.DRAFT and not approvals.open_approved(db, campaign):
        if campaign.access_mode == AccessMode.LOGIN and not campaign.eligible_frozen:
            freeze(db, campaign)
            db.flush()
        lifecycle.check_group_sizes(db, campaign)
        summary = approvals.composition_summary(db, campaign)
        req = approvals.request(db, admin, "open_campaign", campaign.id, summary,
                                f"Відкрити хвилю «{campaign.title}»: склад "
                                + ", ".join(f"{k} — {v}" for k, v in summary["eligible"].items())
                                + f"; нових облікових записів за 30 днів: {summary['created_last_30_days']}")
        db.commit()
        return to_out(campaign).model_copy(update={"pending_approval_id": req.id})
    lifecycle.open_wave(db, campaign, admin)
    autopilot.after_open(db, campaign, "manual")
    db.commit()
    return to_out(campaign)


@router.post("/{campaign_id}/close", response_model=CampaignOut)
def close_campaign(campaign_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    """Закрити хвилю. З «урною» лише позначає запит на закриття: закриють двоє власників частин ключа."""
    campaign = get_locked_or_404(db, campaign_id)
    if campaign.urn_enabled and campaign.status == CampaignStatus.OPEN:
        from app.services import urn

        urn.request_close(db, campaign, admin)
        db.commit()
        raise ApiError(409, "Закриття чекає двох частин ключа урни", code="urn_pending",
                       hint="Закриття чекає двох частин ключа. Власники вводять їх на екрані «Урна».")
    lifecycle.close_wave(db, campaign, admin)
    # Звіт і сповіщення — так само, як після автозакриття (раніше ручне закриття нікого не сповіщало).
    autopilot.after_close(db, campaign)
    db.commit()
    return to_out(campaign)


@router.get("/{campaign_id}/progress", response_model=CampaignProgress)
def progress(campaign_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(admin_only)):
    """Скільки людей пройшли анкети. Лише кількість, без імен.

    Для хвилі за посиланнями: «видано» і «використано» посилань. Для груп, менших за поріг хвилі,
    кількості не показуються.
    """
    campaign = get_or_404(db, campaign_id)
    units = subtree_ids(db, campaign.unit_id)
    token_rows = token_service.load(db, campaign.id) if campaign.access_mode == AccessMode.TOKEN else []
    qr_links = token_service.load_qr_links(db, campaign.id) if campaign.access_mode == AccessMode.TOKEN else []
    users = []
    participants = None
    frozen = frozen_of(db, campaign)
    if campaign.access_mode == AccessMode.LOGIN and frozen is None:
        users = db.scalars(select(User).where(User.role == Role.RESPONDENT, User.is_active.is_(True))).all()
        participants = participants_of(db, campaign)

    items = []
    for link in campaign.questionnaire_links:
        questionnaire = link.questionnaire
        if questionnaire.kind == QuestionnaireKind.CHECKLIST:
            continue  # стан чек-листа: GET /campaigns/{id}/checklist
        if campaign.access_mode == AccessMode.TOKEN:
            eligible, submitted = token_service.counts(token_rows, questionnaire.id, qr_links=qr_links)
        else:
            eligible = (len(frozen.get(questionnaire.id, {})) if frozen is not None
                        else sum(1 for u in users if is_eligible(u, questionnaire, units, participants)))
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
                over_expected=visible and submitted > eligible,
            )
        )
    return CampaignProgress(campaign_id=campaign.id, status=campaign.status, items=items)


# ---------- Явний склад учасників ----------

def participant_out(user: User, campaign: Campaign, units: set[uuid.UUID]) -> ParticipantOut:
    return ParticipantOut(
        id=user.id, login=user.login, display_name=user.display_name, category=user.category, unit_id=user.unit_id,
        eligible=any(is_eligible(user, link.questionnaire, units)
                     for link in campaign.questionnaire_links if link.questionnaire.kind != QuestionnaireKind.CHECKLIST),
    )


def participants_response(db: Session, campaign: Campaign) -> ParticipantsOut:
    ids = participants_of(db, campaign) or set()
    users = db.scalars(select(User).where(User.id.in_(ids)).order_by(User.login)).all() if ids else []
    units = subtree_ids(db, campaign.unit_id)
    return ParticipantsOut(campaign_id=campaign.id, explicit=campaign.explicit_participants,
                           participants=[participant_out(u, campaign, units) for u in users])


class CampaignPersonOut(BaseModel):
    id: uuid.UUID
    login: str
    display_name: str
    role: Role
    category: str | None
    unit_id: uuid.UUID | None


@router.get("/{campaign_id}/people", response_model=list[CampaignPersonOut])
def campaign_people(campaign_id: uuid.UUID, role: Role | None = None, category: str | None = None,
                    db: Session = Depends(get_db), _: User = Depends(admin_only)):
    """З кого уповноважений обирає для цієї хвилі: учасників (PUT .../participants), відповідальних за пункти
    чек-листа (PUT .../checklist/assignments), власників частин ключа урни.

    Лише активні облікові записи підрозділу хвилі та його піддерева (і без підрозділу: експерти, аудит).
    Повного довідника людей уповноважений не бачить: його веде технічний адміністратор.
    """
    campaign = get_or_404(db, campaign_id)
    units = subtree_ids(db, campaign.unit_id)
    query = select(User).where(User.is_active.is_(True), or_(User.unit_id.in_(units), User.unit_id.is_(None)),
                               User.role.notin_([Role.COORDINATOR, Role.DEPARTMENT])).order_by(User.login)
    if role is not None:
        query = query.where(User.role == role)
    if category is not None:
        query = query.where(User.category == category)
    return [CampaignPersonOut.model_validate(u, from_attributes=True) for u in db.scalars(query)]


@router.get("/{campaign_id}/participants", response_model=ParticipantsOut)
def get_participants(campaign_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(admin_only)):
    """Кого запрошено. Хто вже пройшов, не показується нікому."""
    return participants_response(db, get_or_404(db, campaign_id))


def login_campaign_for_participants(db: Session, campaign_id: uuid.UUID, allow_open: bool) -> Campaign:
    campaign = get_or_404(db, campaign_id)
    if campaign.access_mode != AccessMode.LOGIN:
        raise ApiError(409, "У хвилі за посиланнями учасників не ведуть", code="token_mode",
                       hint="Видайте одноразові посилання чи QR або імпортуйте учасників з CSV.")
    allowed = (CampaignStatus.DRAFT, CampaignStatus.OPEN) if allow_open else (CampaignStatus.DRAFT,)
    if campaign.status not in allowed:
        raise ApiError(409, "Склад учасників цієї хвилі вже не змінюється", code="not_editable")
    return campaign


@router.put("/{campaign_id}/participants", response_model=ParticipantsOut)
def set_participants(campaign_id: uuid.UUID, data: ParticipantsIn, db: Session = Depends(get_db),
                     admin: User = Depends(admin_only)):
    """Задати явний склад учасників (лише чернетка). Після цього проходять тільки вони."""
    campaign = login_campaign_for_participants(db, campaign_id, allow_open=False)
    ids = set(data.user_ids)
    found = set(db.scalars(select(User.id).where(User.id.in_(ids), User.role == Role.RESPONDENT))) if ids else set()
    missing = ids - found
    if missing:
        raise ApiError(422, [{"path": str(i), "message": "Не респондент або не існує"} for i in sorted(missing, key=str)])
    db.execute(delete(CampaignParticipant).where(CampaignParticipant.campaign_id == campaign.id))
    db.add_all(CampaignParticipant(campaign_id=campaign.id, user_id=i) for i in ids)
    campaign.explicit_participants = True
    db.flush()
    refreeze(db, campaign)
    log_action(db, admin, "set_participants", "campaign", campaign.id, {"count": len(ids)})
    db.commit()
    return participants_response(db, campaign)


@router.delete("/{campaign_id}/participants", response_model=ParticipantsOut)
def clear_participants(campaign_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    """Повернутися до складу «усі респонденти потрібної категорії в підрозділі хвилі» (лише чернетка)."""
    campaign = login_campaign_for_participants(db, campaign_id, allow_open=False)
    db.execute(delete(CampaignParticipant).where(CampaignParticipant.campaign_id == campaign.id))
    campaign.explicit_participants = False
    db.flush()
    refreeze(db, campaign)
    log_action(db, admin, "clear_participants", "campaign", campaign.id, {})
    db.commit()
    return participants_response(db, campaign)


# ---------- Імпорт CSV псевдонімів ----------

IMPORT_MAX_ROWS = 2000
IMPORT_MAX_BYTES = 1024 * 1024
# Стовпці, яких у файлі бути не повинно: система працює лише з псевдонімами.
PERSONAL_COLUMNS = {"email", "e-mail", "mail", "phone", "телефон", "піб", "фио", "full_name", "fullname", "surname",
                    "last_name", "first_name", "прізвище", "ім'я", "імя", "ipn", "інн", "рнокпп", "passport", "паспорт"}
LOGIN_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")


def read_csv(raw: bytes) -> list[dict[str, str]]:
    if len(raw) > IMPORT_MAX_BYTES:
        raise ApiError(413, "Файл завеликий", hint="Максимум 1 МБ і 2000 рядків.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ApiError(422, "Файл має бути в кодуванні UTF-8", code="bad_encoding",
                       hint="Збережіть CSV як «CSV UTF-8».")
    try:
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    header = [(h or "").strip().lower() for h in (reader.fieldnames or [])]
    personal = sorted(PERSONAL_COLUMNS & set(header))
    if personal:
        raise ApiError(422, "Файл містить стовпці з персональними даними: " + ", ".join(personal),
                       code="personal_data", hint="Залиште лише псевдонім, категорію й підрозділ.")
    if "login" not in header and "pseudonym" not in header:
        raise ApiError(422, "Немає стовпця login (або pseudonym)", code="bad_header",
                       hint="Перший рядок: login,category,unit[,display_name].")
    rows = []
    for row in reader:
        rows.append({(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if k})
        if len(rows) > IMPORT_MAX_ROWS:
            raise ApiError(413, f"Більше {IMPORT_MAX_ROWS} рядків", hint="Розбийте файл на частини.")
    return rows


def resolve_unit(value: str, units_by_name: dict[str, Unit], units_by_id: dict[str, Unit]) -> Unit | None:
    return units_by_id.get(value) or units_by_name.get(value)


@router.post("/{campaign_id}/participants/import", response_model=ImportOut,
             responses={200: {"content": {"text/csv": {}}}})
def import_participants(
    campaign_id: uuid.UUID,
    file: UploadFile = File(..., description="CSV UTF-8: login,category,unit[,display_name]"),
    format: str = Query(default="json", pattern="^(json|csv)$",
                        description="csv: для хвилі за посиланнями віддати таблицю псевдонім → посилання"),
    db: Session = Depends(get_db),
    admin: User = Depends(admin_only),
):
    """Імпорт псевдонімів з CSV (`login,category,unit[,display_name]`; роздільник «,» або «;»).

    - Хвиля за обліковими записами: додає наявних респондентів до явного складу учасників. Можна в чернетці
      й у відкритій хвилі (лише додавання). Нових облікових записів уповноважений не створює: людей заводить
      технічний адміністратор (POST /admin/users або POST /admin/users/import).
    - Хвиля за посиланнями: видає кожному рядку по посиланню на кожну анкету його категорії.
      Псевдоніми не зберігаються: зв'язок «псевдонім → посилання» є лише у файлі, який отримує адміністратор.

    Усе або нічого: якщо хоч один рядок з помилкою, нічого не змінюється (422 з номерами рядків).
    """
    campaign = get_or_404(db, campaign_id)
    if campaign.status not in (CampaignStatus.DRAFT, CampaignStatus.OPEN):
        raise ApiError(409, "Хвилю закрито", code="not_editable")
    rows = read_csv(file.file.read(IMPORT_MAX_BYTES + 1))
    if not rows:
        raise ApiError(422, "У файлі немає рядків", code="empty_file")

    all_units = db.scalars(select(Unit)).all()
    units_by_name = {u.name: u for u in all_units}
    units_by_id = {str(u.id): u for u in all_units}
    campaign_units = subtree_ids(db, campaign.unit_id)
    surveys = [link.questionnaire for link in campaign.questionnaire_links
               if link.questionnaire.kind != QuestionnaireKind.CHECKLIST]

    issues: list[dict] = []
    parsed = []
    seen = set()
    for n, row in enumerate(rows, start=2):  # рядок 1 — заголовок
        login = row.get("login") or row.get("pseudonym") or ""
        if not (3 <= len(login) <= 64) or not set(login) <= LOGIN_CHARS:
            issues.append({"path": f"line {n}", "message": "login: 3–64 символи, латиниця, цифри, _ . -"})
            continue
        if login.lower() in seen:
            issues.append({"path": f"line {n}", "message": f"{login}: повторюється у файлі"})
            continue
        seen.add(login.lower())
        category = None
        if row.get("category"):
            category = row["category"]
            if not categories.exists(db, category):
                issues.append({"path": f"line {n}", "message": f"category «{category}» немає в довіднику категорій"})
                continue
        unit = resolve_unit(row.get("unit", ""), units_by_name, units_by_id) if row.get("unit") else None
        if row.get("unit") and unit is None:
            issues.append({"path": f"line {n}", "message": f"Підрозділ «{row['unit']}» не знайдено"})
            continue
        if unit is not None and unit.id not in campaign_units:
            issues.append({"path": f"line {n}", "message": f"Підрозділ «{unit.name}» не входить у хвилю"})
            continue
        parsed.append((n, login, category, unit, (row.get("display_name") or login)[:100]))

    if campaign.access_mode == AccessMode.TOKEN:
        return import_as_tokens(db, campaign, admin, parsed, issues, surveys, format)

    created, credentials, added = 0, [], 0
    existing_ids = participants_of(db, campaign) or set()
    to_add: list[uuid.UUID] = []
    for n, login, category, unit, display_name in parsed:
        user = db.scalar(select(User).where(User.login == login))
        if user is None:
            issues.append({"path": f"line {n}", "message": f"{login}: обліковий запис не знайдено; "
                           "людей заводить технічний адміністратор"})
        elif user.role != Role.RESPONDENT:
            issues.append({"path": f"line {n}", "message": f"{login}: обліковий запис не респондента"})
        elif category and user.category != category:
            issues.append({"path": f"line {n}", "message": f"{login}: у системі інша категорія ({user.category})"})
        elif unit and user.unit_id != unit.id:
            issues.append({"path": f"line {n}", "message": f"{login}: у системі інший підрозділ"})
        elif user.id not in existing_ids:
            to_add.append(user.id)
    if issues:
        raise ApiError(422, issues, code="import_failed", hint="Виправте рядки й завантажте файл ще раз. Нічого не змінено.")
    pending = None
    if campaign.status == CampaignStatus.DRAFT or campaign.explicit_participants:
        db.add_all(CampaignParticipant(campaign_id=campaign.id, user_id=i) for i in dict.fromkeys(to_add))
        added = len(set(to_add))
        campaign.explicit_participants = True
    if campaign.eligible_frozen:
        # Склад зафіксовано (з моменту створення хвилі), тож нових людей додаємо до нього явно.
        db.flush()
        if campaign.explicit_participants and campaign.status == CampaignStatus.DRAFT:
            refreeze(db, campaign)
        else:
            freeze(db, campaign, list(db.scalars(select(User).where(User.id.in_(set(to_add))))) if to_add else [])
    log_action(db, admin, "import_participants", "campaign", campaign.id,
               {"rows": len(rows), "created_users": created, "added": added})
    db.commit()
    result = ImportOut(campaign_id=campaign.id, rows=len(rows), created_users=created, added_participants=added,
                       credentials=credentials, pending_approval_id=pending.id if pending else None)
    if format == "csv":
        out = io.StringIO()
        w = SafeCsvWriter(csv.writer(out))
        w.writerow(["login", "password", "invite_link"])
        for c in credentials:
            w.writerow([c.login, c.password, c.invite_link or ""])
        return csv_attachment(out.getvalue(), f"credentials-{campaign.id}.csv")
    return result


def csv_attachment(text: str, filename: str) -> PlainTextResponse:
    return PlainTextResponse(
        "\ufeff" + text, media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


def import_as_tokens(db: Session, campaign: Campaign, admin: User, parsed, issues, surveys, format):
    plan: list[tuple[str, Questionnaire, Unit | None]] = []
    for n, login, category, unit, _ in parsed:
        if category is None:
            issues.append({"path": f"line {n}", "message": f"{login}: потрібна category"})
            continue
        targets = [q for q in surveys if q.target_category == category]
        if not targets:
            issues.append({"path": f"line {n}", "message": f"{login}: у хвилі немає анкети для категорії {category}"})
            continue
        if category != RespondentCategory.EXPERT and unit is None:
            issues.append({"path": f"line {n}", "message": f"{login}: потрібен unit"})
            continue
        for q in targets:
            plan.append((login, q, None if category == RespondentCategory.EXPERT else unit))
    if issues:
        raise ApiError(422, issues, code="import_failed", hint="Виправте рядки й завантажте файл ще раз. Нічого не змінено.")

    issued = []
    for login, q, unit in plan:
        token = token_service.issue(db, campaign, q.id, unit.id if unit else None, 1)[0]
        issued.append((login, q.title, unit.name if unit else "", token_link(token)))
    log_action(db, admin, "import_tokens", "campaign", campaign.id, {"rows": len(parsed), "tokens": len(issued)})
    db.commit()
    if format == "csv":
        out = io.StringIO()
        w = SafeCsvWriter(csv.writer(out))
        w.writerow(["login", "questionnaire", "unit", "link"])
        w.writerows(issued)
        return csv_attachment(out.getvalue(), f"links-{campaign.id}.csv")
    return ImportOut(campaign_id=campaign.id, rows=len(parsed), created_users=0, added_participants=0,
                     issued_tokens=len(issued))


# ---------- Одноразові посилання ----------

def token_link(token: str) -> str:
    return f"{get_settings().public_url.rstrip('/')}/s/{token}"


def token_target(db: Session, campaign: Campaign, questionnaire_id: uuid.UUID,
                 unit_id: uuid.UUID | None) -> tuple[Questionnaire, uuid.UUID | None]:
    """Перевірки спільні для видачі посилань і QR: режим хвилі, анкета, підрозділ."""
    if campaign.access_mode != AccessMode.TOKEN:
        raise ApiError(409, "Хвиля проходиться за обліковими записами", code="login_mode",
                       hint="Створіть хвилю з access_mode = token або змініть чернетку.")
    if campaign.status not in (CampaignStatus.DRAFT, CampaignStatus.OPEN):
        raise ApiError(409, "Хвилю закрито", code="not_editable")
    link = db.get(CampaignQuestionnaire, (campaign.id, questionnaire_id))
    if link is None or link.questionnaire.kind == QuestionnaireKind.CHECKLIST:
        raise HTTPException(status_code=422, detail="Анкета не входить у хвилю або це чек-лист")
    questionnaire = link.questionnaire
    if questionnaire.target_category == RespondentCategory.EXPERT:
        return questionnaire, None  # експерти зовнішні: їхні відповіді рахуються лише на рівні всієї хвилі
    if unit_id is None:
        raise HTTPException(status_code=422, detail="Для цієї анкети потрібен підрозділ (unit_id)")
    if unit_id not in subtree_ids(db, campaign.unit_id):
        raise HTTPException(status_code=422, detail="Підрозділ не входить у хвилю")
    return questionnaire, unit_id


@router.post("/{campaign_id}/tokens", response_model=TokensOut, status_code=status.HTTP_201_CREATED,
             responses={201: {"content": {"text/csv": {}}}})
def issue_tokens(campaign_id: uuid.UUID, data: TokensIn,
                 format: str = Query(default="json", pattern="^(json|csv)$"),
                 db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    """Видати одноразові посилання на анкету для групи (підрозділ + категорія анкети).

    Токени показуються лише у цій відповіді; у БД — тільки їхні sha256. Кому яке посилання дісталося,
    система не знає. Посилання відкриває анкету без входу; токен фронтенд передає в X-Response-Token.
    """
    campaign = get_or_404(db, campaign_id)
    questionnaire, unit_id = token_target(db, campaign, data.questionnaire_id, data.unit_id)
    if data.count > get_settings().token_batch_max:
        raise HTTPException(status_code=422, detail=f"Не більше {get_settings().token_batch_max} за раз")

    plain = token_service.issue(db, campaign, questionnaire.id, unit_id, data.count)
    db.flush()
    rows = token_service.load(db, campaign.id)
    total, _ = token_service.counts(rows, questionnaire.id, lambda u: u == unit_id)
    warning = None
    if total < campaign.min_group_size:
        warning = (f"У групі {total} посилань, менше за k = {campaign.min_group_size}: "
                   "результати цього підрозділу будуть приховані й увійдуть лише в батьківський.")
    log_action(db, admin, "issue_tokens", "campaign", campaign.id,
               {"questionnaire_id": str(questionnaire.id), "unit_id": str(unit_id) if unit_id else None,
                "count": data.count})
    db.commit()
    if format == "csv":
        out = io.StringIO()
        w = SafeCsvWriter(csv.writer(out))
        w.writerow(["link"])
        w.writerows([token_link(t)] for t in plain)
        return csv_attachment(out.getvalue(), f"links-{campaign.id}.csv")
    return TokensOut(campaign_id=campaign.id, questionnaire_id=questionnaire.id, unit_id=unit_id,
                     tokens=[IssuedToken(token=t, link=token_link(t)) for t in plain], group_total=total,
                     warning=warning)


@router.post("/{campaign_id}/tokens/revoke", response_model=TokensRevokeOut)
def revoke_tokens(campaign_id: uuid.UUID, data: TokensRevokeIn, db: Session = Depends(get_db),
                  admin: User = Depends(admin_only)):
    """Відкликати невикористані посилання (усі, анкети або анкети + підрозділу), наприклад якщо список злили."""
    campaign = get_or_404(db, campaign_id)
    revoked = 0
    questionnaire_ids = [data.questionnaire_id] if data.questionnaire_id else [
        link.questionnaire_id for link in campaign.questionnaire_links]
    for q_id in questionnaire_ids:
        if "unit_id" in data.model_fields_set:  # unit_id: null — посилання експертів
            revoked += token_service.revoke_unused(db, campaign.id, q_id, data.unit_id)
        else:
            revoked += token_service.revoke_unused_all_units(db, campaign.id, q_id)
    log_action(db, admin, "revoke_tokens", "campaign", campaign.id,
               {"questionnaire_id": str(data.questionnaire_id) if data.questionnaire_id else None,
                "unit_id": str(data.unit_id) if data.unit_id else None, "revoked": revoked})
    db.commit()
    return TokensRevokeOut(revoked=revoked)


# ---------- QR для зали ----------

def qr_out(db: Session, link: QrLink) -> QrLinkOut:
    opened, completed = token_service.qr_stats(db, link.id)
    questionnaire = db.get(Questionnaire, link.questionnaire_id)
    return QrLinkOut(id=link.id, questionnaire_id=link.questionnaire_id, questionnaire_title=questionnaire.title,
                     unit_id=link.unit_id, expected=link.expected, code=link.code, link=qr_link(link.code),
                     revoked=link.revoked, opened=opened, completed=completed,
                     over_expected=completed > link.expected,
                     scan_limit_reached=opened >= link.expected * token_service.QR_OPEN_FACTOR)


def qr_link(code: str) -> str:
    return f"{get_settings().public_url.rstrip('/')}/q/{code}"


@router.post("/{campaign_id}/qr-links", response_model=QrLinkOut, status_code=status.HTTP_201_CREATED)
def create_qr_link(campaign_id: uuid.UUID, data: QrLinkIn, db: Session = Depends(get_db),
                   admin: User = Depends(admin_only)):
    """Одне посилання (QR) на анкету для групи: кожне відкриття дає свіжу одноразову форму.

    Завершена форма — одна відповідь; покинута нічого не рахує. Участь рахується від expected,
    а відповіді понад expected видно в /progress як ознаку накрутки. Відкрити форм можна не більше
    ніж у 3 рази більше за expected.
    """
    campaign = get_or_404(db, campaign_id)
    questionnaire, unit_id = token_target(db, campaign, data.questionnaire_id, data.unit_id)
    link = token_service.issue_qr_link(db, campaign, questionnaire.id, unit_id, data.expected)
    log_action(db, admin, "create_qr_link", "campaign", campaign.id,
               {"questionnaire_id": str(questionnaire.id), "unit_id": str(unit_id) if unit_id else None,
                "expected": data.expected})
    db.commit()
    return qr_out(db, link)


@router.get("/{campaign_id}/qr-links", response_model=list[QrLinkOut])
def list_qr_links(campaign_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(admin_only)):
    campaign = get_or_404(db, campaign_id)
    return [qr_out(db, link) for link in token_service.load_qr_links(db, campaign.id)]


@router.post("/{campaign_id}/qr-links/{qr_id}/revoke", response_model=QrLinkOut)
def revoke_qr_link(campaign_id: uuid.UUID, qr_id: uuid.UUID, db: Session = Depends(get_db),
                   admin: User = Depends(admin_only)):
    """Зупинити нові скани. Вже відкриті форми можна дописати; очікувана кількість лишається в участі."""
    campaign = get_or_404(db, campaign_id)
    link = db.get(QrLink, qr_id)
    if link is None or link.campaign_id != campaign.id:
        raise HTTPException(status_code=404, detail="QR-посилання не знайдено")
    link.revoked = True
    log_action(db, admin, "revoke_qr_link", "campaign", campaign.id, {"qr_link_id": str(link.id)})
    db.commit()
    return qr_out(db, link)
