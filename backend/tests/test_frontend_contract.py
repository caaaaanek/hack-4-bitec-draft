"""Б1: контракт для фронтенду — формат помилок, одне k, CORS, вхід JSON, службові точки."""

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import PASSWORD, auth
from tests.helpers import API


def assert_error(r, status, code=None):
    assert r.status_code == status, r.text
    body = r.json()
    assert {"code", "message", "hint", "detail", "request_id"} <= body.keys()
    assert isinstance(body["message"], str) and body["message"]
    assert isinstance(body["hint"], str) and body["hint"]
    if code:
        assert body["code"] == code, body
    return body


def test_error_format_for_each_status(client):
    assert_error(client.get(f"{API}/auth/me"), 401, "unauthorized")
    respondent = auth(client, "staff01")
    assert_error(client.get(f"{API}/admin/users", headers=respondent), 403, "forbidden")
    admin = auth(client, "admin")
    assert_error(client.get(f"{API}/campaigns/00000000-0000-0000-0000-000000000000", headers=admin), 404, "not_found")
    assert_error(client.get(f"{API}/no-such-route"), 404, "not_found")
    assert_error(client.delete(f"{API}/config"), 405, "method_not_allowed")
    bad = assert_error(client.post(f"{API}/auth/login", data={"username": "admin", "password": "wrong-pass"}),
                       401, "bad_credentials")
    assert bad["detail"] == "Невірний логін або пароль"  # старе поле збережено для сумісності


def test_validation_errors_have_paths(client):
    admin = auth(client, "admin")
    body = assert_error(client.post(f"{API}/campaigns", json={"title": "", "unit_id": "nope"}, headers=admin),
                        422, "invalid")
    paths = {e["path"] for e in body["errors"]}
    assert {"title", "unit_id", "questionnaire_ids"} <= paths


def test_incomplete_submission_lists_missing_questions(client):
    from tests.helpers import open_campaign

    campaign_id, q, _ = open_campaign(client, ("nazk-maturity-staff",))
    headers = auth(client, "staff01")
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{q['nazk-maturity-staff']}"
    body = assert_error(client.post(f"{url}/responses", json={"answers": []}, headers=headers), 422, "incomplete")
    form = client.get(f"{url}/form", headers=headers).json()
    required = {qq["id"] for s in form["sections"] for qq in s["questions"] if qq["required"]}
    assert set(body["missing_question_ids"]) == required


def test_request_id_is_echoed(client):
    r = client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert r.headers["X-Request-ID"] == "abc-123"
    r = client.get("/health", headers={"X-Request-ID": "<script>"})
    assert r.headers["X-Request-ID"] != "<script>"


def test_public_config_has_single_k(client):
    r = client.get(f"{API}/config")
    assert r.status_code == 200
    cfg = r.json()
    assert cfg["min_group_size"] == 5
    assert cfg["auth"] == {"password": True, "proxy": False}
    assert "pdf" in cfg["evidence"]["allowed_extensions"]
    # Те саме k, що бекенд ставить у хвилю за замовчуванням.
    from tests.helpers import open_campaign

    campaign_id, _, admin = open_campaign(client, ("nazk-maturity-staff",))
    assert client.get(f"{API}/campaigns/{campaign_id}", headers=admin).json()["min_group_size"] == cfg["min_group_size"]


def test_json_session_login_and_logout(client):
    r = client.post(f"{API}/auth/session", json={"login": "leader", "password": PASSWORD})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token_type"] == "bearer" and body["expires_in"] == 480 * 60
    assert body["user"]["login"] == "leader" and body["role"] == "leader"
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    assert client.get(f"{API}/auth/session", headers=headers).json()["role"] == "leader"
    assert client.delete(f"{API}/auth/session", headers=headers).status_code == 204
    assert_error(client.post(f"{API}/auth/session", json={"login": "leader", "password": "wrong-pass"}), 401)


def test_session_login_is_throttled(client):
    for _ in range(5):
        client.post(f"{API}/auth/session", json={"login": "leader", "password": "wrong-pass"})
    r = client.post(f"{API}/auth/session", json={"login": "leader", "password": PASSWORD})
    assert_error(r, 429, "too_many_requests")
    assert int(r.headers["Retry-After"]) > 0


def test_cors_preflight_for_allowed_origin_only(client):
    ok = client.options(f"{API}/auth/session", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization"})
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-credentials" not in ok.headers
    r = client.get(f"{API}/config", headers={"Origin": "http://localhost:5173"})
    assert "X-Request-ID" in r.headers["access-control-expose-headers"]
    evil = client.options(f"{API}/auth/session", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in evil.headers


def test_unhandled_error_is_wrapped(client, monkeypatch):
    from app.routers import config as config_router

    def boom():
        raise RuntimeError("secret internals")

    with TestClient(app, raise_server_exceptions=False) as c:
        monkeypatch.setattr(config_router, "get_settings", boom)
        r = c.get(f"{API}/config")
    body = assert_error(r, 500, "internal")
    assert "secret internals" not in r.text and body["request_id"]


def test_large_body_rejected_before_parsing(client):
    admin = auth(client, "admin")
    r = client.post(f"{API}/campaigns", content=b"x" * (2 * 1024 * 1024), headers={**admin, "Content-Type": "application/json"})
    assert_error(r, 413, "too_large")
