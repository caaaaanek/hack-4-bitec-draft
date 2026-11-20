"""Аудит бекенду 20.11: зони доступу, 500 на некоректних даних, урна, PATCH з null, імпорт ризиків."""

import io
from datetime import datetime, timezone

from app.db import SessionLocal
from app.models import Role, Unit, User
from app.security import hash_password
from app.services import external_sources
from tests.conftest import PASSWORD, auth, user_ids
from tests.helpers import API, ROOT, answer, full_wave, open_campaign, units

STAFF = "nazk-maturity-staff"
UNIT_A = "Підрозділ А"


def zoned(login: str, role: Role, unit_name: str = UNIT_A) -> None:
    """Користувач, прив'язаний до підрозділу (у демо таких уповноважених/аудиторів/департаменту немає)."""
    with SessionLocal() as db:
        unit = db.query(Unit).filter(Unit.name == unit_name).one()
        db.add(User(login=login, display_name=login, password_hash=hash_password(PASSWORD), role=role,
                    unit_id=unit.id))
        db.commit()


# ---------- Зони доступу ----------

def test_zoned_admin_and_auditor_dashboard_default_to_own_unit(client):
    zoned("admin_a", Role.ADMIN)
    zoned("auditor_a", Role.AUDITOR)
    for login in ("admin_a", "auditor_a"):
        for path in ("/dashboard", "/dashboard/waves", "/learning/stats", "/agent/digest"):
            r = client.get(API + path, headers=auth(client, login))
            # Раніше без unit_id бралася корінь дерева поза зоною → 403.
            assert r.status_code != 403, (login, path, r.text)


def test_department_zone_limits_lists_and_digest(client):
    campaign_id, _, root = full_wave(client)
    leader = auth(client, "leader")
    r = client.post(f"{API}/campaigns/{campaign_id}/recommendations/cut:accountability/decision", headers=leader,
                    json={"decision": "accepted", "measure": {"owner": "Антикорупційний уповноважений"}})
    assert r.status_code == 200, r.text
    zoned("department_a", Role.DEPARTMENT)  # у його піддереві немає закладів (коренів хвиль)
    dep = auth(client, "department_a")
    assert client.get(f"{API}/measures", headers=dep).json() == []
    names = {u["name"] for u in client.get(f"{API}/units", headers=dep).json()}
    assert ROOT not in names and UNIT_A in names
    # Огляд кореня без unit_id департамент поза зоною не отримує (раніше — увесь заклад).
    assert client.get(f"{API}/agent/digest", headers=dep).status_code in (403, 422)


def test_zoned_admin_sees_only_own_checks(client):
    admin = auth(client, "admin")
    unit_ids = units(client, admin)
    for name in (ROOT, UNIT_A):
        r = client.post(f"{API}/checks/counterparty", headers=admin,
                        json={"unit_id": unit_ids[name], "period": "2026-01", "edrpou": ["00000023", "12345678"]})
        assert r.status_code == 201, r.text
    zoned("admin_a", Role.ADMIN)
    admin_a = auth(client, "admin_a")
    runs = client.get(f"{API}/checks/runs", headers=admin_a).json()
    assert runs and {r["unit_id"] for r in runs} == {unit_ids[UNIT_A]}
    assert client.get(f"{API}/checks/runs", params={"unit_id": unit_ids[ROOT]}, headers=admin_a).status_code == 403
    findings = client.get(f"{API}/checks/findings", headers=admin_a).json()
    assert all(f["unit_id"] == unit_ids[UNIT_A] for f in findings)
    # Факти поза зоною зональний уповноважений не передає.
    r = client.post(f"{API}/indicators", headers=admin_a, json={
        "unit_id": unit_ids[ROOT], "period": "2026-01", "indicator": "training_coverage",
        "numerator": 1, "denominator": 2, "source": "manual"})
    assert r.status_code == 403


def test_counterparty_rejects_non_ascii_digits(client):
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    r = client.post(f"{API}/checks/counterparty", headers=admin,
                    json={"unit_id": root, "period": "2026-01", "edrpou": ["١٢٣٤٥٦٧٨"]})
    assert r.status_code == 422


def test_compare_waves_checks_campaign_zone(client):
    campaign_id, admin, root = full_wave(client)
    unit_a = units(client, admin)[UNIT_A]
    zoned("admin_a", Role.ADMIN)
    r = client.get(f"{API}/units/{unit_a}/compare", headers=auth(client, "admin_a"),
                   params={"from_campaign": campaign_id, "to_campaign": campaign_id})
    # Хвиля закладу (корінь вище зони) для зонального уповноваженого не існує — як і в /campaigns/{id}/results.
    assert r.status_code == 404
    assert client.get(f"{API}/campaigns/{campaign_id}/results", headers=auth(client, "admin_a")).status_code == 404


