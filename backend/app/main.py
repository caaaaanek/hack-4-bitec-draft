import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import errors
from app.config import check_settings, get_settings
from app.schemas import ERROR_RESPONSES
from app.routers import (
    admin,
    assistant,
    auth,
    campaigns,
    checklist,
    checks,
    dashboard,
    indicators,
    insights,
    integrations,
    learning,
    measures,
    normative,
    questionnaires,
    recommendations,
    reports,
    respond,
    results,
    what_if,
)
from app.routers import autopilot as autopilot_router
from app.routers import department, dictionaries, insights_plus, risks, urn
from app.routers import config as config_router
from app.services import autopilot as autopilot_service
from app.services import measures as measures_service
from app.routers import llm as llm_router

API_PREFIX = "/api/v1"

_TOKEN_PATH = re.compile(r"(/s/|/q/|/respond/qr/)[^/?#\s]+")
# Анкети й подання: рядок журналу доступу (IP і час поруч із поданням) не пишемо зовсім.
_ANON_PATH = re.compile(r"/api/v1/(respond/|campaigns/[^/]+/questionnaires/[^/]+/(form|responses|ballot|ballot-key)\b)")


class RedactTokenPaths(logging.Filter):
    """Одноразові посилання /s/<токен> і коди QR (/q/<код>, /respond/qr/<код>) не потрапляють у журнал uvicorn
    (як і в журнал nginx: access_log off): скан не лишає часу й IP поруч із кодом групи.

    Потрібно, коли сторінки віддає сам API (FRONTEND_DIST, run-local.sh). Запит до API токен несе
    лише в заголовку X-Response-Token, який uvicorn не журналює.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) >= 3 and isinstance(record.args[2], str):
            args = list(record.args)
            anonymous = bool(_ANON_PATH.search(args[2]))
            args[2] = _TOKEN_PATH.sub(r"\1***", args[2])
            record.args = tuple(args)
            if anonymous:
                return False  # адреси анкет і подань: рядок журналу доступу не пишемо зовсім
        elif isinstance(record.msg, str) and _TOKEN_PATH.search(record.msg):
            record.msg = _TOKEN_PATH.sub(r"\1***", record.msg)
        return True


logging.getLogger("uvicorn.access").addFilter(RedactTokenPaths())
API_VERSION = "0.3.0"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Без надійного секрету JWT застосунок не стартує.
    check_settings(get_settings())
    _load_registries()
    autopilot_service.start()
    measures_service.start_sync()
    yield
    measures_service.stop_sync()
    autopilot_service.stop()


def _load_registries() -> None:
    """Факти довідника — у methodology.FACTS (див. services/fact_registry.py)."""
    from app.db import SessionLocal
    from app.services import fact_registry

    try:
        with SessionLocal() as db:
            fact_registry.refresh(db)
    except Exception:  # noqa: BLE001 — БД ще недоступна: факти довідника підвантажаться з першим запитом
        logging.getLogger(__name__).warning("Довідник фактів не завантажено на старті")


settings = get_settings()

app = FastAPI(
    title="Integra API",
    version=API_VERSION,
    description="Опитувальники, конструктор анкет, ролі, хвилі оцінювання, Integrity Index, "
    "рекомендації, трекер заходів, журнал дій з ланцюжком хешів.\n\n"
    "Помилки мають вигляд `{code, message, hint, detail, errors?, request_id}`. Поля відповідей у `snake_case`.",
    lifespan=lifespan,
    # За зворотним проксі під підшляхом (наприклад /imd): ROOT_PATH=/imd.
    root_path=settings.root_path,
)

errors.install(app)

# Токен передається в заголовку Authorization, а не в cookie, тому credentials не потрібні.
# Із «*» і credentials браузер усе одно відмовив би, тож тут їх не вмикаємо взагалі.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", errors.REQUEST_ID_HEADER, "X-Response-Token"],
    expose_headers=[errors.REQUEST_ID_HEADER, "Retry-After", "Content-Disposition"],
    max_age=600,
)

for module in (config_router, auth, admin, questionnaires, campaigns, respond, checklist, checks, indicators, results,
               dashboard, recommendations, measures, reports, integrations, assistant, what_if, insights, normative,
               learning, autopilot_router, dictionaries, department, insights_plus, urn, risks):
    app.include_router(module.router, prefix=API_PREFIX, responses=ERROR_RESPONSES)

# /api/assistant — асистент frontend-proto (шлях без /api/v1, як очікує фронтенд).
app.include_router(llm_router.router, responses=ERROR_RESPONSES)

# /health і /api/v1/health: перевірка процесу й БД (див. routers/config.py).
app.include_router(config_router.health_router)
app.include_router(config_router.health_router, prefix=API_PREFIX, include_in_schema=False)

# FRONTEND_DIST=../frontend-proto/dist: API сам віддає сторінки (один процес, один порт). Реєструється останнім,
# щоб /api, /docs і /health мали пріоритет.
if settings.frontend_dist:
    from app.frontend import mount_frontend

    if not mount_frontend(app, settings.frontend_dist):
        import logging

        logging.getLogger(__name__).warning(
            "FRONTEND_DIST=%s: немає index.html, фронтенд не підключено (зберіть: cd frontend-proto && npm run build)",
            settings.frontend_dist)
