"""Інтеграція з Mitra (тема 2) за контрактом docs/contracts/integra-mitra.yaml."""

import threading
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer

import pytest

from app.clock import today
from app.config import get_settings
from app.services import measures as service
from tests.conftest import auth
from tests.helpers import API, post_fact

KEY = "mitra-key-123"
HOOK = f"{API}/integrations/theme2/measures/status"
SHA = "a" * 64
VERIFY = "http://mitra.local/verify?doc=MITRA-001&h=" + SHA


@pytest.fixture()
def mitra(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "theme2_url", "http://mitra.local/api/integrations/integra")
    monkeypatch.setattr(settings, "theme2_api_key", KEY)
    monkeypatch.setattr(settings, "theme2_public_url", "")
    monkeypatch.setattr(settings, "public_url", "http://integra.local")
    return settings


def unit_id(client, name="Підрозділ А-1"):
    return {u["name"]: u["id"] for u in client.get(f"{API}/units", headers=auth(client, "admin")).json()}[name]


def new_measure(client, unit=None, title="Провести навчання з конфлікту інтересів"):
    r = client.post(f"{API}/measures", json={"unit_id": unit or unit_id(client), "title": title, "owner": "Уповноважений",
                                             "component": "accountability", "due_date": today().isoformat()},
                    headers=auth(client, "leader"))
    assert r.status_code == 201, r.text
    return r.json()


def hook(client, body, key=KEY):
    return client.post(HOOK, json=body, headers={"X-Integration-Key": key})


def get(client, measure_id):
    return client.get(f"{API}/measures/{measure_id}", headers=auth(client, "leader")).json()


def link(client, monkeypatch, measure_id, external="MITRA-001"):
    monkeypatch.setattr(service, "http_sender", lambda topic, payload: {"id": external, "state": "inbox"})
    assert client.post(f"{API}/integrations/theme2/sync", headers=auth(client, "admin")).json()["sent"] >= 1
    assert get(client, measure_id)["external"]["state"] == "inbox"


def test_payload_follows_contract(client, mitra, monkeypatch):
    m = new_measure(client)
    sent = []
    monkeypatch.setattr(service, "http_sender", lambda topic, payload: sent.append((topic, payload)) or {"id": "MITRA-001"})
    assert client.post(f"{API}/integrations/theme2/sync", headers=auth(client, "admin")).json() == \
        {"sent": 1, "failed": 0, "pending": 0}
    topic, p = sent[0]
    assert topic == "measure.upsert" and p["contract"] == "integra-mitra/1" and p["id"] == m["id"]
    assert p["unit"]["path"] == ["Організація (демо)", "Підрозділ А", "Підрозділ А-1"]
    assert p["unit"]["code"] == "ORG-A1"  # спільний з темою 2 довідник units.json
    assert p["component_title"] == "Підзвітність" and p["owner"] == "Уповноважений"
    assert p["integra_url"] == f"http://integra.local/tracker?measure={m['id']}"
    ext = get(client, m["id"])["external"]
    assert ext == {**ext, "id": "MITRA-001", "state": "inbox", "system": "Mitra"}


def test_queue_keeps_order_and_parks_rejected(client, mitra, monkeypatch):
    a, b = new_measure(client, title="Захід А"), new_measure(client, title="Захід Б")
    leader = auth(client, "leader")
    client.patch(f"{API}/measures/{a['id']}", json={"status": "in_progress"}, headers=leader)
    calls = []

    def flaky(topic, payload):
        calls.append(payload["title"])
        if payload["title"] == "Захід А":
            raise OSError("connection refused")
        raise service.PermanentError("HTTP 422: unknown unit")

    monkeypatch.setattr(service, "http_sender", flaky)
    admin = auth(client, "admin")
    assert client.post(f"{API}/integrations/theme2/sync", headers=admin).json() == {"sent": 0, "failed": 2, "pending": 2}
    # Друге повідомлення заходу А не пішло раніше за перше: порядок подій зберігається.
    assert calls == ["Захід А", "Захід Б"]
    status = client.get(f"{API}/integrations/status", headers=admin).json()
    assert [f["title"] for f in status["theme2_failed"]] == ["Захід Б"] and "422" in status["theme2_failed"][0]["last_error"]

    monkeypatch.setattr(service, "http_sender", lambda topic, payload: {"id": "M-" + payload["title"][-1]})
    assert client.post(f"{API}/integrations/theme2/sync", headers=admin).json()["sent"] == 2  # лише А (2 повідомлення)
    r = client.post(f"{API}/integrations/theme2/sync", params={"retry_failed": True}, headers=admin).json()
    assert r == {"sent": 1, "failed": 0, "pending": 0}
    assert get(client, b["id"])["external_id"] == "M-Б"