# ---------- 500 на некоректних даних ----------

def test_decision_measure_draft_validated_as_422(client):
    campaign_id, _, _ = full_wave(client)
    url = f"{API}/campaigns/{campaign_id}/recommendations/cut:accountability/decision"
    leader = auth(client, "leader")
    for measure in ({"title": "ab", "owner": "Відділ кадрів"},
                    {"owner": "Відділ кадрів", "catalog_number": "x" * 30},
                    {"owner": "Відділ кадрів", "description": "d" * 5000}):
        r = client.post(url, headers=leader, json={"decision": "accepted", "measure": measure})
        assert r.status_code == 422, (measure, r.text)


def test_ballot_odd_nonce_is_422(client):
    r = client.post(f"{API}/respond/ballot", json={
        "key_id": "00000000-0000-0000-0000-000000000000", "nonce": "a" * 33, "signature": "ab", "answers": []})
    assert r.status_code == 422


def test_patch_with_null_is_422_not_conflict(client):
    dep = auth(client, "department")
    q = client.get(f"{API}/questionnaires", headers=dep).json()[0]
    draft = client.post(f"{API}/questionnaires/{q['id']}/new-version", headers=dep).json()
    for body in ({"title": None}, {"kind": None}):
        assert client.patch(f"{API}/questionnaires/{draft['id']}", json=body, headers=dep).status_code == 422
    assert client.patch(f"{API}/questionnaires/{draft['id']}", json={"description": None},
                        headers=dep).status_code == 200
    co = auth(client, "coordinator")
    uid = user_ids(client)["staff01"]
    for body in ({"display_name": None}, {"is_active": None}, {"role": None}):
        r = client.patch(f"{API}/admin/users/{uid}", json=body, headers=co)
        assert r.status_code == 422, (body, r.text)


def test_measure_title_checked_after_strip(client):
    campaign_id, _, _ = full_wave(client)
    leader = auth(client, "leader")
    rec = client.post(f"{API}/campaigns/{campaign_id}/recommendations/cut:accountability/decision", headers=leader,
                      json={"decision": "accepted", "measure": {"owner": "Антикорупційний уповноважений"}}).json()
    murl = f"{API}/measures/{rec['measures'][0]['id']}"
    assert client.patch(murl, json={"title": "  ab  "}, headers=leader).status_code == 422


def test_prozorro_tender_with_mixed_dates_is_parsed():
    tender = {"id": "t1", "tenderPeriod": {"startDate": "2026-01-01", "endDate": "2026-01-11T00:00:00+02:00"},
              "value": {"amount": "не число"}, "bids": [], "awards": []}
    record = external_sources.normalize_tender(tender)[0]
    assert record["dates"]["tender_period_days"] == 10 and record["expected_value"] is None
    assert external_sources._parse_date("2026-01-01").tzinfo is timezone.utc
    assert external_sources._parse_date(datetime(2026, 1, 1)) is None  # не рядок


# ---------- Урна: невдале відновлення ключа не блокує закриття ----------

def test_urn_mismatch_resets_submitted_shares(client):
    campaign_id, q, admin = open_campaign(client, (STAFF,), open_it=False)
    ids = user_ids(client)
    holders = ["leader", "auditor", "staff24"]
    assert client.put(f"{API}/campaigns/{campaign_id}/urn", json={"holder_ids": [ids[h] for h in holders]},
                      headers=admin).status_code == 200
    shares = {h: client.get(f"{API}/campaigns/{campaign_id}/urn/my-share", headers=auth(client, h)).json()["share"]
              for h in holders}
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    for i in range(1, 7):
        answer(client, campaign_id, q[STAFF], f"staff{i:02d}", lambda _: 2)
    assert client.post(f"{API}/campaigns/{campaign_id}/close", headers=admin).json()["code"] == "urn_pending"

    # Частина leader із зіпсованим y: формат і відбиток правильні, але ключ не відновиться.
    prefix, fp, x, y = shares["leader"].split(":")
    broken = f"{prefix}:{fp}:{x}:{int(y, 16) ^ 1:x}"
    url = f"{API}/campaigns/{campaign_id}/urn/shares"
    assert client.post(url, json={"share": broken}, headers=auth(client, "leader")).json()["status"] == "waiting"
    r = client.post(url, json={"share": shares["staff24"]}, headers=auth(client, "staff24"))
    assert r.status_code == 422 and r.json()["code"] == "urn_mismatch"
    # Двоє інших власників зі справними частинами закривають хвилю. Раніше зіпсована частина лишалася в БД
    # (скидання відкочувалося разом із помилкою), і будь-яка пара з нею знову давала urn_mismatch.
    assert client.post(url, json={"share": shares["auditor"]}, headers=auth(client, "auditor")).json()["status"] == "waiting"
    r = client.post(url, json={"share": shares["staff24"]}, headers=auth(client, "staff24"))
    assert r.status_code == 200 and r.json()["status"] == "closed", r.text


