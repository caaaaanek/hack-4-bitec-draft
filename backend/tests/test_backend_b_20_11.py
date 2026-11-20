"""Таски бекенду ролі Б після аудиту 20.11 (claude/backend-taski-20-11.md): B1, B3, B4, B5, B7, B8."""

import pytest

from app.config import get_settings
from app.db import SessionLocal
from app.models import AuditLog
from tests.conftest import auth
from tests.helpers import API, ROOT, full_wave, units


@pytest.fixture()
def setting(monkeypatch):
    def apply(**values):
        for key, value in values.items():
            monkeypatch.setattr(get_settings(), key, value)
    return apply


# ---------- B1. Перегляди чужих підрозділів пишуться з кожного ендпойнта результатів ----------

def child_views(client) -> list[dict]:
    return client.get(f"{API}/admin/result-views", headers=auth(client, "auditor")).json()["items"]


def test_every_results_endpoint_records_child_view(client):
    campaign_id, admin, root = full_wave(client)
    child = units(client, admin)["Підрозділ А"]
    calls = [
        ("get", "/dashboard", {"params": {"unit_id": child}}),
        ("get", f"/campaigns/{campaign_id}/results", {"params": {"unit_id": child}}),
        ("get", f"/campaigns/{campaign_id}/recommendations", {"params": {"unit_id": child}}),
        ("post", f"/campaigns/{campaign_id}/what-if", {"json": {"unit_id": child, "levers": False}}),
        ("get", f"/campaigns/{campaign_id}/devils-advocate", {"params": {"unit_id": child}}),
        ("get", f"/campaigns/{campaign_id}/report", {"params": {"unit_id": child, "format": "json"}}),
        ("get", f"/campaigns/{campaign_id}/sensitivity", {"params": {"unit_id": child}}),
        ("get", f"/units/{child}/history", {}),
        ("get", f"/units/{child}/indicators", {}),
        ("get", f"/units/{child}/risk-signals", {}),
        ("get", f"/units/{child}/risk-register", {}),
    ]
    for method, path, kwargs in calls:
        r = getattr(client, method)(f"{API}{path}", headers=admin, **kwargs)
        assert r.status_code == 200, (path, r.text)
    endpoints = {v["endpoint"] for v in child_views(client) if v["unit_id"] == child}
    expected = {
        "/dashboard", "/campaigns/{campaign_id}/results", "/campaigns/{campaign_id}/recommendations",
        "/campaigns/{campaign_id}/what-if", "/campaigns/{campaign_id}/devils-advocate",
        "/campaigns/{campaign_id}/report", "/campaigns/{campaign_id}/sensitivity", "/units/{unit_id}/history",
        "/units/{unit_id}/indicators", "/units/{unit_id}/risk-signals", "/units/{unit_id}/risk-register",
    }
    assert expected <= endpoints, expected - endpoints


def test_own_and_root_views_are_not_recorded_and_filters_work(client):
    campaign_id, admin, root = full_wave(client)
    child = units(client, admin)["Підрозділ А"]
    # Корінь хвилі (заклад) — не чужий підрозділ.
    assert client.get(f"{API}/campaigns/{campaign_id}/results", headers=admin).status_code == 200
    assert client.get(f"{API}/units/{root}/history", headers=admin).status_code == 200
    # Свій підрозділ керівника підрозділу — теж.
    assert client.get(f"{API}/campaigns/{campaign_id}/results", params={"unit_id": child},
                      headers=auth(client, "leader_a")).status_code == 200
    assert child_views(client) == []
    # Відмова в доступі — не перегляд.
    assert client.get(f"{API}/campaigns/{campaign_id}/results", params={"unit_id": child},
                      headers=auth(client, "leader")).status_code == 403
    assert child_views(client) == []
    client.get(f"{API}/campaigns/{campaign_id}/results", params={"unit_id": child}, headers=admin)
    client.get(f"{API}/campaigns/{campaign_id}/results", params={"unit_id": child}, headers=auth(client, "auditor"))
    auditor = auth(client, "auditor")
    by_role = client.get(f"{API}/admin/result-views", params={"role": "admin"}, headers=auditor).json()
    assert by_role["total"] == 1 and by_role["items"][0]["login"] == "admin"
    by_unit = client.get(f"{API}/admin/result-views", params={"unit_id": child, "campaign_id": campaign_id},
                         headers=auditor).json()
    assert by_unit["total"] == 2


