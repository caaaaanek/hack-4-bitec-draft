"""Роль coordinator: керування користувачами й підрозділами, журнал, зведення без персональних даних."""

from tests.conftest import auth
from tests.helpers import API, ROOT, open_campaign, units

STAFF = "nazk-maturity-staff"


def test_coordinator_manages_users_and_units(client):
    h = auth(client, "coordinator")
    r = client.post(f"{API}/admin/users", headers=h, json={
        "login": "newbie", "display_name": "Новий", "password": "long-password-1", "role": "leader"})
    assert r.status_code == 201, r.text
    r = client.patch(f"{API}/admin/users/{r.json()['id']}", headers=h, json={"display_name": "Змінений"})
    assert r.status_code == 200 and r.json()["display_name"] == "Змінений"

    r = client.post(f"{API}/admin/units", headers=h, json={"name": "Новий підрозділ"})
    assert r.status_code == 201, r.text
    r = client.patch(f"{API}/admin/units/{r.json()['id']}", headers=h, json={"name": "Перейменований"})
    assert r.status_code == 200 and r.json()["name"] == "Перейменований"
    assert client.get(f"{API}/admin/audit-log", headers=h).status_code == 200


def test_overview_structure(client):
    r = client.get(f"{API}/admin/overview", headers=auth(client, "coordinator"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["users"]["by_role"]["coordinator"] == 1
    assert body["users"]["total"] == sum(body["users"]["by_role"].values())
    assert body["units"]["total"] > 0 and body["users"]["inactive"] == 0
    assert body["campaigns"] == []
    assert set(body["checks"]) == {"findings_total", "findings_open"}
    assert client.get(f"{API}/admin/overview", headers=auth(client, "admin")).status_code == 200


def test_overview_forbidden_for_others(client):
    for login in ("leader", "staff01"):
        assert client.get(f"{API}/admin/overview", headers=auth(client, login)).status_code == 403


def test_coordinator_cannot_create_campaign(client):
    admin = auth(client, "admin")
    q = {x["code"]: x["id"] for x in client.get(f"{API}/questionnaires", headers=admin).json()}
    r = client.post(f"{API}/campaigns", headers=auth(client, "coordinator"),
                    json={"title": "Х", "unit_id": units(client, admin)[ROOT], "questionnaire_ids": [q[STAFF]]})
    assert r.status_code == 403


def test_overview_hides_small_groups(client):
    # Відкрити хвилю з групою, меншою за k, не можна; зведення ховає кількості вже в чернетці.
    open_campaign(client, (STAFF,), min_group_size=1000, open_it=False)
    camp = client.get(f"{API}/admin/overview", headers=auth(client, "coordinator")).json()["campaigns"][0]
    assert camp["status"] == "draft"
    assert camp["progress"] == [{"questionnaire_title": camp["progress"][0]["questionnaire_title"],
                                 "submitted": None, "eligible": None, "hidden": True}]
