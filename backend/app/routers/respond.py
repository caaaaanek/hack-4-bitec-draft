"""Проходження анкет респондентом.

Два способи:
- за обліковим записом (хвиля access_mode = login): /me/assignments, /campaigns/{cid}/questionnaires/{qid}/...;
- анонімно за одноразовим посиланням (access_mode = token): /respond/form і /respond/responses
  з токеном у заголовку X-Response-Token. Без входу, без облікового запису, без cookie.
"""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ApiError
from app.models import (
    AccessMode,
    Campaign,
    CampaignQuestionnaire,
    CampaignStatus,
    Participation,
    Questionnaire,
    QuestionnaireKind,
    Role,
    User,
)
from app.schemas import AssignmentOut, FormOut, QrOpenOut, SubmissionIn, SubmissionOut, TokenFormOut
from app.security import LoginThrottle, client_ip, require_roles
from app.services import tokens
from app.services.eligibility import can_answer, frozen_of, participants_of
from app.services.responses import pool_answers, save_submission, validate_submission
from app.services.units import subtree_ids

router = APIRouter(tags=["respond"])
respondent_only = require_roles(Role.RESPONDENT)


def check_answers(questionnaire: Questionnaire, data: SubmissionIn) -> None:
    issues = validate_submission(questionnaire, data.answers)
    if issues:
        raise ApiError(422, [i.model_dump() for i in issues], code="incomplete",
                       hint="Дайте відповідь на позначені питання.",
                       missing_question_ids=[i.path for i in issues if i.message.startswith("Немає відповіді")])


def already_submitted(db: Session, campaign_id, questionnaire_id, user_id) -> bool:
    return db.scalar(
        select(Participation.id).where(
            Participation.campaign_id == campaign_id,
            Participation.questionnaire_id == questionnaire_id,
            Participation.user_id == user_id,
        )
    ) is not None


def load_assignment(db: Session, user: User, campaign_id: uuid.UUID, questionnaire_id: uuid.UUID):
    campaign = db.get(Campaign, campaign_id)
    link = db.get(CampaignQuestionnaire, (campaign_id, questionnaire_id))
    if campaign is None or link is None:
        raise HTTPException(status_code=404, detail="Анкету в цій хвилі не знайдено")
    if campaign.status != CampaignStatus.OPEN:
        raise HTTPException(status_code=409, detail="Хвиля не відкрита для проходження")
    questionnaire = link.questionnaire
    if questionnaire.kind == QuestionnaireKind.CHECKLIST:
        raise HTTPException(status_code=409, detail="Чек-лист заповнюється через /campaigns/{id}/checklist")
    if campaign.access_mode == AccessMode.TOKEN:
        raise ApiError(409, "Ця хвиля проходиться за одноразовими посиланнями", code="token_only",
                       hint="Скористайтеся посиланням, яке ви отримали.")
    if not can_answer(user, questionnaire, subtree_ids(db, campaign.unit_id), participants_of(db, campaign),
                      frozen_of(db, campaign)):
        raise HTTPException(status_code=403, detail="Ця анкета призначена іншій категорії або підрозділу")
    return campaign, questionnaire


@router.get("/me/assignments", response_model=list[AssignmentOut])
def my_assignments(db: Session = Depends(get_db), user: User = Depends(respondent_only)):
    result = []
    for campaign in db.scalars(select(Campaign).where(Campaign.status == CampaignStatus.OPEN)):
        units = subtree_ids(db, campaign.unit_id)
        participants = participants_of(db, campaign)
        frozen = frozen_of(db, campaign)
        token_only = campaign.access_mode == AccessMode.TOKEN
        for link in campaign.questionnaire_links:
            questionnaire: Questionnaire = link.questionnaire
            # Анкети анонімної хвилі проходять лише за посиланням; чек-лист робоча група вносить під своїм входом.
            if token_only and questionnaire.kind != QuestionnaireKind.CHECKLIST:
                continue
            # Чек-лист не має складу учасників (вносить робоча група): за правилом.
            fixed = None if questionnaire.kind == QuestionnaireKind.CHECKLIST else frozen
            if can_answer(user, questionnaire, units, participants, fixed):
                result.append(
                    AssignmentOut(
                        campaign_id=campaign.id,
                        campaign_title=campaign.title,
                        questionnaire_id=questionnaire.id,
                        questionnaire_title=questionnaire.title,
                        kind=questionnaire.kind,
                        submitted=already_submitted(db, campaign.id, questionnaire.id, user.id),
                    )
                )
    return result


