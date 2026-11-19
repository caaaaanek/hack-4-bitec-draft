"""Асистент для frontend-proto: `GET/POST /api/assistant` (без префікса /api/v1, як очікує фронтенд).

Контракт фронтенду:
- `GET`  → `{"live": bool, "model": str | null}` — чи налаштовано модель (без секретів);
- `POST` `{"question", "history", "unit_id"?}` → `{"text", "model", "tools"}`: tool calling — модель сама викликає
  інструменти бекенду (`services/assistant_tools.py`: методика, словник термінів, результати, рекомендації, заходи,
  динаміка) з правами
  користувача. Якщо модель не вміє tools, бекенд сам підкладає основні дані в запит.
- `POST` з `context` (демо-режим фронтенду з синтетичними даними) — як раніше: модель пояснює лише надіслані дані.
- 503, якщо модель не налаштовано (тоді фронтенд відповідає шаблонами правил), 502 — модель не відповіла.

Правила ті самі, що й для `/api/v1/assistant/ask`: модель лише пояснює вже пораховані правилами числа, нічого
не змінює; у контексті лише агрегати груп ≥ k, які користувач і так бачить; заборонені сервіси й моделі з
FORBIDDEN_MARKERS не викликаються; текст запитань у журнал не пишеться.
"""

import json
import re
import threading
from contextlib import contextmanager
from typing import Literal

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

MAX_CONTEXT = 30000

SYSTEM = """Ти асистент Integra, інформаційно-аналітичної системи оцінювання доброчесності закладу сектору безпеки і оборони.
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
SYSTEM_TOOLS = """Ти асистент Integra, інформаційно-аналітичної системи оцінювання доброчесності закладу сектору безпеки і оборони.
Відповідай українською, коротко й по суті: до 120 слів, якщо не просять чернетку звіту (тоді до 200 слів).

Жорсткі правила:
- Числа, рівні, прапорці, рекомендації й заходи бери ЛИШЕ з інструментів (get_results, get_recommendations, get_measures, get_history).
  Значення термінів — з explain_term. Перш ніж назвати будь-яке число, виклич потрібний інструмент. Нічого не перераховуй і не вигадуй.
- Якщо підрозділ не названо, не перепитуй: одразу виклич інструмент без unit_id — він сам візьме підрозділ користувача або всю організацію. Динаміка між хвилями — get_history, заходи й строки — get_measures.
- Не показуй користувачу технічні id (uuid), лише назви підрозділів і хвиль.
- Завжди називай, до якого підрозділу належать числа (поле unit у даних). Якщо в даних є access_scope, а користувач
  питає про інший підрозділ чи всю організацію, прямо скажи, що ці дані йому недоступні, і не видавай свій підрозділ за них.
- Як рахується показник — лише з get_methodology і з поля rule у даних. Своїх формул не додавай. Формулу з rule наводь,
  лише коли питають, як пораховано число; інакше поясни її зміст одним реченням.
- Достовірність пояснюй словами, а не лише літерою: A — сумнівів немає, B — незначні сумніви, C — серйозний сумнів;
  назви причину з reliability_reasons чи flags.
- Терміни — як у Рекомендаціях НУОУ: індекс доброчесності (не «Integrity Index»), рівень зрілості доброчесності,
  ВВНЗ (ВНП ЗВО), антикорупційний уповноважений, робоча група, особовий склад, контрольний чек-лист, План трансформації.
  Якщо питають «що таке…» або відповідь спирається на термін, який користувач може не знати, виклич explain_term і
  перекажи визначення, назвавши джерело. Визначень від себе не вигадуй.
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

_slots_lock = threading.Lock()
_slots_busy = 0


@contextmanager
def model_slot():
    """Не більше LLM_MAX_CONCURRENT одночасних звернень до моделі. Ендпоінти синхронні й виконуються в пулі
    потоків сервера: без ліміту повільна модель (до 60 с × кроки інструментів) забрала б потоки в решти API.
    Понад ліміт — 429, фронтенд тоді відповідає шаблонами правил."""
    global _slots_busy
    limit = max(1, get_settings().llm_max_concurrent)
    with _slots_lock:
        if _slots_busy >= limit:
            raise HTTPException(status_code=429, detail="Асистент зараз зайнятий іншими запитами. Спробуйте за хвилину")
        _slots_busy += 1
    try:
        yield
    finally:
        with _slots_lock:
            _slots_busy -= 1


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
            text = (msg.get("content") or "").strip()
            if not text and used:
                # Буває, що після відповіді інструмента (наприклад, «немає доступу») модель мовчить.
                text = finish_after_tools(base, key, model, messages)
            return text, used
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for n, call in enumerate(calls):
            fn = call.get("function") or {}
            name = fn.get("name", "")
            used.append(name)
            messages.append({"role": "tool", "tool_call_id": call.get("id") or f"call_{len(used)}_{n}", "name": name,
                             "content": assistant_tools.run_tool(db, user, name, fn.get("arguments"))})
    # Ліміт кроків вичерпано: просимо відповісти з тим, що вже отримано.
    return finish_after_tools(base, key, model, messages), used


