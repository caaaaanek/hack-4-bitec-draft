"""Сценарій «що, якщо»: POST /campaigns/{id}/what-if. Прогноз тією ж scoring.compute, нічого не записується."""

from datetime import date, timedelta

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import AuditLog, IndexSnapshot, Measure, Response
from tests.conftest import auth
from tests.helpers import API, ALL, full_wave, open_campaign, post_fact, results, units


def what_if(client, campaign_id, headers, **body):
    return client.post(f"{API}/campaigns/{campaign_id}/what-if", json=body, headers=headers)


def comp(payload, code):
    return next(c for c in payload["components"] if c["code"] == code)


def row_counts():
    with SessionLocal() as db:
        return tuple(db.scalar(select(func.count()).select_from(t)) for t in (AuditLog, IndexSnapshot, Measure, Response))


def test_without_changes_equals_wave_snapshot(client):
    campaign_id, admin, _ = full_wave(client)
    leader = auth(client, "leader")
    r = what_if(client, campaign_id, leader)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scenario"] == {**body["baseline"], "components": [
        {**c, "explanation": s["explanation"]} for c, s in zip(body["baseline"]["components"], body["scenario"]["components"])]}
    assert body["baseline"]["index"]["score"] == results(client, campaign_id, admin)["index"]["score"]
    assert body["delta"]["index"] == 0 and set(body["delta"]["components"].values()) == {0}
    assert body["applied"] == [] and "не моделюються" in body["disclaimer"]
    assert body["at_root"] is True and len(body["options"]["checklist"]) == 36
    assert {f["indicator"] for f in body["options"]["facts"]} >= {"coi_reviewed", "training_coverage"}


def test_checklist_item_raises_its_component(client):
    campaign_id, _, _ = full_wave(client, checklist_status="partial")
    leader = auth(client, "leader")
    base = what_if(client, campaign_id, leader, levers=False).json()
    item = next(i for i in base["options"]["checklist"] if i["component"] == "culture")
    body = what_if(client, campaign_id, leader, checklist={item["number"]: "full"}, levers=False).json()
    assert body["delta"]["components"]["culture"] > 0 and body["delta"]["index"] > 0
    assert body["delta"]["components"]["system"] == 0
    assert body["applied"][0]["effect"] is True and "частково → повністю" in body["applied"][0]["note"]


def test_fact_capped_component_grows_only_from_facts(client):
    """Підзвітність зрізана фактами: весь чек-лист її не піднімає, а факти піднімають."""
    campaign_id, _, _ = full_wave(client, checklist_status="partial")
    leader = auth(client, "leader")
    base = what_if(client, campaign_id, leader, levers=False).json()
    assert comp(base["baseline"], "accountability")["cut_by_facts"] is True

    all_full = {i["number"]: "full" for i in base["options"]["checklist"]}
    paper = what_if(client, campaign_id, leader, checklist=all_full, levers=False).json()
    assert paper["delta"]["components"]["culture"] > 0
    assert paper["delta"]["components"]["accountability"] == 0
    assert "стелю задають факти" in comp(paper["scenario"], "accountability")["explanation"]

    real = what_if(client, campaign_id, leader, levers=False,
                   facts={"coi_reviewed": 98, "procurement_flags_reviewed": 95, "reports_handled": 100}).json()
    assert real["delta"]["components"]["accountability"] > 0
    assert real["delta"]["index"] > paper["delta"]["index"]  # реальні зміни важать більше за папір
    assert all(a["effect"] for a in real["applied"])


def test_levers_are_sorted_and_reproducible(client):
    campaign_id, _, _ = full_wave(client, checklist_status="partial")
    leader = auth(client, "leader")
    body = what_if(client, campaign_id, leader).json()
    levers = body["levers"]
    assert 0 < len(levers) <= 5
    deltas = [x["delta_index"] for x in levers]
    assert deltas == sorted(deltas, reverse=True) and all(d > 0 for d in deltas)
    top = levers[0]
    again = what_if(client, campaign_id, leader, levers=False, **top["scenario"]).json()
    assert again["scenario"]["index"]["score"] == top["index"]  # той самий розрахунок
    checklist_lever = next((x for x in levers if x["kind"] == "checklist"), None)
    if checklist_lever:
        assert checklist_lever["measure"] and checklist_lever["measure"]["catalog_number"] == checklist_lever["number"]


