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
