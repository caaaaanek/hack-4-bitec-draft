"""Контрольний чек-лист (додаток Б): інституційна оцінка.

Член робочої групи вносить статус пункту і доказ, підтверджує уповноважений (commissioner) або
внутрішній аудит (CHECKLIST_CONFIRMERS). Вносить і підтверджує завжди різні люди.

Відповідальні за пункт (ChecklistAssignment): адміністратор чи уповноважений призначає, хто з робочої
групи вносить конкретний пункт і хто його підтверджує. Тоді вносить лише призначений, а підтверджує
лише призначений підтверджувач, і це не та сама людина.
Це не анонімна анкета: оцінюється заклад, а не люди, тому видно, хто вніс і хто підтвердив.

Докази: текстовий опис (evidence) і/або файли (Evidence Repository, services/evidence.py).
Додавання чи видалення файлу, як і зміна статусу, знімає підтвердження: підтверджується
конкретний набір доказів.
"""

import uuid
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import (
    Campaign,
    CampaignStatus,
    ChecklistAssignment,
    ChecklistEntry,
    ChecklistStatus,
    EvidenceFile,
    Questionnaire,
    QuestionnaireKind,
    RespondentCategory,
    Role,
    User,
)
from app.security import get_current_user, require_roles
from app.services import evidence as storage
from app.services import methodology as m
from app.services.units import subtree_ids

router = APIRouter(prefix="/campaigns/{campaign_id}/checklist", tags=["checklist"])


class EntryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ChecklistStatus
    evidence: str = Field(default="", max_length=2000)
    comment: str = Field(default="", max_length=2000)


class EvidenceFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    content_type: str
    size: int
    sha256: str
    uploaded_at: datetime


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
    files: list[EvidenceFileOut] = []
    # Призначені відповідальні (якщо є): хто вносить і хто підтверджує саме цей пункт.
    enterer_id: uuid.UUID | None = None
    confirmer_id: uuid.UUID | None = None


class ChecklistOut(BaseModel):
    campaign_id: uuid.UUID
    questionnaire_id: uuid.UUID
    total: int
    filled: int
    confirmed: int
    items: list[ChecklistItemOut]


def is_working_group(user: User) -> bool:
    return user.role == Role.RESPONDENT and user.category == RespondentCategory.WORKING_GROUP and user.is_active


def wg_of_campaign(db: Session, user: User, campaign: Campaign) -> bool:
    """Член робочої групи цієї хвилі: його підрозділ входить у підрозділ хвилі."""
    return is_working_group(user) and user.unit_id is not None and user.unit_id in subtree_ids(db, campaign.unit_id)


def ensure_view(db: Session, user: User, campaign: Campaign) -> None:
    # Аудитор лише читає: бачить пункти й завантажує докази. Робоча група — лише чек-лист своєї хвилі.
    if user.role in (Role.ADMIN, Role.COMMISSIONER, Role.AUDITOR) or wg_of_campaign(db, user, campaign):
        return
    raise HTTPException(status_code=403, detail="Недостатньо прав")


def item_score(entry: ChecklistEntry | None) -> float | None:
    if entry is None:
        return None
    if entry.status == ChecklistStatus.FULL and entry.confirmed_by_id is None:
        return m.UNCONFIRMED_FULL_SCORE
    return m.CHECKLIST_STATUS_SCORES[entry.status.value]


