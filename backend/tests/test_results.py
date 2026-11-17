"""Результати хвилі через API: v2, знімки, динаміка, поріг k."""

import pytest

from tests.conftest import auth
from tests.helpers import (
    API,
    ROOT,
    answer,
    close,
    fill_checklist,
    open_campaign,
    post_fact,
    results,
    units,
)

ALL = ("nazk-maturity-staff", "nazk-maturity-wg", "nazk-maturity-expert", "nazk-checklist")


def test_results_only_after_close(client):
    campaign_id, _, admin = open_campaign(client, ALL)
    assert client.get(f"{API}/campaigns/{campaign_id}/results", headers=admin).status_code == 409
    assert client.get(f"{API}/campaigns/{campaign_id}/results", headers=auth(client, "staff01")).status_code == 403


def test_full_wave_with_facts(client):
    """ОС обирає рівень 3 (50), РГ — 5 (100), експерти — 3 (50), чек-лист повністю підтверджено (100).

    S кожного компонента = 0,35·50 + 0,25·100 + 0,20·50 + 0,20·100 = 72,5.
    Факти: навчання 72% → 50; декларації 96% → 75; КІ 55% → 0, закупівлі 40% → 0, повідомлення 80% → 25.
    Підзвітність: F = 8,3, отже 72,5 > 33,3 і компонент зрізається до 33,3.
    II = (72,5 + 72,5 + 33,3) / 3 = 59,4; без фактів 72,5.
    """
    campaign_id, q, admin = open_campaign(client, ALL)
    for i in range(1, 7):
        answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda _: 2)
    for i in range(1, 6):
        answer(client, campaign_id, q["nazk-maturity-wg"], f"wg{i}", lambda _: -1)
        answer(client, campaign_id, q["nazk-maturity-expert"], f"expert{i}", lambda _: 2)
    fill_checklist(client, campaign_id)

    root = units(client, admin)[ROOT]
    post_fact(client, root, "training_coverage", 72, 100)
    post_fact(client, root, "declarations_on_time", 96, 100)
    post_fact(client, root, "coi_reviewed", 55, 100)
    post_fact(client, root, "procurement_flags_reviewed", 40, 100)
    post_fact(client, root, "reports_handled", 80, 100)
    close(client, campaign_id, admin)

    data = results(client, campaign_id, admin)
    assert data["source"] == "snapshot"
    assert data["methodology_version"] == "2.0"
    c = {x["code"]: x for x in data["components"]}

    assert c["culture"]["self_score"] == 72.5 and c["culture"]["score"] == 72.5
    assert c["system"]["facts_score"] == 75.0 and c["system"]["score"] == 72.5
    assert c["accountability"]["facts_score"] == pytest.approx(8.3)
    assert c["accountability"]["score"] == pytest.approx(33.3)
    assert c["accountability"]["cut_by_facts"] is True
    assert "знижена до 33,3" in c["accountability"]["rule"]

    assert data["index"]["score"] == pytest.approx(59.4)
    assert data["index"]["self_score"] == 72.5
    assert data["index"]["level"]["level"] == 3
    # РГ відповіла лише найвищими варіантами і на 50 балів вище за ОС: серйозні прапорці.
    assert data["index"]["reliability"] == "C"
    flags = {f["code"] for f in c["culture"]["flags"]}
    assert {"suspiciously_perfect", "category_gap", "low_participation"} <= flags

    sources = {s["source"]: s for s in c["culture"]["sources"]}
    assert sources["checklist"]["score"] == 100.0 and sources["expert"]["effective_weight"] == 0.2
    assert data["checklist"]["confirmed"] == 36

    training = next(f for f in data["facts"] if f["indicator"] == "training_coverage")
    assert training["label"] == "Охоплення навчанням за 12 місяців: мали пройти 100 · пройшли навчання 72 · не пройшли 28 (72%)"
    assert training["level"] == 3

    assert any("самооцінку не підтверджують факти" in line for line in data["summary"])
    assert any("Без перевірки фактами індекс був би 72,5" in line for line in data["summary"])


def test_below_threshold_hides_everything(client):
    campaign_id, q, admin = open_campaign(client, ("nazk-maturity-staff",))
    for login in ["staff01", "staff02", "staff03", "staff04"]:  # 4 < k = 5
        answer(client, campaign_id, q["nazk-maturity-staff"], login, lambda _: 2)
    close(client, campaign_id, admin)

    data = results(client, campaign_id, admin)
    assert data["index"]["score"] is None
    assert data["index"]["reliability"] == "insufficient_data"
    group = data["groups"][0]
    assert group["n"] is None and group["sufficient"] is False  # навіть кількість відповідей приховано
    assert group["eligible"] == 24  # людей, які мали пройти, достатньо — цю цифру показуємо
    assert data["questions"] == []


