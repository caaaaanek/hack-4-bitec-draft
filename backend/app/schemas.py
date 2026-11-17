import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.config import MIN_GROUP_SIZE_FLOOR
from app.models import (
    CampaignStatus,
    QuestionnaireKind,
    QuestionnaireStatus,
    QuestionType,
    RespondentCategory,
    Role,
)


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Авторизація ----------

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeOut(ORM):
    id: uuid.UUID
    login: str
    display_name: str
    role: Role
    category: RespondentCategory | None
    unit_id: uuid.UUID | None


# ---------- Адміністрування ----------

class UnitIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: uuid.UUID | None = None


class UnitOut(ORM):
    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None


class UserCreate(BaseModel):
    login: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    role: Role
    category: RespondentCategory | None = None
    unit_id: uuid.UUID | None = None


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: Role | None = None
    category: RespondentCategory | None = None
    unit_id: uuid.UUID | None = None
    is_active: bool | None = None


class UserOut(ORM):
    id: uuid.UUID
    login: str
    display_name: str
    role: Role
    category: RespondentCategory | None
    unit_id: uuid.UUID | None
    is_active: bool
    created_at: datetime


class AuditVerifyOut(BaseModel):
    ok: bool
    checked: int
    broken_seq: int | None
    reason: str | None
    head_hash: str | None = None


class AuditLogOut(ORM):
    id: uuid.UUID
    seq: int
    prev_hash: str
    hash: str
    at: datetime
    actor_id: uuid.UUID | None
    action: str
    entity: str
    entity_id: str | None
    details: dict


# ---------- Конструктор анкет ----------

class OptionIn(BaseModel):
    text: str = Field(min_length=1)
    score: float


class QuestionIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1)
    help_text: str = ""
    type: QuestionType
    required: bool = True
    weight: float = Field(default=1.0, ge=0)
    scale_min: int | None = None
    scale_max: int | None = None
    options: list[OptionIn] = []


class SectionIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    component: str = Field(min_length=1, max_length=64)
    questions: list[QuestionIn] = []


class QuestionnaireCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.-]+$")
    title: str = Field(min_length=1, max_length=300)
    description: str = ""
    kind: QuestionnaireKind
    target_category: RespondentCategory
    sections: list[SectionIn] = []


class QuestionnaireMetaUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    kind: QuestionnaireKind | None = None
    target_category: RespondentCategory | None = None


class StructureIn(BaseModel):
    """Повна структура анкети. Конструктор надсилає її цілком при збереженні."""

    sections: list[SectionIn]


class OptionOut(ORM):
    id: uuid.UUID
    position: int
    text: str
    score: float


class QuestionOut(ORM):
    id: uuid.UUID
    position: int
    code: str
    text: str
    help_text: str
    type: QuestionType
    required: bool
    weight: float
    scale_min: int | None
    scale_max: int | None
    options: list[OptionOut]


class SectionOut(ORM):
    id: uuid.UUID
    position: int
    title: str
    component: str
    questions: list[QuestionOut]


class QuestionnaireSummary(ORM):
    id: uuid.UUID
    code: str
    version: int
    title: str
    kind: QuestionnaireKind
    target_category: RespondentCategory
    status: QuestionnaireStatus
    updated_at: datetime
    published_at: datetime | None


class QuestionnaireOut(QuestionnaireSummary):
    description: str
    previous_version_id: uuid.UUID | None
    sections: list[SectionOut]


class ValidationIssue(BaseModel):
    path: str
    message: str


# ---------- Хвилі й проходження ----------

class CampaignCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    unit_id: uuid.UUID
    questionnaire_ids: list[uuid.UUID] = Field(min_length=1)
    min_group_size: int | None = Field(
        default=None, ge=MIN_GROUP_SIZE_FLOOR, le=1000,
        description=f"Поріг k для показу агрегатів, не менше {MIN_GROUP_SIZE_FLOOR}",
    )


class CampaignOut(ORM):
    id: uuid.UUID
    title: str
    unit_id: uuid.UUID
    status: CampaignStatus
    min_group_size: int
    opened_on: date | None
    closed_on: date | None
    questionnaire_ids: list[uuid.UUID]


class ProgressItem(BaseModel):
    questionnaire_id: uuid.UUID
    questionnaire_title: str
    target_category: RespondentCategory
    eligible: int | None
    submitted: int | None
    percent: float | None
    too_few_people: bool = False  # група менша за поріг: кількості приховано


class CampaignProgress(BaseModel):
    campaign_id: uuid.UUID
    status: CampaignStatus
    items: list[ProgressItem]


class AssignmentOut(BaseModel):
    campaign_id: uuid.UUID
    campaign_title: str
    questionnaire_id: uuid.UUID
    questionnaire_title: str
    kind: QuestionnaireKind  # checklist заповнюється через /campaigns/{id}/checklist
    submitted: bool


# Форма для респондента: без балів варіантів.
class FormOption(ORM):
    id: uuid.UUID
    text: str


class FormQuestion(ORM):
    id: uuid.UUID
    text: str
    help_text: str
    type: QuestionType
    required: bool
    scale_min: int | None
    scale_max: int | None
    options: list[FormOption]


class FormSection(ORM):
    id: uuid.UUID
    title: str
    questions: list[FormQuestion]


class FormOut(BaseModel):
    campaign_id: uuid.UUID
    questionnaire_id: uuid.UUID
    title: str
    description: str
    sections: list[FormSection]


class AnswerIn(BaseModel):
    question_id: uuid.UUID
    option_ids: list[uuid.UUID] = []
    value: float | None = None


class SubmissionIn(BaseModel):
    answers: list[AnswerIn]


class SubmissionOut(BaseModel):
    status: str = "accepted"
    submitted_on: date
