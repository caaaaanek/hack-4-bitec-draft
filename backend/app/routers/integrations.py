"""Інтеграції: стан, синхронізація заходів з темою 2, вхідний вебхук статусів від теми 2."""

import hmac
import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import today
from app.config import get_settings
from app.db import get_db
from app.models import Measure, MeasureStatus, Role, User
from app.security import require_roles
from app.services import measures as service

router = APIRouter(prefix="/integrations", tags=["integrations"])
admin_only = require_roles(Role.ADMIN)


class IntegrationStatus(BaseModel):
    fact_sources: list[str]
    shared_fact_key: bool
    theme2_enabled: bool
    theme2_pending: int
    assistant_enabled: bool


class SyncResult(BaseModel):
    sent: int
    failed: int
    pending: int


class ExternalStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    measure_id: uuid.UUID | None = None
    external_id: str | None = Field(default=None, max_length=128)
    status: MeasureStatus
    done_on: date | None = None
    evidence: str = Field(default="", max_length=2000)


@router.get("/status", response_model=IntegrationStatus)
def status(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    """Які інтеграції налаштовано. Ключі не показуються, лише назви джерел."""
    settings = get_settings()
    return {
        "fact_sources": sorted(settings.integration_key_map),
        "shared_fact_key": bool(settings.integration_api_key),
        "theme2_enabled": bool(settings.theme2_url),
        "theme2_pending": service.pending_count(db),
        "assistant_enabled": settings.assistant_enabled,
    }


@router.post("/theme2/sync", response_model=SyncResult)
def sync_theme2(db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    """Надіслати заходи з черги в трекер теми 2. Невдалі повторяться при наступному запуску."""
    if not get_settings().theme2_url:
        raise HTTPException(status_code=409, detail="Інтеграцію з темою 2 не налаштовано (THEME2_URL)")
    result = service.send_pending(db)
    log_action(db, admin, "sync", "theme2", None, result)
    db.commit()
    return result


@router.post("/theme2/measures/status")
def theme2_status_webhook(
    data: ExternalStatusIn,
    x_integration_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Тема 2 повідомляє про зміну статусу заходу (за нашим id або їхнім external_id)."""
    key = get_settings().theme2_api_key
    if not key or not x_integration_key or not hmac.compare_digest(x_integration_key, key):
        raise HTTPException(status_code=401, detail="Невірний ключ інтеграції")
    if data.measure_id is None and not data.external_id:
        raise HTTPException(status_code=422, detail="Потрібен measure_id або external_id")
    conditions = []
    if data.measure_id is not None:
        conditions.append(Measure.id == data.measure_id)
    if data.external_id:
        conditions.append(Measure.external_id == data.external_id)
    measure = db.scalar(select(Measure).where(or_(*conditions)))
    if measure is None:
        raise HTTPException(status_code=404, detail="Захід не знайдено")
    if data.status == MeasureStatus.DONE and not (data.evidence or measure.evidence):
        raise HTTPException(status_code=422, detail="Виконання підтверджується доказом (evidence)")
    measure.status = data.status
    if data.evidence:
        measure.evidence = data.evidence
    measure.done_on = (data.done_on or today()) if data.status == MeasureStatus.DONE else None
    log_action(db, None, "external_status", "measure", measure.id, {"source": "theme2", "status": data.status.value})
    db.commit()
    return {"id": str(measure.id), "status": measure.status.value}
