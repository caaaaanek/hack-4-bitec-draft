"""Б3: Assessment Manager — зміна чернетки хвилі, явні учасники, імпорт CSV псевдонімів, підрозділи."""

import csv
import io

from tests.conftest import auth
from tests.helpers import API, ROOT, open_campaign, questionnaire_ids, units

STAFF = "nazk-maturity-staff"
WG = "nazk-maturity-wg"


def draft(client, codes=(STAFF,), access_mode="login"):
    admin = auth(client, "admin")
    q = questionnaire_ids(client, admin)
    r = client.post(f"{API}/campaigns", json={"title": "Чернетка", "unit_id": units(client, admin)[ROOT],
                                              "questionnaire_ids": [q[c] for c in codes], "access_mode": access_mode},
                    headers=admin)
    assert r.status_code == 201, r.text
    return r.json()["id"], q, admin


def user_ids(client, admin) -> dict[str, str]:
    return {u["login"]: u["id"] for u in client.get(f"{API}/admin/users", headers=admin).json()}


def upload_csv(client, campaign_id, text, admin, fmt="json"):
    return client.post(f"{API}/campaigns/{campaign_id}/participants/import", params={"format": fmt},
                       files={"file": ("people.csv", text.encode("utf-8"), "text/csv")}, headers=admin)


# ---------- PATCH хвилі ----------

