"""Модель даних.

Головне правило анонімності: таблиця Participation (хто пройшов) і таблиця
Response (що відповіли) не мають спільного ключа. Response не зберігає ні
користувача, ні часу, ні дати. Відповідь спершу потрапляє в ResponsePool
зашифрованою і переноситься в Response при закритті хвилі однією транзакцією,
перемішаною, з узагальненим підрозділом (≥ k відповідей на підрозділ зберігання),
тож ні системні поля БД (порядок вставки, xmin), ні підрозділ не вказують на людину.
"""

import uuid
from datetime import date, datetime, timezone
from enum import StrEnum

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Index,
    UniqueConstraint,
    LargeBinary,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def str_enum(enum_cls: type[StrEnum]) -> Enum:
    # Зберігаємо як рядок, а не як тип Postgres ENUM: так простіше міграції.
    return Enum(enum_cls, native_enum=False, length=32, values_callable=lambda e: [x.value for x in e])


class Role(StrEnum):
    ADMIN = "admin"                # користувачі, підрозділи, хвилі, журнал дій
    COMMISSIONER = "commissioner"  # розробляє анкети, підтверджує пункти чек-листа
    RESPONDENT = "respondent"      # проходить анкети
    LEADER = "leader"              # керівник: результати, рішення щодо рекомендацій, заходи
    AUDITOR = "auditor"            # аудитор: лише читання результатів, заходів і журналу дій
    COORDINATOR = "coordinator"    # координатор: користувачі, ролі, підрозділи, журнал і зведення по всіх групах


class RespondentCategory(StrEnum):
    WORKING_GROUP = "working_group"  # члени робочої групи (Анкета 1)
    STAFF = "staff"                  # особовий склад (Анкета 2)
    EXPERT = "expert"                # експертне оцінювання


class QuestionnaireKind(StrEnum):
    SURVEY = "survey"        # анкета зрілості (додаток В)
    CHECKLIST = "checklist"  # інституційний чек-лист (додаток Б)


class QuestionnaireStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class QuestionType(StrEnum):
    SINGLE_CHOICE = "single_choice"
    MULTIPLE_CHOICE = "multiple_choice"
    SCALE = "scale"


