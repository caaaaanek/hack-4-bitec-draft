"""Асистент для frontend-proto: `GET/POST /api/assistant` (без префікса /api/v1, як очікує фронтенд).

Контракт фронтенду:
- `GET`  → `{"live": bool, "model": str | null}` — чи налаштовано модель (без секретів);
- `POST` `{"question", "context", "history"}` → `{"text", "model"}`; 503, якщо модель не налаштовано
  (тоді фронтенд відповідає шаблонами правил), 502 — модель не відповіла.

Правила ті самі, що й для `/api/v1/assistant/ask`: модель лише пояснює вже пораховані правилами числа, нічого
не змінює; у контексті лише агрегати груп ≥ k, які користувач і так бачить; заборонені сервіси й моделі з
FORBIDDEN_MARKERS не викликаються; текст запитань у журнал не пишеться.
"""

import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.db import get_db
from app.models import User
from app.routers.assistant import check_allowed
from app.security import RESULT_READERS, require_roles

router = APIRouter(tags=["assistant"])

GROQ_URL = "https://api.groq.com/openai/v1"
MAX_CONTEXT = 30000

SYSTEM = """Ти — асистент інформаційно-аналітичної системи оцінювання доброчесності закладу сектору безпеки і оборони.
Відповідай українською, коротко й по суті: до 120 слів, якщо не просять чернетку звіту (тоді до 200 слів).

Жорсткі правила:
- Усі числа, рівні зрілості, прапорці та рекомендації вже розраховані явними правилами системи й передані тобі в JSON. Використовуй лише ці числа. Нічого не перераховуй і не вигадуй нових оцінок, рівнів чи статусів.
- Ти не ухвалюєш рішень: не приймаєш і не відхиляєш рекомендацій, не змінюєш статусів, не ставиш оцінок. Можеш лише пояснити або запропонувати формулювання, яке затвердить посадова особа.
- Не роби висновків про конкретних людей, командирів чи підрозділи і не порівнюй підрозділи між собою. Оцінювання — інструмент розвитку, а не покарання.
- Коли пояснюєш, називай правило або формулу, з якої взялося число (наприклад: «зараховано = min(самооцінка; факти + 25)»).
- Якщо в даних немає відповіді, так і скажи.
- Простий текст без Markdown: без заголовків, зірочок і таблиць; списки — рядками з «• ».

Методика (для пояснень): самооцінка компонента S = зважене середнє джерел (особовий склад, робоча група, експерти, чек-лист; ваги в даних); факти F — середнє балів показників «X з Y» за порогами; зараховано L = min(S; F + 25); індекс = середнє трьох компонентів; рівні 1–5 з межами 12,5 · 37,5 · 62,5 · 87,5; достовірність A/B/C за прапорцями."""


class LlmIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    context: dict | list | None = None
    history: list[dict] = Field(default_factory=list, max_length=20)


class LlmOut(BaseModel):
    text: str
    model: str


class LlmStatus(BaseModel):
    live: bool
    model: str | None


# Помилки виклику моделі: мережа, HTTP-статус, неочікувана відповідь.
CHAT_ERRORS = (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError)


def chat(base: str, key: str, model: str, messages: list[dict]) -> str:
    """Один виклик OpenAI-сумісного /chat/completions (Ollama, vLLM, Groq). Ключ — як Bearer, якщо задано."""
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    r = httpx.post(f"{base}/chat/completions", headers=headers, timeout=get_settings().llm_timeout_seconds,
                   json={"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 600})
    r.raise_for_status()
    return (r.json()["choices"][0]["message"]["content"] or "").strip()


def endpoint() -> tuple[str, str, str] | None:
    s = get_settings()
    base = (s.llm_base_url or (GROQ_URL if s.llm_api_key else "")).rstrip("/")
    if not base:
        return None
    return base, s.llm_api_key, s.llm_model


@router.get("/api/assistant", response_model=LlmStatus)
def status():
    """Чи доступна модель. Без секретів і без входу (фронтенд показує перемикач режиму)."""
    ep = endpoint()
    return LlmStatus(live=ep is not None, model=ep[2] if ep else None)


@router.post("/api/assistant", response_model=LlmOut)
def ask(data: LlmIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*RESULT_READERS))):
    ep = endpoint()
    if ep is None:
        raise HTTPException(status_code=503, detail="Асистента не налаштовано: відповіді дають шаблони правил")
    base, key, model = ep
    check_allowed(base, model)
    ctx = json.dumps(data.context or {}, ensure_ascii=False)
    if len(ctx) > MAX_CONTEXT:
        raise HTTPException(status_code=413, detail="Завеликий контекст")

    messages = [{"role": "system", "content": SYSTEM}]
    for m in data.history[-4:]:
        if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str):
            messages.append({"role": m["role"], "content": m["content"][:2000]})
    messages.append({"role": "user", "content": f"Дані поточного циклу (агреговані, JSON):\n{ctx}\n\nЗапитання: {data.question.strip()}"})

    try:
        text = chat(base, key, model, messages)
    except CHAT_ERRORS:
        raise HTTPException(status_code=502, detail="Модель не відповіла. Спробуйте ще раз або вимкніть асистента")
    if not text:
        raise HTTPException(status_code=502, detail="Модель повернула порожню відповідь")
    # Текст запитання й відповіді не зберігаємо: лише факт звернення.
    log_action(db, user, "ask", "assistant", None, {"model": model, "question_chars": len(data.question)})
    db.commit()
    return LlmOut(text=text, model=model)
