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
    llm_env(ASSISTANT_ENABLED="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_API_KEY="secret-key-123",
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
    llm_env(ASSISTANT_ENABLED="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma3:27b")

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
    llm_env(LLM_BASE_URL="https://llm.example.test/v1", LLM_API_KEY="k", LLM_MODEL="gemma3:27b")
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
    llm_env(LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma3:27b")
    calls = scripted_model(monkeypatch, [(200, tool_call("get_results", f'{{"unit_id": "{root}"}}')), (200, final("Немає доступу."))])
    r = client.post("/api/assistant", json={"question": "Покажи всю організацію"}, headers=auth(client, "leader_a"))
    assert r.status_code == 200, r.text
    tool_msg = next(m for m in calls[1]["messages"] if m["role"] == "tool")
    assert "error" in tool_msg["content"] and "index" not in tool_msg["content"]


def test_model_without_tools_gets_prefetched_data(client, llm_env, monkeypatch):
    from tests.helpers import full_wave

    full_wave(client)
    llm_env(LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma3:27b")
    calls = scripted_model(monkeypatch, [(400, {"error": "model does not support tools"}), (200, final("Індекс пояснено."))])
    r = client.post("/api/assistant", json={"question": "Який індекс?"}, headers=auth(client, "leader"))
    assert r.status_code == 200, r.text
    assert r.json()["tools"] == list(llm.PREFETCH_TOOLS)
    assert "tools" not in calls[1]
    assert "Дані з інструментів системи" in calls[1]["messages"][-1]["content"]
