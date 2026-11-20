"""Виправлення з аналізу 19.11: довгий пароль, ключ інтеграції з не-ASCII, нормативка, «Що, якщо»."""

import io
import zipfile

import pytest

from app.services import normative
from tests.conftest import PASSWORD, auth

API = "/api/v1"


def test_long_password_is_401_not_500(client):
    # bcrypt 5 кидає ValueError на паролі > 72 байтів; вхід має відповідати як на звичайний невірний пароль.
    for login in ("admin", "no-such-user"):
        r = client.post(f"{API}/auth/login", data={"username": login, "password": "я" * 100})
        assert r.status_code == 401, r.text
        r = client.post(f"{API}/auth/session", json={"login": login, "password": "я" * 60})
        assert r.status_code == 401, r.text
    # звичайний вхід після цього працює
    assert client.post(f"{API}/auth/login", data={"username": "admin", "password": PASSWORD}).status_code == 200


def test_invite_password_over_72_bytes_is_rejected(client):
    body = {"login": "longpw", "display_name": "Довгий пароль", "role": "auditor"}
    r = client.post(f"{API}/admin/users", json=body, headers=auth(client, "coordinator"))
    assert r.status_code == 201, r.text
    token = r.json()["invite_link"].rsplit("/", 1)[-1]
    r = client.post(f"{API}/auth/invite", json={"token": token, "password": "я" * 40})
    assert r.status_code == 422 and "72" in r.text, r.text
    # рівно 72 байти — можна
    assert client.post(f"{API}/auth/invite", json={"token": token, "password": "я" * 36}).status_code == 204
    r = client.post(f"{API}/auth/session", json={"login": "longpw", "password": "я" * 36})
    assert r.status_code == 200, r.text


def test_non_ascii_integration_key_is_401(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "theme2_api_key", "mitra-secret")
    monkeypatch.setattr(get_settings(), "integration_keys", "mitra=fact-secret")
    bad = {"X-Integration-Key": "ключ".encode()}
    assert client.post(f"{API}/indicators", headers=bad, json={}).status_code == 401
    r = client.post(f"{API}/integrations/theme2/measures/status", headers=bad,
                    json={"external_id": "MITRA-1", "state": "in_progress"})
    assert r.status_code == 401, r.text


def test_docx_bomb_rejected():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", b"<a>" + b" " * (normative.MAX_UNPACKED_BYTES + 1) + b"</a>")
    assert len(buf.getvalue()) < 1024 * 1024  # стиснуто в сотні КБ
    with pytest.raises(ValueError, match="50 МБ"):
        normative.read_document("bomb.docx", buf.getvalue())


def test_normative_bad_docx_is_422(client):
    leader = auth(client, "leader")
    r = client.post(f"{API}/normative/analyze", headers=leader,
                    files={"file": ("x.docx", b"not a zip at all", "application/octet-stream")})
    assert r.status_code == 422, r.text
