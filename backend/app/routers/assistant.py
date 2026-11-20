"""Опційний асистент (чат-бот). Вимкнено за замовчуванням (ASSISTANT_ENABLED=false).

Правила:
- бачить лише агрегати й пояснення `rule` знімка та рекомендації, без імен, логінів і відповідей;
- нічого не рахує й не змінює: бали, рівні, статуси дають тільки правила, захід створює людина;
- модель локальна (Ollama) або дозволена; моделі й сервіси з РФ, РБ і китайські хмари заборонені;
- якщо задано LLM_* (наприклад, self-hosted Gemma з ключем), обидва асистенти працюють з тією самою моделлю;
- система повністю працює з вимкненим асистентом.
"""

import ipaddress
import json
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlparse

import httpx

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.db import get_db
from app.models import User
from app.routers.recommendations import build, closed_campaign
from app.security import RESULT_READERS, campaign_visible, ensure_unit_access, require_roles

router = APIRouter(prefix="/assistant", tags=["assistant"])

# Частини адрес і назв моделей, які використовувати заборонено (Політика ШІ команди).
FORBIDDEN_MARKERS = (
    "deepseek", "qwen", "dashscope", "aliyun", "moonshot", "kimi", "baidu", "ernie", "zhipu", "glm",
    "yandex", "gigachat", "sber", ".ru", ".by",
)

DISCLAIMER = "Відповідь асистента лише пояснює наявні результати. Бали й рекомендації розраховують правила, рішення ухвалює людина."


class AskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    campaign_id: uuid.UUID
    unit_id: uuid.UUID | None = None
    question: str = Field(min_length=3, max_length=500)


class AskOut(BaseModel):
    answer: str
    model: str
    disclaimer: str
    context_keys: list[str]


def is_internal_host(url: str) -> bool:
    """Адреса в закритому контурі: localhost, приватні й службові IP, імена без домену (сервіс docker compose),
    .local / .internal / .lan і host.docker.internal. DNS не запитується."""
    host = (urlparse(url).hostname or "").lower().rstrip(".")
    if not host:
        return False
    try:
        addr = ipaddress.ip_address(host)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except ValueError:
        pass
    return ("." not in host or host == "localhost" or host == "host.docker.internal"
            or host.endswith((".local", ".internal", ".lan", ".localhost")))


def check_allowed(url: str, model: str) -> None:
    host = (urlparse(url).hostname or "").lower()
    name = model.lower()
    for marker in FORBIDDEN_MARKERS:
        if marker.startswith("."):
            hit = host.endswith(marker)
        else:
            hit = marker in host or marker in name
        if hit:
            raise HTTPException(status_code=503, detail="Налаштована модель або сервіс заборонені політикою використання ШІ")
    # Закритий контур: дані з системи не йдуть у зовнішню мережу, якщо це явно не дозволено.
    if not is_internal_host(url) and not get_settings().llm_allow_external:
        raise HTTPException(status_code=503, detail="Модель поза закритим контуром: зовнішні сервіси вимкнено "
                                                    "(LLM_ALLOW_EXTERNAL=false). Решта системи працює без асистента")


def build_context(result: dict, recs: list[dict]) -> dict:
    """Лише агрегати: індекс, компоненти з правилами, прапорці, топ-рекомендації."""
    return {
        "unit": result["unit_name"],
        "wave": result["campaign_title"],
        "index": {k: result["index"][k] for k in ("score", "self_score", "level", "reliability", "reliability_reasons", "rule")},
        "components": [
            {"title": c["title"], "score": c["score"], "self_score": c["self_score"], "facts_score": c["facts_score"],
             "reliability": c["reliability"], "flags": [f["title"] for f in c["flags"]], "rule": c["rule"]}
            for c in result["components"]
        ],
        "summary": result["summary"],
        "recommendations": [{"title": r["title"], "priority": r["priority_title"], "rule": r["rule"]} for r in recs[:8]],
    }


def target() -> tuple[str, str]:
    """(адреса, модель) асистента. Якщо задано LLM_* (OpenAI-сумісна модель із ключем, напр. self-hosted Gemma),
    обидва асистенти працюють з нею; інакше — ASSISTANT_URL/ASSISTANT_MODEL (Ollama /api/generate)."""
    from app.routers import llm  # llm імпортує check_allowed звідси

    ep = llm.endpoint()
    if ep is not None:
        return f"{ep[0]}/chat/completions", ep[2]
    settings = get_settings()
    return settings.assistant_url, settings.assistant_model


def call_model(prompt: str) -> str:
    from app.routers import llm

    ep = llm.endpoint()
    if ep is not None:
        base, key, model = ep
        return llm.chat(base, key, model, [{"role": "user", "content": prompt}])
    settings = get_settings()
    body = json.dumps({"model": settings.assistant_model, "prompt": prompt, "stream": False}).encode()
    request = urllib.request.Request(settings.assistant_url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=settings.assistant_timeout_seconds) as response:  # noqa: S310 (адреса з конфігу)
        return json.loads(response.read()).get("response", "").strip()


@router.post("/ask", response_model=AskOut)
def ask(data: AskIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*RESULT_READERS))):
    settings = get_settings()
    if not settings.assistant_enabled:
        raise HTTPException(status_code=404, detail="Асистента вимкнено в налаштуваннях")
    url, model = target()
    check_allowed(url, model)
    campaign = closed_campaign(db, data.campaign_id)
    # campaign_id тут у тілі запиту, тож campaign_zone_guard його не бачить: хвиля поза зоною — як відсутня.
    if not campaign_visible(db, user, campaign):
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    ensure_unit_access(db, user, data.unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    result, recs = build(db, campaign, data.unit_id)
    context = build_context(result, recs)
    prompt = (
        "Ти помічник керівника з питань доброчесності. Відповідай українською, коротко, лише на основі даних нижче. "
        "Не вигадуй чисел. Не змінюй бали й рівні. Якщо даних бракує, так і скажи. "
        "Простий текст без Markdown: без зірочок і заголовків; списки — рядками з «• ».\n\n"
        f"ДАНІ (JSON):\n{json.dumps(context, ensure_ascii=False)}\n\nПИТАННЯ: {data.question}\n"
    )
    try:
        answer = call_model(prompt)
    except (urllib.error.URLError, OSError, ValueError, KeyError, IndexError, TypeError, httpx.HTTPError):
        raise HTTPException(status_code=503, detail="Асистент тимчасово недоступний. Решта системи працює.")
    # Питання й відповідь не логуються дослівно: лише факт звернення.
    log_action(db, user, "ask", "assistant", campaign.id, {"unit_id": result["unit_id"]})
    db.commit()
    return {"answer": answer, "model": model, "disclaimer": DISCLAIMER, "context_keys": sorted(context)}
