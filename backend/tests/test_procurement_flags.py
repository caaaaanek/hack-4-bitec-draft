"""Тести правил червоних прапорців для закупівель (app/services/procurement_flags.py)."""
import json

from app.services import procurement_flags as pf


def bid(bid_id, edrpou, amount=100.0, status=None, name=None, phone=None, email=None,
        street=None):
    bidder = {"name": name or f"Компанія {edrpou}", "edrpou": edrpou}
    if phone:
        bidder["phones"] = [phone]
    if email:
        bidder["email"] = email
    if street:
        bidder["address"] = {"street": street, "locality": "Київ"}
    return {"bid_id": bid_id, "bidder": bidder, "amount": amount, "award_status": status}


def rec(record_id="r1", **kw):
    base = {"record_id": record_id, "id": record_id, "procurement_method": "open",
            "procurement_method_type": "aboveThreshold", "category": "goods",
            "expected_value": 100_000.0, "bids": []}
    base.update(kw)
    return base


def rules_of(record, **kw):
    (res,) = pf.evaluate_records([record], **kw)
    return {f["rule_id"]: f for f in res["flags"]}


# ---------------------------------------------------------------- по правилу: так / ні

def test_single_bidder():
    r = rec(expected_value=2_000_000.0, bids=[bid("b1", "1")])
    assert rules_of(r)["single_bidder_high_value"]["severity"] == "medium"
    r["expected_value"] = 6_000_000.0
    assert rules_of(r)["single_bidder_high_value"]["severity"] == "high"
    r["bids"].append(bid("b2", "2"))
    assert "single_bidder_high_value" not in rules_of(r)
    assert "single_bidder_high_value" not in rules_of(
        rec(expected_value=500_000.0, bids=[bid("b1", "1")]))


def test_winner_price_near_expected():
    bids = [bid("b1", "1", 99_000.0), bid("b2", "2", 120_000.0)]
    assert "winner_price_near_expected" in rules_of(
        rec(bids=bids, winner={"edrpou": "1", "amount": 99_000.0}))
    assert "winner_price_near_expected" not in rules_of(
        rec(bids=bids, winner={"edrpou": "1", "amount": 80_000.0}))


def test_short_tender_period():
    short = rec(dates={"created_at": "2026-10-01T10:00:00+02:00", "tender_period_days": 10})
    assert "short_tender_period" in rules_of(short)
    ok = rec(dates={"created_at": "2026-10-01T10:00:00+02:00", "tender_period_days": 15})
    assert "short_tender_period" not in rules_of(ok)
    # оголошення до 01.09.2026: діє попередня редакція, 7 днів достатньо
    old = rec(dates={"created_at": "2026-08-01T10:00:00+02:00", "tender_period_days": 7})
    assert "short_tender_period" not in rules_of(old)


def test_shared_phone_email_address():
    r = rec(bids=[
        bid("b1", "1", phone="+380441234567", email="a@x.com", street="вул. Шевченка, 5"),
        bid("b2", "2", phone="044 123 45 67", email="A@x.com", street="Шевченка вулиця 5"),
    ])
    got = rules_of(r)
    assert got["shared_phone"]["severity"] == "high"
    assert got["shared_email"]["severity"] == "high"
    assert got["shared_address"]["severity"] == "medium"
    clean = rec(bids=[
        bid("b1", "1", phone="+380441234567", email="a@x.com", street="вул. Шевченка, 5"),
        bid("b2", "2", phone="+380442222222", email="b@y.com", street="вул. Лесі, 7"),
    ])
    assert not {"shared_phone", "shared_email", "shared_address"} & set(rules_of(clean))


def test_email_matches_other_bidder():
    r = rec(bids=[
        bid("b1", "1", name='ТОВ "ВЕКТОР"', email="info@zorya-group.com"),
        bid("b2", "2", name='ТОВ "ЗОРЯ"', email="x@other.com"),
    ])
    assert "email_matches_other_bidder" in rules_of(r)
    r["bids"][0]["bidder"]["email"] = "info@random.com"
    assert "email_matches_other_bidder" not in rules_of(r)


