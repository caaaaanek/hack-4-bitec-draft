"""Підготовка керівника: «Адвокат диявола» і агент-черговий («що впало, чому, як виправити»).

Обидва працюють на явних правилах і без ШІ. Модель (якщо підключена) лише перефразовує питання
адвоката, а числа в її тексті звіряються з оригіналом.
"""

import json
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import now
from app.db import get_db
from app.models import Measure, Role, User
from app.routers import llm
from app.routers.recommendations import build, closed_campaign, with_decisions
from app.security import RESULT_READERS, ensure_unit_access, home_unit, require_roles
from app.services import devils_advocate, facts, watchdog
from app.services import measures as measures_service
from app.services.units import subtree_ids

router = APIRouter(tags=["insights"])


class Evidence(BaseModel):
    label: str
    value: float | int | None
    text: str
    path: str = Field(description="Де це число в результатах хвилі (для переходу на екран)")


class AdvocateQuestion(BaseModel):
    n: int
    id: str
    rule_id: str
    severity: int = Field(description="Вага правила: що вище, то неприємніше питання")
    category: str
    question: str
    original_question: str | None = Field(default=None, description="Текст правила, якщо питання перефразувала модель")
    why: str = Field(description="Правило й числа, з яких виникло питання")
    evidence: list[Evidence]
    prepare: str = Field(description="Що підготувати до відповіді")
    link: dict


class RuleOut(BaseModel):
    id: str
    description: str


class AdvocateOut(BaseModel):
    campaign_id: uuid.UUID
    campaign_title: str
    unit_id: uuid.UUID
    unit_name: str
    generated_at: str
    questions: list[AdvocateQuestion]
    total_found: int
    rules: list[RuleOut]
    rephrased_by_model: str | None = Field(default=None, description="Модель, яка перефразувала питання, або null")
    note: str


NOTE = ("Питання сформовано явними правилами з чисел цієї хвилі; той самий вхід дає той самий результат. "
        "Питання стосуються системи доброчесності, а не окремих людей.")


def rephrase(questions: list[dict]) -> str | None:
    """Модель робить формулювання жорсткішими й живішими. Числа не змінюються: якщо в новому тексті є число,
    якого не було в правилі й доказах, лишається оригінал. Повертає назву моделі або None."""
    ep = llm.endpoint()
    if ep is None or not questions:
        return None
    try:
        llm.check_allowed(ep[0], ep[2])
    except HTTPException:
        return None
    base, key, model = ep
    payload = [{"id": q["id"], "question": q["question"]} for q in questions]
    messages = [
        {"role": "system", "content": "Ти — суворий зовнішній аудитор системи доброчесності (стиль оцінювання НАТО "
         "Building Integrity). Перефразуй кожне питання коротко й гостро, українською. Не додавай нових чисел, "
         "фактів чи імен; не оцінюй людей. Відповідай лише JSON-об'єктом {\"id\": \"нове питання\"}."},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    try:
        raw = llm.chat(base, key, model, messages)
        start, end = raw.find("{"), raw.rfind("}")
        texts = json.loads(raw[start:end + 1]) if start >= 0 else {}
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        return None
    used = False
    for q in questions:
        text = texts.get(q["id"]) if isinstance(texts, dict) else None
        if not isinstance(text, str) or not text.strip():
            continue
        sources = [q["question"], q["why"]] + [e["text"] for e in q["evidence"]]
        if llm.new_numbers(text, *sources):
            continue
        q["original_question"], q["question"] = q["question"], text.strip()[:600]
        used = True
    return model if used else None


@router.get("/campaigns/{campaign_id}/devils-advocate", response_model=AdvocateOut)
def devils_advocate_questions(
    campaign_id: uuid.UUID,
    unit_id: uuid.UUID | None = None,
    limit: int = Query(default=10, ge=1, le=30),
    rephrase_with_model: bool = Query(default=False, alias="rephrase",
                                      description="Перефразувати моделлю (якщо підключена); числа не змінюються"),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """«Адвокат диявола»: найнеприємніші питання аудитора до результатів хвилі, кожне з посиланням на число."""
    campaign = closed_campaign(db, campaign_id)
    if unit_id is None and user.role == Role.LEADER:
        unit_id = user.unit_id
    ensure_unit_access(db, user, unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    data, recs = build(db, campaign, unit_id)
    scope = uuid.UUID(data["unit_id"])
    signals = facts.risk_signals(db, scope, 3, campaign.closed_on, campaign.min_group_size)
    decided = with_decisions(db, campaign, scope, recs)
    measures = measures_service.to_dicts(db, list(db.scalars(
        select(Measure).where(Measure.unit_id.in_(subtree_ids(db, scope))).order_by(Measure.due_date))))
    result = devils_advocate.questions(data, signals, decided, measures, limit)
    model = rephrase(result["questions"]) if rephrase_with_model else None
    log_action(db, user, "devils_advocate", "campaign", campaign.id,
               {"unit_id": str(scope), "questions": len(result["questions"]), "rephrased": bool(model)})
    db.commit()
    return {"campaign_id": campaign.id, "campaign_title": campaign.title, "unit_id": scope,
            "unit_name": data["unit_name"], "generated_at": now().isoformat(timespec="seconds"),
            **result, "rephrased_by_model": model, "note": NOTE}


# ---------- Агент-черговий ----------

class DigestItem(BaseModel):
    id: str
    category: str = Field(description="drop | rise | technical | process")
    severity: str = Field(description="critical | warning | info")
    title: str
    what: str
    why: str
    fix: list[str]
    link: dict
    data: dict = Field(default_factory=dict)


class DigestOut(BaseModel):
    generated_at: str
    unit_id: uuid.UUID | None
    unit_name: str | None
    status: str = Field(description="ok | attention | critical")
    summary: str
    counts: dict[str, int]
    items: list[DigestItem]
    note: str


@router.get("/agent/digest", response_model=DigestOut)
def agent_digest(
    unit_id: uuid.UUID | None = None,
    include_info: bool = Query(default=False, description="Додати інформаційні пункти («падінь немає», «зросло на…»)"),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*RESULT_READERS)),
):
    """Агент-черговий: що знизилось і чому (за джерелами), технічні збої, що прострочено — і як виправити.

    Кожна роль отримує лише те, що може виправити (watchdog.audience): керівник — падіння, рекомендації без
    рішення, заходи; уповноважений — технічні збої, участь, план хвилі; аудит — цілісність журналу й
    підтвердження чек-листа; Департамент — нічого. Інформаційні пункти — лише з include_info=true.
    """
    # Без unit_id — свій підрозділ (керівник, зональні уповноважений і аудит) чи корінь дерева. Доступ перевіряється
    # завжди: раніше без unit_id огляд кореня отримував і той, хто корінь не бачить (департамент, зональний аудит).
    if unit_id is None:
        unit_id = home_unit(db, user)
    if unit_id is not None:
        ensure_unit_access(db, user, unit_id)
    return watchdog.digest(db, unit_id, role=user.role, include_info=include_info)