def to_item(question, entry: ChecklistEntry | None, files: list[EvidenceFile] | None = None,
            assignment: ChecklistAssignment | None = None) -> ChecklistItemOut:
    number = m.checklist_item_number(question.code) or question.code
    return ChecklistItemOut(
        question_id=question.id,
        code=question.code,
        number=number,
        component=m.item_component(question.code, question.section.component if question.section else None),
        text=question.text,
        indicator=question.help_text,
        status=entry.status if entry else None,
        evidence=entry.evidence if entry else "",
        comment=entry.comment if entry else "",
        entered_at=entry.entered_at if entry else None,
        confirmed=bool(entry and entry.confirmed_by_id),
        confirmed_at=entry.confirmed_at if entry else None,
        score=item_score(entry),
        files=[EvidenceFileOut.model_validate(f) for f in files or []],
        enterer_id=assignment.enterer_id if assignment else None,
        confirmer_id=assignment.confirmer_id if assignment else None,
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


def files_of(db: Session, campaign_id, question_id=None) -> list[EvidenceFile]:
    query = select(EvidenceFile).where(EvidenceFile.campaign_id == campaign_id, EvidenceFile.deleted_at.is_(None))
    if question_id is not None:
        query = query.where(EvidenceFile.question_id == question_id)
    return list(db.scalars(query.order_by(EvidenceFile.uploaded_at)))


def entry_of(db: Session, campaign_id, question_id) -> ChecklistEntry | None:
    return db.scalar(
        select(ChecklistEntry).where(ChecklistEntry.campaign_id == campaign_id, ChecklistEntry.question_id == question_id)
    )


@router.get("", response_model=ChecklistOut)
def get_checklist(campaign_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    campaign, questionnaire = checklist_of(db, campaign_id)
    ensure_view(db, user, campaign)
    entries = {
        e.question_id: e for e in db.scalars(select(ChecklistEntry).where(ChecklistEntry.campaign_id == campaign.id))
    }
    files: dict[uuid.UUID, list[EvidenceFile]] = {}
    for f in files_of(db, campaign.id):
        files.setdefault(f.question_id, []).append(f)
    assigned = assignments_of(db, campaign.id)
    items = [to_item(q, entries.get(q.id), files.get(q.id), assigned.get(q.id))
             for section in questionnaire.sections for q in section.questions]
    return ChecklistOut(
        campaign_id=campaign.id,
        questionnaire_id=questionnaire.id,
        total=len(items),
        filled=sum(1 for i in items if i.status is not None),
        confirmed=sum(1 for i in items if i.confirmed),
        items=items,
    )


def assignments_of(db: Session, campaign_id) -> dict[uuid.UUID, ChecklistAssignment]:
    return {a.question_id: a for a in db.scalars(
        select(ChecklistAssignment).where(ChecklistAssignment.campaign_id == campaign_id))}


def confirmer_roles() -> tuple[Role, ...]:
    """Хто може підтверджувати пункти: CHECKLIST_CONFIRMERS (за замовчуванням уповноважений і внутрішній аудит)."""
    roles = []
    for name in get_settings().checklist_confirmers.split(","):
        try:
            roles.append(Role(name.strip()))
        except ValueError:
            continue
    return tuple(r for r in roles if r in (Role.COMMISSIONER, Role.AUDITOR, Role.ADMIN)) or (Role.COMMISSIONER,)


def require_confirmer(user: User = Depends(get_current_user)) -> User:
    if user.role not in confirmer_roles():
        raise HTTPException(status_code=403, detail="Недостатньо прав")
    return user


class AssignmentItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question_id: uuid.UUID
    enterer_id: uuid.UUID | None = Field(default=None, description="Член робочої групи хвилі, який вносить пункт")
    confirmer_id: uuid.UUID | None = Field(default=None, description="Хто підтверджує (CHECKLIST_CONFIRMERS)")


class AssignmentsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AssignmentItemIn] = Field(max_length=500)


class AssignmentOut(BaseModel):
    question_id: uuid.UUID
    code: str
    number: str
    enterer_id: uuid.UUID | None
    enterer: str | None
    confirmer_id: uuid.UUID | None
    confirmer: str | None


def assignments_response(db: Session, campaign: Campaign, questionnaire: Questionnaire) -> list[AssignmentOut]:
    assigned = assignments_of(db, campaign.id)
    names = {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_(
        {x for a in assigned.values() for x in (a.enterer_id, a.confirmer_id) if x})))} if assigned else {}
    out = []
    for section in questionnaire.sections:
        for q in section.questions:
            a = assigned.get(q.id)
            out.append(AssignmentOut(
                question_id=q.id, code=q.code, number=m.checklist_item_number(q.code) or q.code,
                enterer_id=a.enterer_id if a else None, enterer=names.get(a.enterer_id) if a else None,
                confirmer_id=a.confirmer_id if a else None, confirmer=names.get(a.confirmer_id) if a else None))
    return out


