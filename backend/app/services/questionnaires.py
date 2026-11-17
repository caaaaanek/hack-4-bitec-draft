"""Логіка конструктора анкет: збереження структури, перевірка, версії."""

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Option,
    Question,
    Questionnaire,
    QuestionnaireStatus,
    QuestionType,
    Section,
)
from app.schemas import SectionIn, ValidationIssue

CHOICE_TYPES = {QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE}


def build_sections(sections_in: list[SectionIn]) -> list[Section]:
    """Перетворює вхідну структуру на об'єкти БД. Порядок задає позиція у списку."""
    sections = []
    for s_pos, s_in in enumerate(sections_in, start=1):
        section = Section(position=s_pos, title=s_in.title, component=s_in.component)
        for q_pos, q_in in enumerate(s_in.questions, start=1):
            question = Question(
                position=q_pos,
                code=q_in.code,
                text=q_in.text,
                help_text=q_in.help_text,
                type=q_in.type,
                required=q_in.required,
                weight=q_in.weight,
                scale_min=q_in.scale_min if q_in.type == QuestionType.SCALE else None,
                scale_max=q_in.scale_max if q_in.type == QuestionType.SCALE else None,
            )
            if q_in.type in CHOICE_TYPES:
                question.options = [
                    Option(position=o_pos, text=o_in.text, score=o_in.score)
                    for o_pos, o_in in enumerate(q_in.options, start=1)
                ]
            section.questions.append(question)
        sections.append(section)
    return sections


def replace_structure(db: Session, questionnaire: Questionnaire, sections_in: list[SectionIn]) -> None:
    """Замінює всі розділи, питання й варіанти чернетки на нові."""
    questionnaire.sections.clear()
    db.flush()
    questionnaire.sections.extend(build_sections(sections_in))
    questionnaire.updated_at = datetime.now(timezone.utc)


def validate_for_publish(questionnaire: Questionnaire) -> list[ValidationIssue]:
    """Правила, без яких анкету не можна опублікувати. Повертає список проблем."""
    issues: list[ValidationIssue] = []
    if not questionnaire.sections:
        issues.append(ValidationIssue(path="sections", message="Анкета не має жодного розділу"))

    seen_codes: set[str] = set()
    for s in questionnaire.sections:
        s_path = f"sections[{s.position}]"
        if not s.questions:
            issues.append(ValidationIssue(path=s_path, message="Розділ не має жодного питання"))
        for q in s.questions:
            q_path = f"{s_path}.questions[{q.position}]"
            if q.code in seen_codes:
                issues.append(ValidationIssue(path=q_path, message=f"Код питання '{q.code}' повторюється"))
            seen_codes.add(q.code)

            if q.type in CHOICE_TYPES:
                if len(q.options) < 2:
                    issues.append(ValidationIssue(path=q_path, message="Потрібно щонайменше 2 варіанти відповіді"))
                texts = [o.text.strip().lower() for o in q.options]
                if len(texts) != len(set(texts)):
                    issues.append(ValidationIssue(path=q_path, message="Варіанти відповіді повторюються"))
            elif q.type == QuestionType.SCALE:
                if q.scale_min is None or q.scale_max is None or q.scale_min >= q.scale_max:
                    issues.append(ValidationIssue(path=q_path, message="Для шкали потрібні scale_min < scale_max"))
    return issues


def publish(questionnaire: Questionnaire) -> None:
    questionnaire.status = QuestionnaireStatus.PUBLISHED
    questionnaire.published_at = datetime.now(timezone.utc)


def create_new_version(db: Session, source: Questionnaire) -> Questionnaire:
    """Копія опублікованої анкети як нова чернетка з номером версії +1."""
    max_version = db.scalar(select(func.max(Questionnaire.version)).where(Questionnaire.code == source.code))
    copy = Questionnaire(
        code=source.code,
        version=(max_version or 0) + 1,
        title=source.title,
        description=source.description,
        kind=source.kind,
        target_category=source.target_category,
        status=QuestionnaireStatus.DRAFT,
        previous_version_id=source.id,
    )
    for s in source.sections:
        new_s = Section(position=s.position, title=s.title, component=s.component)
        for q in s.questions:
            new_q = Question(
                position=q.position,
                code=q.code,
                text=q.text,
                help_text=q.help_text,
                type=q.type,
                required=q.required,
                weight=q.weight,
                scale_min=q.scale_min,
                scale_max=q.scale_max,
                options=[Option(position=o.position, text=o.text, score=o.score) for o in q.options],
            )
            new_s.questions.append(new_q)
        copy.sections.append(new_s)
    db.add(copy)
    return copy
