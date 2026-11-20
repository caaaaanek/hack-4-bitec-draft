"""Сценарій «що, якщо»: що зрушить індекс. Лише прогноз, нічого не записується (ні знімків, ні журналу)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ApiError
from app.models import Campaign, CampaignStatus, User
from app.security import RESULT_READERS, ensure_unit_access, require_roles
from app.services import what_if

router = APIRouter(tags=["what-if"])


class WhatIfIn(BaseModel):
    unit_id: uuid.UUID | None = Field(default=None, description="Підрозділ; порожньо — підрозділ хвилі (заклад)")
    measure_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200,
                                         description="Заходи: кожен закриває свій пункт чек-листа за catalog_number")
    checklist: dict[str, str] = Field(default_factory=dict, max_length=200,
                                      description="Пункт чек-листа → full | partial | none (підтверджено)")
    facts: dict[str, float] = Field(default_factory=dict, max_length=20,
                                    description="Факт → цільовий відсоток 0–100; бал через пороги методики")
    levers: bool = Field(default=True, description="Порахувати топ-5 важелів (≈40 розрахунків)")


@router.post("/campaigns/{campaign_id}/what-if")
def what_if_scenario(campaign_id: uuid.UUID, data: WhatIfIn, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*RESULT_READERS))):
    """Прогноз індексу, якщо закрити пункти чек-листа, виконати заходи або підтягнути факти.

    Розрахунок тією ж `scoring.compute`, що й знімок хвилі. Відповідь: `baseline`, `scenario` (індекс і компоненти
    з `rule` і `explanation`), `delta`, `applied` (що застосовано й чому ні), `levers` (топ-5 важелів із готовим
    `scenario` для повторного запиту), `options` (пункти чек-листа й факти з порогами), `disclaimer`.
    Опитування не моделюються. Чек-лист — лише для всього закладу. Прихований факт (менше k) → 422.
    """
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    if campaign.status != CampaignStatus.CLOSED:
        raise ApiError(409, "Сценарій доступний після закриття хвилі", code="campaign_not_closed")
    ensure_unit_access(db, user, data.unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    try:
        return what_if.simulate(db, campaign, data.unit_id, data.measure_ids, data.checklist, data.facts, data.levers)
    except what_if.WhatIfError as e:
        raise ApiError(422, e.message, code=e.code, hint=e.hint or None)
    finally:
        db.rollback()  # нічого не записуємо, навіть випадково