class CampaignStatus(StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    CLOSED = "closed"


class AccessMode(StrEnum):
    LOGIN = "login"  # респонденти входять своїм обліковим записом
    TOKEN = "token"  # анонімне проходження за одноразовими посиланнями, без облікових записів


class Unit(Base):
    """Підрозділ. Типів немає: ієрархію будь-якої глибини задає адміністратор."""

    __tablename__ = "units"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("units.id"), index=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # Лише псевдонім, без ПІБ: персональні дані в системі не потрібні.
    display_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[Role] = mapped_column(str_enum(Role), index=True)
    category: Mapped[RespondentCategory | None] = mapped_column(str_enum(RespondentCategory))
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("units.id"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Версія токенів: зростає при зміні пароля чи блокуванні, і всі видані раніше JWT стають недійсними.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Questionnaire(Base):
    __tablename__ = "questionnaires"
    __table_args__ = (UniqueConstraint("code", "version"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # code однаковий для всіх версій однієї анкети, version зростає.
    code: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[QuestionnaireKind] = mapped_column(str_enum(QuestionnaireKind))
    target_category: Mapped[RespondentCategory] = mapped_column(str_enum(RespondentCategory))
    status: Mapped[QuestionnaireStatus] = mapped_column(
        str_enum(QuestionnaireStatus), default=QuestionnaireStatus.DRAFT
    )
    previous_version_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("questionnaires.id"))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sections: Mapped[list["Section"]] = relationship(
        back_populates="questionnaire",
        order_by="Section.position",
        cascade="all, delete-orphan",
    )


class Section(Base):
    __tablename__ = "sections"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questionnaires.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    # Компонент системи доброчесності, до якого належить розділ:
    # culture / system / accountability / overall / checklist_1 ... checklist_6.
    component: Mapped[str] = mapped_column(String(64))

    questionnaire: Mapped[Questionnaire] = relationship(back_populates="sections")
    questions: Mapped[list["Question"]] = relationship(
        back_populates="section",
        order_by="Question.position",
        cascade="all, delete-orphan",
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sections.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    # Стабільний ключ питання: однаковий в анкетах різних категорій і версій,
    # щоб можна було порівнювати відповіді (наприклад "culture.values").
    code: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text)
    help_text: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[QuestionType] = mapped_column(str_enum(QuestionType))
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    scale_min: Mapped[int | None] = mapped_column(Integer)
    scale_max: Mapped[int | None] = mapped_column(Integer)

    section: Mapped[Section] = relationship(back_populates="questions")
    options: Mapped[list["Option"]] = relationship(
        back_populates="question",
        order_by="Option.position",
        cascade="all, delete-orphan",
    )


class Option(Base):
    __tablename__ = "options"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    question_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    # Бал варіанта задає розробник анкети явно (для анкет зрілості це рівень 1-5).
    # Респонденту бал не показується.
    score: Mapped[float] = mapped_column(Float)

    question: Mapped[Question] = relationship(back_populates="options")


class Campaign(Base):
    """Хвиля (цикл) оцінювання для підрозділу і всіх його дочірніх підрозділів."""

    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(300))
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"))
    status: Mapped[CampaignStatus] = mapped_column(str_enum(CampaignStatus), default=CampaignStatus.DRAFT, index=True)
    min_group_size: Mapped[int] = mapped_column(Integer, default=5)
    access_mode: Mapped[AccessMode] = mapped_column(str_enum(AccessMode), default=AccessMode.LOGIN,
                                                    server_default=AccessMode.LOGIN.value)
    # True: проходять лише явно додані учасники (CampaignParticipant), а не всі за категорією й підрозділом.
    explicit_participants: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # True: склад учасників зафіксовано при відкритті (CampaignEligible), знаменник участі рахується від нього.
    eligible_frozen: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    opened_on: Mapped[date | None] = mapped_column(Date)
    closed_on: Mapped[date | None] = mapped_column(Date)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # Автопілот (services/autopilot.py): відкриття й закриття за планом, нагадування всім учасникам.
    autopilot: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    planned_open_on: Mapped[date | None] = mapped_column(Date)
    planned_close_on: Mapped[date | None] = mapped_column(Date)
    # Закрити раніше строку, коли в кожній анкеті участь досягла цього відсотка.
    close_at_percent: Mapped[float | None] = mapped_column(Float)
    remind_every_days: Mapped[int | None] = mapped_column(Integer)
    last_reminder_on: Mapped[date | None] = mapped_column(Date)

    questionnaire_links: Mapped[list["CampaignQuestionnaire"]] = relationship(cascade="all, delete-orphan")


class CampaignQuestionnaire(Base):
    __tablename__ = "campaign_questionnaires"

    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questionnaires.id"), primary_key=True)

    questionnaire: Mapped[Questionnaire] = relationship()


class CampaignParticipant(Base):
    """Явний склад учасників хвилі (коли campaign.explicit_participants). Лише хто запрошений, без відповідей."""

    __tablename__ = "campaign_participants"

    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class CampaignEligible(Base):
    """Склад учасників, зафіксований при відкритті хвилі за обліковими записами: хто мав пройти анкету
    і в якому підрозділі був на той момент. Лише склад, без відповідей і без позначки «пройшов».

    Від нього рахується знаменник участі: блокування чи перенесення людей після подання
    не змінює «мали пройти», а проходити можуть лише ті, хто в складі.
    """

    __tablename__ = "campaign_eligible"
    __table_args__ = (Index("ix_campaign_eligible_user_id", "user_id"),)

    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questionnaires.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("units.id"))
    category: Mapped[RespondentCategory] = mapped_column(str_enum(RespondentCategory))


class AccessToken(Base):
    """Одноразове посилання для анонімного проходження.

    Зберігається лише sha256 токена: сам токен бачить тільки адміністратор у момент видачі.
    Немає користувача, часу використання й жодного зв'язку з відповіддю: після подання
    лишається тільки позначка used. Підрозділ потрібен для агрегатів (як unit_id у відповіді).
    """

    __tablename__ = "access_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questionnaires.id"))
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("units.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Participation(Base):
    """Хто пройшов анкету. Тут є користувач, але немає відповідей."""

    __tablename__ = "participations"
    __table_args__ = (UniqueConstraint("campaign_id", "questionnaire_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"))
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questionnaires.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    submitted_on: Mapped[date] = mapped_column(Date)


class ResponsePool(Base):
    """Зашифрований буфер анонімних відповідей до закриття хвилі.

    Немає користувача, часу й дати. Відповіді й підрозділ лежать в answers зашифрованими
    (services/anonymity.seal): {"v": 1, "n": nonce, "c": шифротекст}. unit_id лишився для
    старих рядків і для нових порожній. При закритті все переноситься в Response.
    """

    __tablename__ = "response_pool"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questionnaires.id"))
    category: Mapped[RespondentCategory] = mapped_column(str_enum(RespondentCategory))
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("units.id"))
    # Зашифрований конверт; старі рядки — [{"question_id", "option_id", "value"}, ...]
    answers: Mapped[dict | list] = mapped_column(JSON)


