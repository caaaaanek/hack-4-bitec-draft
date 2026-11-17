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
    assert r.json() == {"text": "Індекс 53,7: правило min(S; F+25).", "model": "gemma3:4b"}
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
