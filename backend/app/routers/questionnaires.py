"""Конструктор анкет. Змінює анкети лише commissioner.

Адмін сюди навмисно не допускається: хто складає анкети, той не запускає хвилі,
і навпаки (розподіл обов'язків)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.models import (
    CampaignQuestionnaire,
    Questionnaire,
    QuestionnaireKind,
    QuestionnaireStatus,
    RespondentCategory,
    Role,
    User,
)
from app.schemas import (
    QuestionnaireCreate,
    QuestionnaireMetaUpdate,
    QuestionnaireOut,
    QuestionnaireSummary,
    StructureIn,
    ValidationIssue,
)
from app.security import require_roles
from app.services import questionnaires as service

router = APIRouter(prefix="/questionnaires", tags=["questionnaires"])
commissioner_only = require_roles(Role.COMMISSIONER)
# Адмін бачить лише опубліковані анкети, щоб обрати їх для хвилі. Змінювати не може.
can_read = require_roles(Role.COMMISSIONER, Role.ADMIN)


def get_or_404(db: Session, questionnaire_id: uuid.UUID) -> Questionnaire:
    questionnaire = db.get(Questionnaire, questionnaire_id)
    if questionnaire is None:
        raise HTTPException(status_code=404, detail="Анкету не знайдено")
    return questionnaire


def require_draft(questionnaire: Questionnaire) -> None:
    if questionnaire.status != QuestionnaireStatus.DRAFT:
        raise HTTPException(
            status_code=409,
            detail="Опубліковану анкету змінювати не можна. Створіть нову версію.",
        )


@router.get("", response_model=list[QuestionnaireSummary])
def list_questionnaires(
    status_filter: QuestionnaireStatus | None = Query(default=None, alias="status"),
    kind: QuestionnaireKind | None = None,
    target_category: RespondentCategory | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(can_read),
):
    query = select(Questionnaire).order_by(Questionnaire.code, Questionnaire.version.desc())
    if user.role == Role.ADMIN:
        query = query.where(Questionnaire.status == QuestionnaireStatus.PUBLISHED)
    if status_filter:
        query = query.where(Questionnaire.status == status_filter)
    if kind:
        query = query.where(Questionnaire.kind == kind)
    if target_category:
        query = query.where(Questionnaire.target_category == target_category)
    return db.scalars(query).all()


@router.post("", response_model=QuestionnaireOut, status_code=status.HTTP_201_CREATED)
def create_questionnaire(data: QuestionnaireCreate, db: Session = Depends(get_db), user: User = Depends(commissioner_only)):
    if db.scalar(select(Questionnaire.id).where(Questionnaire.code == data.code)):
        raise HTTPException(status_code=409, detail="Анкета з таким кодом уже існує. Створіть нову версію.")
    questionnaire = Questionnaire(
        code=data.code,
        version=1,
        title=data.title,
        description=data.description,
        kind=data.kind,
        target_category=data.target_category,
        created_by_id=user.id,
        sections=service.build_sections(data.sections),
    )
    db.add(questionnaire)
    db.flush()
    log_action(db, user, "create", "questionnaire", questionnaire.id, {"code": data.code})
    db.commit()
    return questionnaire


@router.get("/{questionnaire_id}", response_model=QuestionnaireOut)
def get_questionnaire(questionnaire_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(can_read)):
    questionnaire = get_or_404(db, questionnaire_id)
    if user.role == Role.ADMIN and questionnaire.status != QuestionnaireStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Анкету не знайдено")
    return questionnaire


@router.patch("/{questionnaire_id}", response_model=QuestionnaireOut)
def update_meta(
    questionnaire_id: uuid.UUID,
    data: QuestionnaireMetaUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(commissioner_only),
):
    questionnaire = get_or_404(db, questionnaire_id)
    require_draft(questionnaire)
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(questionnaire, field, value)
    log_action(db, user, "update_meta", "questionnaire", questionnaire.id, {"fields": sorted(changes)})
    db.commit()
    return questionnaire


@router.put("/{questionnaire_id}/structure", response_model=QuestionnaireOut)
def replace_structure(
    questionnaire_id: uuid.UUID,
    data: StructureIn,
    db: Session = Depends(get_db),
    user: User = Depends(commissioner_only),
):
    questionnaire = get_or_404(db, questionnaire_id)
    require_draft(questionnaire)
    service.replace_structure(db, questionnaire, data.sections)
    questions = sum(len(s.questions) for s in data.sections)
    log_action(
        db, user, "update_structure", "questionnaire", questionnaire.id,
        {"sections": len(data.sections), "questions": questions},
    )
    db.commit()
    db.refresh(questionnaire)
    return questionnaire


@router.get("/{questionnaire_id}/validate", response_model=list[ValidationIssue])
def validate(questionnaire_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(commissioner_only)):
    """Попередня перевірка: що завадить публікації. Порожній список означає, що все гаразд."""
    return service.validate_for_publish(get_or_404(db, questionnaire_id))


@router.post("/{questionnaire_id}/publish", response_model=QuestionnaireOut)
def publish(questionnaire_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(commissioner_only)):
    questionnaire = get_or_404(db, questionnaire_id)
    require_draft(questionnaire)
    issues = service.validate_for_publish(questionnaire)
    if issues:
        raise HTTPException(status_code=422, detail=[i.model_dump() for i in issues])
    service.publish(questionnaire)
    log_action(db, user, "publish", "questionnaire", questionnaire.id, {"version": questionnaire.version})
    db.commit()
    return questionnaire


@router.post("/{questionnaire_id}/new-version", response_model=QuestionnaireOut, status_code=status.HTTP_201_CREATED)
def new_version(questionnaire_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(commissioner_only)):
    source = get_or_404(db, questionnaire_id)
    if source.status == QuestionnaireStatus.DRAFT:
        raise HTTPException(status_code=409, detail="Це вже чернетка, редагуйте її напряму")
    copy = service.create_new_version(db, source)
    copy.created_by_id = user.id
    db.flush()
    log_action(db, user, "new_version", "questionnaire", copy.id, {"from": str(source.id), "version": copy.version})
    db.commit()
    return copy


@router.post("/{questionnaire_id}/archive", response_model=QuestionnaireOut)
def archive(questionnaire_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(commissioner_only)):
    questionnaire = get_or_404(db, questionnaire_id)
    if questionnaire.status != QuestionnaireStatus.PUBLISHED:
        raise HTTPException(status_code=409, detail="Архівувати можна лише опубліковану анкету")
    questionnaire.status = QuestionnaireStatus.ARCHIVED
    log_action(db, user, "archive", "questionnaire", questionnaire.id)
    db.commit()
    return questionnaire


@router.delete("/{questionnaire_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(questionnaire_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(commissioner_only)):
    questionnaire = get_or_404(db, questionnaire_id)
    require_draft(questionnaire)
    in_use = db.scalar(
        select(CampaignQuestionnaire.campaign_id).where(CampaignQuestionnaire.questionnaire_id == questionnaire.id)
    )
    if in_use:
        raise HTTPException(status_code=409, detail="Анкета вже прив'язана до хвилі")
    log_action(db, user, "delete", "questionnaire", questionnaire.id, {"code": questionnaire.code})
    db.delete(questionnaire)
    db.commit()
