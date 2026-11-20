"""Проходження анкет респондентом.

Два способи:
- за обліковим записом (хвиля access_mode = login): /me/assignments, /campaigns/{cid}/questionnaires/{qid}/...;
- анонімно за одноразовим посиланням (access_mode = token): /respond/form і /respond/responses
  з токеном у заголовку X-Response-Token. Без входу, без облікового запису, без cookie.
"""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
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
from app.security import LoginThrottle, client_ip, get_current_user, require_roles
from app.config import get_settings
from app.clock import today
from app.services import ballots, candor, categories, tokens
from app.services.eligibility import can_answer, frozen_of, participants_of
from app.services.responses import pool_answers, save_submission, validate_submission
from app.services.units import subtree_ids

router = APIRouter(tags=["respond"])
respondent_only = require_roles(Role.RESPONDENT)


def check_answers(questionnaire: Questionnaire, data: SubmissionIn) -> None:
    # Непряме питання могли відповісти вибором варіанта «кількість»: перетворюємо на value + variant.
    data.answers = candor.normalize_answers(questionnaire, data.answers)
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
        sections=candor.form_sections(questionnaire),
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
        sections=candor.form_sections(questionnaire),
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


# ---------- Жетон зі сліпим підписом і квитанція (services/ballots.py) ----------

class BallotKeyOut(BaseModel):
    key_id: uuid.UUID
    n: str = Field(description="Модуль RSA, hex")
    e: int
    hash: str = Field(default="FDH-SHA512(integra-ballot-v1 ‖ лічильник ‖ nonce) mod n",
                      description="Як рахувати повідомлення m з випадкового nonce")


class BallotIn(BaseModel):
    blinded: str = Field(pattern=r"^[0-9a-f]{1,1024}$", description="Засліплене повідомлення m·rᵉ mod n, hex")
    key_id: uuid.UUID | None = Field(default=None, description="key_id з GET .../ballot-key, яким засліплено "
                                                               "повідомлення (рекомендовано)")


class BallotOut(BaseModel):
    key_id: uuid.UUID
    blinded_signature: str


class BallotSubmissionIn(SubmissionIn):
    key_id: uuid.UUID
    # Парна кількість символів: інакше bytes.fromhex падав з ValueError, і непарний nonce давав 500.
    nonce: str = Field(pattern=r"^(?:[0-9a-f]{2}){16,64}$", description="Випадковий nonce (hex, парна довжина 32–128), "
                                                                       "з якого порахували m")
    signature: str = Field(pattern=r"^[0-9a-f]{1,1024}$", description="Знятий із засліплення підпис s = mᵈ, hex")


class ReceiptOut(BaseModel):
    receipt: str
    counted: bool
    campaign_closed: bool | None = None


def ballot_unit(db: Session, campaign: Campaign, questionnaire: Questionnaire, user: User) -> uuid.UUID | None:
    if categories.is_external(questionnaire.target_category):
        return None
    frozen = frozen_of(db, campaign)
    if frozen is not None and user.id in frozen.get(questionnaire.id, {}):
        return frozen[questionnaire.id][user.id][0]
    return user.unit_id


@router.get("/campaigns/{campaign_id}/questionnaires/{questionnaire_id}/ballot-key", response_model=BallotKeyOut)
def ballot_key(campaign_id: uuid.UUID, questionnaire_id: uuid.UUID, db: Session = Depends(get_db),
               user: User = Depends(respondent_only)):
    """Відкритий ключ групи (анкета хвилі + підрозділ) для засліплення жетона."""
    campaign, questionnaire = load_assignment(db, user, campaign_id, questionnaire_id)
    key = ballots.key_for(db, campaign, questionnaire, ballot_unit(db, campaign, questionnaire, user))
    db.commit()
    return BallotKeyOut(key_id=key.id, n=key.n, e=key.e)


@router.post("/campaigns/{campaign_id}/questionnaires/{questionnaire_id}/ballot", response_model=BallotOut,
             status_code=status.HTTP_201_CREATED)
def issue_ballot(campaign_id: uuid.UUID, questionnaire_id: uuid.UUID, data: BallotIn, db: Session = Depends(get_db),
                 user: User = Depends(respondent_only)):
    """Підписати засліплений жетон. Тут записується участь (хто), щоб не видати другий жетон.
    Що саме підписано, сервер не знає: відповідь надійде пізніше без входу (POST /respond/ballot)."""
    campaign, questionnaire = load_assignment(db, user, campaign_id, questionnaire_id)
    if already_submitted(db, campaign.id, questionnaire.id, user.id):
        raise ApiError(409, "Ви вже отримали жетон або пройшли цю анкету", code="already_submitted")
    unit_id = ballot_unit(db, campaign, questionnaire, user)
    if data.key_id is not None:
        # Підписуємо саме тим ключем, яким клієнт засліплював: інакше жетон не перевіриться, а участь уже записано.
        key = ballots.group_key(db, data.key_id, campaign, questionnaire, unit_id)
        if key is None:
            raise ApiError(422, "Ключ не належить вашій групі", code="invalid",
                           hint="Оновіть сторінку анкети й спробуйте ще раз.")
    else:
        key = ballots.key_for(db, campaign, questionnaire, unit_id)
    try:
        signature = ballots.sign_blinded(key, data.blinded)
    except ValueError as e:
        raise ApiError(422, str(e), code="invalid")
    db.add(Participation(campaign_id=campaign.id, questionnaire_id=questionnaire.id, user_id=user.id,
                         submitted_on=today()))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "Ви вже отримали жетон або пройшли цю анкету", code="already_submitted")
    return BallotOut(key_id=key.id, blinded_signature=signature)