FINISH_PROMPT = ("Дай відповідь користувачу на основі даних, які вже повернули інструменти. Якщо інструмент "
                 "повернув error (наприклад, немає доступу до підрозділу), коротко поясни це своїми словами.")
NO_ANSWER = ("Не вдалося сформувати відповідь на основі доступних вам даних. Спробуйте уточнити запитання "
             "або подивитися показники на дашборді.")


def finish_after_tools(base: str, key: str, model: str, messages: list[dict]) -> str:
    """Остаточна відповідь без інструментів; якщо модель і далі мовчить — зрозуміле повідомлення замість 502."""
    text = chat(base, key, model, messages + [{"role": "user", "content": FINISH_PROMPT}])
    return text or NO_ANSWER


def answer_with_prefetch(db: Session, user: User, base: str, key: str, model: str, messages: list[dict]) -> tuple[str, list[str]]:
    """Запасний шлях для моделей без tools: бекенд сам викликає основні інструменти й дає дані в запиті."""
    data = {name: json.loads(assistant_tools.run_tool(db, user, name, {})) for name in PREFETCH_TOOLS}
    question = messages[-1]["content"]
    messages = messages[:-1] + [{"role": "user", "content":
                                 f"Дані з інструментів системи (JSON):\n{json.dumps(data, ensure_ascii=False)}\n\n{question}"}]
    return chat(base, key, model, messages), list(PREFETCH_TOOLS)


def endpoint() -> tuple[str, str, str] | None:
    """(адреса, ключ, модель) або None. Адреса задається лише явно (LLM_BASE_URL): сам ключ без адреси
    нікуди дані не відправляє (раніше в такому разі неявно бралася зовнішня хмара)."""
    s = get_settings()
    base = s.llm_base_url.rstrip("/")
    if not base:
        return None
    return base, s.llm_api_key, s.llm_model


@router.get("/api/assistant", response_model=LlmStatus)
def status():
    """Чи доступна модель. Без секретів і без входу (фронтенд показує перемикач режиму)."""
    ep = endpoint()
    if ep is None:
        return LlmStatus(live=False, model=None)
    try:
        check_allowed(ep[0], ep[2])
    except HTTPException:
        return LlmStatus(live=False, model=None)  # заборонена чи зовнішня без дозволу: фронтенд відповідає шаблонами
    return LlmStatus(live=True, model=ep[2])


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
        with model_slot():
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


# ---------- Редактор звіту: запит до моделі щодо виділеного фрагмента ----------

SYSTEM_EDIT = """Ти — редактор офіційного звіту про рівень зрілості доброчесності закладу сектору безпеки і оборони.
Користувач виділив фрагмент звіту і дав інструкцію. Відповідай українською, офіційно-діловим стилем, без Markdown.

Як діяти:
- Якщо інструкція просить змінити текст (скоротити, переписати, зробити офіційнішим, виправити, доповнити), виклич
  інструмент replace_selection з НОВИМ текстом лише виділеного фрагмента. Не повертай увесь документ.
- Якщо інструкція — запитання або для правки бракує даних, відповідай звичайним текстом (до 120 слів) і нічого не міняй.
  Можеш поставити одне уточнювальне запитання.
- Числа, рівні, статуси й рекомендації не змінюй і нових не вигадуй: бери лише ті, що є у фрагменті, документі або
  в інструментах get_results, get_recommendations, get_measures, get_history, get_methodology.
- Не роби висновків про конкретних людей і не порівнюй підрозділи. Рішень не ухвалюєш: лише формулювання для посадової особи."""

EDIT_TOOL = {"type": "function", "function": {
    "name": "replace_selection",
    "description": "Замінити виділений фрагмент звіту новим текстом. Лише текст фрагмента, без пояснень.",
    "parameters": {"type": "object", "properties": {
        "text": {"type": "string", "description": "Новий текст виділеного фрагмента"},
        "note": {"type": "string", "description": "Коротко, що змінено (одне речення)"},
    }, "required": ["text"]}}}
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
MAX_DOCUMENT = 20000


class EditIn(BaseModel):
    selection: str = Field(min_length=1, max_length=4000, description="Виділений фрагмент звіту")
    instruction: str = Field(min_length=1, max_length=500, description="Що зробити: «скороти», «офіційніше», запитання…")
    document: str = Field(default="", max_length=MAX_DOCUMENT, description="Текст звіту для контексту і звірки чисел")
    mode: Literal["auto", "edit", "ask"] = Field(
        default="auto", description="auto: модель сама вирішує правити чи відповісти; edit: лише правка; ask: лише відповідь")
    unit_id: str | None = Field(default=None, max_length=64)


class EditOut(BaseModel):
    action: Literal["replace", "answer"] = Field(description="replace: замінити виділене на text; answer: показати text")
    text: str
    note: str | None = None
    model: str
    tools: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list, description="Напр. числа, яких немає в документі й даних")


def numbers(text: str) -> set[str]:
    """Числа з тексту в одному записі: «53,7» = «53.7», «50,0» = «50»."""
    result = set()
    for n in NUMBER.findall(text):
        n = n.replace(",", ".")
        result.add(n.rstrip("0").rstrip(".") if "." in n else n)
    return result