class Response(Base):
    """Анонімна відповідь. Немає користувача, часу й дати, ID випадковий.

    unit_id — підрозділ зберігання (узагальнений): під ним щонайменше k відповідей анкети.
    """

    __tablename__ = "responses"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), index=True)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questionnaires.id"))
    category: Mapped[RespondentCategory] = mapped_column(str_enum(RespondentCategory))
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("units.id"))

    answers: Mapped[list["Answer"]] = relationship(cascade="all, delete-orphan")


class Answer(Base):
    __tablename__ = "answers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    response_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("responses.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questions.id"))
    option_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("options.id"))
    value: Mapped[float | None] = mapped_column(Float)  # для питань-шкал


class ChecklistStatus(StrEnum):
    FULL = "full"        # впроваджено повністю
    PARTIAL = "partial"  # впроваджено частково
    NONE = "none"        # підлягає впровадженню


class ChecklistEntry(Base):
    """Пункт чек-листа в межах хвилі. Інституційна оцінка, не анонімна:
    видно, хто вніс і хто підтвердив."""

    __tablename__ = "checklist_entries"
    __table_args__ = (UniqueConstraint("campaign_id", "question_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    question_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questions.id"))
    status: Mapped[ChecklistStatus] = mapped_column(str_enum(ChecklistStatus))
    evidence: Mapped[str] = mapped_column(Text, default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    entered_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    confirmed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EvidenceFile(Base):
    """Файл-доказ до пункту чек-листа (Evidence Repository).

    Вміст лежить на диску за sha256 (EVIDENCE_DIR/ab/abcdef...), тут — опис і хто додав.
    Видалення м'яке: запис і файл лишаються для журналу, але не показуються й не рахуються як доказ.
    """

    __tablename__ = "evidence_files"
    __table_args__ = (Index("ix_evidence_files_item", "campaign_id", "question_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    question_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questions.id"))
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(128))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class Indicator(Base):
    """Факт з іншої системи: лише агрегат "numerator з denominator", без імен."""

    __tablename__ = "indicators"
    __table_args__ = (UniqueConstraint("unit_id", "period", "indicator"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"))
    period: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    indicator: Mapped[str] = mapped_column(String(64))
    numerator: Mapped[int] = mapped_column(Integer)
    denominator: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(64))
    why: Mapped[str] = mapped_column(Text, default="")
    extra_counts: Mapped[dict] = mapped_column(JSON, default=dict)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class IndexSnapshot(Base):
    """Незмінний знімок результатів хвилі для підрозділу, зроблений при закритті."""

    __tablename__ = "index_snapshots"
    __table_args__ = (UniqueConstraint("campaign_id", "unit_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"), index=True)
    methodology_version: Mapped[str] = mapped_column(String(16))
    closed_on: Mapped[date] = mapped_column(Date)
    index_score: Mapped[float | None] = mapped_column(Float)
    index_self: Mapped[float | None] = mapped_column(Float)
    reliability: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    """Журнал дій. Відповіді респондентів сюди не потрапляють.

    Записи утворюють ланцюжок хешів: hash = sha256(prev_hash + вміст запису).
    Зміна чи видалення будь-якого запису ламає ланцюжок, це видно в /admin/audit-log/verify.
    """

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    seq: Mapped[int] = mapped_column(Integer)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(64))
    entity: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict] = mapped_column(JSON, default=dict)

    __table_args__ = (UniqueConstraint("seq", name="uq_audit_log_seq"), Index("ix_audit_log_entity", "entity", "entity_id"))


class RevokedToken(Base):
    """Відкликані JWT (вихід). Зберігаються лише до закінчення строку дії токена."""

    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[float] = mapped_column(Float, index=True)  # unix-час


class LoginFailure(Base):
    """Невдала спроба входу чи анонімного посилання. Спільна для всіх процесів API, переживає перезапуск.

    key — sha256 від (scope, логін, IP): самих логінів і адрес у таблиці немає.
    """

    __tablename__ = "login_failures"

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(16), index=True)
    key: Mapped[str] = mapped_column(String(64), index=True)
    at: Mapped[float] = mapped_column(Float, index=True)  # unix-час


class AuditHead(Base):
    """Голова ланцюжка журналу (один рядок). Блокується при записі, щоб ланцюжок не розгалужувався."""

    __tablename__ = "audit_head"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, default=0)
    hash: Mapped[str] = mapped_column(String(64))


# ---------- Рекомендації й заходи ----------

class RecommendationDecisionType(StrEnum):
    ACCEPTED = "accepted"  # прийнято, буде захід
    CLARIFY = "clarify"    # потрібне уточнення
    REJECTED = "rejected"  # відхилено (з обґрунтуванням)


