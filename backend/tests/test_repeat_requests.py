"""Повторні й паралельні запити: подвійний клік, адмін і автопілот одночасно, чужі джерела фактів, тіло частинами.

Паралельні сценарії (race) перевіряються лише на PostgreSQL (TEST_DATABASE_URL, так у CI): SQLite не має
блокування рядків (FOR UPDATE), і там результат гонки залежить від планувальника потоків.
"""

import threading

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import SessionLocal, engine
from app.main import app
from app.models import Measure, Participation, ResponsePool
from tests.conftest import auth
from tests.helpers import API, ROOT, full_wave, open_campaign, units

STAFF = "nazk-maturity-staff"
postgres_only = pytest.mark.skipif(engine.dialect.name != "postgresql",
                                   reason="гонки перевіряються на PostgreSQL (блокування рядків)")


def race(fn, n: int = 5) -> list:
    """n одночасних викликів fn (через бар'єр). Повертає результати."""
    out: list = []
    barrier = threading.Barrier(n)

    def run():
        barrier.wait()
        out.append(fn())

    threads = [threading.Thread(target=run) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


@pytest.fixture()
def raw(client):
    """Клієнт, який повертає 500 як відповідь, а не кидає виняток (щоб побачити, що саме отримав користувач)."""
    return TestClient(app, raise_server_exceptions=False)


def staff_answers(client, url, headers):
    form = client.get(f"{url}/form", headers=headers).json()
    return [{"question_id": q["id"], "option_ids": [q["options"][0]["id"]]}
            for s in form["sections"] for q in s["questions"]]


def test_repeat_submit_is_409(client):
    campaign_id, q, _ = open_campaign(client, (STAFF,))
    headers = auth(client, "staff01")
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}"
    answers = staff_answers(client, url, headers)
    assert client.post(f"{url}/responses", json={"answers": answers}, headers=headers).status_code == 201
    again = client.post(f"{url}/responses", json={"answers": answers}, headers=headers)
    assert again.status_code == 409 and again.json()["code"] == "already_submitted"


@postgres_only
def test_parallel_submit_is_409_not_500(client, raw):
    campaign_id, q, _ = open_campaign(client, (STAFF,))
    headers = auth(client, "staff01")
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}"
    answers = staff_answers(client, url, headers)

    codes = race(lambda: raw.post(f"{url}/responses", json={"answers": answers}, headers=headers).status_code)
    assert sorted(codes) == [201] + [409] * (len(codes) - 1), codes

    again = client.post(f"{url}/responses", json={"answers": answers}, headers=headers)
    assert again.status_code == 409 and again.json()["code"] == "already_submitted"
    with SessionLocal() as db:
        assert db.query(Participation).count() == 1
        assert db.query(ResponsePool).count() == 1  # друга відповідь відкотилася разом з участю


@postgres_only
def test_parallel_close_one_wins_rest_409(client, raw):
    campaign_id, _, admin = open_campaign(client, (STAFF,))
    codes = race(lambda: raw.post(f"{API}/campaigns/{campaign_id}/close", headers=admin).status_code, 4)
    assert sorted(codes) == [200, 409, 409, 409], codes


@postgres_only
def test_parallel_open_one_wins_rest_409(client, raw):
    admin = auth(client, "admin")
    qs = {x["code"]: x["id"] for x in client.get(f"{API}/questionnaires", headers=admin).json()}
    r = client.post(f"{API}/campaigns", json={"title": "Х", "unit_id": units(client, admin)[ROOT],
                                              "questionnaire_ids": [qs[STAFF]]}, headers=admin)
    campaign_id = r.json()["id"]
    codes = race(lambda: raw.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code, 4)
    assert sorted(codes) == [200, 409, 409, 409], codes


