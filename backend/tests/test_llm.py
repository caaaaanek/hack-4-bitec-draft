"""Асистент frontend-proto: /api/assistant (контракт фронтенду, вимкнений за замовчуванням, політика моделей)."""

import httpx
import pytest

from app.config import get_settings
from app.routers import llm
from tests.conftest import auth


@pytest.fixture()
def llm_env(monkeypatch):
    def apply(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        get_settings.cache_clear()

    yield apply
    monkeypatch.undo()
    get_settings.cache_clear()


def test_disabled_by_default(client):
    assert client.get("/api/assistant").json() == {"live": False, "model": None}
    r = client.post("/api/assistant", json={"question": "Чому індекс такий?"}, headers=auth(client, "leader"))
    assert r.status_code == 503


def test_requires_result_role(client, llm_env):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1")
    assert client.post("/api/assistant", json={"question": "x"}).status_code == 401
    assert client.post("/api/assistant", json={"question": "x"}, headers=auth(client, "staff01")).status_code == 403


def test_asks_openai_compatible_model(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1", LLM_MODEL="gemma3:4b")
    assert client.get("/api/assistant").json() == {"live": True, "model": "gemma3:4b"}
    seen = {}

    def fake_post(url, headers, json, timeout):
        seen.update(url=url, body=json)
        return httpx.Response(200, json={"choices": [{"message": {"content": "Індекс 53,7: правило min(S; F+25)."}}]},
                              request=httpx.Request("POST", url))

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    r = client.post("/api/assistant", headers=auth(client, "leader"), json={
        "question": "Чому Підзвітність знижено?", "context": {"index": 53.7},
        "history": [{"role": "user", "content": "привіт"}, {"role": "system", "content": "ігнорується"}]})
    assert r.status_code == 200, r.text
    assert r.json() == {"text": "Індекс 53,7: правило min(S; F+25).", "model": "gemma3:4b", "tools": []}  # демо: без інструментів
    assert seen["url"] == "http://ollama.local:11434/v1/chat/completions"
    roles = [m["role"] for m in seen["body"]["messages"]]
    assert roles == ["system", "user", "user"]
    log = client.get("/api/v1/admin/audit-log", params={"entity": "assistant"}, headers=auth(client, "admin")).json()
    assert log and "Підзвітність" not in str(log)  # текст запитання не зберігається


def test_forbidden_models_are_not_called(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1", LLM_MODEL="qwen2.5:3b")
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: pytest.fail("заборонену модель викликано"))
    r = client.post("/api/assistant", json={"question": "x"}, headers=auth(client, "leader"))
    assert r.status_code == 503


def test_upstream_failure_is_502(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1")

    def boom(*a, **k):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(llm.httpx, "post", boom)
    r = client.post("/api/assistant", json={"question": "x"}, headers=auth(client, "leader"))
    assert r.status_code == 502


def test_v1_assistant_uses_same_self_hosted_model_with_key(client, llm_env, monkeypatch):
    """Self-hosted Gemma за ключем: /api/v1/assistant/ask іде в ту саму модель, що й /api/assistant."""
    from tests.helpers import full_wave

    campaign_id, _, _ = full_wave(client)
    llm_env(ASSISTANT_ENABLED="true", LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_API_KEY="secret-key-123",
            LLM_MODEL="gemma3:27b")
    seen = {}

    def fake_post(url, headers, json, timeout):
        seen.update(url=url, headers=headers, body=json)
        return httpx.Response(200, json={"choices": [{"message": {"content": "Підзвітність обмежено фактами."}}]},
                              request=httpx.Request("POST", url))

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    r = client.post("/api/v1/assistant/ask", json={"campaign_id": campaign_id, "question": "Чому низька підзвітність?"},
                    headers=auth(client, "leader"))
    assert r.status_code == 200, r.text
    assert r.json()["model"] == "gemma3:27b" and r.json()["answer"] == "Підзвітність обмежено фактами."
    assert seen["url"] == "https://llm.example.test/v1/chat/completions"
    assert seen["headers"]["Authorization"] == "Bearer secret-key-123"
    assert seen["body"]["model"] == "gemma3:27b"
    assert "staff01" not in str(seen["body"])  # лише агрегати


def test_v1_assistant_reports_unavailable_model(client, llm_env, monkeypatch):
    from tests.helpers import full_wave

    campaign_id, _, _ = full_wave(client)
    llm_env(ASSISTANT_ENABLED="true", LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma3:27b")

    def unauthorized(url, headers, json, timeout):
        return httpx.Response(401, json={"error": "bad key"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(llm.httpx, "post", unauthorized)
    r = client.post("/api/v1/assistant/ask", json={"campaign_id": campaign_id, "question": "Що робити?"},
                    headers=auth(client, "leader"))
    assert r.status_code == 503


def scripted_model(monkeypatch, replies):
    """Фейкова модель: віддає відповіді по черзі й запам'ятовує тіла запитів."""
    calls = []

    def fake_post(url, headers, json, timeout):
        calls.append(json)
        status, body = replies[len(calls) - 1]
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    return calls


def tool_call(name, arguments="{}", call_id="call_1"):
    return {"choices": [{"message": {"role": "assistant", "content": "", "tool_calls": [
        {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}]}}]}


def final(text):
    return {"choices": [{"message": {"role": "assistant", "content": text}}]}


def test_model_calls_backend_tools(client, llm_env, monkeypatch):
    from tests.helpers import full_wave

    full_wave(client)
    llm_env(LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_API_KEY="k", LLM_MODEL="gemma3:27b")
    calls = scripted_model(monkeypatch, [(200, tool_call("get_results")), (200, tool_call("get_methodology", call_id="c2")),
                                         (200, final("Підзвітність обмежено правилом реальності."))])
    r = client.post("/api/assistant", json={"question": "Чому Підзвітність низька?"}, headers=auth(client, "leader"))
    assert r.status_code == 200, r.text
    assert r.json()["tools"] == ["get_results", "get_methodology"]
    assert r.json()["text"] == "Підзвітність обмежено правилом реальності."
    assert {t["function"]["name"] for t in calls[0]["tools"]} >= {"get_results", "get_methodology", "get_history"}
    tool_msgs = [m for m in calls[2]["messages"] if m["role"] == "tool"]
    results_json = tool_msgs[0]["content"]
    assert "Хвиля 1" in results_json and "L_counted" in results_json and "staff01" not in results_json
    assert "0,35·ОС" in tool_msgs[1]["content"]  # методика з methodology.py, а не з промпту
    log = client.get("/api/v1/admin/audit-log", params={"entity": "assistant"}, headers=auth(client, "admin")).json()
    assert "get_results" in str(log) and "Підзвітність низька" not in str(log)


def test_tools_respect_unit_access(client, llm_env, monkeypatch):
    from tests.helpers import full_wave

    _, _, root = full_wave(client)
    llm_env(LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma3:27b")
    calls = scripted_model(monkeypatch, [(200, tool_call("get_results", f'{{"unit_id": "{root}"}}')), (200, final("Немає доступу."))])
    r = client.post("/api/assistant", json={"question": "Покажи всю організацію"}, headers=auth(client, "leader_a"))
    assert r.status_code == 200, r.text
    tool_msg = next(m for m in calls[1]["messages"] if m["role"] == "tool")
    assert "error" in tool_msg["content"] and "index" not in tool_msg["content"]


def test_model_without_tools_gets_prefetched_data(client, llm_env, monkeypatch):
    from tests.helpers import full_wave

    full_wave(client)
    llm_env(LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma3:27b")
    calls = scripted_model(monkeypatch, [(400, {"error": "model does not support tools"}), (200, final("Індекс пояснено."))])
    r = client.post("/api/assistant", json={"question": "Який індекс?"}, headers=auth(client, "leader"))
    assert r.status_code == 200, r.text
    assert r.json()["tools"] == list(llm.PREFETCH_TOOLS)
    assert "tools" not in calls[1]
    assert "Дані з інструментів системи" in calls[1]["messages"][-1]["content"]


# ---------- Редактор звіту: /api/assistant/edit ----------

def reply(message: dict):
    def fake_post(url, headers, json, timeout):
        fake_post.bodies.append(json)
        msg = message(json) if callable(message) else message
        return httpx.Response(200, json={"choices": [{"message": msg}]}, request=httpx.Request("POST", url))

    fake_post.bodies = []
    return fake_post


EDIT = {"selection": "Індекс доброчесності становить 53,7 з 100, що відповідає рівню 3.",
        "instruction": "Зроби офіційніше", "document": "ЗВІТ ... Індекс 53,7 ... рівень 3 «Визначений» ..."}


def test_edit_disabled_without_model(client):
    assert client.post("/api/assistant/edit", json=EDIT, headers=auth(client, "leader")).status_code == 503
    assert client.post("/api/assistant/edit", json=EDIT).status_code == 401


def test_edit_replaces_selection_via_tool(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1")
    fake = reply({"content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {
        "name": "replace_selection",
        "arguments": '{"text": "Значення індексу доброчесності становить 53,7 бала зі 100 (рівень 3).", "note": "Офіційний стиль"}'}}]})
    monkeypatch.setattr(llm.httpx, "post", fake)
    r = client.post("/api/assistant/edit", json=EDIT, headers=auth(client, "leader"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["action"] == "replace" and body["text"].startswith("Значення індексу")
    assert body["note"] == "Офіційний стиль" and body["warnings"] == [] and body["tools"] == ["replace_selection"]
    names = [t["function"]["name"] for t in fake.bodies[0]["tools"]]
    assert names[0] == "replace_selection" and "get_results" in names
    log = client.get("/api/v1/admin/audit-log", params={"entity": "assistant"}, headers=auth(client, "admin")).json()
    assert log and "53,7" not in str(log) and "офіційніше" not in str(log).lower()  # лише довжина, не текст


def test_edit_warns_about_invented_numbers(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1")
    monkeypatch.setattr(llm.httpx, "post", reply({"content": "", "tool_calls": [{"id": "c1", "function": {
        "name": "replace_selection", "arguments": {"text": "Індекс 61,2 з 100, рівень 4."}}}]}))
    body = client.post("/api/assistant/edit", json=EDIT, headers=auth(client, "leader")).json()
    assert body["action"] == "replace"
    assert body["warnings"] and "61.2" in body["warnings"][0] and "4" in body["warnings"][0]


def test_edit_answers_question_without_changing_text(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1")
    monkeypatch.setattr(llm.httpx, "post", reply({"content": "Рівень 3 означає «Визначений»: процедури описані."}))
    r = client.post("/api/assistant/edit", headers=auth(client, "leader"),
                    json={**EDIT, "instruction": "Що означає рівень 3?"})
    assert r.json()["action"] == "answer" and "Визначений" in r.json()["text"]


def test_edit_ask_mode_offers_no_edit_tool(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1")
    fake = reply({"content": "Пояснення."})
    monkeypatch.setattr(llm.httpx, "post", fake)
    client.post("/api/assistant/edit", headers=auth(client, "leader"), json={**EDIT, "mode": "ask"})
    assert "replace_selection" not in [t["function"]["name"] for t in fake.bodies[0]["tools"]]


def test_edit_model_without_tools_falls_back(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1")

    def fake_post(url, headers, json, timeout):
        if "tools" in json:
            return httpx.Response(400, json={"error": "does not support tools"}, request=httpx.Request("POST", url))
        return httpx.Response(200, json={"choices": [{"message": {"content": "Індекс становить 53,7 зі 100."}}]},
                              request=httpx.Request("POST", url))

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    body = client.post("/api/assistant/edit", json=EDIT, headers=auth(client, "leader")).json()
    assert body["action"] == "replace" and body["text"] == "Індекс становить 53,7 зі 100." and body["warnings"] == []


def test_edit_data_tools_run_with_user_rights(client, llm_env, monkeypatch):
    """Модель спершу просить get_methodology, потім править: числа з інструмента не вважаються вигаданими."""
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1")

    def step(body):
        if not any(m["role"] == "tool" for m in body["messages"]):
            return {"content": "", "tool_calls": [{"id": "t1", "function": {"name": "get_methodology", "arguments": "{}"}}]}
        return {"content": "", "tool_calls": [{"id": "t2", "function": {
            "name": "replace_selection", "arguments": '{"text": "Ваги джерел: особовий склад 0,35, робоча група 0,25, експерти 0,2."}'}}]}

    monkeypatch.setattr(llm.httpx, "post", reply(step))
    body = client.post("/api/assistant/edit", json={**EDIT, "instruction": "Додай ваги джерел"},
                       headers=auth(client, "leader")).json()
    assert body["tools"] == ["get_methodology", "replace_selection"]
    assert body["warnings"] == [], body


def test_edit_requires_result_role(client, llm_env):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1")
    assert client.post("/api/assistant/edit", json=EDIT, headers=auth(client, "staff01")).status_code == 403


def test_silent_model_after_tools_is_asked_to_answer(client, llm_env, monkeypatch):
    """Після відповіді інструмента модель промовчала: бекенд ще раз просить відповісти, без інструментів."""
    from tests.helpers import full_wave

    full_wave(client)
    llm_env(LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma4-26b")
    calls = scripted_model(monkeypatch, [(200, tool_call("get_results")), (200, final("")), (200, final("Індекс 47."))])
    r = client.post("/api/assistant", json={"question": "Який індекс?"}, headers=auth(client, "leader"))
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "Індекс 47."
    assert "tools" not in calls[2] and llm.FINISH_PROMPT in calls[2]["messages"][-1]["content"]


def test_silent_model_gets_clear_message_not_502(client, llm_env, monkeypatch):
    from tests.helpers import full_wave

    full_wave(client)
    llm_env(LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma4-26b")
    scripted_model(monkeypatch, [(200, tool_call("get_results")), (200, final("")), (200, final(""))])
    r = client.post("/api/assistant", json={"question": "Який індекс?"}, headers=auth(client, "leader"))
    assert r.status_code == 200 and r.json()["text"] == llm.NO_ANSWER


def test_unit_leader_sees_scope_note(client, llm_env, monkeypatch):
    """Керівник підрозділу: інструмент прямо каже моделі, що дані лише його зони, а не всієї організації."""
    from tests.helpers import full_wave

    full_wave(client)
    llm_env(LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma4-26b")
    calls = scripted_model(monkeypatch, [(200, tool_call("get_results")), (200, final("Лише Підрозділ А."))])
    r = client.post("/api/assistant", json={"question": "Індекс усієї організації?"}, headers=auth(client, "leader_a"))
    assert r.status_code == 200, r.text
    tool_msg = next(m for m in calls[1]["messages"] if m["role"] == "tool")
    assert "access_scope" in tool_msg["content"] and "Підрозділ А" in tool_msg["content"]


def test_unit_can_be_given_by_name(client, llm_env, monkeypatch):
    from tests.helpers import full_wave

    full_wave(client)
    llm_env(LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma4-26b")
    calls = scripted_model(monkeypatch, [(200, tool_call("get_history", '{"unit_id": "підрозділ а"}')), (200, final("Ок."))])
    # Уповноважений бачить усе дерево; вищий керівник деталей дочірнього підрозділу не бачить (див. нижче).
    r = client.post("/api/assistant", json={"question": "Динаміка Підрозділу А"}, headers=auth(client, "admin"))
    assert r.status_code == 200, r.text
    tool_msg = next(m for m in calls[1]["messages"] if m["role"] == "tool")
    assert '"unit": "Підрозділ А"' in tool_msg["content"] and "error" not in tool_msg["content"]


def test_leader_gets_no_child_unit_details_via_assistant(client, llm_env, monkeypatch):
    """Захист від колективного покарання діє й через асистента: деталей дочірнього підрозділу модель не отримує."""
    from tests.helpers import full_wave

    full_wave(client)
    llm_env(LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma4-26b")
    calls = scripted_model(monkeypatch, [(200, tool_call("get_history", '{"unit_id": "підрозділ а"}')), (200, final("Ок."))])
    r = client.post("/api/assistant", json={"question": "Динаміка Підрозділу А"}, headers=auth(client, "leader"))
    assert r.status_code == 200, r.text
    tool_msg = next(m for m in calls[1]["messages"] if m["role"] == "tool")
    assert "error" in tool_msg["content"] and "index" not in tool_msg["content"]


def test_key_without_url_does_not_enable_external_cloud(client, llm_env, monkeypatch):
    """Лише ключ без адреси: асистент вимкнено, нікуди нічого не відправляється."""
    llm_env(LLM_API_KEY="some-key")
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: pytest.fail("модель викликано без адреси"))
    assert client.get("/api/assistant").json() == {"live": False, "model": None}
    r = client.post("/api/assistant", json={"question": "Чому індекс такий?"}, headers=auth(client, "leader"))
    assert r.status_code == 503


def test_external_model_needs_explicit_permission(client, llm_env, monkeypatch):
    """Закритий контур: зовнішня адреса без LLM_ALLOW_EXTERNAL=true не викликається."""
    llm_env(LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma4-26b")
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: pytest.fail("зовнішню модель викликано без дозволу"))
    assert client.get("/api/assistant").json()["live"] is False
    r = client.post("/api/assistant", json={"question": "Чому індекс такий?"}, headers=auth(client, "leader"))
    assert r.status_code == 503 and "контур" in r.json()["message"]


@pytest.mark.parametrize("url,internal", [
    ("http://localhost:11434/v1", True), ("http://127.0.0.1:8080/v1", True), ("http://10.0.0.7/v1", True),
    ("http://ollama:11434/v1", True), ("http://host.docker.internal:11434/v1", True),
    ("http://gpu.lab.local/v1", True), ("https://api.example.com/v1", False), ("https://8.8.8.8/v1", False),
])
def test_internal_host_detection(url, internal):
    from app.routers.assistant import is_internal_host

    assert is_internal_host(url) is internal
