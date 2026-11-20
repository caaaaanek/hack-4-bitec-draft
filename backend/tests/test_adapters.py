"""Адаптери джерел фактів: агрегація записів, ключ на джерело, передача в POST /indicators."""

import importlib.util
import json
from datetime import date
from pathlib import Path

import pytest

from adapters.__main__ import months_back
from adapters.base import Pusher, load_unit_codes
from adapters.sources import ORG_QUALITY, SOURCES
from app.config import get_settings
from app.services import methodology as m
from tests.conftest import auth
from tests.helpers import API, ROOT, units

AS_OF = date(2026, 11, 17)
ORG_QUALITY_UNITS = ["Підрозділ А", "Підрозділ А-1", "Підрозділ А-2", "Підрозділ Б", "Підрозділ Б-1", "Підрозділ В"]
KEYS = {name: f"{name}-key-0123456789" for name in SOURCES}


@pytest.fixture()
def source_keys(monkeypatch):
    settings = get_settings()
    old = settings.integration_keys
    value = ";".join(f"{n}={k}" for n, k in KEYS.items())
    settings.integration_keys = value
    monkeypatch.setenv("INTEGRATION_KEYS", value)
    monkeypatch.delenv("INTEGRATION_API_KEY", raising=False)
    yield
    settings.integration_keys = old


def artemida_export(**extra_case) -> dict:
    case = lambda org, detected, deadline, status, closed: {  # noqa: E731
        "case_id": f"KI-{org}-{detected}", "org_code": org, "detected_on": detected, "deadline_on": deadline,
        "status": status, "closed_on": closed, **extra_case}
    return {"system": "ARTEMIDA", "exported_at": AS_OF.isoformat(), "cases": [
        case("ORG-A", "2026-10-01", "2026-10-31", "resolved", "2026-10-20"),   # вчасно
        case("ORG-A", "2026-10-05", "2026-11-04", "dismissed", "2026-11-03"),  # вчасно
        case("ORG-A", "2026-10-07", "2026-11-06", "resolved", "2026-11-10"),   # із запізненням
        case("ORG-A", "2026-10-09", "2026-11-08", "open", None),               # строк минув, не розібрано
        case("ORG-A", "2026-11-10", "2026-12-10", "open", None),               # строк ще не минув: не рахується
    ]}


def test_artemida_aggregates_on_time_cases(tmp_path):
    path = tmp_path / "artemida.json"
    path.write_text(json.dumps(artemida_export(officer_name="Синтетичне ім'я")), encoding="utf-8")
    source = SOURCES["artemida"]
    facts = source.facts(source.read_file(path), None, AS_OF)
    assert len(facts) == 1
    fact = facts[0]
    assert (fact.org_code, fact.period, fact.indicator) == ("ORG-A", "2026-10", "coi_reviewed")
    assert (fact.numerator, fact.denominator) == (2, 4)
    assert fact.extra_counts == {"pending": 1, "late": 1}
    # Зайві поля експорту (наприклад, ім'я) адаптер не читає й нікуди не передає.
    assert "Синтетичне" not in repr(facts)


def test_artemida_rejects_foreign_export(tmp_path):
    path = tmp_path / "x.json"
    path.write_text(json.dumps({"system": "OTHER", "cases": []}), encoding="utf-8")
    with pytest.raises(SystemExit):
        SOURCES["artemida"].read_file(path)


def test_mocks_cover_all_facts_and_are_deterministic():
    orgs = list(ORG_QUALITY)
    periods = months_back(AS_OF, 6)
    covered = set()
    for source in SOURCES.values():
        first = source.facts(source.mock_records(orgs, periods, AS_OF), set(periods), AS_OF)
        again = source.facts(source.mock_records(orgs, periods, AS_OF), set(periods), AS_OF)
        assert first == again
        assert all(0 <= f.numerator <= f.denominator and f.period in periods for f in first)
        assert {f.indicator for f in first} <= set(source.indicators)
        covered |= {f.indicator for f in first}
    # Факти, якими володіють лише модулі самої системи («Перевірки», флешкартки), адаптери не передають.
    from app.services.fact_registry import BUILTIN_OWNERS
    internal = {code for code, owners in BUILTIN_OWNERS.items() if set(owners) <= {"checks", "learning"}}
    assert covered | internal == set(m.FACTS) and not covered & internal
    assert set(load_unit_codes().values()) >= set(ORG_QUALITY_UNITS)




def test_integration_units_need_key(client, source_keys):
    assert client.get(f"{API}/indicators/units").status_code == 401
    r = client.get(f"{API}/indicators/units", headers={"X-Integration-Key": KEYS["training"]})
    assert r.status_code == 200
    assert {u["name"] for u in r.json()} >= {ROOT, *ORG_QUALITY_UNITS}
    assert set(r.json()[0]) == {"id", "name", "parent_id"}


def load_mock_sources_script():
    path = Path(__file__).resolve().parents[1] / "scripts" / "mock_sources.py"
    spec = importlib.util.spec_from_file_location("mock_sources", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_mock_sources_script_pushes_all_sources_with_own_keys(client, source_keys):
    script = load_mock_sources_script()
    code = script.main(["--months", "3", "--as-of", AS_OF.isoformat(), "--url", ""], client=client)
    assert code == 0
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    facts = client.get(f"{API}/units/{root}/indicators", params={"months": 3, "end": AS_OF.isoformat()},
                       headers=admin).json()
    sources = {s for f in facts for s in f["sources"]}
    assert sources == set(SOURCES)


def test_key_of_other_source_is_refused(client, source_keys):
    pusher = Pusher(client, "", KEYS["artemida"], load_unit_codes())
    source = SOURCES["atestat"]
    periods = months_back(AS_OF, 1)
    facts = source.facts(source.mock_records(list(ORG_QUALITY), periods, AS_OF), set(periods), AS_OF)
    sent, warnings = pusher.push(facts)
    assert sent == 0 and warnings and all("403" in w for w in warnings)


def test_fact_intake_refuses_unknown_key_and_extra_fields(client, source_keys):
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    body = {"unit_id": root, "period": "2026-10", "indicator": "coi_reviewed", "numerator": 1, "denominator": 2,
            "source": "artemida"}
    url = f"{API}/indicators"
    assert client.post(url, json=body, headers={"X-Integration-Key": "not-a-key"}).status_code == 401
    assert client.post(url, json=body, headers={"X-Integration-Key": KEYS["training"]}).status_code == 403
    # Зайве поле (наприклад, ім'я людини) не приймається: передаються лише агрегати.
    extra = {**body, "person_name": "Синтетичне ім'я"}
    assert client.post(url, json=extra, headers={"X-Integration-Key": KEYS["artemida"]}).status_code == 422
    assert client.post(url, json=body, headers={"X-Integration-Key": KEYS["artemida"]}).status_code == 201


def test_seed_fact_sources_match_adapters():
    from app.seed.seed import FACT_SOURCES

    assert set(FACT_SOURCES) == set(m.FACTS)
    for indicator, source in FACT_SOURCES.items():
        assert indicator in SOURCES[source].indicators, (indicator, source)