def test_winner_not_cheapest():
    bids = [bid("b1", "1", 130_000.0, "active"), bid("b2", "2", 100_000.0, "active")]
    got = rules_of(rec(bids=bids, winner={"edrpou": "1", "amount": 130_000.0}))
    assert got["winner_not_cheapest"]["severity"] == "high"
    got = rules_of(rec(bids=bids, winner={"edrpou": "2", "amount": 100_000.0}))
    assert "winner_not_cheapest" not in got


def test_cheaper_rejected_near_max():
    bids = [bid("b1", "1", 99_000.0, "active"), bid("b2", "2", 90_000.0, "unsuccessful")]
    r = rec(bids=bids, winner={"edrpou": "1", "amount": 99_000.0})
    got = rules_of(r)
    assert got["cheaper_rejected_near_max"]["severity"] == "high"
    # відхилення не виняток: дешевша пропозиція ще активна
    bids[1]["award_status"] = "pending"
    assert "cheaper_rejected_near_max" not in rules_of(r)


def test_non_competitive_high_value():
    r = rec(procurement_method="limited", procurement_method_type="negotiation",
            expected_value=300_000.0)
    assert "non_competitive_high_value" in rules_of(r)
    r["expected_value"] = 100_000.0
    assert "non_competitive_high_value" not in rules_of(r)
    # special: поріг 1 млн
    r.update(expected_value=300_000.0, buyer={"edrpou": "9", "kind": "special"})
    assert "non_competitive_high_value" not in rules_of(r)


def test_many_contract_changes():
    assert "many_contract_changes" in rules_of(rec(contract={"changes_count": 3}))
    assert "many_contract_changes" not in rules_of(rec(contract={"changes_count": 2}))
    assert "many_contract_changes" not in rules_of(rec(contract={"changes_count": None}))


def test_shared_owner():
    bens = [{"company_edrpou": "1", "person": "Іваненко Іван"},
            {"company_edrpou": "2", "person": "іваненко  іван"}]
    r = rec(bids=[bid("b1", "1"), bid("b2", "2")], beneficiaries=bens)
    assert rules_of(r)["shared_owner"]["severity"] == "high"
    bens[1]["person"] = "Петренко Петро"
    assert "shared_owner" not in rules_of(r)


def test_complaints_present():
    assert rules_of(rec(complaints_count=2))["complaints_present"]["severity"] == "low"
    assert "complaints_present" not in rules_of(rec(complaints_count=0))


# ---------------------------------------------------------------- дроблення

def lot(i, day, amount=80_000.0, edrpou="777"):
    return rec(f"s{i}", buyer={"edrpou": edrpou, "kind": "general"}, cpv="09134200-9",
               expected_value=amount, dates={"created_at": f"2026-10-{day:02d}T10:00:00+02:00"})


def test_split_purchase_three_lots_cross_threshold():
    records = [lot(1, 1), lot(2, 5), lot(3, 10)]  # по 80k, разом 240k >= 200k
    res = pf.evaluate_records(records)
    assert all("split_purchase" in {f["rule_id"] for f in x["flags"]} for x in res)
    assert res[0]["risk_level"] == "high"


def test_split_purchase_negative():
    # лише 2 закупівлі
    assert all(not x["flags"] for x in pf.evaluate_records([lot(1, 1), lot(2, 5)]))
    # поза вікном 30 днів
    far = [lot(1, 1), lot(2, 2), rec("s3", buyer={"edrpou": "777"}, cpv="09134200-9",
                                      expected_value=80_000.0,
                                      dates={"created_at": "2026-12-20T10:00:00+02:00"})]
    assert all("split_purchase" not in {f["rule_id"] for f in x["flags"]}
               for x in pf.evaluate_records(far))