@router.get("/assignments", response_model=list[AssignmentOut])
def get_assignments(campaign_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Хто вносить і хто підтверджує кожен пункт. Пункт без призначення: вносить будь-хто з робочої групи
    хвилі, підтверджує будь-хто з CHECKLIST_CONFIRMERS (але не той, хто вніс)."""
    campaign, questionnaire = checklist_of(db, campaign_id)
    ensure_view(db, user, campaign)
    return assignments_response(db, campaign, questionnaire)


@router.put("/assignments", response_model=list[AssignmentOut])
def set_assignments(campaign_id: uuid.UUID, data: AssignmentsIn, db: Session = Depends(get_db),
                    user: User = Depends(require_roles(Role.ADMIN, Role.COMMISSIONER))):
    """Розподілити пункти чек-листа між членами робочої групи і підтверджувачами (чернетка або відкрита хвиля).

    Передані пункти замінюються; enterer_id і confirmer_id null — зняти призначення. Вносить і підтверджує
    завжди різні люди.
    """
    campaign, questionnaire = checklist_of(db, campaign_id)
    if campaign.status == CampaignStatus.CLOSED:
        raise ApiError(409, "Хвилю закрито", code="not_editable")
    questions = {q.id: q for s in questionnaire.sections for q in s.questions}
    allowed_confirmers = confirmer_roles()
    issues = []
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(
        {x for i in data.items for x in (i.enterer_id, i.confirmer_id) if x})))}
    for n, item in enumerate(data.items):
        path = f"items[{n}]"
        if item.question_id not in questions:
            issues.append({"path": path, "message": "Пункт не належить до чек-листа хвилі"})
            continue
        if item.enterer_id is not None:
            enterer = users.get(item.enterer_id)
            if enterer is None or not wg_of_campaign(db, enterer, campaign):
                issues.append({"path": path, "message": "Вносить лише активний член робочої групи цієї хвилі"})
        if item.confirmer_id is not None:
            confirmer = users.get(item.confirmer_id)
            if confirmer is None or not confirmer.is_active or confirmer.role not in allowed_confirmers:
                issues.append({"path": path, "message": "Підтверджувач має мати роль: "
                               + ", ".join(r.value for r in allowed_confirmers)})
        if item.enterer_id is not None and item.enterer_id == item.confirmer_id:
            issues.append({"path": path, "message": "Вносить і підтверджує не та сама людина"})
    if issues:
        raise ApiError(422, issues, code="invalid", hint="Нічого не змінено.")
    assigned = assignments_of(db, campaign.id)
    for item in data.items:
        row = assigned.get(item.question_id)
        if item.enterer_id is None and item.confirmer_id is None:
            if row is not None:
                db.delete(row)
            continue
        if row is None:
            row = ChecklistAssignment(campaign_id=campaign.id, question_id=item.question_id)
            db.add(row)
        row.enterer_id, row.confirmer_id, row.assigned_by_id = item.enterer_id, item.confirmer_id, user.id
        row.assigned_at = datetime.now(timezone.utc)
    log_action(db, user, "assign", "checklist", campaign.id,
               {"items": [{"code": questions[i.question_id].code,
                           "enterer_id": str(i.enterer_id) if i.enterer_id else None,
                           "confirmer_id": str(i.confirmer_id) if i.confirmer_id else None} for i in data.items]})
    db.commit()
    return assignments_response(db, campaign, questionnaire)


def check_assigned_enterer(db: Session, campaign_id, question_id, user: User) -> None:
    a = db.get(ChecklistAssignment, (campaign_id, question_id))
    if a is not None and a.enterer_id is not None and a.enterer_id != user.id:
        raise ApiError(403, "Цей пункт призначено іншому члену робочої групи", code="not_assigned",
                       hint="Відповідальних за пункти видно в GET /campaigns/{id}/checklist/assignments.")


def check_assigned_confirmer(db: Session, campaign_id, question_id, user: User) -> None:
    a = db.get(ChecklistAssignment, (campaign_id, question_id))
    if a is not None and a.confirmer_id is not None and a.confirmer_id != user.id:
        raise ApiError(403, "Підтвердження цього пункту призначено іншій людині", code="not_assigned",
                       hint="Відповідальних за пункти видно в GET /campaigns/{id}/checklist/assignments.")


@router.put("/{question_id}", response_model=ChecklistItemOut)
def set_entry(
    campaign_id: uuid.UUID,
    question_id: uuid.UUID,
    data: EntryIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Член робочої групи вносить або змінює статус пункту. Зміна знімає підтвердження."""
    campaign, questionnaire = checklist_of(db, campaign_id)
    if not wg_of_campaign(db, user, campaign):
        raise HTTPException(status_code=403, detail="Вносити чек-лист може лише член робочої групи цієї хвилі")
    if campaign.status != CampaignStatus.OPEN:
        raise HTTPException(status_code=409, detail="Хвиля не відкрита")
    question = find_question(questionnaire, question_id)
    check_assigned_enterer(db, campaign.id, question.id, user)

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
    return to_item(question, entry, files_of(db, campaign.id, question.id),
                   db.get(ChecklistAssignment, (campaign.id, question.id)))


@router.post("/{question_id}/confirm", response_model=ChecklistItemOut)
def confirm_entry(
    campaign_id: uuid.UUID,
    question_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_confirmer),
):
    """Підтвердити пункт можна лише за наявності доказу. Підтверджує не той, хто вніс."""
    campaign, questionnaire = checklist_of(db, campaign_id)
    if campaign.status != CampaignStatus.OPEN:
        raise HTTPException(status_code=409, detail="Хвиля не відкрита")
    question = find_question(questionnaire, question_id)
    check_assigned_confirmer(db, campaign.id, question.id, user)
    entry = entry_of(db, campaign.id, question.id)
    if entry is None:
        raise HTTPException(status_code=409, detail="Пункт ще не заповнено")
    files = files_of(db, campaign.id, question.id)
    if not entry.evidence and not files:
        raise HTTPException(status_code=422, detail="Без доказу пункт підтвердити не можна")
    if entry.entered_by_id == user.id:
        raise HTTPException(status_code=409, detail="Не можна підтверджувати власний запис")
    entry.confirmed_by_id = user.id
    entry.confirmed_at = datetime.now(timezone.utc)
    # У журнал — хеші файлів, які саме підтверджено.
    log_action(db, user, "confirm", "checklist_entry", entry.id,
               {"item": question.code, "files": [f.sha256 for f in files]})
    db.commit()
    return to_item(question, entry, files, db.get(ChecklistAssignment, (campaign.id, question.id)))


