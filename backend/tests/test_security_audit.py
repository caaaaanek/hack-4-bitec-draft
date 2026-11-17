"""Обмеження спроб входу, секрет JWT, ролі керівника й аудитора, ланцюжок хешів журналу."""

import pytest
from sqlalchemy import delete, select, update

from app.config import Settings, check_settings
from app.db import SessionLocal
from app.models import AuditHead, AuditLog
from tests.conftest import PASSWORD, auth
from tests.helpers import API, ROOT, full_wave, results, units


def test_short_jwt_secret_is_rejected():
    with pytest.raises(RuntimeError):
        check_settings(Settings(jwt_secret="short"))
    check_settings(Settings(jwt_secret="x" * 32))


def test_login_is_throttled_after_failures(client):
    for _ in range(5):
        r = client.post(f"{API}/auth/login", data={"username": "staff01", "password": "wrong"})
        assert r.status_code == 401
    r = client.post(f"{API}/auth/login", data={"username": "staff01", "password": PASSWORD})
    assert r.status_code == 429 and "Retry-After" in r.headers
    # Інший логін не заблоковано.
    assert client.post(f"{API}/auth/login", data={"username": "staff02", "password": PASSWORD}).status_code == 200


def test_unknown_login_gives_same_error(client):
    r = client.post(f"{API}/auth/login", data={"username": "nobody", "password": "x"})
    assert r.status_code == 401 and r.json()["detail"] == "Невірний логін або пароль"


def test_leader_scoped_to_unit(client):
    campaign_id, admin, root = full_wave(client)
    u = units(client, admin)
    leader_a = auth(client, "leader_a")
    assert client.get(f"{API}/campaigns/{campaign_id}/results", headers=leader_a).status_code == 403
    r = client.get(f"{API}/campaigns/{campaign_id}/results", params={"unit_id": u["Підрозділ А"]}, headers=leader_a)
    assert r.status_code == 200
    assert client.get(f"{API}/units/{u['Підрозділ Б']}/history", headers=leader_a).status_code == 403
    # Керівник без підрозділу бачить усе.
    assert results(client, campaign_id, auth(client, "leader"))["unit_id"] == root


def test_auditor_reads_but_does_not_manage(client):
    auditor = auth(client, "auditor")
    assert client.get(f"{API}/admin/audit-log", headers=auditor).status_code == 200
    assert client.get(f"{API}/admin/users", headers=auditor).status_code == 403
    assert client.post(f"{API}/campaigns", json={}, headers=auditor).status_code == 403
    assert client.get(f"{API}/campaigns", headers=auditor).status_code == 200


def test_audit_chain_verifies_and_detects_tampering(client):
    full_wave(client)
    admin = auth(client, "admin")
    log = client.get(f"{API}/admin/audit-log", params={"limit": 1000}, headers=admin).json()
    assert len(log) > 10
    seqs = [e["seq"] for e in log]
    assert seqs == sorted(seqs, reverse=True) and seqs[-1] == 1
    assert all(log[i]["prev_hash"] == log[i + 1]["hash"] for i in range(len(log) - 1))

    ok = client.post(f"{API}/admin/audit-log/verify", headers=admin).json()
    assert ok["ok"] is True and ok["checked"] == len(log)

    # Хтось змінив запис прямо в БД.
    with SessionLocal() as db:
        db.execute(update(AuditLog).where(AuditLog.seq == 3).values(details={"title": "підмінено"}))
        db.commit()
    broken = client.post(f"{API}/admin/audit-log/verify", headers=auth(client, "auditor")).json()
    assert broken["ok"] is False and broken["broken_seq"] == 3


def test_audit_chain_detects_deleted_tail(client):
    full_wave(client)
    with SessionLocal() as db:
        last = db.scalar(select(AuditHead)).seq
        db.execute(delete(AuditLog).where(AuditLog.seq == last))
        db.commit()
    result = client.post(f"{API}/admin/audit-log/verify", headers=auth(client, "admin")).json()
    assert result["ok"] is False


def test_audit_log_filters(client):
    full_wave(client)
    admin = auth(client, "admin")
    closes = client.get(f"{API}/admin/audit-log", params={"action": "close"}, headers=admin).json()
    assert len(closes) == 1 and closes[0]["details"]["responses_moved"] == 16
    page = client.get(f"{API}/admin/audit-log", params={"limit": 2, "offset": 1}, headers=admin).json()
    assert len(page) == 2


def test_per_source_integration_key(client):
    from app.config import get_settings

    settings = get_settings()
    old = settings.integration_keys
    settings.integration_keys = "artemida=artemida-key-123"
    try:
        admin = auth(client, "admin")
        root = units(client, admin)[ROOT]
        body = {"unit_id": root, "period": "2026-10", "indicator": "coi_reviewed", "numerator": 1, "denominator": 10}
        h = {"X-Integration-Key": "artemida-key-123"}
        assert client.post(f"{API}/indicators", json={**body, "source": "atestat"}, headers=h).status_code == 403
        assert client.post(f"{API}/indicators", json={**body, "source": "artemida"}, headers=h).status_code == 201
    finally:
        settings.integration_keys = old