class RecommendationDecision(Base):
    """Рішення керівника щодо рекомендації. Самі рекомендації не зберігаються:
    їх детерміновано дають правила зі знімка хвилі, а код рекомендації стабільний."""

    __tablename__ = "recommendation_decisions"
    __table_args__ = (UniqueConstraint("campaign_id", "unit_id", "recommendation_code"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"))
    recommendation_code: Mapped[str] = mapped_column(String(128))
    decision: Mapped[RecommendationDecisionType] = mapped_column(str_enum(RecommendationDecisionType))
    comment: Mapped[str] = mapped_column(Text, default="")
    decided_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MeasureStatus(StrEnum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELLED = "cancelled"


class Measure(Base):
    """Захід плану трансформації: відповідальний (посада, не ПІБ), строк, статус, доказ виконання."""

    __tablename__ = "measures"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"), index=True)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id", ondelete="SET NULL"), index=True)
    recommendation_code: Mapped[str | None] = mapped_column(String(128))
    component: Mapped[str | None] = mapped_column(String(32))
    catalog_number: Mapped[str | None] = mapped_column(String(16))  # пункт Додатку Д
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    owner: Mapped[str] = mapped_column(String(200))  # посада чи підрозділ відповідального
    due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[MeasureStatus] = mapped_column(str_enum(MeasureStatus), default=MeasureStatus.PLANNED)
    done_on: Mapped[date | None] = mapped_column(Date)
    evidence: Mapped[str] = mapped_column(Text, default="")  # чим підтверджено виконання
    # Синхронізація з темою 2.
    external_id: Mapped[str | None] = mapped_column(String(128))
    external_source: Mapped[str | None] = mapped_column(String(64))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class OutboxMessage(Base):
    """Вихідні повідомлення в інші системи. Надсилаються пізніше й повторюються,
    тож недоступність зовнішнього сервісу не ламає роботу в нас."""

    __tablename__ = "outbox"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target: Mapped[str] = mapped_column(String(32))  # theme2
    topic: Mapped[str] = mapped_column(String(64))   # measure.upsert
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class CheckRun(Base):
    """Запуск перевірки (закупівлі чи декларації). Зберігає лише підсумки, без самих записів."""

    __tablename__ = "check_runs"
    __table_args__ = (Index("ix_check_runs_unit_period_kind", "unit_id", "period", "kind"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(16))  # procurement | declarations
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"))
    period: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    source: Mapped[str] = mapped_column(String(16))
    total: Mapped[int] = mapped_column(Integer)
    flagged: Mapped[int] = mapped_column(Integer)
    by_risk: Mapped[dict] = mapped_column(JSON, default=dict)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CheckFinding(Base):
    """Знахідка: публічний ідентифікатор запису (або хеш декларації), прапорці правил, рішення уповноваженого."""

    __tablename__ = "check_findings"
    __table_args__ = (Index("ix_check_findings_unit_period_kind", "unit_id", "period", "kind"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("check_runs.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"))
    period: Mapped[str] = mapped_column(String(7))
    record_ref: Mapped[str] = mapped_column(String(200))
    risk_level: Mapped[str] = mapped_column(String(8))
    flags: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="new")  # new | reviewed | dismissed
    comment: Mapped[str] = mapped_column(Text, default="")
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------- Автопілот, сповіщення, згенеровані звіти ----------

class AutopilotEvent(Base):
    """Крок автопілота або агента-чергового: що зроблено, пропущено чи не вдалося. Без персональних даних."""

    __tablename__ = "autopilot_events"
    __table_args__ = (Index("ix_autopilot_events_campaign_at", "campaign_id", "at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    step: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))  # ok | skipped | error
    message: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class Notice(Base):
    """Сповіщення для аудиторії (усім учасникам хвилі, керівникам, адміністраторам), не конкретній людині.

    Нагадування йде всім учасникам хвилі, тож воно не розкриває, хто вже пройшов анкету.
    """

    __tablename__ = "notices"
    __table_args__ = (Index("ix_notices_created_at", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    audience: Mapped[str] = mapped_column(String(16))  # participants | leaders | admins
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GeneratedReport(Base):
    """Звіт, який автопілот підготував при закритті хвилі (Word за шаблоном Додатку Г)."""

    __tablename__ = "generated_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"))
    format: Mapped[str] = mapped_column(String(8))
    filename: Mapped[str] = mapped_column(String(200))
    content: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- Навчання: флешкартки ----------

class TrainingCompletion(Base):
    """Людина пройшла колоду флешкарток. Відповіді на окремі картки не зберігаються.

    Назовні — лише агрегат «пройшли X з Y» з порогом k (services/learning.py), як і для участі в анкетах.
    """

    __tablename__ = "training_completions"
    __table_args__ = (UniqueConstraint("user_id", "deck", "completed_on"),
                      Index("ix_training_completions_deck_on", "deck", "completed_on"))

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    deck: Mapped[str] = mapped_column(String(32))
    completed_on: Mapped[date] = mapped_column(Date)
