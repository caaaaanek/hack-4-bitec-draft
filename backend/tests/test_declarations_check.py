"""Тести сервісу перевірки декларацій на синтетичних даних."""
import json

from app.services.declarations_check import (
    DEFAULT_CONFIG, RULES, _rule_business_ownership, _rule_family_conflict, _rule_large_family_income,
    _rule_ngo_risk, _rule_self_interest, _rule_suspicious_gifts, evaluate_declarations, law_refs_for,
)

FAM = {"data": [{"id": "2", "lastname": "Вигаданий", "firstname": "Родич", "middlename": "Тестович"}]}


def s1(work=None, code=None, **kw):
    d = {"lastname": "Тестович", "firstname": "Тест", "middlename": "Тестівна", **kw}
    if work:
        d.update(workPlace=work, workPlaceEdrpou=code)
    return {"data": d}


def corp(name, code):
    return {"data": [{"name": name, "corporate_rights_company_code": code, "cost_percent": "50",
                      "rights": [{"rightBelongs": "1"}]}]}


def inc(who, name, code, amount, typ="Дохід"):
    return {"objectType": typ, "sizeIncome": amount, "person_who_care": [{"person": who}],
            "sources": [{"source_ua_company_name": name, "source_ua_company_code": code,
                         "source_citizen": "Юридична особа"}]}


def decl(i, t=1, y=2025, dt="2026-03-01", data=None):
    return {"declaration_id": f"id{i}", "declaration_type": t, "declaration_year": y, "date": dt, "data": data}


def ev(item, year=2025):
    return evaluate_declarations([item], year=year)[0]


def test_on_time_and_boundary():
    assert ev(decl(1, dt="2026-03-31"))["on_time"] is True
    r = ev(decl(1, dt="2026-03-31"))
    assert r["deadline"] == "2026-03-31" and r["submitted_on"] == "2026-03-31" and r["risk_level"] == "none"


def test_late():
    r = ev(decl(2, dt="2026-04-01"))
    assert r["on_time"] is False
    assert [f["rule_id"] for f in r["flags"]] == ["declaration_late"] and r["risk_level"] == "medium"


def test_not_evaluated():
    for it in (decl(3, y=2024), decl(4, t=4), decl(5, t=2)):
        r = ev(it)
        assert r["on_time"] is None and r["flags"] == []
    assert ev(decl(3, y=2024))["deadline"] is None


def test_dismissal_deadline():
    data = {"step_1": s1(dismissalDate="2025-12-01")}
    assert ev(decl(6, t=2, dt="2025-12-31", data=data))["on_time"] is True
    assert ev(decl(7, t=3, dt="2026-01-05", data=data))["on_time"] is False


def test_record_ref_and_order():
    res = evaluate_declarations([decl(1), decl(2)], year=2025)
    assert [r["declaration_id"] for r in res] == ["id1", "id2"]
    assert res[0]["record_ref"].startswith("d-") and len(res[0]["record_ref"]) == 14


def test_self_interest():
    pos = {"step_1": s1("ТОВ Тест", "111"), "step_8": corp("ТОВ Тест", "111")}
    assert _rule_self_interest(pos)[0]["rule_id"] == "self_interest"
    assert _rule_self_interest({"step_1": s1("ТОВ Тест", "111"), "step_8": corp("ТОВ Інша", "222")}) == []


def test_business_ownership():
    assert _rule_business_ownership({"step_8": corp("ТОВ Тест", "111")})
    assert _rule_business_ownership({"step_8": corp("Благодійний фонд Тест", "111")}) == []


def test_ngo_risk():
    d = {"step_8": corp("Благодійний фонд Тест", "111")}
    assert _rule_ngo_risk(d)[0]["severity"] == "low"
    assert _rule_ngo_risk({**d, "step_1": s1("Благодійний фонд Тест", "111")})[0]["severity"] == "high"
    assert _rule_ngo_risk({"step_16": {"data": {"part_org": [{"objectName": "Спілка", "reestrCode": "5"}]}}})
    assert _rule_ngo_risk({"step_8": corp("ТОВ Тест", "111")}) == []


