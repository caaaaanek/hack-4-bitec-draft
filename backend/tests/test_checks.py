"""Модуль «Перевірки»: запуск, знахідки, розгляд, публікація показників, мок і живі вибірки (мережа підмінена)."""

import json

import pytest

from app.config import get_settings
from app.services import external_sources as ext
from tests.conftest import auth
from tests.helpers import API, ROOT, units

KEY = {"X-Integration-Key": "test-integration-key"}
PERIOD = "2026-11"
# Факти показуються лише цілими завершеними кварталами (B3), тож публікацію перевіряємо на III кварталі.
DONE_PERIOD = "2026-08"


@pytest.fixture()
def ctx(client):
    admin = auth(client, "admin")
    return client, admin, units(client, admin)[ROOT]


def mock_body(client, admin, unit_id, kind, period=PERIOD):
    r = client.get(f"{API}/checks/mock/{kind}", params={"unit_id": unit_id, "period": period}, headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


def test_procurement_run_and_findings(ctx):
    client, admin, unit = ctx
    body = mock_body(client, admin, unit, "procurement")
    assert 12 <= len(body["records"]) <= 20 and body["source"] == "mock"
    r = client.post(f"{API}/checks/procurement", json=body, headers=admin)
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["kind"] == "procurement" and run["total"] == len(body["records"]) and run["flagged"] > 0
    assert sum(run["by_risk"].values()) == run["flagged"]

    findings = client.get(f"{API}/checks/findings", params={"run_id": run["run_id"]}, headers=admin).json()
    assert len(findings) == run["flagged"]
    assert all(f["risk_level"] != "none" and f["flags"] and f["status"] == "new" for f in findings)
    # Ні імен, ні контактів учасників у відповідях і БД.
    text = json.dumps([run, findings], ensure_ascii=False)
    assert "Демо-" not in text and "example.test" not in text and "+38050" not in text
    runs = client.get(f"{API}/checks/runs", params={"unit_id": unit, "kind": "procurement"}, headers=admin).json()
    assert [x["run_id"] for x in runs] == [run["run_id"]]


def test_declarations_run(ctx):
    client, admin, unit = ctx
    items = [
        {"declaration_id": "a1", "declaration_type": 1, "declaration_year": 2025, "date": "2026-03-10"},
        {"declaration_id": "a2", "declaration_type": 1, "declaration_year": 2025, "date": "2026-04-15"},
        {"declaration_id": "a3", "declaration_type": 2, "declaration_year": 2025, "date": "2025-09-01"},
    ]
    r = client.post(f"{API}/checks/declarations", headers=admin,
                    json={"unit_id": unit, "period": PERIOD, "source": "file", "items": items})
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["extra"] == {"on_time": 1, "late": 1, "unknown": 1}
    assert run["total"] == 3 and run["flagged"] == 1
    [finding] = client.get(f"{API}/checks/findings", params={"run_id": run["run_id"]}, headers=admin).json()
    assert finding["record_ref"].startswith("d-") and len(finding["record_ref"]) == 14
    assert finding["flags"][0]["rule_id"] == "declaration_late" and "declaration_id" not in finding


def test_validation(ctx):
    client, admin, unit = ctx
    ok = {"unit_id": unit, "period": PERIOD, "source": "file", "records": [{"record_id": "x"}]}
    assert client.post(f"{API}/checks/procurement", json={**ok, "owner": "x"}, headers=admin).status_code == 422
    assert client.post(f"{API}/checks/procurement", json={**ok, "period": "2026-13"}, headers=admin).status_code == 422
    assert client.post(f"{API}/checks/procurement", json={**ok, "source": "ftp"}, headers=admin).status_code == 422
    too_many = {**ok, "records": [{"record_id": str(i)} for i in range(5001)]}
    assert client.post(f"{API}/checks/procurement", json=too_many, headers=admin).status_code == 422
    unknown = {**ok, "unit_id": "00000000-0000-0000-0000-000000000000"}
    assert client.post(f"{API}/checks/procurement", json=unknown, headers=admin).status_code == 404


def test_access(ctx):
    client, admin, unit = ctx
    body = {"unit_id": unit, "period": PERIOD, "source": "api", "records": [{"record_id": "x"}]}
    assert client.post(f"{API}/checks/procurement", json=body).status_code == 401
    for login in ("leader", "leader_a", "staff01"):
        h = auth(client, login)
        assert client.post(f"{API}/checks/procurement", json=body, headers=h).status_code == 403
        assert client.get(f"{API}/checks/runs", headers=h).status_code == 403
        assert client.get(f"{API}/checks/findings", headers=h).status_code == 403
        assert client.post(f"{API}/checks/publish", json={"unit_id": unit, "period": PERIOD}, headers=h).status_code == 403
    assert client.get(f"{API}/checks/runs").status_code == 401
    # Ключ інтеграції: можна запускати, але не читати й не публікувати.
    assert client.post(f"{API}/checks/procurement", json=body, headers={"X-Integration-Key": "bad"}).status_code == 401
    assert client.post(f"{API}/checks/procurement", json=body, headers=KEY).status_code == 201
    dec = {"unit_id": unit, "period": PERIOD, "source": "api", "items": []}
    assert client.post(f"{API}/checks/declarations", json=dec, headers=KEY).status_code == 201
    assert client.get(f"{API}/checks/findings", headers=KEY).status_code == 401
    assert client.post(f"{API}/checks/publish", json={"unit_id": unit, "period": PERIOD}, headers=KEY).status_code == 401


def test_review_and_publish(ctx):
    client, admin, unit = ctx
    client.post(f"{API}/checks/procurement", json=mock_body(client, admin, unit, "procurement", DONE_PERIOD), headers=admin)
    client.post(f"{API}/checks/declarations", json=mock_body(client, admin, unit, "declarations", DONE_PERIOD), headers=admin)
    findings = client.get(f"{API}/checks/findings", params={"kind": "procurement"}, headers=admin).json()
    assert findings
    url = f"{API}/checks/findings/{findings[0]['id']}/review"
    assert client.post(url, json={"status": "bad"}, headers=admin).status_code == 422
    r = client.post(url, json={"status": "reviewed", "comment": "Перевірено"}, headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "reviewed" and r.json()["reviewed_at"]
    if len(findings) > 1:
        client.post(f"{API}/checks/findings/{findings[1]['id']}/review", json={"status": "dismissed"}, headers=admin)
    assert client.post(f"{API}/checks/findings/{unit}/review", json={"status": "new"}, headers=admin).status_code == 404

    r = client.post(f"{API}/checks/publish", json={"unit_id": unit, "period": DONE_PERIOD}, headers=admin)
    assert r.status_code == 200, r.text
    by_name = {i["indicator"]: i for i in r.json()["indicators"]}
    done = 2 if len(findings) > 1 else 1
    assert by_name["procurement_flags_reviewed"]["numerator"] == done
    assert by_name["procurement_flags_reviewed"]["denominator"] == len(findings)
    assert by_name["declarations_on_time"]["denominator"] > 0

    # Показники з'являються в існуючому перегляді фактів.
    facts = client.get(f"{API}/units/{unit}/indicators", params={"end": "2026-10-15"}, headers=admin).json()
    fact = {f["indicator"]: f for f in facts}["procurement_flags_reviewed"]
    # Синтетичних закупівель буває різна кількість (залежить від id підрозділу). Менше k знахідок за квартал —
    # факт приховано порогом анонімності (B3), і чисел не видно.
    small = len(findings) < get_settings().min_group_size
    if small:
        assert fact["status"] == "too_few_people" and fact["denominator"] is None
    else:
        assert fact["denominator"] == len(findings) and fact["numerator"] == done and "checks" in fact["sources"]

    # Повторна публікація перезаписує, а не дублює.
    client.post(f"{API}/checks/findings/{findings[0]['id']}/review", json={"status": "new"}, headers=admin)
    client.post(f"{API}/checks/publish", json={"unit_id": unit, "period": DONE_PERIOD}, headers=admin)
    facts = client.get(f"{API}/units/{unit}/indicators", params={"end": "2026-10-15"}, headers=admin).json()
    fact = {f["indicator"]: f for f in facts}["procurement_flags_reviewed"]
    if not small:
        assert fact["numerator"] == done - 1 and fact["denominator"] == len(findings)


def test_publish_without_data_writes_nothing(ctx):
    client, admin, unit = ctx
    r = client.post(f"{API}/checks/publish", json={"unit_id": unit, "period": PERIOD}, headers=admin)
    assert all(not i["written"] and i["denominator"] == 0 for i in r.json()["indicators"])
    facts = client.get(f"{API}/units/{unit}/indicators", params={"end": "2026-11-30"}, headers=admin).json()
    assert all(f["denominator"] is None for f in facts if f["indicator"] in
               ("coi_reviewed", "procurement_flags_reviewed", "declarations_on_time"))


def test_mock_is_deterministic(ctx):
    client, admin, unit = ctx
    for kind, key in (("procurement", "records"), ("declarations", "items")):
        a, b = mock_body(client, admin, unit, kind), mock_body(client, admin, unit, kind)
        assert a == b and a[key]
    other = client.get(f"{API}/checks/mock/procurement", params={"unit_id": unit, "period": "2026-10"}, headers=admin)
    assert other.json()["records"] != mock_body(client, admin, unit, "procurement")["records"]
    assert client.get(f"{API}/checks/mock/other", params={"unit_id": unit, "period": PERIOD}, headers=admin).status_code == 422


# ---------- Живі вибірки (мережа підмінена) ----------

def test_fetch_disabled_by_default(ctx):
    client, admin, unit = ctx
    for kind in ("prozorro", "nazk"):
        r = client.post(f"{API}/checks/fetch/{kind}", json={"unit_id": unit, "period": PERIOD}, headers=admin)
        assert r.status_code == 409 and "закритий контур" in r.json()["detail"]


TENDER = {
    "id": "t1", "tenderID": "UA-1", "status": "complete", "procurementMethod": "open",
    "procurementMethodType": "aboveThresholdUA", "mainProcurementCategory": "goods",
    "procuringEntity": {"name": "Замовник", "identifier": {"id": "00000001"}, "kind": "general"},
    "value": {"amount": 5_000_000, "currency": "UAH"},
    "tenderPeriod": {"startDate": "2026-10-01T00:00:00+03:00", "endDate": "2026-10-03T00:00:00+03:00"},
    "items": [{"classification": {"id": "30190000-7"}}],
    "bids": [{"id": "b1", "status": "active", "value": {"amount": 4_900_000},
              "tenderers": [{"name": "ТОВ Один", "identifier": {"id": "11111111"},
                             "contactPoint": {"telephone": "(044) 123-45-67", "email": "A@x.test"}}]}],
    "awards": [{"id": "a1", "status": "active", "bid_id": "b1", "value": {"amount": 4_900_000},
                "suppliers": [{"identifier": {"id": "11111111"}}]}],
}


def fake_prozorro(url, params=None):
    if url.endswith("/tenders"):
        return {"data": [{"id": "t1", "status": "complete", "procurementMethodType": "aboveThresholdUA"},
                         {"id": "t2", "status": "active.tendering", "procurementMethodType": "aboveThresholdUA"}]}
    return {"data": TENDER}


def test_fetch_prozorro(ctx, monkeypatch):
    client, admin, unit = ctx
    monkeypatch.setattr(get_settings(), "external_fetch_enabled", True)
    monkeypatch.setattr(ext, "get_json", fake_prozorro)
    body = {"unit_id": unit, "period": PERIOD, "limit": 5}
    r = client.post(f"{API}/checks/fetch/prozorro", json=body, headers=admin)
    assert r.status_code == 201, r.text
    assert r.json()["source"] == "prozorro" and r.json()["total"] == 1 and r.json()["flagged"] == 1
    assert "ТОВ Один" not in r.text
    assert client.post(f"{API}/checks/fetch/prozorro", json={**body, "limit": 51}, headers=admin).status_code == 422

    def down(url, params=None):
        raise ext.ExternalSourceError("Зовнішнє джерело не відповіло (ConnectError)")

    monkeypatch.setattr(ext, "get_json", down)
    r = client.post(f"{API}/checks/fetch/prozorro", json=body, headers=admin)
    assert r.status_code == 502 and "не відповіло" in r.json()["detail"]


def test_fetch_nazk(ctx, monkeypatch):
    client, admin, unit = ctx
    monkeypatch.setattr(get_settings(), "external_fetch_enabled", True)
    seen = {}

    def fake(url, params=None):
        seen.update(url=url, params=params)
        return {"data": [
            {"id": "nacp_1", "declaration_type": 1, "declaration_year": 2025, "date": "2026-03-10T10:00:00",
             "data": {"step_1": {"data": {"lastname": "Прізвище"}}}, "full_name": "Іван Іванов"},
            {"id": "nacp_2", "declaration_type": 1, "declaration_year": 2025, "date": "2026-04-20"},
            {"declaration_type": 1}, {"id": "bad", "declaration_type": 9},
        ]}

    monkeypatch.setattr(ext, "get_json", fake)
    r = client.post(f"{API}/checks/fetch/nazk", json={"unit_id": unit, "period": PERIOD, "limit": 10}, headers=admin)
    assert r.status_code == 200, r.text
    out = r.json()
    assert [i["declaration_id"] for i in out["items"]] == ["nacp_1", "nacp_2"] and out["year"] == 2025
    assert all(i["data"] is None for i in out["items"]) and "Прізвище" not in r.text and "Іванов" not in r.text
    assert seen["url"].endswith("/documents/list") and seen["params"]["declaration_year"] == 2025
    # Результат придатний як тіло для POST /checks/declarations.
    run = client.post(f"{API}/checks/declarations", json=out, headers=admin).json()
    assert run["extra"] == {"on_time": 1, "late": 1, "unknown": 0}

    def down(url, params=None):
        raise ext.ExternalSourceError("Зовнішнє джерело не відповіло (ReadTimeout)")

    monkeypatch.setattr(ext, "get_json", down)
    r = client.post(f"{API}/checks/fetch/nazk", json={"unit_id": unit, "period": PERIOD}, headers=admin)
    assert r.status_code == 502


def test_get_json_maps_network_errors(monkeypatch):
    import httpx

    def boom(*a, **k):
        raise httpx.ConnectError("x")

    monkeypatch.setattr(ext.httpx, "get", boom)
    with pytest.raises(ext.ExternalSourceError):
        ext.get_json("https://example.test")
