from tests.conftest import auth

API = "/api/v1"


def test_login_wrong_password(client):
    r = client.post(f"{API}/auth/login", data={"username": "admin", "password": "wrong-password"})
    assert r.status_code == 401


def test_me_returns_role(client):
    r = client.get(f"{API}/auth/me", headers=auth(client, "staff01"))
    assert r.status_code == 200
    assert r.json()["role"] == "respondent"
    assert r.json()["category"] == "staff"


def test_admin_endpoints_need_admin_role(client):
    assert client.get(f"{API}/admin/users").status_code == 401
    assert client.get(f"{API}/admin/users", headers=auth(client, "staff01")).status_code == 403
    assert client.get(f"{API}/admin/users", headers=auth(client, "commissioner")).status_code == 403
    assert client.get(f"{API}/admin/users", headers=auth(client, "admin")).status_code == 200


def test_create_and_update_user(client):
    headers = auth(client, "admin")
    units = client.get(f"{API}/admin/units", headers=headers).json()
    unit_id = units[0]["id"]

    new_user = {
        "login": "staff99",
        "display_name": "Новий респондент",
        "password": "password-123",
        "role": "respondent",
        "category": "staff",
        "unit_id": unit_id,
    }
    r = client.post(f"{API}/admin/users", json=new_user, headers=headers)
    assert r.status_code == 201
    user_id = r.json()["id"]
    assert "password" not in r.json() and "password_hash" not in r.json()

    assert client.post(f"{API}/admin/users", json=new_user, headers=headers).status_code == 409

    r = client.patch(f"{API}/admin/users/{user_id}", json={"role": "commissioner", "category": None}, headers=headers)
    assert r.status_code == 200
    assert r.json()["role"] == "commissioner"

    log = client.get(f"{API}/admin/audit-log?entity=user", headers=headers).json()
    assert {e["action"] for e in log} >= {"create", "update"}


def test_respondent_requires_category(client):
    headers = auth(client, "admin")
    r = client.post(
        f"{API}/admin/users",
        json={"login": "nocat", "display_name": "X", "password": "password-123", "role": "respondent"},
        headers=headers,
    )
    assert r.status_code == 422


def test_admin_cannot_demote_self(client):
    headers = auth(client, "admin")
    me = client.get(f"{API}/auth/me", headers=headers).json()
    r = client.patch(f"{API}/admin/users/{me['id']}", json={"role": "commissioner"}, headers=headers)
    assert r.status_code == 422


def test_blocked_user_cannot_login(client):
    headers = auth(client, "admin")
    users = client.get(f"{API}/admin/users?role=respondent", headers=headers).json()
    target = next(u for u in users if u["login"] == "staff02")
    client.patch(f"{API}/admin/users/{target['id']}", json={"is_active": False}, headers=headers)
    r = client.post(f"{API}/auth/login", data={"username": "staff02", "password": "demo-pass-123"})
    assert r.status_code == 401