def decide(client, campaign_id, code, headers, **body):
    r = client.post(f"{API}/campaigns/{campaign_id}/recommendations/{code}/decision", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_repeated_accept_creates_one_measure(client):
    campaign_id, _, _ = full_wave(client)
    leader = auth(client, "leader")
    code = client.get(f"{API}/campaigns/{campaign_id}/recommendations", headers=leader).json()["items"][0]["code"]
    accept = {"decision": "accepted", "measure": {"owner": "Начальник кафедри"}}

    decide(client, campaign_id, code, leader, **accept)
    out = decide(client, campaign_id, code, leader, **accept)
    assert len(out["measures"]) == 1


@postgres_only
def test_parallel_accept_creates_one_measure(client, raw):
    campaign_id, _, _ = full_wave(client)
    leader = auth(client, "leader")
    code = client.get(f"{API}/campaigns/{campaign_id}/recommendations", headers=leader).json()["items"][0]["code"]
    url = f"{API}/campaigns/{campaign_id}/recommendations/{code}/decision"
    body = {"decision": "accepted", "measure": {"owner": "Начальник кафедри"}}

    codes = race(lambda: raw.post(url, json=body, headers=leader).status_code, 4)
    assert 500 not in codes and 200 in codes, codes
    with SessionLocal() as db:
        assert db.query(Measure).filter(Measure.recommendation_code == code).count() == 1


def test_reject_after_accept_cancels_open_measures(client):
    campaign_id, _, _ = full_wave(client)
    leader = auth(client, "leader")
    code = client.get(f"{API}/campaigns/{campaign_id}/recommendations", headers=leader).json()["items"][0]["code"]
    decide(client, campaign_id, code, leader, decision="accepted", measure={"owner": "Начальник кафедри"})

    out = decide(client, campaign_id, code, leader, decision="rejected", comment="Вже врегульовано наказом")
    assert [m["status"] for m in out["measures"]] == ["cancelled"]
    log = client.get(f"{API}/admin/audit-log", params={"limit": 50}, headers=auth(client, "admin")).json()
    entries = log["items"] if isinstance(log, dict) else log
    cancel = next(e for e in entries if e["entity"] == "measure" and e["details"].get("status") == "cancelled")
    assert "Вже врегульовано наказом" in cancel["details"]["reason"]

    # Повторне прийняття після відхилення — новий захід (скасований не рахується).
    out = decide(client, campaign_id, code, leader, decision="accepted", measure={"owner": "Начальник кафедри"})
    assert sorted(m["status"] for m in out["measures"]) == ["cancelled", "planned"]


def test_source_key_cannot_overwrite_other_source(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "integration_keys", "artemida=key-a;training=key-t;learning=key-l")
    root = units(client, auth(client, "admin"))[ROOT]
    body = {"unit_id": root, "period": "2026-07", "indicator": "training_coverage",
            "numerator": 72, "denominator": 100, "source": "training"}
    assert client.post(f"{API}/indicators", json=body, headers={"X-Integration-Key": "key-t"}).status_code == 201

    # Інший власник того самого факту (флешкартки) не переписує вже переданий показник.
    r = client.post(f"{API}/indicators", json={**body, "numerator": 100, "source": "learning"},
                    headers={"X-Integration-Key": "key-l"})
    assert r.status_code == 409 and r.json()["code"] == "source_conflict"
    # Джерело, що не є власником факту, не передає його взагалі (В7).
    r = client.post(f"{API}/indicators", json={**body, "numerator": 100, "source": "artemida"},
                    headers={"X-Integration-Key": "key-a"})
    assert r.status_code == 409 and r.json()["code"] == "not_fact_owner" and "learning" in r.json()["message"]

    # Своє джерело оновлює свій показник, як і раніше.
    r = client.post(f"{API}/indicators", json={**body, "numerator": 80}, headers={"X-Integration-Key": "key-t"})
    assert r.status_code == 201 and r.json()["numerator"] == 80
    # Адмін (і застарілий спільний ключ) може виправити будь-яке джерело.
    r = client.post(f"{API}/indicators", json={**body, "numerator": 75, "source": "artemida"},
                    headers={"X-Integration-Key": "test-integration-key"})
    assert r.status_code == 201


def test_chunked_body_over_limit_is_413(client, raw):
    limit = get_settings().evidence_max_bytes + 1024 * 1024

    def chunks():
        piece = b"a" * 65536
        for _ in range(limit // len(piece) + 2):
            yield piece

    r = raw.post(f"{API}/auth/login", content=chunks(),
                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert r.status_code == 413, r.text
    assert r.json()["code"] == "too_large"
    # Звичайний вхід як і раніше працює.
    assert auth(client, "admin")