def test_done_with_verifiable_document(client, mitra, monkeypatch):
    m = new_measure(client)
    link(client, monkeypatch, m["id"])
    r = hook(client, {"measure_id": m["id"], "external_id": "MITRA-001", "state": "linked",
                      "url": "http://mitra.local/measures/42"})
    assert r.status_code == 200 and r.json()["changed"] and r.json()["status"] == "planned"

    done = {"contract": "integra-mitra/1", "event_id": "e-1", "external_id": "MITRA-001", "state": "done",
            "mitra_status": "DONE", "done_on": today().isoformat(),
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "evidence": {"summary": "Наказ підписано, проведено 2 заняття",
                         "documents": [{"name": "Наказ №12.pdf", "sha256": SHA, "verify_url": VERIFY}]}}
    r = hook(client, done)
    assert r.status_code == 200, r.text
    data = get(client, m["id"])
    assert data["status"] == "done" and data["done_on"] == today().isoformat()
    assert "Наказ №12.pdf (sha256 aaaaaaaaaaaa…)" in data["evidence"]
    assert data["external"]["documents"] == [{"name": "Наказ №12.pdf", "sha256": SHA, "verify_url": VERIFY}]
    assert data["external"]["url"] == "http://mitra.local/measures/42"
    assert data["external"]["state_title"] == "виконано в Mitra"
    # Повтор тієї ж події нічого не змінює і не пишеться в журнал вдруге.
    assert hook(client, done).json()["changed"] is False
    log = client.get(f"{API}/admin/audit-log", params={"entity": "measure"}, headers=auth(client, "admin")).json()
    items = log["items"] if isinstance(log, dict) else log
    assert sum(1 for x in items if x["action"] == "external_status") == 2  # linked + done
    # Застаріла подія (раніше за вже отриману) ігнорується.
    stale = {**done, "state": "in_progress", "evidence": None,
             "occurred_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()}
    assert hook(client, stale).json()["reason"] == "stale"
    assert get(client, m["id"])["status"] == "done"


@pytest.mark.parametrize("body, code", [
    ({"state": "done", "evidence": {"documents": [{"name": "a.pdf", "sha256": SHA,
                                                  "verify_url": "http://evil.example/verify"}]}}, "untrusted_link"),
    ({"state": "done", "evidence": {"documents": [{"name": "a.pdf", "sha256": "Z" * 64}]}}, "bad_sha256"),
    ({"state": "done"}, "evidence_required"),
    ({"state": "done", "evidence": {"summary": "ok"}, "done_on": "2999-01-01"}, "done_on_in_future"),
    ({"state": "archived"}, "unknown_state"),
    ({"state": "linked", "url": "javascript:alert(1)"}, "untrusted_link"),
])
def test_webhook_rejects_bad_events(client, mitra, monkeypatch, body, code):
    m = new_measure(client)
    link(client, monkeypatch, m["id"])
    r = hook(client, {"external_id": "MITRA-001", **body})
    assert r.status_code == 422 and r.json()["code"] == code, r.text
    assert get(client, m["id"])["status"] == "planned"


def test_webhook_auth_and_ids(client, mitra, monkeypatch):
    m = new_measure(client)
    link(client, monkeypatch, m["id"])
    other = new_measure(client, title="Інший захід")
    assert hook(client, {"external_id": "MITRA-001", "state": "linked"}, key="wrong").status_code == 401
    assert hook(client, {"external_id": "NOPE", "state": "linked"}).status_code == 404
    assert hook(client, {"state": "linked"}).status_code == 422
    # Наш id одного заходу і їхній id іншого: не вгадуємо, а повідомляємо.
    monkeypatch.setattr(service, "http_sender", lambda topic, payload: {"id": "MITRA-002"})
    client.post(f"{API}/integrations/theme2/sync", headers=auth(client, "admin"))
    r = hook(client, {"measure_id": other["id"], "external_id": "MITRA-001", "state": "linked"})
    assert r.status_code == 409 and r.json()["code"] == "id_mismatch"
    # Поля, яких немає в контракті (наприклад, ПІБ виконавця), відхиляються.
    r = hook(client, {"external_id": "MITRA-001", "state": "linked", "executor_name": "Іваненко І. І."})
    assert r.status_code == 422


def test_rejected_and_not_allowed_transitions(client, mitra, monkeypatch):
    m = new_measure(client)
    link(client, monkeypatch, m["id"])
    r = hook(client, {"external_id": "MITRA-001", "state": "rejected", "comment": "Дублює захід 2.4 програми"})
    data = get(client, m["id"])
    assert r.status_code == 200 and data["status"] == "planned"
    assert data["external"]["state"] == "rejected" and data["external"]["note"] == "Дублює захід 2.4 програми"

    leader = auth(client, "leader")
    client.patch(f"{API}/measures/{m['id']}", json={"status": "cancelled", "reason": "Рекомендацію переглянуто"},
                 headers=leader)
    r = hook(client, {"external_id": "MITRA-001", "state": "done", "evidence": {"summary": "Виконано"}})
    # Наш статус не змінюється (скасовано → виконано заборонено), але стан Mitra видно, і Mitra не повторює подію.
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and "недозволений" in r.json()["note"]
    assert get(client, m["id"])["external"]["state"] == "done"


def test_mitra_fact_counts_in_system_component(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "integration_keys", "mitra=mitra-facts-key")
    unit = unit_id(client)
    body = {"unit_id": unit, "period": "2026-10", "indicator": "program_measures_on_time", "numerator": 9,
            "denominator": 12, "source": "mitra", "why": "Mitra: заходи програми, закриті «Виконано» до строку"}
    assert client.post(f"{API}/indicators", json=body, headers={"X-Integration-Key": "mitra-facts-key"}).status_code == 201
    assert client.post(f"{API}/indicators", json={**body, "source": "artemida"},
                       headers={"X-Integration-Key": "mitra-facts-key"}).status_code in (401, 403)
    method = client.get(f"{API}/methodology", headers=auth(client, "admin")).json()
    assert method["facts"]["program_measures_on_time"]["component"] == "system"
    post_fact(client, unit, "program_measures_on_time", 5, 10)  # той самий шлях, що й інші факти


def test_live_http_roundtrip_with_mock(client, mitra, monkeypatch):
    """Справжній HTTP до мока Mitra; вебхук мока повертається в Integra через TestClient."""
    import scripts.mitra_mock as mock

    server = ThreadingHTTPServer(("127.0.0.1", 0), mock.Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        mock.INBOX.clear()
        mock.ARGS = mock.argparse.Namespace(key=KEY, auto=0, public=f"http://127.0.0.1:{port}", integra="")
        monkeypatch.setattr(get_settings(), "theme2_url", f"http://127.0.0.1:{port}")

        def deliver(item, state, **extra):
            r = hook(client, {"contract": mock.CONTRACT, "measure_id": item["id"], "external_id": item["mitra_id"],
                              "state": state, "url": f"{mock.ARGS.public}/measures/{item['mitra_id']}", **extra})
            return r.status_code, r.text

        monkeypatch.setattr(mock, "webhook", deliver)
        m = new_measure(client)
        assert client.post(f"{API}/integrations/theme2/sync", headers=auth(client, "admin")).json()["sent"] == 1
        assert get(client, m["id"])["external_id"] == "MITRA-001"
        assert mock.act("MITRA-001", "link")[0] == 200
        assert mock.act("MITRA-001", "done")[0] == 200
        data = get(client, m["id"])
        doc = data["external"]["documents"][0]
        assert data["status"] == "done" and doc["verify_url"].startswith(f"http://127.0.0.1:{port}/verify")
        import urllib.request
        with urllib.request.urlopen(doc["verify_url"], timeout=5) as r:  # noqa: S310
            assert "sha256 збігається" in r.read().decode()
    finally:
        server.shutdown()