def test_measures_close_their_checklist_items(client):
    campaign_id, _, root = full_wave(client, checklist_status="partial")
    leader = auth(client, "leader")
    base = what_if(client, campaign_id, leader, levers=False).json()
    number = next(i["number"] for i in base["options"]["checklist"] if i["component"] == "system")
    due = (date.today() + timedelta(days=30)).isoformat()
    linked = client.post(f"{API}/measures", headers=leader, json={
        "unit_id": root, "title": "Оновити порядок", "owner": "Уповноважений", "due_date": due, "catalog_number": number})
    loose = client.post(f"{API}/measures", headers=leader, json={
        "unit_id": root, "title": "Провести зустріч", "owner": "Керівник", "due_date": due})
    assert linked.status_code == 201 and loose.status_code == 201, (linked.text, loose.text)
    body = what_if(client, campaign_id, leader, levers=False,
                   measure_ids=[linked.json()["id"], loose.json()["id"]]).json()
    by_id = {a["id"]: a for a in body["applied"]}
    assert by_id[linked.json()["id"]]["effect"] is True
    assert by_id[loose.json()["id"]]["effect"] is False and "наступною хвилею" in by_id[loose.json()["id"]]["note"]
    assert body["delta"]["components"]["system"] > 0


def test_nothing_is_written(client):
    campaign_id, _, _ = full_wave(client, checklist_status="partial")
    leader = auth(client, "leader")
    before = row_counts()
    r = what_if(client, campaign_id, leader, checklist={"1.1": "full"}, facts={"coi_reviewed": 90})
    assert r.status_code == 200, r.text
    assert row_counts() == before  # ні знімків, ні заходів, ні журналу


def test_access_and_validation(client):
    campaign_id, admin, root = full_wave(client)
    unit_a = units(client, admin)["Підрозділ А"]
    leader_a = auth(client, "leader_a")
    assert what_if(client, campaign_id, leader_a).status_code == 403  # заклад поза зоною керівника підрозділу
    assert what_if(client, campaign_id, auth(client, "staff01")).status_code == 403
    assert what_if(client, campaign_id, {}).status_code == 401

    # Підрозділ: чек-лист не змінюється (лише для закладу), а прихований факт (знаменник < k) — 422.
    post_fact(client, unit_a, "hiring_checks", 1, 3)
    r = what_if(client, campaign_id, leader_a, unit_id=unit_a, checklist={"1.1": "full"}, levers=False)
    assert r.status_code == 200, r.text
    assert r.json()["at_root"] is False and r.json()["applied"][0]["effect"] is False
    assert "закладу" in r.json()["applied"][0]["note"]
    r = what_if(client, campaign_id, leader_a, unit_id=unit_a, facts={"hiring_checks": 90})
    assert r.status_code == 422 and r.json()["code"] == "fact_hidden"

    leader = auth(client, "leader")
    assert what_if(client, campaign_id, leader, facts={"coi_reviewed": 120}).json()["code"] == "fact_out_of_range"
    assert what_if(client, campaign_id, leader, facts={"nope": 50}).json()["code"] == "fact_unknown"
    assert what_if(client, campaign_id, leader, checklist={"9.9": "full"}).json()["code"] == "checklist_unknown"
    assert what_if(client, campaign_id, leader, checklist={"1.1": "done"}).json()["code"] == "checklist_status"

    open_id, _, _ = open_campaign(client, ALL, title="Відкрита")
    r = what_if(client, open_id, leader)
    assert r.status_code == 409 and r.json()["code"] == "campaign_not_closed"