def test_unit_drilldown_and_participant_screen(client):
    campaign_id, q, admin = open_campaign(client, ("nazk-maturity-staff",))
    for i in range(1, 25):
        answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda _: 2)
    close(client, campaign_id, admin)

    u = units(client, admin)
    assert results(client, campaign_id, admin)["groups"][0]["n"] == 24
    # Підрозділ А разом із дочірніми А-1 і А-2: 12 осіб.
    a = results(client, campaign_id, admin, u["Підрозділ А"])
    assert a["groups"][0]["n"] == 12 and a["index"]["score"] is not None and a["source"] == "snapshot"
    # Підрозділ А-1: 4 особи — нічого не показуємо, дані враховано у вищому підрозділі.
    a1 = results(client, campaign_id, admin, u["Підрозділ А-1"])
    assert a1["index"]["score"] is None
    assert a1["groups"][0]["eligible"] is None and a1["groups"][0]["n"] is None

    log = client.get(f"{API}/admin/audit-log?entity=campaign", headers=admin).json()
    assert sum(1 for e in log if e["action"] == "view_results") == 3

    [item] = client.get(f"{API}/me/results", headers=auth(client, "staff01")).json()
    assert item["my_unit"]["unit_name"] == "Підрозділ А" and item["my_unit"]["sufficient"] is True
    assert "questions" not in item["institution"]
    [item] = client.get(f"{API}/me/results", headers=auth(client, "staff03")).json()
    assert item["my_unit"]["unit_name"] == "Підрозділ А-1" and item["my_unit"]["sufficient"] is False


def test_snapshots_history_compare_and_significance(client):
    def wave(title, pick):
        campaign_id, q, admin = open_campaign(client, ("nazk-maturity-staff",), title=title)
        for i in range(1, 6):
            answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda _: pick)
        close(client, campaign_id, admin)
        return campaign_id, admin

    c1, admin = wave("Хвиля 1", 1)   # рівень 2 → 25
    c2, _ = wave("Хвиля 2", 3)       # рівень 4 → 75
    c3, _ = wave("Хвиля 3", 3)       # без змін
    root = units(client, admin)[ROOT]

    history = client.get(f"{API}/units/{root}/history", headers=admin).json()
    points = history["points"]
    assert [p["campaign_title"] for p in points] == ["Хвиля 1", "Хвиля 2", "Хвиля 3"]
    assert [p["index"] for p in points] == [25.0, 75.0, 75.0]
    assert points[1]["significance"]["code"] == "improved"
    assert points[2]["significance"]["code"] == "within_error"
    assert all(p["methodology_version"] == "2.0" for p in points)

    compare = client.get(f"{API}/units/{root}/compare", params={"from_campaign": c1, "to_campaign": c3}, headers=admin).json()
    assert compare["index_delta"] == 50.0
    assert compare["index_significance"]["code"] == "improved"
    assert {r["code"]: (r["before"], r["after"]) for r in compare["radar"]}["culture"] == (25.0, 75.0)

    data = results(client, c2, admin)
    assert data["dynamics"]["previous_title"] == "Хвиля 1"
    assert data["dynamics"]["index_significance"]["title"] == "покращилось"

    # Знімок незмінний: нові факти не впливають на закриту хвилю, але видні при перерахунку.
    post_fact(client, root, "training_coverage", 10, 100)
    assert results(client, c1, admin)["components"][0]["facts"] == []
    recalculated = results(client, c1, admin, recalculate=True)
    assert recalculated["source"] == "recalculated"
    assert recalculated["components"][0]["facts"][0]["percent"] == 10.0


def test_same_input_gives_same_snapshot(client):
    campaign_id, q, admin = open_campaign(client, ("nazk-maturity-staff",))
    for i in range(1, 6):
        answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda question: len(question["options"]) // 2)
    close(client, campaign_id, admin)
    snapshot = results(client, campaign_id, admin)
    recalculated = results(client, campaign_id, admin, recalculate=True)
    for key in ("index", "components", "groups", "questions"):
        assert snapshot[key] == recalculated[key]


def test_progress_hides_small_groups(client):
    campaign_id, _, admin = open_campaign(client, ("nazk-maturity-wg", "nazk-maturity-staff"), min_group_size=7)
    items = {i["target_category"]: i for i in client.get(f"{API}/campaigns/{campaign_id}/progress", headers=admin).json()["items"]}
    assert items["working_group"]["eligible"] is None and items["working_group"]["too_few_people"] is True  # 6 < 7
    assert items["staff"]["eligible"] == 24 and items["staff"]["too_few_people"] is False


def test_methodology_endpoint(client):
    data = client.get(f"{API}/methodology", headers=auth(client, "staff01")).json()
    assert data["version"] == "2.0"
    assert sum(data["source_weights"].values()) == pytest.approx(1.0)
    assert sum(c["weight"] for c in data["components"].values()) == pytest.approx(1.0)


def test_commissioner_reads_units_and_campaigns_but_not_progress(client):
    campaign_id, _, _ = open_campaign(client, ("nazk-maturity-staff",))
    commissioner = auth(client, "commissioner")
    assert len(client.get(f"{API}/units", headers=commissioner).json()) == 7
    assert client.get(f"{API}/campaigns", headers=commissioner).status_code == 200
    assert client.get(f"{API}/campaigns/{campaign_id}/progress", headers=commissioner).status_code == 403
    assert client.get(f"{API}/units", headers=auth(client, "staff01")).status_code == 403