# ---------- B3. Проходження колоди не потрапляє в журнал дій (А10) ----------

def test_deck_completion_not_in_audit_log(client):
    staff = auth(client, "staff01")
    deck = client.get(f"{API}/learning/decks/coi", headers=staff).json()
    r = client.post(f"{API}/learning/decks/coi/complete", json={"seen": [c["id"] for c in deck["cards"]]},
                    headers=staff)
    assert r.status_code == 200 and r.json()["deck"] == "coi"
    with SessionLocal() as db:
        rows = db.query(AuditLog).filter(AuditLog.entity == "learning_deck").all()
    assert rows == []


# ---------- B4. Власник факту ----------

def test_declarations_owned_by_checks_not_hr(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "integration_keys", "atestat=key-hr;checks=key-ch")
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    body = {"unit_id": root, "period": "2026-07", "indicator": "declarations_on_time", "numerator": 9,
            "denominator": 10, "source": "atestat"}
    r = client.post(f"{API}/indicators", json=body, headers={"X-Integration-Key": "key-hr"})
    assert r.status_code == 409 and r.json()["code"] == "not_fact_owner" and "checks" in r.json()["message"]
    # Кадрова ІС і далі передає свій факт.
    r = client.post(f"{API}/indicators", json={**body, "indicator": "hiring_checks"}, headers={"X-Integration-Key": "key-hr"})
    assert r.status_code == 201
    facts = {f["code"]: f for f in client.get(f"{API}/dictionaries/facts", headers=admin).json()}
    assert facts["declarations_on_time"]["owner_sources"] == ["checks"]
    assert facts["training_coverage"]["owner_sources"] == ["learning", "training"]
    # Розгортання може призначити іншого власника.
    monkeypatch.setattr(get_settings(), "fact_owners", "declarations_on_time=atestat")
    assert client.post(f"{API}/indicators", json=body, headers={"X-Integration-Key": "key-hr"}).status_code == 201
    r = client.post(f"{API}/indicators", json={**body, "source": "checks"}, headers={"X-Integration-Key": "key-ch"})
    assert r.json()["code"] == "not_fact_owner"


def test_custom_fact_owner_sources(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "integration_keys", "ecu=key-e;reports=key-r")
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    r = client.post(f"{API}/dictionaries/facts", headers=admin, json={
        "code": "teaching_feedback", "title": "Анонімне оцінювання викладання", "component": "culture",
        "thresholds": [40, 60, 80, 95], "owner_sources": ["ecu"]})
    assert r.status_code == 201 and r.json()["owner_sources"] == ["ecu"]
    body = {"unit_id": root, "period": "2026-07", "indicator": "teaching_feedback", "numerator": 5,
            "denominator": 10, "source": "reports"}
    assert client.post(f"{API}/indicators", json=body, headers={"X-Integration-Key": "key-r"}).json()["code"] == \
        "not_fact_owner"
    assert client.post(f"{API}/indicators", json={**body, "source": "ecu"},
                       headers={"X-Integration-Key": "key-e"}).status_code == 201
    # Без власників — будь-яке джерело.
    r = client.patch(f"{API}/dictionaries/facts/teaching_feedback", json={"owner_sources": []}, headers=admin)
    assert r.status_code == 200 and r.json()["owner_sources"] == []
    bad = client.patch(f"{API}/dictionaries/facts/teaching_feedback", json={"owner_sources": ["Bad Name"]},
                       headers=admin)
    assert bad.status_code == 422


# ---------- B5. Профіль безпеки ----------

def test_production_profile_turns_on_safeguards(monkeypatch):
    from app.config import PRODUCTION_PROFILE, Settings

    for key in ("FOUR_EYES_ENABLED", "STAFF_TOKEN_ONLY", "LEADER_CHILD_DETAILS", "SECURITY_PROFILE"):
        monkeypatch.delenv(key, raising=False)
    demo = Settings(_env_file=None)
    # Принцип двох осіб діє вже в demo: два адміністратори й підтвердження відкриття хвилі — частина моделі ролей.
    assert demo.security_profile == "demo" and demo.four_eyes_enabled and not demo.staff_token_only
    prod = Settings(_env_file=None, security_profile="production")
    assert all(getattr(prod, k) == v for k, v in PRODUCTION_PROFILE.items()) and prod.profile_overrides == []
    # Явно задана змінна перекриває профіль, і це видно.
    monkeypatch.setenv("FOUR_EYES_ENABLED", "false")
    mixed = Settings(_env_file=None, security_profile="production")
    assert mixed.four_eyes_enabled is False and mixed.profile_overrides == ["four_eyes_enabled"]
    # Порожня змінна (як у compose за замовчуванням) профіль не перекриває.
    monkeypatch.setenv("FOUR_EYES_ENABLED", "")
    assert Settings(_env_file=None, security_profile="production").four_eyes_enabled is True


