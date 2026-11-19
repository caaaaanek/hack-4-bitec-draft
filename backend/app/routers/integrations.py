"""Інтеграції: стан, синхронізація заходів з Mitra (тема 2), вхідний вебхук статусів від Mitra.

Контракт: docs/contracts/integra-mitra.yaml."""

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import Role, User
from app.security import keys_equal, require_roles
from app.services import measures as service

router = APIRouter(prefix="/integrations", tags=["integrations"])
admin_only = require_roles(Role.ADMIN)


class FailedMessage(BaseModel):
    measure_id: str | None
    title: str | None
    attempts: int
    last_error: str
    created_at: datetime


class IntegrationStatus(BaseModel):
    fact_sources: list[str]
    shared_fact_key: bool
    theme2_enabled: bool
    theme2_pending: int
    theme2_failed: list[FailedMessage] = []
    theme2_public_url: str | None = None
    theme2_auto_sync_seconds: float = 0
    assistant_enabled: bool


class SyncResult(BaseModel):
    sent: int
    failed: int
    pending: int


class DocumentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    sha256: str = Field(min_length=64, max_length=64)
    verify_url: str | None = Field(default=None, max_length=1000)


class EvidenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(default="", max_length=4000, description="Опис результату виконання")
    documents: list[DocumentIn] = Field(default_factory=list, max_length=20)


class ExternalStatusIn(BaseModel):
    """Подія з Mitra. Новий формат: `state` + структурований `evidence`. Старий (`status` нашими словами,
    `evidence` рядком) теж приймається."""

    model_config = ConfigDict(extra="forbid")

    contract: str | None = Field(default=None, max_length=32)
    event_id: str | None = Field(default=None, max_length=128, description="Для журналу; повтори безпечні й без нього")
    occurred_at: datetime | None = Field(default=None, description="Час події в Mitra: старіші події ігноруються")
    measure_id: uuid.UUID | None = None
    external_id: str | None = Field(default=None, max_length=128)
    state: str | None = Field(default=None, max_length=32,
                              description="inbox | linked | rejected | planned | in_progress | on_review | returned "
                                          "| done | partial | not_done")
    status: str | None = Field(default=None, max_length=32, description="Старий формат: planned | in_progress | done | cancelled")
    mitra_status: str | None = Field(default=None, max_length=32, description="Статус у Mitra як є, для журналу")
    url: str | None = Field(default=None, max_length=1000, description="Посилання на захід у Mitra")
    done_on: date | None = None
    comment: str = Field(default="", max_length=2000, description="Причина відхилення чи невиконання")
    evidence: EvidenceIn | str | None = None

    @model_validator(mode="after")
    def need_state(self):
        if not (self.state or self.status):
            raise ValueError("Потрібен state (або status у старому форматі)")
        if self.measure_id is None and not self.external_id:
            raise ValueError("Потрібен measure_id або external_id")
        return self


@router.get("/status", response_model=IntegrationStatus)
def status(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    """Які інтеграції налаштовано. Ключі не показуються, лише назви джерел."""
    settings = get_settings()
    failed = [{"measure_id": x.payload.get("id"), "title": x.payload.get("title"), "attempts": x.attempts,
               "last_error": x.last_error, "created_at": x.created_at} for x in service.failed_messages(db)]
    return {
        "fact_sources": sorted(settings.integration_key_map),
        "shared_fact_key": bool(settings.integration_api_key),
        "theme2_enabled": bool(settings.theme2_url),
        "theme2_pending": service.pending_count(db),
        "theme2_failed": failed,
        "theme2_public_url": service.public_origin() if settings.theme2_url else None,
        "theme2_auto_sync_seconds": settings.theme2_sync_seconds if settings.theme2_url else 0,
        "assistant_enabled": settings.assistant_enabled,
    }


@router.post("/theme2/sync", response_model=SyncResult)
def sync_theme2(retry_failed: bool = False, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    """Надіслати заходи з черги в Mitra. Невдалі повторяться при наступному запуску.
    `retry_failed=true` повертає в чергу й ті, що Mitra відхилила або що вичерпали спроби."""
    if not get_settings().theme2_url:
        raise HTTPException(status_code=409, detail="Інтеграцію з темою 2 не налаштовано (THEME2_URL)")
    requeued = service.retry_failed(db) if retry_failed else 0
    result = service.send_pending(db)
    log_action(db, admin, "sync", "theme2", None, {**result, "requeued": requeued})
    db.commit()
    return result


@router.post("/theme2/measures/status")
def theme2_status_webhook(
    data: ExternalStatusIn,
    x_integration_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Mitra повідомляє про зміну стану заходу (за нашим `measure_id` або їхнім `external_id`).

    «Виконано» — лише з доказом: опис результату або документи з sha256 і посиланням на перевірку в Mitra.
    Повтор тієї ж події безпечний (`changed: false`), старіша за вже отриману (`occurred_at`) ігнорується."""
    key = get_settings().theme2_api_key
    if not keys_equal(x_integration_key, key):
        raise HTTPException(status_code=401, detail="Невірний ключ інтеграції")
    try:
        measure = service.find_measure(db, data.measure_id, data.external_id)
        if measure is None:
            raise HTTPException(status_code=404, detail="Захід не знайдено")
        if isinstance(data.evidence, EvidenceIn):
            summary, documents = data.evidence.summary, [d.model_dump() for d in data.evidence.documents]
        else:
            summary, documents = data.evidence or "", []
        if not summary.strip() and not documents and (data.state or data.status) == "done" and measure.evidence:
            summary = measure.evidence  # старий формат: доказ уже внесено в нас
        result = service.apply_external_update(
            db, measure, state=(data.state or data.status or "").lower(), external_id=data.external_id,
            occurred_at=data.occurred_at, done_on=data.done_on, comment=data.comment, summary=summary,
            documents=documents, url=data.url)
    except service.ExternalUpdateError as e:
        raise ApiError(e.status_code, str(e), code=e.code) from e
    if result["changed"]:
        log_action(db, None, "external_status", "measure", measure.id,
                   {"source": "theme2", "state": result.get("external_state"), "status": result["status"],
                    "from_status": result.get("from_status"), "mitra_status": data.mitra_status,
                    "event_id": data.event_id, "documents": len(documents)})
    db.commit()
    return result