@router.post("/respond/ballot", response_model=ReceiptOut, status_code=status.HTTP_201_CREATED)
def ballot_submit(data: BallotSubmissionIn, db: Session = Depends(get_db)):
    """Відповідь за жетоном, без входу й без cookie. Повертає квитанцію sha256(nonce): після закриття хвилі
    за нею можна перевірити, що відповідь урахована. Час і користувач не зберігаються."""
    from app.models import BlindKey

    key = db.get(BlindKey, data.key_id)
    campaign = db.get(Campaign, key.campaign_id) if key else None
    if key is None or campaign is None:
        raise ApiError(404, "Жетон недійсний", code="ballot_invalid")
    if campaign.status != CampaignStatus.OPEN:
        raise ApiError(409, "Опитування зараз не приймає відповіді", code="campaign_not_open")
    nonce = bytes.fromhex(data.nonce)
    if not ballots.verify(key, nonce, data.signature):
        raise ApiError(403, "Підпис жетона не дійсний", code="ballot_invalid")
    questionnaire = db.get(Questionnaire, key.questionnaire_id)
    check_answers(questionnaire, data)
    receipt = ballots.spend(db, key, nonce)
    if receipt is None:
        raise ApiError(409, "Жетон уже використано", code="ballot_used")
    pool_answers(db, campaign, questionnaire, key.unit_id, data.answers)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "Жетон уже використано", code="ballot_used")
    return ReceiptOut(receipt=receipt, counted=True, campaign_closed=False)


@router.get("/respond/receipts/{receipt}", response_model=ReceiptOut)
def check_receipt(receipt: str, db: Session = Depends(get_db)):
    """Чи врахована відповідь із цією квитанцією. Без входу: квитанцію знає лише сам учасник."""
    from app.models import SpentBallot

    if len(receipt) != 64 or any(c not in "0123456789abcdef" for c in receipt):
        raise ApiError(422, "Квитанція — 64 шістнадцяткові символи", code="invalid")
    row = db.scalar(select(SpentBallot).where(SpentBallot.receipt == receipt))
    if row is None:
        return ReceiptOut(receipt=receipt, counted=False)
    campaign = db.get(Campaign, row.campaign_id)
    return ReceiptOut(receipt=receipt, counted=True, campaign_closed=campaign.status == CampaignStatus.CLOSED)


@router.get("/campaigns/{campaign_id}/receipts")
def campaign_receipts(campaign_id: uuid.UUID, db: Session = Depends(get_db),
                      _: User = Depends(get_current_user)) -> dict:
    """Публічний список квитанцій закритої хвилі (відсортований, без підрозділів): кожен знайде свою."""
    from app.models import SpentBallot

    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    if campaign.status != CampaignStatus.CLOSED:
        raise ApiError(409, "Список квитанцій публікується після закриття хвилі", code="campaign_not_closed")
    receipts = sorted(db.scalars(select(SpentBallot.receipt).where(SpentBallot.campaign_id == campaign.id)))
    return {"campaign_id": str(campaign.id), "count": len(receipts), "receipts": receipts}


@router.get("/respond/privacy")
def privacy_notice() -> dict:
    """«Що саме ми зберігаємо»: екран перед анкетою. Однаковий для всіх, без входу."""
    s = get_settings()
    return {
        "title": "Що саме ми зберігаємо",
        "modes": {
            "login": [
                "Що ви пройшли анкету (щоб не пустити вдруге) — без відповідей.",
                "Ваші відповіді — окремо, без вашого імені, часу й дати, у зашифрованому буфері до закриття хвилі.",
                "При закритті відповіді переносяться перемішаними, а підрозділ узагальнюється до групи щонайменше "
                f"з {s.min_group_size} людей.",
            ],
            "ballot": [
                "Жетон зі сліпим підписом: сервер підписує його, не бачачи вмісту, тож відповідь не пов'язати з вами.",
                "Квитанція лишається лише у вас: після закриття хвилі перевірте, що відповідь урахована.",
            ],
            "token": [
                "Посилання чи QR не пов'язані з вашим обліковим записом: система не знає навіть, хто пройшов.",
                "Зберігається лише «посилання використано» і відповідь без часу.",
            ],
        },
        "never": ["ПІБ, email, телефон", "вільний текст", "IP-адреса й час подання поруч із відповіддю",
                  "результати груп, менших за k"],
        "min_group_size": s.min_group_size,
        "urn": "Якщо хвиля з «урною», відповіді розшифрують лише двоє з трьох власників частин ключа.",
    }
