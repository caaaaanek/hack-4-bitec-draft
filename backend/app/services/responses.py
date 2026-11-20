"""Перевірка й збереження анонімних відповідей."""

from datetime import date

from sqlalchemy.orm import Session

from app.clock import today
from app.models import (
    Campaign,
    Participation,
    Questionnaire,
    QuestionType,
    ResponsePool,
    User,
)
from app.schemas import AnswerIn, ValidationIssue
from app.services.anonymity import seal
from app.services.text import shorten


def validate_submission(questionnaire: Questionnaire, answers_in: list[AnswerIn]) -> list[ValidationIssue]:
    """Контроль повноти й коректності заповнення."""
    issues: list[ValidationIssue] = []
    questions = {q.id: q for s in questionnaire.sections for q in s.questions}

    by_question: dict = {}
    for a in answers_in:
        if a.question_id not in questions:
            issues.append(ValidationIssue(path=str(a.question_id), message="Питання не належить до цієї анкети"))
            continue
        if a.question_id in by_question:
            issues.append(ValidationIssue(path=str(a.question_id), message="Відповідь на питання надіслано двічі"))
            continue
        by_question[a.question_id] = a

    for q_id, q in questions.items():
        a = by_question.get(q_id)
        answered = a is not None and (a.option_ids or a.value is not None)
        if not answered:
            if q.required:
                issues.append(ValidationIssue(path=str(q_id), message=f"Немає відповіді на обов'язкове питання: {shorten(q.text, 80)}"))
            continue

        option_ids = {o.id for o in q.options}
        if q.type == QuestionType.SINGLE_CHOICE:
            if len(a.option_ids) != 1 or a.option_ids[0] not in option_ids:
                issues.append(ValidationIssue(path=str(q_id), message="Потрібно обрати рівно один варіант цього питання"))
        elif q.type == QuestionType.MULTIPLE_CHOICE:
            if len(set(a.option_ids)) != len(a.option_ids) or not set(a.option_ids) <= option_ids:
                issues.append(ValidationIssue(path=str(q_id), message="Обрано варіанти, яких немає в цьому питанні"))
        elif q.type == QuestionType.SCALE:
            if a.value is None or not (q.scale_min <= a.value <= q.scale_max):
                issues.append(ValidationIssue(path=str(q_id), message=f"Значення має бути від {q.scale_min} до {q.scale_max}"))
        elif q.type == QuestionType.LIST_COUNT:
            # Кількість правдивих тверджень: у варіанті A чутливого твердження немає, тож максимум на 1 менший.
            top = len(q.options) - (1 if a.variant == "A" else 0)
            if a.variant not in ("A", "B"):
                issues.append(ValidationIssue(path=str(q_id), message="Для непрямого питання потрібен variant з форми"))
            elif a.option_ids or a.value is None or a.value != int(a.value) or not 0 <= a.value <= top:
                issues.append(ValidationIssue(path=str(q_id), message=f"Вкажіть кількість від 0 до {top}"))
    return issues


def pool_answers(
    db: Session,
    campaign: Campaign,
    questionnaire: Questionnaire,
    unit_id,
    answers_in: list[AnswerIn],
) -> None:
    """Кладе відповіді в буфер: без користувача, часу й способу входу (логін чи посилання).

    Відповіді й підрозділ шифруються (services/anonymity.seal): у відкритому вигляді лишаються
    лише хвиля, анкета й категорія.
    """
    answers = []
    for a in answers_in:
        if a.option_ids:
            answers.extend({"question_id": str(a.question_id), "option_id": str(o), "value": None} for o in a.option_ids)
        elif a.value is not None:
            item = {"question_id": str(a.question_id), "option_id": None, "value": a.value}
            if a.variant:
                item["variant"] = a.variant  # варіант непрямого питання: лише у відповіді, не в людини
            answers.append(item)
    db.add(
        ResponsePool(
            campaign_id=campaign.id,
            questionnaire_id=questionnaire.id,
            category=questionnaire.target_category,
            unit_id=None,
            answers=seal({"unit_id": str(unit_id) if unit_id else None, "answers": answers},
                         campaign.urn_public_key if campaign.urn_enabled else None),
        )
    )


def save_submission(
    db: Session,
    campaign: Campaign,
    questionnaire: Questionnaire,
    user: User,
    answers_in: list[AnswerIn],
) -> date:
    """Записує дві незв'язані речі: факт участі (з користувачем) і відповідь у буфер (без нього).

    У постійну таблицю Response відповідь потрапить пізніше, пачкою (services/anonymity.py).
    """
    submitted_on = today()
    db.add(
        Participation(
            campaign_id=campaign.id,
            questionnaire_id=questionnaire.id,
            user_id=user.id,
            submitted_on=submitted_on,
        )
    )
    pool_answers(db, campaign, questionnaire, user.unit_id, answers_in)
    return submitted_on
