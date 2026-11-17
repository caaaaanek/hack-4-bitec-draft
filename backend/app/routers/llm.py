"""Асистент для frontend-proto: `GET/POST /api/assistant` (без префікса /api/v1, як очікує фронтенд).

Контракт фронтенду:
- `GET`  → `{"live": bool, "model": str | null}` — чи налаштовано модель (без секретів);
- `POST` `{"question", "history", "unit_id"?}` → `{"text", "model", "tools"}`: tool calling — модель сама викликає
  інструменти бекенду (`services/assistant_tools.py`: методика, результати, рекомендації, заходи, динаміка) з правами
  користувача. Якщо модель не вміє tools, бекенд сам підкладає основні дані в запит.
- `POST` з `context` (демо-режим фронтенду з синтетичними даними) — як раніше: модель пояснює лише надіслані дані.
- 503, якщо модель не налаштовано (тоді фронтенд відповідає шаблонами правил), 502 — модель не відповіла.

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
from app.services import assistant_tools

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


# Режим інструментів (без context від фронтенду): числа й методику модель бере лише з інструментів бекенду,
# тож методика не дублюється в промпті й не розходиться з розрахунком.
SYSTEM_TOOLS = """Ти — асистент інформаційно-аналітичної системи оцінювання доброчесності закладу сектору безпеки і оборони.
Відповідай українською, коротко й по суті: до 120 слів, якщо не просять чернетку звіту (тоді до 200 слів).