def test_config_shows_profile(client, setting):
    from app.config import PRODUCTION_PROFILE

    setting(security_profile="production", **{**PRODUCTION_PROFILE, "staff_token_only": False})
    policies = client.get(f"{API}/config").json()["policies"]
    assert policies["security_profile"] == "production" and policies["overridden"] == ["staff_token_only"]
    assert policies["admin_sets_passwords"] is False and policies["separate_tech_admin"] is True


# ---------- B7 у test_qr_links.py; B8. Якір журналу назовні ----------

def test_timestamp_request_is_valid_der():
    from app.services import audit_anchor

    digest = bytes(range(32))
    req = audit_anchor.timestamp_request(digest, nonce=12345)
    assert req[0] == 0x30 and req[1] == len(req) - 2
    assert digest in req and bytes.fromhex("0609608648016503040201") in req  # OID sha256
    assert audit_anchor.response_status(bytes.fromhex("3005300302010000")) == 0
    assert audit_anchor.response_status(bytes.fromhex("3005300302010200")) == 2


def test_export_anchor_to_file_and_tsa(client, setting, tmp_path, monkeypatch):
    from app.services import audit_anchor

    auditor = auth(client, "auditor")
    r = client.post(f"{API}/admin/audit-log/export-anchor", headers=auditor)
    assert r.status_code == 409 and r.json()["code"] == "anchor_disabled"

    sent = {}

    class Resp:
        status_code = 200
        content = bytes.fromhex("3005300302010000")

    def fake_post(url, content, headers, timeout):
        sent.update(url=url, body=content, ctype=headers["Content-Type"])
        return Resp()

    monkeypatch.setattr(audit_anchor.httpx, "post", fake_post)
    setting(audit_anchor_dir=str(tmp_path), audit_anchor_tsa_url="http://tsa.local/tsr")
    client.post(f"{API}/dictionaries/categories", json={"code": "cadet", "title": "Курсанти"},
                headers=auth(client, "coordinator"))  # дія в журналі, щоб голова мала seq ≥ 1
    r = client.post(f"{API}/admin/audit-log/export-anchor", headers=auditor)
    assert r.status_code == 201, r.text
    anchor = r.json()
    assert anchor["accepted_by_id"] is None and "tsa" in anchor["note"] and "file" in anchor["note"]
    files = sorted(p.name for p in tmp_path.iterdir())
    assert len(files) == 2 and files[0].endswith(".json") and files[1].endswith(".tsr")
    saved = __import__("json").loads((tmp_path / files[0]).read_text())
    assert saved["seq"] == anchor["seq"] and saved["hash"] == anchor["hash"]
    assert sent["ctype"] == "application/timestamp-query" and bytes.fromhex(anchor["hash"]) in sent["body"]
    # Копія з файлу проходить звірку аудитора.
    check = client.post(f"{API}/admin/audit-log/verify-anchor", json={"seq": saved["seq"], "hash": saved["hash"]},
                        headers=auditor).json()
    assert check["ok"] is True
    # Відмова TSA — помилка, а не мовчазний «успіх».
    Resp.content = bytes.fromhex("3005300302010200")
    r = client.post(f"{API}/admin/audit-log/export-anchor", headers=auditor)
    assert r.status_code == 502 and r.json()["code"] == "tsa_rejected"


def test_daily_autopilot_step_exports_anchor(client, setting, tmp_path):
    from app.services import autopilot

    setting(audit_anchor_dir=str(tmp_path))
    with SessionLocal() as db:
        events = autopilot.daily(db)
        db.commit()
    assert "якір журналу" in events[0]["message"]
    assert any(p.suffix == ".json" for p in tmp_path.iterdir())