# ---------- Імпорт реєстру ризиків і призначення чек-листа ----------

def test_risk_import_duplicate_codes_and_zone(client):
    admin = auth(client, "admin")
    unit_ids = units(client, admin)
    csv = "code,title,component\nR1,Ризик один,culture\nR1,Ризик один (оновлено),system\n".encode()
    r = client.post(f"{API}/units/{unit_ids[UNIT_A]}/risk-register/import", headers=admin,
                    files={"file": ("risks.csv", io.BytesIO(csv), "text/csv")})
    assert r.status_code == 200 and r.json()["created"] == 1, r.text
    items = client.get(f"{API}/units/{unit_ids[UNIT_A]}/risk-register", headers=admin).json()["items"]
    assert len(items) == 1 and items[0]["component"] == "system"
    zoned("admin_a", Role.ADMIN)
    r = client.post(f"{API}/units/{unit_ids[ROOT]}/risk-register/import", headers=auth(client, "admin_a"),
                    files={"file": ("risks.csv", io.BytesIO(csv), "text/csv")})
    assert r.status_code == 403


def test_checklist_assignments_reject_duplicate_items(client):
    campaign_id, _, admin = open_campaign(client, ("nazk-checklist",))
    items = client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=auth(client, "wg1")).json()["items"]
    qid = items[0]["question_id"]
    ids = user_ids(client)
    body = {"items": [{"question_id": qid, "enterer_id": ids["wg1"]}, {"question_id": qid, "enterer_id": ids["wg2"]}]}
    r = client.put(f"{API}/campaigns/{campaign_id}/checklist/assignments", json=body, headers=admin)
    assert r.status_code == 422, r.text


# ---------- Рішення 20.11: вага категорій, довідник, реєстр ризиків ----------

def test_category_weight_source_and_rights(client):
    co, dep = auth(client, "coordinator"), auth(client, "department")
    cats = {c["code"]: c for c in client.get(f"{API}/dictionaries/categories", headers=dep).json()}
    assert cats["staff"]["weight_source"] == "methodology" and cats["staff"]["weight_editable"] is False
    # Форма надсилає всі поля: незмінені вага й активність вбудованої категорії не заважають перейменуванню.
    r = client.patch(f"{API}/dictionaries/categories/staff", headers=co,
                     json={"title": "Особовий склад закладу", "weight": cats["staff"]["weight"], "active": True})
    assert r.status_code == 200 and r.json()["title"] == "Особовий склад закладу", r.text
    r = client.patch(f"{API}/dictionaries/categories/staff", headers=co, json={"weight": 0.5})
    assert r.status_code == 409 and r.json()["code"] == "weight_from_methodology"
    r = client.post(f"{API}/dictionaries/categories", headers=co, json={"code": "cadet", "title": "Курсанти", "weight": 0.1})
    assert r.status_code == 201 and r.json()["weight_editable"] is True and r.json()["weight_source"] == "dictionary"
    # Департамент довідник лише читає.
    assert client.patch(f"{API}/dictionaries/categories/cadet", headers=dep, json={"title": "X"}).status_code == 403
    assert client.post(f"{API}/dictionaries/categories", headers=dep, json={"code": "c2", "title": "X"}).status_code == 403


def test_department_reads_risk_register_of_its_institutions(client):
    full_wave(client)  # заклад = корінь хвилі
    admin = auth(client, "admin")
    unit_ids = units(client, admin)
    csv = "code,title,component\nR1,Ризик один,culture\n".encode()
    for name in (ROOT, UNIT_A):
        assert client.post(f"{API}/units/{unit_ids[name]}/risk-register/import", headers=admin,
                           files={"file": ("r.csv", io.BytesIO(csv), "text/csv")}).status_code == 200
    dep = auth(client, "department")
    for name in (ROOT, UNIT_A):  # заклад і його підрозділ
        r = client.get(f"{API}/units/{unit_ids[name]}/risk-register", headers=dep)
        assert r.status_code == 200 and len(r.json()["items"]) == 1, r.text
    assert client.post(f"{API}/units/{unit_ids[ROOT]}/risk-register/import", headers=dep,
                       files={"file": ("r.csv", io.BytesIO(csv), "text/csv")}).status_code == 403
    zoned("department_a", Role.DEPARTMENT)  # у зоні немає закладів
    r = client.get(f"{API}/units/{unit_ids[ROOT]}/risk-register", headers=auth(client, "department_a"))
    assert r.status_code == 403
