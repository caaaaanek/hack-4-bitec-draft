"""Б5: /health з БД. Б6: вхід через довірений проксі, ROOT_PATH."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, check_settings, get_settings
from app.main import app
from tests.helpers import API


@pytest.fixture()
def settings_env(monkeypatch):
    """Змінює налаштування на час тесту (get_settings кешується)."""

    def apply(**env):
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()

    yield apply
    monkeypatch.undo()
    get_settings.cache_clear()


def test_health_checks_database(client):
    for url in ("/health", f"{API}/health"):
        r = client.get(url)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ok" and r.json()["database"] == "ok"


def test_health_reports_503_when_database_down(client):
    from app.db import get_db

    class Broken:
        def execute(self, *_):
            raise RuntimeError("connection refused")

    app.dependency_overrides[get_db] = lambda: Broken()
    try:
        r = client.get("/health")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 503 and r.json()["database"] == "unavailable"


def test_proxy_login_disabled_by_default(client):
    r = client.post(f"{API}/auth/proxy", headers={"X-Remote-User": "admin"})
    assert r.status_code == 404 and r.json()["code"] == "proxy_auth_disabled"


def proxy_client(host: str) -> TestClient:
    return TestClient(app, client=(host, 40000))


def test_proxy_login_from_trusted_proxy(client, settings_env):
    settings_env(PROXY_AUTH_ENABLED="true", TRUSTED_PROXIES="10.0.0.0/24")
    with proxy_client("10.0.0.7") as c:
        r = c.post(f"{API}/auth/proxy", headers={"X-Remote-User": "leader@org.example"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["login"] == "leader" and body["role"] == "leader"
        me = c.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
        assert me.json()["login"] == "leader"
        assert c.get(f"{API}/config").json()["auth"]["proxy"] is True
        # Невідомого користувача не створюємо.
        r = c.post(f"{API}/auth/proxy", headers={"X-Remote-User": "stranger"})
        assert r.status_code == 403 and r.json()["code"] == "unknown_user"
        r = c.post(f"{API}/auth/proxy")
        assert r.status_code == 401 and r.json()["code"] == "no_proxy_user"
        r = c.post(f"{API}/auth/proxy", headers={"X-Remote-User": "admin' OR 1=1"})
        assert r.status_code == 401


def test_proxy_header_from_untrusted_address_is_ignored(client, settings_env):
    settings_env(PROXY_AUTH_ENABLED="true", TRUSTED_PROXIES="10.0.0.0/24")
    with proxy_client("192.168.1.50") as c:
        # X-Forwarded-For не допомагає: перевіряється безпосередній співрозмовник.
        r = c.post(f"{API}/auth/proxy", headers={"X-Remote-User": "admin", "X-Forwarded-For": "10.0.0.7"})
        assert r.status_code == 403 and r.json()["code"] == "untrusted_proxy"


def test_proxy_shared_secret(client, settings_env):
    settings_env(PROXY_AUTH_ENABLED="true", TRUSTED_PROXIES="10.0.0.7", PROXY_AUTH_SECRET="s3cret-value")
    with proxy_client("10.0.0.7") as c:
        assert c.post(f"{API}/auth/proxy", headers={"X-Remote-User": "admin"}).status_code == 403
        r = c.post(f"{API}/auth/proxy", headers={"X-Remote-User": "admin", "X-Proxy-Secret": "s3cret-value"})
        assert r.status_code == 200


def test_password_login_can_be_disabled(client, settings_env):
    settings_env(PASSWORD_LOGIN_ENABLED="false")
    r = client.post(f"{API}/auth/session", json={"login": "admin", "password": "whatever-123"})
    assert r.status_code == 403 and r.json()["code"] == "password_login_disabled"


def test_unsafe_settings_stop_startup():
    base = {"jwt_secret": "x" * 40}
    with pytest.raises(RuntimeError, match="TRUSTED_PROXIES"):
        check_settings(Settings(**base, proxy_auth_enabled=True, trusted_proxies=""))
    with pytest.raises(RuntimeError, match="CORS"):
        check_settings(Settings(**base, cors_origins="*"))
    with pytest.raises(RuntimeError, match="ROOT_PATH"):
        check_settings(Settings(**base, root_path="imd/"))
    check_settings(Settings(**base, root_path="/imd"))


def test_root_path_prefix_in_openapi(client):
    """За проксі з підшляхом /imd застосунок віддає правильні адреси в OpenAPI."""
    with TestClient(app, root_path="/imd") as c:
        assert c.get("/health").status_code == 200
        spec = c.get("/openapi.json").json()
        assert spec["servers"][0]["url"] == "/imd"


def test_client_ip_trusts_forwarded_only_from_proxy(settings_env):
    from starlette.requests import Request

    from app.security import client_ip

    settings_env(TRUSTED_PROXIES="10.0.0.0/24")

    def req(peer, xff=None):
        headers = [(b"x-forwarded-for", xff.encode())] if xff else []
        return Request({"type": "http", "client": (peer, 1), "headers": headers})

    assert client_ip(req("10.0.0.2", "203.0.113.9, 10.0.0.3")) == "203.0.113.9"
    assert client_ip(req("198.51.100.1", "203.0.113.9")) == "198.51.100.1"