@router.get("/campaigns/{campaign_id}/questionnaires/{questionnaire_id}/form", response_model=FormOut)
def get_form(
    campaign_id: uuid.UUID,
    questionnaire_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(respondent_only),
):
    """Анкета для заповнення. Бали варіантів не віддаються, щоб не підказувати 'правильну' відповідь."""
    campaign, questionnaire = load_assignment(db, user, campaign_id, questionnaire_id)
    return FormOut(
        campaign_id=campaign.id,
        questionnaire_id=questionnaire.id,
        title=questionnaire.title,
        description=questionnaire.description,
        sections=questionnaire.sections,
    )


@router.post(
    "/campaigns/{campaign_id}/questionnaires/{questionnaire_id}/responses",
    response_model=SubmissionOut,
    status_code=status.HTTP_201_CREATED,
)
def submit(
    campaign_id: uuid.UUID,
    questionnaire_id: uuid.UUID,
    data: SubmissionIn,
    db: Session = Depends(get_db),
    user: User = Depends(respondent_only),
):
    campaign, questionnaire = load_assignment(db, user, campaign_id, questionnaire_id)
    if already_submitted(db, campaign.id, questionnaire.id, user.id):
        raise ApiError(409, "Ви вже пройшли цю анкету", code="already_submitted",
                       hint="Відповідь прийнято з першого надсилання.")

    check_answers(questionnaire, data)

    # Подання респондента навмисно не пишемо в журнал дій: запис із часом і
    # користувачем дозволив би зіставити його з відповіддю.
    submitted_on = save_submission(db, campaign, questionnaire, user, data.answers)
    # Відповідь лишається в зашифрованому буфері до закриття хвилі (services/anonymity.py).
    try:
        db.commit()
    except IntegrityError:
        # Паралельне подання (подвійний клік) уже записало участь: друге відкочується разом зі своєю відповіддю.
        db.rollback()
        raise ApiError(409, "Ви вже пройшли цю анкету", code="already_submitted",
                       hint="Відповідь прийнято з першого надсилання.")
    return SubmissionOut(submitted_on=submitted_on)


# ---------- Анонімне проходження за одноразовим посиланням ----------

TOKEN_HEADER = "X-Response-Token"
# Невдалі спроби з одного IP: захист від перебору (хоча 256 біт і так не перебрати) і від сміття в логах.
token_throttle = LoginThrottle("token")


def token_assignment(request: Request, db: Session, token: str | None):
    # Спершу шукаємо токен: дійсне посилання ніколи не впирається в ліміт, навіть якщо з тієї ж адреси
    # (спільний NAT, той самий nginx) хтось уже ввів кілька невірних. Рахуємо лише невдалі спроби.
    row = tokens.find(db, token or "")
    if row is None or row.revoked:
        key = ("token", client_ip(request))
        retry_after = token_throttle.blocked_for(key)
        if retry_after:
            raise ApiError(429, "Забагато спроб з невірним посиланням", hint=f"Спробуйте через {retry_after} с.",
                           headers={"Retry-After": str(retry_after)})
        token_throttle.fail(key)
        raise ApiError(404, "Посилання недійсне", code="token_invalid",
                       hint="Перевірте, що посилання скопійовано повністю, або попросіть нове.")
    campaign = db.get(Campaign, row.campaign_id)
    if row.used:
        raise ApiError(409, "Анкету за цим посиланням уже заповнено", code="token_used",
                       hint="Кожне посилання діє один раз. Дякуємо за участь!")
    if campaign.status != CampaignStatus.OPEN:
        raise ApiError(409, "Опитування зараз не приймає відповіді", code="campaign_not_open",
                       hint="Перевірте строки опитування.")
    link = db.get(CampaignQuestionnaire, (campaign.id, row.questionnaire_id))
    if link is None:
        raise ApiError(404, "Посилання недійсне", code="token_invalid")
    return row, campaign, link.questionnaire


