"""Відкликання сесій (вихід, зміна пароля, блокування) і ліміт спроб у БД."""
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import LoginFailure, RevokedToken, User
from app.security import LoginThrottle
from tests.conftest import PASSWORD, auth

API = "/api/v1"


def me(client, headers) -> int:
    return client.get(f"{API}/auth/session", headers=headers).status_code


def user_id(client, admin, login) -> str:
    return next(u["id"] for u in client.get(f"{API}/admin/users", headers=admin).json() if u["login"] == login)


def test_logout_revokes_only_this_token(client):
    first, second = auth(client, "leader"), auth(client, "leader")
    assert me(client, first) == 200 and me(client, second) == 200
    assert client.delete(f"{API}/auth/session", headers=first).status_code == 204
    assert me(client, first) == 401  # вихід діє на сервері, а не лише в браузері
    assert me(client, second) == 200  # інша сесія того ж облікового запису (спільний демо-логін) працює
    with SessionLocal() as db:
        assert db.scalar(select(RevokedToken)) is not None


def test_password_reset_by_invite_revokes_all_sessions(client):
    co = auth(client, "coordinator")
    old = auth(client, "leader")
    r = client.post(f"{API}/admin/users/{user_id(client, co, 'leader')}/invite", headers=co)
    assert r.status_code == 201, r.text
    assert me(client, old) == 401  # скидання запрошенням гасить старі сесії
    assert client.post(f"{API}/auth/session", json={"login": "leader", "password": PASSWORD}).status_code == 401
    assert client.post(f"{API}/auth/invite", json={"token": r.json()["invite_token"],
                                                   "password": "new-password-123"}).status_code == 204
    r = client.post(f"{API}/auth/session", json={"login": "leader", "password": "new-password-123"})
    assert r.status_code == 200
    assert me(client, {"Authorization": f"Bearer {r.json()['access_token']}"}) == 200
    assert me(client, co) == 200  # сесії інших користувачів не зачеплені


def test_block_and_unblock_keeps_old_token_invalid(client):
    co = auth(client, "coordinator")
    old = auth(client, "staff01")
    uid = user_id(client, co, "staff01")
    assert client.patch(f"{API}/admin/users/{uid}", headers=co, json={"is_active": False}).status_code == 200
    assert client.patch(f"{API}/admin/users/{uid}", headers=co, json={"is_active": True}).status_code == 200
    assert me(client, old) == 401  # після розблокування потрібен новий вхід
    assert me(client, auth(client, "staff01")) == 200


def test_rename_keeps_sessions(client):
    co = auth(client, "coordinator")
    other = auth(client, "department")
    uid = user_id(client, co, "department")
    with SessionLocal() as db:
        before = db.get(User, uuid.UUID(uid)).token_version
    r = client.patch(f"{API}/admin/users/{uid}", headers=co, json={"display_name": "Департамент"})
    assert r.status_code == 200
    assert me(client, other) == 200
    with SessionLocal() as db:
        assert db.get(User, uuid.UUID(uid)).token_version == before


def test_throttle_is_shared_and_stores_no_login(client):
    for _ in range(5):
        r = client.post(f"{API}/auth/session", json={"login": "leader", "password": "wrong-password"})
        assert r.status_code == 401
    # Новий екземпляр (як інший воркер чи процес після перезапуску) бачить ті самі спроби
    assert LoginThrottle("login").blocked_for(("leader", "testclient")) > 0
    r = client.post(f"{API}/auth/session", json={"login": "leader", "password": PASSWORD})
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
    with SessionLocal() as db:
        keys = db.scalars(select(LoginFailure.key)).all()
    assert keys and all(len(k) == 64 and "leader" not in k for k in keys)


def test_throttle_scopes_are_independent(client):
    login, token = LoginThrottle("login"), LoginThrottle("token")
    for _ in range(5):
        token.fail(("token", "10.0.0.1"))
    assert token.blocked_for(("token", "10.0.0.1")) > 0
    assert login.blocked_for(("token", "10.0.0.1")) == 0
    login.reset()
    assert token.blocked_for(("token", "10.0.0.1")) > 0
    token.reset(("token", "10.0.0.1"))
    assert token.blocked_for(("token", "10.0.0.1")) == 0