def test_split_purchase_uses_dataset_when_given():
    ds = [lot(1, 1), lot(2, 5), lot(3, 10)]
    (res,) = pf.evaluate_records([ds[0]], dataset=ds)
    assert [f["rule_id"] for f in res["flags"]] == ["split_purchase"]
    (res,) = pf.evaluate_records([ds[0]])  # без dataset лише один запис
    assert res["flags"] == []


# ---------------------------------------------------------------- загальне

def test_privacy():
    r = rec(expected_value=2_000_000.0, procurement_method_type="aboveThreshold",
            bids=[bid("b1", "11111111", name="СЕКРЕТНА КОМПАНІЯ", phone="+380441234567",
                      email="secret@private-mail.com", street="вул. Таємна, 42"),
                  bid("b2", "22222222", name="ІНША ФІРМА", phone="+380441234567",
                      email="secret@private-mail.com", street="вул. Таємна, 42")],
            winner={"edrpou": "11111111", "amount": 1_990_000.0},
            beneficiaries=[{"company_edrpou": "11111111", "person": "Прізвище Ім'я"},
                           {"company_edrpou": "22222222", "person": "Прізвище Ім'я"}])
    res = pf.evaluate_records([r])
    assert len(res[0]["flags"]) >= 4
    dumped = json.dumps(res, ensure_ascii=False)
    for secret in ("СЕКРЕТНА", "ІНША ФІРМА", "380441234567", "private-mail", "Таємна",
                   "11111111", "22222222", "Прізвище"):
        assert secret not in dumped
    for f in res[0]["flags"]:
        assert set(f) == {"rule_id", "severity", "title", "law_refs"}
        assert f["law_refs"] and all(isinstance(x, str) for x in f["law_refs"])


def test_order_length_and_defects():
    records = [rec("a", complaints_count=1), {"title": "без id"}, "сміття", None,
               rec("b", bids="не список", winner="x", dates=5, contract=[], buyer=7,
                   expected_value="1", beneficiaries=[1], complaints_count="2"),
               rec("c", complaints_count=0)]
    res = pf.evaluate_records(records)
    assert [x["record_id"] for x in res] == ["a", "", "", "", "b", "c"]
    assert [x["risk_level"] for x in res] == ["low", "none", "none", "none", "none", "none"]
    assert res[0]["flags"][0]["rule_id"] == "complaints_present"
    assert pf.evaluate_records([]) == []


def test_risk_level_and_registry():
    sev = lambda *s: [{"severity": x} for x in s]  # noqa: E731
    assert pf.risk_level([]) == "none"
    assert pf.risk_level(sev("low")) == "low"
    assert pf.risk_level(sev("low", "low")) == "medium"
    assert pf.risk_level(sev("medium")) == "medium"
    assert pf.risk_level(sev("medium", "medium", "medium")) == "high"
    assert pf.risk_level(sev("high")) == "high"
    assert len(pf.RULES) == 14
    assert all(pf.law_refs_for(rid) for rid in pf.RULES)
    assert pf.law_refs_for("нема") == []


def test_config_overrides_thresholds():
    r = rec(expected_value=2_000_000.0, bids=[bid("b1", "1")], complaints_count=1,
            contract={"changes_count": 2})
    assert "single_bidder_high_value" in rules_of(r)
    got = rules_of(r, config={"single_bidder_min_amount": 3_000_000, "many_changes_min": 2})
    assert "single_bidder_high_value" not in got
    assert "many_contract_changes" in got
    assert pf.DEFAULT_CONFIG["single_bidder_min_amount"] == 1_000_000  # дефолт не змінено
    # поріг дроблення: з вищим порогом 3 лоти по 80k не перетинають його
    res = pf.evaluate_records([lot(1, 1), lot(2, 5), lot(3, 10)],
                              config={"threshold_goods_services": 300_000})
    assert all(not x["flags"] for x in res)