def test_family_conflict():
    d = {"step_1": s1("ТОВ Тест", "111"), "step_2": FAM, "step_11": {"data": [inc("2", "ТОВ Тест", "111", "10")]}}
    assert _rule_family_conflict(d)[0]["rule_id"] == "family_conflict"
    d["step_11"] = {"data": [inc("2", "ТОВ Інша", "999", "10")]}
    assert _rule_family_conflict(d) == []


def test_suspicious_gifts():
    gift = {"objectType": "Подарунок", "sizeIncome": "100", "person_who_care": [{"person": "1"}],
            "sources": [{"source_ua_lastname": "Сторонній", "source_ua_firstname": "Дарувальник",
                         "source_citizen": "Громадянин України"}]}
    assert _rule_suspicious_gifts({"step_11": {"data": [gift]}})
    relative = {**gift, "sources": [{"source_ua_lastname": "Вигаданий", "source_ua_firstname": "Родич",
                                     "source_ua_middlename": "Тестович", "source_citizen": "Громадянин України"}]}
    assert _rule_suspicious_gifts({"step_2": FAM, "step_11": {"data": [relative]}}) == []
    assert _rule_suspicious_gifts({"step_11": {"data": [{**gift, "objectType": "Зарплата"}]}}) == []


def test_large_family_income():
    d = {"step_1": s1("ТОВ Тест", "111"), "step_2": FAM, "step_11": {"data": [inc("2", "ТОВ Інша", "999", "2000000")]}}
    assert _rule_large_family_income(d)[0]["rule_id"] == "large_family_income"
    d["step_11"] = {"data": [inc("2", "ТОВ Інша", "999", "500")]}
    assert _rule_large_family_income(d) == []
    d["step_11"] = {"data": [inc("2", "ТОВ Тест", "111", "2000000")]}
    assert _rule_large_family_income(d) == []
    d["step_11"] = {"data": [inc("2", "ТОВ Інша", "999", "500")]}
    assert _rule_large_family_income(d, {**DEFAULT_CONFIG, "large_family_income_threshold": 100})


def test_config_override_via_evaluate():
    data = {"step_2": FAM, "step_11": {"data": [inc("2", "ТОВ Інша", "999", "500")]}}
    r = evaluate_declarations([decl(1, data=data)], year=2025, config={"large_family_income_threshold": 100})[0]
    assert "large_family_income" in [f["rule_id"] for f in r["flags"]]


def test_robust_to_garbage():
    for data in (None, {}, [], "x", {"step_1": None}, {"step_2": {"data": "x"}}, {"step_8": {"data": [1, None, {"rights": 5}]}},
                 {"step_11": {"data": [{"sources": "s", "person_who_care": 3}]}}, {"step_16": {"data": []}},
                 {"step_9": {"data": [{"person_who_care": None}]}}):
        r = ev(decl(1, data=data))
        assert r["flags"] == [] and r["risk_level"] == "none"
    assert ev({"declaration_id": "x"})["on_time"] is None


def test_rules_and_law_refs():
    assert set(RULES) >= {"self_interest", "business_ownership", "ngo_risk", "family_conflict",
                          "suspicious_gifts", "large_family_income", "declaration_late"}
    assert all(law_refs_for(r) for r in RULES) and law_refs_for("nope") == []


def test_no_pii_in_result():
    data = {"step_1": s1("ТОВ Тест", "111"), "step_2": FAM, "step_8": corp("ТОВ Тест", "111"),
            "step_11": {"data": [inc("2", "ТОВ Тест", "111", "2000000")]}}
    out = json.dumps(evaluate_declarations([decl(1, dt="2026-05-01", data=data)], year=2025), ensure_ascii=False)
    for secret in ("Тестович", "Тестівна", "Вигаданий", "111", "2000000", "ТОВ"):
        assert secret not in out


def test_mock_file():
    import pathlib
    p = pathlib.Path(__file__).parent.parent / "app" / "seed" / "data" / "declarations_mock.json"
    items = json.loads(p.read_text(encoding="utf-8"))
    assert len(items) == 12 and sum(1 for i in items if i["data"]) == 4
    res = evaluate_declarations(items, year=2025)
    assert any(r["on_time"] is False for r in res)
    assert {"self_interest", "family_conflict", "suspicious_gifts", "large_family_income", "ngo_risk"} <= \
        {f["rule_id"] for r in res for f in r["flags"]}