def new_numbers(result: str, *sources: str) -> list[str]:
    """Числа з відповіді моделі, яких немає ні у фрагменті, ні в документі, ні в даних інструментів."""
    known = set().union(*(numbers(s) for s in sources))
    return sorted(numbers(result) - known, key=lambda n: (len(n), n))


def tool_args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def edit_with_tools(db: Session, user: User, ep: tuple[str, str, str], messages: list[dict], mode: str,
                    seen: list[str]) -> tuple[str, str, str | None, list[str]]:
    """(action, text, note, used). Інструменти даних виконуються з правами користувача; replace_selection — правка."""
    base, key, model = ep
    tools = [EDIT_TOOL, *assistant_tools.TOOLS] if mode != "ask" else assistant_tools.TOOLS
    used: list[str] = []
    for _ in range(MAX_TOOL_STEPS):
        msg = chat_message(base, key, model, messages, tools=tools)
        calls = msg.get("tool_calls") or []
        edit = next((c for c in calls if (c.get("function") or {}).get("name") == "replace_selection"), None)
        if edit is not None:
            args = tool_args(edit["function"].get("arguments"))
            used.append("replace_selection")
            return "replace", str(args.get("text") or "").strip(), (str(args.get("note") or "").strip() or None), used
        if not calls:
            text = (msg.get("content") or "").strip()
            return ("replace" if mode == "edit" else "answer"), text, None, used
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for n, call in enumerate(calls):
            fn = call.get("function") or {}
            name = fn.get("name", "")
            used.append(name)
            output = assistant_tools.run_tool(db, user, name, fn.get("arguments"))
            seen.append(output)
            messages.append({"role": "tool", "tool_call_id": call.get("id") or f"call_{len(used)}_{n}", "name": name,
                             "content": output})
    return ("replace" if mode == "edit" else "answer"), chat(base, key, model, messages), None, used


def edit_plain(ep: tuple[str, str, str], messages: list[dict], mode: str, instruction: str) -> tuple[str, str]:
    """Модель без tools: правка чи відповідь за режимом; у режимі auto запитання (з «?») — відповідь."""
    base, key, model = ep
    action = "answer" if mode == "ask" or (mode == "auto" and instruction.rstrip().endswith("?")) else "replace"
    tail = ("Поверни ЛИШЕ новий текст виділеного фрагмента, без лапок і пояснень." if action == "replace"
            else "Відповідай текстом, документ не змінюй.")
    messages = messages[:-1] + [{"role": "user", "content": f"{messages[-1]['content']}\n\n{tail}"}]
    return action, chat(base, key, model, messages)


@router.post("/api/assistant/edit", response_model=EditOut)
def edit(data: EditIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*RESULT_READERS))):
    """Редактор звіту: запит до моделі щодо виділеного фрагмента.

    Модель або пропонує заміну фрагмента (інструмент `replace_selection` → `action: replace`), або відповідає /
    уточнює (`action: answer`). Документ на сервері не змінюється: фронтенд показує пропозицію, людина приймає її.
    Числа, яких немає у фрагменті, документі й даних інструментів, повертаються в `warnings`.
    503 — модель не налаштовано, 502 — модель не відповіла.
    """
    ep = endpoint()
    if ep is None:
        raise HTTPException(status_code=503, detail="Модель не налаштовано: редагування з ШІ недоступне")
    check_allowed(ep[0], ep[2])
    hint = f"На екрані відкрито підрозділ unit_id={data.unit_id}.\n" if data.unit_id else ""
    document = f"Текст звіту (для контексту):\n{data.document}\n\n" if data.document.strip() else ""
    messages = [{"role": "system", "content": SYSTEM_EDIT},
                {"role": "user", "content": f"{hint}{document}Виділений фрагмент:\n«{data.selection}»\n\n"
                                            f"Інструкція: {data.instruction.strip()}"}]
    seen: list[str] = []
    try:
        with model_slot():
            try:
                action, text, note, used = edit_with_tools(db, user, ep, list(messages), data.mode, seen)
            except httpx.HTTPStatusError as e:
                if not tools_unsupported(e):
                    raise
                action, text = edit_plain(ep, messages, data.mode, data.instruction)
                note, used = None, []
    except CHAT_ERRORS:
        raise HTTPException(status_code=502, detail="Модель не відповіла. Спробуйте ще раз")
    if not text:
        raise HTTPException(status_code=502, detail="Модель повернула порожню відповідь")
    warnings = []
    extra = new_numbers(text, data.selection, data.document, data.instruction, *seen)
    if extra:
        warnings.append("У тексті є числа, яких немає у звіті й даних системи: " + ", ".join(extra[:8])
                        + ". Перевірте перед прийняттям.")
    log_action(db, user, "edit_report", "assistant", None,
               {"model": ep[2], "action": action, "selection_chars": len(data.selection), "tools": sorted(set(used))})
    db.commit()
    return EditOut(action=action, text=text, note=note, model=ep[2], tools=used, warnings=warnings)
