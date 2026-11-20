"""Рекомендації за правилами, рішення керівника, трекер заходів, дашборд, звіт, тема 2, асистент."""

from datetime import timedelta

import pytest

from app.clock import today
from app.config import get_settings
from app.services import recommendations as engine
from tests.conftest import auth
from tests.helpers import API, close, full_wave, open_campaign


def recs(client, campaign_id, headers, unit_id=None):
    params = {"unit_id": unit_id} if unit_id else {}
    r = client.get(f"{API}/campaigns/{campaign_id}/recommendations", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_catalog_matches_checklist_numbering():
    numbers = set(engine.catalog())
    assert {"1.1", "2.7", "4.5.2", "6.4"} <= numbers
    assert all(engine.catalog_measure(n)["title"] for n in numbers)


def test_recommendations_follow_rules(client):
    campaign_id, admin, _ = full_wave(client)
    data = recs(client, campaign_id, auth(client, "leader"))
    codes = [r["code"] for r in data["items"]]
    first = data["items"][0]
    # Підзвітність зрізано фактами: серйозна рекомендація йде першою.
    assert first["code"] == "cut:accountability" and first["priority"] == "high"
    assert "знижена" in first["rule"]
    assert {m["catalog_number"] for m in first["suggested_measures"]} >= {"4.1.2", "4.5.2"}
    # РГ (100) і ОС (50) розходяться більше ніж на 25 балів.
    assert "gap:culture" in codes
    # Слабкі факти (КІ, закупівлі, повідомлення) уже пояснено в cut:accountability, окремих fact:* немає;
    # навчання 72% за порогами — рівень 3, це не слабкий факт.
    assert not any(c.startswith("fact:") for c in codes)
    # Чек-лист повністю підтверджено: рекомендацій за пунктами немає.
    assert not any(c.startswith("checklist:") for c in codes)
    # Детермінованість: той самий запит дає той самий порядок.
    assert [r["code"] for r in recs(client, campaign_id, admin)["items"]] == codes


def test_checklist_gaps_become_recommendations(client):
    campaign_id, _, _ = full_wave(client, checklist_status="none")
    items = {r["code"]: r for r in recs(client, campaign_id, auth(client, "leader"))["items"]}
    # Захід 2.7 пропонується рівно один раз: окремою рекомендацією за пунктом чек-листа або в найважливішій
    # рекомендації, що вже його містить (тоді checklist:2.7 — у її covers).
    owners = [r for r in items.values() if any(x["catalog_number"] == "2.7" for x in r["suggested_measures"])]
    assert len(owners) == 1, [r["code"] for r in owners]
    owner = owners[0]
    assert owner["code"] == "checklist:2.7" or "checklist:2.7" in owner["covers"], owner["code"]
    measure = next(x for x in owner["suggested_measures"] if x["catalog_number"] == "2.7")
    assert measure["source"] == "Додаток Д"
    assert any(c.startswith("checklist:") for c in items)  # решта пунктів чек-листа лишаються рекомендаціями


def test_decision_creates_measure_and_tracker_flow(client):
    campaign_id, admin, root = full_wave(client)
    leader = auth(client, "leader")
    url = f"{API}/campaigns/{campaign_id}/recommendations/cut:accountability/decision"

    assert client.post(url, json={"decision": "rejected"}, headers=leader).status_code == 422  # без обґрунтування
    assert client.post(url, json={"decision": "accepted"}, headers=auth(client, "auditor")).status_code == 403

    r = client.post(url, json={"decision": "accepted", "measure": {"owner": "Антикорупційний уповноважений"}}, headers=leader)
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["decision"]["decision"] == "accepted"
    assert len(rec["measures"]) == 1
    measure = rec["measures"][0]
    assert measure["catalog_number"] == "4.1.2" and measure["component"] == "accountability"
    assert measure["status"] == "planned" and measure["overdue"] is False

    murl = f"{API}/measures/{measure['id']}"
    assert client.patch(murl, json={"status": "done"}, headers=leader).status_code == 422  # без доказу
    r = client.patch(murl, json={"status": "done", "evidence": "Наказ №15 (синтетичний)"}, headers=leader)
    assert r.status_code == 200 and r.json()["done_on"] == today().isoformat()

    stats = client.get(f"{API}/measures/stats", params={"unit_id": root}, headers=auth(client, "auditor")).json()
    assert stats["total"] == 1 and stats["by_status"]["done"] == 1
    assert client.patch(murl, json={"owner": "x" * 3}, headers=auth(client, "auditor")).status_code == 403


def test_overdue_and_filters(client):
    campaign_id, _, root = full_wave(client)
    leader = auth(client, "leader")
    body = {"unit_id": root, "title": "Провести навчання", "owner": "Відділ кадрів",
            "due_date": (today() - timedelta(days=3)).isoformat(), "component": "culture"}
    assert client.post(f"{API}/measures", json=body, headers=leader).status_code == 201
    assert client.post(f"{API}/measures", json={**body, "person_name": "Іваненко"}, headers=leader).status_code == 422
    overdue = client.get(f"{API}/measures", params={"overdue": True}, headers=leader).json()
    assert len(overdue) == 1 and overdue[0]["overdue_days"] == 3


def test_history_counts_measures_between_waves(client):
    first, admin, root = full_wave(client, title="Хвиля 1")
    leader = auth(client, "leader")
    m = client.post(f"{API}/measures", json={"unit_id": root, "title": "Розібрати КІ", "owner": "Уповноважений",
                                             "due_date": today().isoformat()}, headers=leader).json()
    client.patch(f"{API}/measures/{m['id']}", json={"status": "done", "evidence": "Звіт", "done_on": today().isoformat()}, headers=leader)
    # Друга хвиля закривається того ж дня: захід виконано не пізніше її закриття.
    campaign_id, _, _ = open_campaign(client, ("nazk-maturity-staff",), title="Хвиля 2")
    close(client, campaign_id, admin)
    points = client.get(f"{API}/units/{root}/history", headers=leader).json()["points"]
    assert points[0]["measures_done"] is not None


def test_dashboard_and_report(client):
    campaign_id, _, root = full_wave(client)
    leader = auth(client, "leader")
    d = client.get(f"{API}/dashboard", headers=leader)
    assert d.status_code == 200, d.text
    d = d.json()
    assert d["campaign_id"] == campaign_id and d["unit_id"] == root
    assert round(d["index"]["score"], 1) == 59.4
    assert len(d["recommendations"]) <= 5 and d["recommendations_total"] >= len(d["recommendations"])
    assert d["measures"]["total"] == 0 and len(d["trend"]) == 1

    report = client.get(f"{API}/campaigns/{campaign_id}/report", headers=leader).json()
    assert report["index"]["score"] == d["index"]["score"] and report["recommendations"]
    csv = client.get(f"{API}/campaigns/{campaign_id}/report", params={"format": "csv"}, headers=leader)
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    assert "Індекс доброчесності" in csv.text and "рекомендація" in csv.text
    assert client.get(f"{API}/campaigns/{campaign_id}/report", headers=auth(client, "staff01")).status_code == 403


@pytest.fixture()
def theme2():
    settings = get_settings()
    old = settings.theme2_url, settings.theme2_api_key
    settings.theme2_url, settings.theme2_api_key = "http://theme2.local/api", "theme2-key-123"
    yield settings
    settings.theme2_url, settings.theme2_api_key = old


def test_theme2_outbox_and_webhook(client, theme2, monkeypatch):
    from app.services import measures as service

    _, _, root = full_wave(client)
    leader, admin = auth(client, "leader"), auth(client, "admin")
    m = client.post(f"{API}/measures", json={"unit_id": root, "title": "Захід", "owner": "Уповноважений",
                                             "due_date": today().isoformat()}, headers=leader).json()
    assert client.get(f"{API}/integrations/status", headers=admin).json()["theme2_pending"] == 1

    def down(topic, payload):
        raise OSError("connection refused")

    monkeypatch.setattr(service, "http_sender", down)
    assert client.post(f"{API}/integrations/theme2/sync", headers=admin).json() == {"sent": 0, "failed": 1, "pending": 1}

    sent = []
    monkeypatch.setattr(service, "http_sender", lambda topic, payload: sent.append(payload) or {"id": "T2-77"})
    assert client.post(f"{API}/integrations/theme2/sync", headers=admin).json()["sent"] == 1
    assert sent[0]["id"] == m["id"] and "person" not in str(sent[0])
    assert client.get(f"{API}/measures/{m['id']}", headers=leader).json()["external_id"] == "T2-77"

    hook = f"{API}/integrations/theme2/measures/status"
    body = {"external_id": "T2-77", "status": "done", "evidence": "Акт виконання"}
    assert client.post(hook, json=body, headers={"X-Integration-Key": "wrong"}).status_code == 401
    assert client.post(hook, json=body, headers={"X-Integration-Key": "theme2-key-123"}).status_code == 200
    assert client.get(f"{API}/measures/{m['id']}", headers=leader).json()["status"] == "done"


def test_assistant_disabled_by_default(client):
    campaign_id, _, _ = full_wave(client)
    r = client.post(f"{API}/assistant/ask", json={"campaign_id": campaign_id, "question": "Чому низька підзвітність?"},
                    headers=auth(client, "leader"))
    assert r.status_code == 404


def test_assistant_sees_only_aggregates(client, monkeypatch):
    from app.routers import assistant

    campaign_id, _, _ = full_wave(client)
    settings = get_settings()
    monkeypatch.setattr(settings, "assistant_enabled", True)
    prompts = []
    monkeypatch.setattr(assistant, "call_model", lambda prompt: prompts.append(prompt) or "Через факти розгляду КІ.")
    r = client.post(f"{API}/assistant/ask", json={"campaign_id": campaign_id, "question": "Чому низька підзвітність?"},
                    headers=auth(client, "leader"))
    assert r.status_code == 200 and r.json()["answer"]
    assert "staff01" not in prompts[0] and "wg1" not in prompts[0] and "Підзвітність" in prompts[0]

    monkeypatch.setattr(settings, "assistant_model", "deepseek-r1")
    r = client.post(f"{API}/assistant/ask", json={"campaign_id": campaign_id, "question": "Що робити?"},
                    headers=auth(client, "leader"))
    assert r.status_code == 503
