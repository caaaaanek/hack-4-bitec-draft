"""Публічні службові точки: налаштування для фронтенду і перевірка стану."""

import time

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import ORG_TERMS, get_settings
from app.db import get_db
from app.services import methodology
from app.services.evidence import ALLOWED_TYPES

router = APIRouter(tags=["service"])
health_router = APIRouter(tags=["service"])


class AuthModes(BaseModel):
    password: bool
    proxy: bool


class EvidenceLimits(BaseModel):
    max_bytes: int
    max_files_per_item: int
    allowed_extensions: list[str]


class Policies(BaseModel):
    """Політики розгортання, від яких залежить інтерфейс (які кнопки показувати)."""

    four_eyes: bool
    # Завжди false і true відповідно: паролі лише за запрошенням, люди й підрозділи — лише технічний адміністратор.
    # Поля лишено для сумісності з фронтендом.
    admin_sets_passwords: bool = False
    staff_token_only: bool
    leader_child_details: bool
    separate_tech_admin: bool = True
    checklist_confirmers: list[str]
    # Пункт «повністю» чи «частково» підтверджується лише з файлом-доказом (CHECKLIST_REQUIRE_FILE).
    checklist_require_file: bool = True
    external_fetch: bool
    # demo | production (SECURITY_PROFILE) і які запобіжники production явно вимкнено змінними оточення.
    security_profile: str = "demo"
    overridden: list[str] = []


class PublicConfig(BaseModel):
    api_version: str
    methodology_version: str
    # Поріг k: єдине джерело для фронтенду. Групи, менші за k, приходять з null і suppressed.
    min_group_size: int
    timezone: str
    root_path: str
    auth: AuthModes
    evidence: EvidenceLimits
    # Як називати кореневу одиницю (ORG_KIND): {"nominative": "заклад", "genitive": ..., "plural": ..., "full": ...}
    org_terms: dict[str, str] = {}
    policies: Policies | None = None


@router.get("/config", response_model=PublicConfig)
def public_config():
    """Налаштування, потрібні фронтенду до входу. Без секретів і без даних."""
    from app.main import API_VERSION  # уникаємо циклічного імпорту

    s = get_settings()
    return PublicConfig(
        api_version=API_VERSION,
        methodology_version=methodology.METHODOLOGY_VERSION,
        min_group_size=s.min_group_size,
        timezone=s.timezone,
        root_path=s.root_path,
        auth=AuthModes(password=s.password_login_enabled, proxy=s.proxy_auth_enabled),
        evidence=EvidenceLimits(
            max_bytes=s.evidence_max_bytes,
            max_files_per_item=s.evidence_max_files_per_item,
            allowed_extensions=sorted(ALLOWED_TYPES),
        ),
        org_terms=ORG_TERMS[s.org_kind],
        policies=Policies(
            four_eyes=s.four_eyes_enabled, admin_sets_passwords=False,
            staff_token_only=s.staff_token_only, leader_child_details=s.leader_child_details,
            separate_tech_admin=True,
            checklist_confirmers=[c.strip() for c in s.checklist_confirmers.split(",") if c.strip()],
            checklist_require_file=s.checklist_require_file,
            external_fetch=s.external_fetch_enabled,
            security_profile=s.security_profile,
            overridden=s.profile_overrides,
        ),
    )


class HealthOut(BaseModel):
    status: str
    database: str
    latency_ms: float | None = None


@health_router.get("/health", response_model=HealthOut, responses={503: {"model": HealthOut}})
def health(db: Session = Depends(get_db)):
    """Готовність: процес живий і БД відповідає. 503, якщо БД недоступна (для healthcheck і балансувальника)."""
    started = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 — будь-яка помилка БД означає «не готовий»
        return JSONResponse({"status": "error", "database": "unavailable", "latency_ms": None}, status_code=503)
    return HealthOut(status="ok", database="ok", latency_ms=round((time.perf_counter() - started) * 1000, 1))
