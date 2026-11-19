"""Порожні змінні в .env, ліміт одночасних запитів до моделі, пауза черги Mitra при недоступності."""

import httpx
import pytest

from app.config import Settings, get_settings
from app.routers import llm
from app.services import measures as service
from tests.conftest import auth


def test_empty_values_in_env_file_fall_back_to_defaults(tmp_path, monkeypatch):
    # backend/.env.example містить «AUTOPILOT_INTERVAL_SECONDS=»: скопійований як є, він зупиняв застосунок на старті.
    env = tmp_path / ".env"
    env.write_text("AUTOPILOT_INTERVAL_SECONDS=\nTHEME2_SYNC_SECONDS=\nEVIDENCE_MAX_BYTES=\n", encoding="utf-8")
    for name in ("AUTOPILOT_INTERVAL_SECONDS", "THEME2_SYNC_SECONDS", "EVIDENCE_MAX_BYTES"):
        monkeypatch.delenv(name, raising=False)
    s = Settings(_env_file=env)
    assert s.autopilot_interval_seconds == 0
    assert s.theme2_sync_seconds == 10
    assert s.evidence_max_bytes == 10 * 1024 * 1024


def test_empty_process_env_also_falls_back(monkeypatch):
    monkeypatch.setenv("AUTOPILOT_INTERVAL_SECONDS", "")
    assert Settings(_env_file=None).autopilot_interval_seconds == 0


@pytest.fixture()
def llm_env(monkeypatch):
    def apply(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        get_settings.cache_clear()

    yield apply
    monkeypatch.undo()
    get_settings.cache_clear()


def test_busy_model_answers_429_and_frees_slot(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1", LLM_MAX_CONCURRENT="1")
    headers = auth(client, "leader")
    monkeypatch.setattr(llm, "_slots_busy", 1)  # один запит уже чекає на модель
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: pytest.fail("модель викликано понад ліміт"))
    r = client.post("/api/assistant", json={"question": "x", "context": {}}, headers=headers)
    assert r.status_code == 429
    r = client.post("/api/assistant/edit", json={"selection": "a", "instruction": "b"}, headers=headers)
    assert r.status_code == 429

    monkeypatch.setattr(llm, "_slots_busy", 0)

    def fake_post(url, headers, json, timeout):
        return httpx.Response(200, json={"choices": [{"message": {"content": "ок"}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    assert client.post("/api/assistant", json={"question": "x", "context": {}}, headers=headers).status_code == 200
    assert llm._slots_busy == 0  # слот звільнено


def test_slot_is_freed_after_model_error(client, llm_env, monkeypatch):
    llm_env(LLM_BASE_URL="http://ollama.local:11434/v1", LLM_MAX_CONCURRENT="1")

    def boom(*a, **k):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(llm.httpx, "post", boom)
    r = client.post("/api/assistant", json={"question": "x", "context": {}}, headers=auth(client, "leader"))
    assert r.status_code == 502
    assert llm._slots_busy == 0


def test_sync_backs_off_while_mitra_is_down_and_resets_after():
    wait = 10.0
    waits = []
    for _ in range(12):
        wait = service.next_sync_wait(10, wait, {"sent": 0, "failed": 3, "pending": 3})
        waits.append(wait)
    assert waits[:4] == [20, 40, 80, 160]
    assert max(waits) == service.MAX_SYNC_BACKOFF_SECONDS
    # 20 спроб тепер розтягуються на години, а не на 3 хвилини
    assert sum(waits) > 3600
    assert service.next_sync_wait(10, 900, {"sent": 1, "failed": 2, "pending": 2}) == 10
    assert service.next_sync_wait(10, 900, {}) == 10  # черга порожня
    assert service.next_sync_wait(10, 40, None) == 80  # збій самого кроку (наприклад, БД)
