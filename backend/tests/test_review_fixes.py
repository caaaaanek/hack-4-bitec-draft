"""Зауваження рецензента: дати автопілота в минулому і повернення анкети з архіву."""

from datetime import timedelta

from app.clock import today
from tests.conftest import auth
from tests.helpers import API, ROOT, open_campaign, questionnaire_ids, units

STAFF = "nazk-maturity-staff"


def draft_wave(client, admin):
    q = questionnaire_ids(client, admin)
    r = client.post(f"{API}/campaigns", json={"title": "Минулі дати", "unit_id": units(client, admin)[ROOT],
                                              "questionnaire_ids": [q[STAFF]]}, headers=admin)
    assert r.status_code == 201, r.text
    return f"{API}/campaigns/{r.json()['id']}/autopilot"


def test_autopilot_rejects_past_dates(client):
    admin = auth(client, "admin")
    url = draft_wave(client, admin)
    yesterday, week = (today() - timedelta(days=1)).isoformat(), (today() + timedelta(days=7)).isoformat()

    r = client.put(url, json={"enabled": True, "planned_open_on": yesterday, "planned_close_on": week}, headers=admin)
    assert r.status_code == 422 and r.json()["code"] == "date_in_past", r.text
    r = client.put(url, json={"enabled": True, "planned_close_on": yesterday}, headers=admin)
    assert r.status_code == 422 and "закриття" in r.json()["message"], r.text

    plan = {"enabled": True, "planned_open_on": today().isoformat(), "planned_close_on": week}
    assert client.put(url, json=plan, headers=admin).status_code == 200  # сьогодні можна
    # Вимкнений автопілот нічого не виконує: старі дати у формі не заважають його вимкнути.
    assert client.put(url, json={"enabled": False, "planned_close_on": yesterday}, headers=admin).status_code == 200


def test_open_wave_keeps_its_past_open_date(client):
    """У відкритої хвилі дата відкриття вже минула: зміна інших полів не має на ній падати."""
    campaign_id, _, admin = open_campaign(client, [STAFF])
    url = f"{API}/campaigns/{campaign_id}/autopilot"
    plan = client.get(url, headers=admin).json()
    body = {"enabled": True, "planned_open_on": plan["planned_open_on"],
            "planned_close_on": (today() + timedelta(days=5)).isoformat(), "remind_every_days": 2}
    r = client.put(url, json=body, headers=admin)
    assert r.status_code == 200, r.text


def test_restore_questionnaire_from_archive(client):
    commissioner = auth(client, "department")
    qid = questionnaire_ids(client, commissioner)[STAFF]

    assert client.post(f"{API}/questionnaires/{qid}/restore", headers=commissioner).status_code == 409  # не в архіві
    assert client.post(f"{API}/questionnaires/{qid}/archive", headers=commissioner).json()["status"] == "archived"
    assert client.post(f"{API}/questionnaires/{qid}/restore", headers=auth(client, "admin")).status_code == 403

    r = client.post(f"{API}/questionnaires/{qid}/restore", headers=commissioner)
    assert r.status_code == 200 and r.json()["status"] == "published", r.text
    actions = [e["action"] for e in client.get(f"{API}/admin/audit-log", headers=auth(client, "admin")).json()]
    assert "restore" in actions