def test_patch_draft_campaign(client):
    campaign_id, q, admin = draft(client)
    unit_a = units(client, admin)["Підрозділ А"]
    r = client.patch(f"{API}/campaigns/{campaign_id}", json={
        "title": "Хвиля весна", "unit_id": unit_a, "questionnaire_ids": [q[STAFF], q[WG]], "min_group_size": 6},
        headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "Хвиля весна" and body["unit_id"] == unit_a and body["min_group_size"] == 6
    assert set(body["questionnaire_ids"]) == {q[STAFF], q[WG]}
    assert client.patch(f"{API}/campaigns/{campaign_id}", json={"min_group_size": 3}, headers=admin).status_code == 422
    assert client.patch(f"{API}/campaigns/{campaign_id}", json={"unit_id": None}, headers=admin).status_code == 422
    assert client.patch(f"{API}/campaigns/{campaign_id}", json={"status": "open"}, headers=admin).status_code == 422
    log = client.get(f"{API}/admin/audit-log", params={"entity": "campaign", "action": "update"}, headers=admin).json()
    assert log and log[0]["details"]["title"] == "Хвиля весна"


def test_patch_open_campaign_is_409(client):
    campaign_id, _, admin = open_campaign(client, (STAFF,))
    r = client.patch(f"{API}/campaigns/{campaign_id}", json={"title": "Інша"}, headers=admin)
    assert r.status_code == 409 and r.json()["code"] == "not_draft"


def test_patch_blocked_while_tokens_issued(client):
    campaign_id, q, admin = draft(client, access_mode="token")
    unit_a = units(client, admin)["Підрозділ А"]
    client.post(f"{API}/campaigns/{campaign_id}/tokens", json={"questionnaire_id": q[STAFF], "unit_id": unit_a,
                                                               "count": 5}, headers=admin)
    r = client.patch(f"{API}/campaigns/{campaign_id}", json={"access_mode": "login"}, headers=admin)
    assert r.status_code == 409 and r.json()["code"] == "tokens_issued"
    assert client.patch(f"{API}/campaigns/{campaign_id}", json={"title": "Можна"}, headers=admin).status_code == 200
    client.post(f"{API}/campaigns/{campaign_id}/tokens/revoke", json={}, headers=admin)
    assert client.patch(f"{API}/campaigns/{campaign_id}", json={"access_mode": "login"}, headers=admin).status_code == 200


# ---------- Явні учасники ----------

def test_explicit_participants_limit_who_answers(client):
    campaign_id, q, admin = draft(client)
    ids = user_ids(client, admin)
    chosen = ["staff01", "staff02", "staff03", "staff04", "staff05"]
    r = client.put(f"{API}/campaigns/{campaign_id}/participants", json={"user_ids": [ids[x] for x in chosen]},
                   headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["explicit"] and {p["login"] for p in r.json()["participants"]} == set(chosen)
    assert all(p["eligible"] for p in r.json()["participants"])
    # Не респондента додати не можна.
    bad = client.put(f"{API}/campaigns/{campaign_id}/participants", json={"user_ids": [ids["leader"]]}, headers=admin)
    assert bad.status_code == 422

    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    def assigned(login):
        return any(a["campaign_id"] == campaign_id for a in client.get(f"{API}/me/assignments", headers=auth(client, login)).json())
    assert assigned("staff01") and not assigned("staff10")
    r = client.get(f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}/form", headers=auth(client, "staff10"))
    assert r.status_code == 403
    item = client.get(f"{API}/campaigns/{campaign_id}/progress", headers=admin).json()["items"][0]
    assert item["eligible"] == 5
    # Після відкриття склад через PUT не змінюється.
    assert client.put(f"{API}/campaigns/{campaign_id}/participants", json={"user_ids": []},
                      headers=admin).status_code == 409


def test_open_with_empty_explicit_list_is_409(client):
    campaign_id, _, admin = draft(client)
    client.put(f"{API}/campaigns/{campaign_id}/participants", json={"user_ids": []}, headers=admin)
    r = client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin)
    assert r.status_code == 409 and r.json()["code"] == "no_participants"
    client.delete(f"{API}/campaigns/{campaign_id}/participants", headers=admin)
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200


# ---------- Імпорт CSV ----------

def test_import_csv_creates_pseudonymous_accounts(client):
    campaign_id, q, admin = draft(client)
    text = ("login;category;unit;display_name\n"
            "anon-a1;staff;Підрозділ А;Респондент А1\n"
            "anon-a2;staff;Підрозділ А;\n"
            "staff01;;;\n")
    r = upload_csv(client, campaign_id, text, admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rows"] == 3 and body["created_users"] == 2 and body["added_participants"] == 3
    creds = {c["login"]: c["password"] for c in body["credentials"]}
    assert set(creds) == {"anon-a1", "anon-a2"}
    login = client.post(f"{API}/auth/login", data={"username": "anon-a1", "password": creds["anon-a1"]})
    assert login.status_code == 200
    participants = client.get(f"{API}/campaigns/{campaign_id}/participants", headers=admin).json()
    assert participants["explicit"] and len(participants["participants"]) == 3
    # Паролі не потрапляють у журнал.
    log = client.get(f"{API}/admin/audit-log", params={"action": "import_participants"}, headers=admin).json()
    assert creds["anon-a1"] not in str(log)


def test_import_csv_is_all_or_nothing_with_line_numbers(client):
    campaign_id, _, admin = draft(client)
    text = ("login,category,unit\n"
            "ok-person,staff,Підрозділ А\n"
            "x,staff,Підрозділ А\n"
            "nounit,staff,Немає такого\n"
            "leader,,\n")
    r = upload_csv(client, campaign_id, text, admin)
    assert r.status_code == 422 and r.json()["code"] == "import_failed"
    lines = {e["path"] for e in r.json()["errors"]}
    assert lines == {"line 3", "line 4", "line 5"}
    assert "ok-person" not in user_ids(client, admin)


def test_import_csv_rejects_personal_data_columns(client):
    campaign_id, _, admin = draft(client)
    r = upload_csv(client, campaign_id, "login,email,category,unit\np1,a@b.c,staff,Підрозділ А\n", admin)
    assert r.status_code == 422 and r.json()["code"] == "personal_data"


def test_import_csv_in_token_mode_returns_links_and_stores_no_pseudonyms(client):
    campaign_id, q, admin = draft(client, codes=(STAFF, WG), access_mode="token")
    text = ("pseudonym,category,unit\n" + "".join(f"k-{i},staff,Підрозділ А\n" for i in range(1, 6))
            + "".join(f"wg-{i},working_group,Організація (демо)\n" for i in "xyzvw"))
    r = upload_csv(client, campaign_id, text, admin, fmt="csv")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(r.text.lstrip("﻿"))))
    assert [row["login"] for row in rows][:2] == ["k-1", "k-2"] and len(rows) == 10
    assert all("/s/" in row["link"] for row in rows)
    logins = user_ids(client, admin)
    assert "k-1" not in logins and "wg-x" not in logins
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    token = rows[0]["link"].rsplit("/", 1)[1]
    form = client.get(f"{API}/respond/form", headers={"X-Response-Token": token})
    assert form.status_code == 200 and form.json()["questionnaire_id"] == q[STAFF]
    log = client.get(f"{API}/admin/audit-log", params={"action": "import_tokens"}, headers=admin).json()
    assert "k-1" not in str(log) and token not in str(log)