@router.post("/respond/qr/{code}", response_model=QrOpenOut, status_code=status.HTTP_201_CREATED)
def qr_open(code: str, request: Request, db: Session = Depends(get_db)):
    """Скан QR: свіжий одноразовий токен для нової форми. Подання лише через POST: GET могли б
    «натиснути» превʼю месенджера чи антивірус, і форми розтратилися б.

    Хто відкрив форму, не зберігається: у БД лише sha256 токена без часу й IP. Закрив форму
    без подання — токен просто лишається невикористаним, наступний скан дає нову форму.
    """
    # Як і для посилань: дійсний QR не впирається в ліміт невдалих спроб (уся зала за одним NAT).
    link = tokens.find_qr(db, code)
    if link is None or link.revoked:
        key = ("token", client_ip(request))
        retry_after = token_throttle.blocked_for(key)
        if retry_after:
            raise ApiError(429, "Забагато спроб з невірним посиланням", hint=f"Спробуйте через {retry_after} с.",
                           headers={"Retry-After": str(retry_after)})
        token_throttle.fail(key)
        raise ApiError(404, "Посилання недійсне", code="qr_invalid",
                       hint="Відскануйте QR ще раз або попросіть організатора показати актуальний.")
    campaign = db.get(Campaign, link.campaign_id)
    if campaign.status != CampaignStatus.OPEN:
        raise ApiError(409, "Опитування зараз не приймає відповіді", code="campaign_not_open",
                       hint="Перевірте строки опитування.")
    token = tokens.open_by_scan(db, link)
    if token is None:
        raise ApiError(429, "Для цього QR відкрито забагато форм", code="qr_limit",
                       hint="Зверніться до організатора: лімітом є 3 × очікувана кількість учасників.")
    db.commit()
    return QrOpenOut(token=token)


@router.get("/respond/form", response_model=TokenFormOut)
def token_form(request: Request, db: Session = Depends(get_db),
               x_response_token: str | None = Header(default=None, alias=TOKEN_HEADER)):
    """Анкета за одноразовим посиланням. Токен лише в заголовку X-Response-Token (не в адресі запиту)."""
    _, campaign, questionnaire = token_assignment(request, db, x_response_token)
    return TokenFormOut(
        campaign_id=campaign.id,
        campaign_title=campaign.title,
        questionnaire_id=questionnaire.id,
        title=questionnaire.title,
        description=questionnaire.description,
        sections=questionnaire.sections,
        min_group_size=campaign.min_group_size,
    )


@router.post("/respond/responses", response_model=SubmissionOut, status_code=status.HTTP_201_CREATED)
def token_submit(data: SubmissionIn, request: Request, db: Session = Depends(get_db),
                 x_response_token: str | None = Header(default=None, alias=TOKEN_HEADER)):
    """Подання за одноразовим посиланням. Повторне — 409 token_used.

    Записується лише «посилання використано» і відповідь у буфер; між ними немає жодного ключа.
    Дату подання не зберігаємо й не повертаємо.
    """
    row, campaign, questionnaire = token_assignment(request, db, x_response_token)
    check_answers(questionnaire, data)
    if not tokens.consume(db, row):
        db.rollback()
        raise ApiError(409, "Анкету за цим посиланням уже заповнено", code="token_used",
                       hint="Кожне посилання діє один раз.")
    pool_answers(db, campaign, questionnaire, row.unit_id, data.answers)
    db.commit()
    return SubmissionOut(submitted_on=None)