@router.delete("/{question_id}/confirm", response_model=ChecklistItemOut)
def revoke_confirmation(
    campaign_id: uuid.UUID,
    question_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_confirmer),
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
    return to_item(question, entry, files_of(db, campaign.id, question.id))


# ---------- Файли-докази ----------

def unconfirm(db: Session, campaign_id, question_id) -> bool:
    entry = entry_of(db, campaign_id, question_id)
    if entry is not None and entry.confirmed_by_id is not None:
        entry.confirmed_by_id = None
        entry.confirmed_at = None
        return True
    return False


def editable_item(db: Session, campaign_id: uuid.UUID, question_id: uuid.UUID, user: User):
    campaign, questionnaire = checklist_of(db, campaign_id)
    if not wg_of_campaign(db, user, campaign):
        raise HTTPException(status_code=403, detail="Додавати докази може лише член робочої групи цієї хвилі")
    if campaign.status != CampaignStatus.OPEN:
        raise HTTPException(status_code=409, detail="Хвиля не відкрита: докази закритої хвилі не змінюються")
    question = find_question(questionnaire, question_id)
    check_assigned_enterer(db, campaign.id, question.id, user)
    return campaign, question


@router.get("/{question_id}/files", response_model=list[EvidenceFileOut])
def list_files(campaign_id: uuid.UUID, question_id: uuid.UUID, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    campaign, questionnaire = checklist_of(db, campaign_id)
    ensure_view(db, user, campaign)
    find_question(questionnaire, question_id)
    return files_of(db, campaign.id, question_id)


@router.post("/{question_id}/files", response_model=EvidenceFileOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    campaign_id: uuid.UUID,
    question_id: uuid.UUID,
    file: UploadFile = File(..., description="PDF, зображення, документ Office/ODF, TXT або CSV"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Додати файл-доказ до пункту. Ліміти: GET /config → evidence. Знімає підтвердження пункту."""
    campaign, question = editable_item(db, campaign_id, question_id, user)
    count = db.scalar(select(func.count()).select_from(EvidenceFile).where(
        EvidenceFile.campaign_id == campaign.id, EvidenceFile.question_id == question.id,
        EvidenceFile.deleted_at.is_(None)))
    limit = get_settings().evidence_max_files_per_item
    if count >= limit:
        raise ApiError(409, f"До пункту вже додано {limit} файлів", code="too_many_files",
                       hint="Видаліть зайвий файл або об'єднайте документи.")
    filename, mime, sha, size = await storage.store(file)
    record = EvidenceFile(campaign_id=campaign.id, question_id=question.id, filename=filename, content_type=mime,
                          size=size, sha256=sha, uploaded_by_id=user.id)
    db.add(record)
    unconfirmed = unconfirm(db, campaign.id, question.id)
    db.flush()
    log_action(db, user, "upload", "evidence_file", record.id,
               {"item": question.code, "filename": filename, "sha256": sha, "size": size,
                "unconfirmed": unconfirmed})
    db.commit()
    return record


def file_or_404(db: Session, campaign_id, question_id, file_id) -> EvidenceFile:
    record = db.get(EvidenceFile, file_id)
    if (record is None or record.deleted_at is not None or record.campaign_id != campaign_id
            or record.question_id != question_id):
        raise HTTPException(status_code=404, detail="Файл не знайдено")
    return record


@router.get("/{question_id}/files/{file_id}", response_class=FileResponse,
            responses={200: {"content": {"application/octet-stream": {}}}})
def download_file(campaign_id: uuid.UUID, question_id: uuid.UUID, file_id: uuid.UUID,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Завантажити доказ. Перед віддачею вміст звіряється з sha256 із БД."""
    campaign, _ = checklist_of(db, campaign_id)
    ensure_view(db, user, campaign)
    record = file_or_404(db, campaign_id, question_id, file_id)
    if not storage.verify_on_disk(record.sha256):
        log_action(db, user, "integrity_fail", "evidence_file", record.id, {"sha256": record.sha256})
        db.commit()
        raise ApiError(409, "Вміст файлу на диску не збігається з зафіксованим хешем", code="evidence_tampered",
                       hint="Повідомте адміністратора: файл могли змінити поза системою.")
    log_action(db, user, "download", "evidence_file", record.id, {"sha256": record.sha256})
    db.commit()
    ascii_name = record.filename.encode("ascii", "replace").decode().replace("?", "_")
    return FileResponse(
        storage.path_for(record.sha256),
        media_type=record.content_type,
        headers={
            "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(record.filename)}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Cache-Control": "private, no-store",
            "X-Content-SHA256": record.sha256,
        },
    )


@router.delete("/{question_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_file(campaign_id: uuid.UUID, question_id: uuid.UUID, file_id: uuid.UUID,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """М'яке видалення: файл зникає з пункту, але лишається в сховищі й журналі. Знімає підтвердження."""
    campaign, question = editable_item(db, campaign_id, question_id, user)
    record = file_or_404(db, campaign.id, question.id, file_id)
    record.deleted_at = datetime.now(timezone.utc)
    record.deleted_by_id = user.id
    unconfirmed = unconfirm(db, campaign.id, question.id)
    log_action(db, user, "delete", "evidence_file", record.id,
               {"item": question.code, "sha256": record.sha256, "unconfirmed": unconfirmed})
    db.commit()
