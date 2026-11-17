from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import check_settings, get_settings
from app.routers import (
    admin,
    assistant,
    auth,
    campaigns,
    checklist,
    dashboard,
    indicators,
    integrations,
    measures,
    questionnaires,
    recommendations,
    reports,
    respond,
    results,
)

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Без надійного секрету JWT застосунок не стартує.
    check_settings(get_settings())
    yield


app = FastAPI(
    title="Integrity Management Dashboard API",
    version="0.2.0",
    description="Опитувальники, конструктор анкет, ролі, хвилі оцінювання, Integrity Index, "
    "рекомендації, трекер заходів, журнал дій з ланцюжком хешів.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (auth, admin, questionnaires, campaigns, respond, checklist, indicators, results,
               dashboard, recommendations, measures, reports, integrations, assistant):
    app.include_router(module.router, prefix=API_PREFIX)


@app.get("/health", tags=["service"])
def health():
    return {"status": "ok"}