Жорсткі правила:
- Числа, рівні, прапорці, рекомендації й заходи бери ЛИШЕ з інструментів (get_results, get_recommendations, get_measures, get_history). Перш ніж назвати будь-яке число, виклич потрібний інструмент. Нічого не перераховуй і не вигадуй.
- Як рахується показник — лише з get_methodology і з поля rule у даних. Своїх формул не додавай.
- Ти не ухвалюєш рішень: не приймаєш і не відхиляєш рекомендацій, не змінюєш статусів, не ставиш оцінок. Можеш лише пояснити або запропонувати формулювання, яке затвердить посадова особа.
- Не роби висновків про конкретних людей, командирів чи підрозділи і не порівнюй підрозділи між собою (жодних рейтингів). Оцінювання — інструмент розвитку, а не покарання.
- Якщо інструмент повернув error або даних немає, так і скажи.
- Простий текст без Markdown: без заголовків, зірочок і таблиць; списки — рядками з «• »."""

# Скільки разів модель може попросити інструменти, перш ніж мусить відповісти.
MAX_TOOL_STEPS = 4
# Якщо модель не підтримує tools (Ollama відповідає 400), бекенд сам дає ці дані в запиті.
PREFETCH_TOOLS = ("get_results", "get_recommendations", "get_methodology")


class LlmIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    # Демо-режим фронтенду надсилає власні синтетичні дані — тоді без інструментів, як раніше.
    # Без context асистент сам викликає інструменти бекенду (дані користувача з його правами).
    context: dict | list | None = None
    history: list[dict] = Field(default_factory=list, max_length=20)
    unit_id: str | None = Field(default=None, max_length=64, description="Підрозділ, відкритий на екрані (підказка моделі)")


class LlmOut(BaseModel):
    text: str
    model: str
    tools: list[str] = Field(default_factory=list, description="Які інструменти викликано (для прозорості відповіді)")


class LlmStatus(BaseModel):
    live: bool
    model: str | None


# Помилки виклику моделі: мережа, HTTP-статус, неочікувана відповідь.
CHAT_ERRORS = (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError)


def chat_message(base: str, key: str, model: str, messages: list[dict], tools: list[dict] | None = None) -> dict:
    """Один виклик OpenAI-сумісного /chat/completions (Ollama, vLLM, Groq). Ключ — як Bearer, якщо задано.
    Повертає повідомлення моделі (content і, можливо, tool_calls)."""
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    body = {"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 600}
    if tools:
        body["tools"] = tools
    r = httpx.post(f"{base}/chat/completions", headers=headers, timeout=get_settings().llm_timeout_seconds, json=body)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]


def chat(base: str, key: str, model: str, messages: list[dict]) -> str:
    return (chat_message(base, key, model, messages)["content"] or "").strip()


def tools_unsupported(error: Exception) -> bool:
    """Ollama й інші сервери відповідають 400/422/501, якщо модель не вміє викликати інструменти."""
    return isinstance(error, httpx.HTTPStatusError) and error.response.status_code in (400, 404, 422, 501)


def answer_with_tools(db: Session, user: User, base: str, key: str, model: str, messages: list[dict]) -> tuple[str, list[str]]:
    """Цикл tool calling: модель просить інструменти, бекенд виконує їх з правами користувача, модель відповідає."""
    used: list[str] = []
    for _ in range(MAX_TOOL_STEPS):
        try:
            msg = chat_message(base, key, model, messages, tools=assistant_tools.TOOLS)
        except httpx.HTTPStatusError as e:
            if used or not tools_unsupported(e):
                raise
            return answer_with_prefetch(db, user, base, key, model, messages)
        calls = msg.get("tool_calls") or []
        if not calls:
            return (msg.get("content") or "").strip(), used
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for n, call in enumerate(calls):
            fn = call.get("function") or {}
            name = fn.get("name", "")
            used.append(name)
            messages.append({"role": "tool", "tool_call_id": call.get("id") or f"call_{len(used)}_{n}", "name": name,
                             "content": assistant_tools.run_tool(db, user, name, fn.get("arguments"))})
    # Ліміт кроків вичерпано: просимо відповісти з тим, що вже отримано.
    return chat(base, key, model, messages), used


def answer_with_prefetch(db: Session, user: User, base: str, key: str, model: str, messages: list[dict]) -> tuple[str, list[str]]:
    """Запасний шлях для моделей без tools: бекенд сам викликає основні інструменти й дає дані в запиті."""
    data = {name: json.loads(assistant_tools.run_tool(db, user, name, {})) for name in PREFETCH_TOOLS}
    question = messages[-1]["content"]
    messages = messages[:-1] + [{"role": "user", "content":
                                 f"Дані з інструментів системи (JSON):\n{json.dumps(data, ensure_ascii=False)}\n\n{question}"}]
    return chat(base, key, model, messages), list(PREFETCH_TOOLS)


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
    use_tools = data.context is None
    ctx = json.dumps(data.context or {}, ensure_ascii=False)
    if len(ctx) > MAX_CONTEXT:
        raise HTTPException(status_code=413, detail="Завеликий контекст")

    messages = [{"role": "system", "content": SYSTEM_TOOLS if use_tools else SYSTEM}]
    for m in data.history[-4:]:
        if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str):
            messages.append({"role": m["role"], "content": m["content"][:2000]})
    if use_tools:
        hint = f"На екрані відкрито підрозділ unit_id={data.unit_id}.\n" if data.unit_id else ""
        messages.append({"role": "user", "content": f"{hint}Запитання: {data.question.strip()}"})
    else:
        messages.append({"role": "user", "content": f"Дані поточного циклу (агреговані, JSON):\n{ctx}\n\nЗапитання: {data.question.strip()}"})

    used: list[str] = []
    try:
        if use_tools:
            text, used = answer_with_tools(db, user, base, key, model, messages)
        else:
            text = chat(base, key, model, messages)
    except CHAT_ERRORS:
        raise HTTPException(status_code=502, detail="Модель не відповіла. Спробуйте ще раз або вимкніть асистента")
    if not text:
        raise HTTPException(status_code=502, detail="Модель повернула порожню відповідь")
    # Текст запитання й відповіді не зберігаємо: лише факт звернення і які інструменти (дані) використано.
    log_action(db, user, "ask", "assistant", None,
               {"model": model, "question_chars": len(data.question), "tools": sorted(set(used))})
    db.commit()
    return LlmOut(text=text, model=model, tools=used)