# ---------- Підрозділи ----------

def test_unit_rename_move_and_cycle(client):
    admin = auth(client, "admin")
    u = units(client, admin)
    r = client.patch(f"{API}/admin/units/{u['Підрозділ В']}", json={"name": "Підрозділ В (новий)"}, headers=admin)
    assert r.status_code == 200 and r.json()["name"] == "Підрозділ В (новий)"
    r = client.patch(f"{API}/admin/units/{u['Підрозділ В']}", json={"parent_id": u["Підрозділ А"]}, headers=admin)
    assert r.status_code == 200 and r.json()["parent_id"] == u["Підрозділ А"]
    r = client.patch(f"{API}/admin/units/{u['Підрозділ А']}", json={"parent_id": u["Підрозділ А-1"]}, headers=admin)
    assert r.status_code == 422 and r.json()["code"] == "unit_cycle"
    log = client.get(f"{API}/admin/audit-log", params={"entity": "unit", "action": "update"}, headers=admin).json()
    assert len(log) == 2


def test_unit_move_blocked_during_open_campaign(client):
    campaign_id, _, admin = open_campaign(client, (STAFF,))
    u = units(client, admin)
    r = client.patch(f"{API}/admin/units/{u['Підрозділ В']}", json={"parent_id": u["Підрозділ А"]}, headers=admin)
    assert r.status_code == 409 and r.json()["code"] == "campaign_open"
    # Перейменування не змінює складу груп і дозволене.
    assert client.patch(f"{API}/admin/units/{u['Підрозділ В']}", json={"name": "В"}, headers=admin).status_code == 200


def test_unit_delete_only_when_unused(client):
    admin = auth(client, "admin")
    u = units(client, admin)
    r = client.delete(f"{API}/admin/units/{u['Підрозділ А']}", headers=admin)
    assert r.status_code == 409 and r.json()["code"] == "unit_in_use"
    new = client.post(f"{API}/admin/units", json={"name": "Тимчасовий", "parent_id": u[ROOT]}, headers=admin).json()
    assert client.delete(f"{API}/admin/units/{new['id']}", headers=admin).status_code == 204
    assert "Тимчасовий" not in units(client, admin)


def test_campaign_reports_has_checklist(client):
    from tests.helpers import open_campaign

    with_ck, _, admin = open_campaign(client, ("nazk-maturity-staff", "nazk-checklist"), title="З чек-листом")
    without, _, _ = open_campaign(client, ("nazk-maturity-staff",), title="Без чек-листа")
    flags = {c["id"]: c["has_checklist"] for c in client.get("/api/v1/campaigns", headers=admin).json()}
    assert flags[with_ck] is True and flags[without] is False
    assert client.get(f"/api/v1/campaigns/{without}/checklist", headers=admin).status_code == 404
