"""Чек-лист з підтвердженням і прийом фактів."""

from tests.conftest import auth
from tests.helpers import API, ROOT, close, fill_checklist, open_campaign, post_fact, results, units


def first_items(client, campaign_id, count=2):
    wg = auth(client, "wg1")
    return client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=wg).json()["items"][:count]


# ---------- Чек-лист ----------

def test_checklist_enter_and_confirm(client):
    campaign_id, _, _ = open_campaign(client, ("nazk-checklist",))
    wg, commissioner = auth(client, "wg1"), auth(client, "commissioner")
    with_proof, without_proof = first_items(client, campaign_id)
    url = f"{API}/campaigns/{campaign_id}/checklist"

    r = client.put(f"{url}/{with_proof['question_id']}", json={"status": "full", "evidence": "Наказ №5"}, headers=wg)
    assert r.json()["score"] == 50.0 and r.json()["confirmed"] is False  # повністю без підтвердження = 50

    r = client.post(f"{url}/{with_proof['question_id']}/confirm", headers=commissioner)
    assert r.status_code == 200 and r.json()["score"] == 100.0 and r.json()["confirmed"] is True

    client.put(f"{url}/{without_proof['question_id']}", json={"status": "full"}, headers=wg)
    assert client.post(f"{url}/{without_proof['question_id']}/confirm", headers=commissioner).status_code == 422

    # Зміна запису знімає підтвердження.
    r = client.put(f"{url}/{with_proof['question_id']}", json={"status": "full", "evidence": "Наказ №6"}, headers=wg)
    assert r.json()["confirmed"] is False and r.json()["score"] == 50.0

    summary = client.get(url, headers=auth(client, "admin")).json()
    assert summary["total"] == 36 and summary["filled"] == 2 and summary["confirmed"] == 0


def test_checklist_permissions(client):
    campaign_id, _, _ = open_campaign(client, ("nazk-checklist", "nazk-maturity-staff"))
    [item] = first_items(client, campaign_id, 1)
    url = f"{API}/campaigns/{campaign_id}/checklist/{item['question_id']}"
    body = {"status": "partial", "evidence": "Звіт"}

    assert client.put(url, json=body, headers=auth(client, "staff01")).status_code == 403
    assert client.put(url, json=body, headers=auth(client, "commissioner")).status_code == 403  # підтверджує, але не вносить
    assert client.put(url, json=body, headers=auth(client, "admin")).status_code == 403
    assert client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=auth(client, "staff01")).status_code == 403
    assert client.put(url, json=body, headers=auth(client, "wg1")).status_code == 200
    assert client.post(f"{url}/confirm", headers=auth(client, "wg2")).status_code == 403
    assert client.post(f"{url}/confirm", headers=auth(client, "admin")).status_code == 403  # підтверджує лише commissioner
    assert client.put(url, json={**body, "person_name": "x"}, headers=auth(client, "wg1")).status_code == 422

    # Анонімна форма для чек-листа закрита.
    q_id = client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=auth(client, "admin")).json()["questionnaire_id"]
    r = client.get(f"{API}/campaigns/{campaign_id}/questionnaires/{q_id}/form", headers=auth(client, "wg1"))
    assert r.status_code == 409


def test_unconfirmed_checklist_lowers_reliability(client):
    campaign_id, _, admin = open_campaign(client, ("nazk-checklist",))
    fill_checklist(client, campaign_id, status="full", confirm=False)
    close(client, campaign_id, admin)
    assert client.put(
        f"{API}/campaigns/{campaign_id}/checklist/{first_items(client, campaign_id, 1)[0]['question_id']}",
        json={"status": "none"}, headers=auth(client, "wg1"),
    ).status_code == 409  # після закриття змінювати не можна

    data = results(client, campaign_id, admin)
    culture = next(c for c in data["components"] if c["code"] == "culture")
    assert culture["score"] == 50.0  # усі "повністю", але без підтвердження = 50
    assert {"checklist_unconfirmed", "no_facts"} <= {f["code"] for f in culture["flags"]}
    assert culture["reliability"] == "B"
    assert data["checklist"]["confirmed_share"] == 0


# ---------- Факти ----------

def fact(unit_id, **extra):
    return {"unit_id": unit_id, "period": "2026-10", "indicator": "coi_reviewed",
            "numerator": 15, "denominator": 20, "source": "artemida", **extra}


KEY = {"X-Integration-Key": "test-integration-key"}


def test_indicator_rejects_personal_fields_and_bad_values(client):
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    assert client.post(f"{API}/indicators", json=fact(root, person_name="Іваненко"), headers=KEY).status_code == 422
    assert client.post(f"{API}/indicators", json=fact(root, numerator=21), headers=KEY).status_code == 422
    assert client.post(f"{API}/indicators", json=fact(root, indicator="rating_of_people"), headers=KEY).status_code == 422
    assert client.post(f"{API}/indicators", json=fact(root, period="2026-13"), headers=KEY).status_code == 422
    assert client.post(f"{API}/indicators", json=fact(root, extra_counts={"Ім'я": 1}), headers=KEY).status_code == 422


def test_indicator_auth(client):
    root = units(client, auth(client, "admin"))[ROOT]
    assert client.post(f"{API}/indicators", json=fact(root)).status_code == 401
    assert client.post(f"{API}/indicators", json=fact(root), headers={"X-Integration-Key": "wrong"}).status_code == 401
    assert client.post(f"{API}/indicators", json=fact(root), headers=auth(client, "commissioner")).status_code == 403
    assert client.post(f"{API}/indicators", json=fact(root), headers=auth(client, "admin")).status_code == 201
    assert client.post(f"{API}/indicators", json=fact(root), headers=KEY).status_code == 201


def test_indicator_upsert_and_x_of_y(client):
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    client.post(f"{API}/indicators", json=fact(root, extra_counts={"pending": 5}), headers=KEY)
    client.post(f"{API}/indicators", json=fact(root, numerator=16, extra_counts={"pending": 4}), headers=KEY)  # оновлення

    data = client.get(f"{API}/units/{root}/indicators", params={"months": 3, "end": "2026-11-15"}, headers=admin).json()
    [coi] = data
    assert coi["numerator"] == 16 and coi["denominator"] == 20 and coi["percent"] == 80.0
    assert coi["label"] == "Можливі конфлікти інтересів розібрано вчасно: знайдено можливих 20 · розібрано вчасно 16 · чекають 4 (80%)"
    assert coi["level"] == 3 and coi["extra_counts"] == {"pending": 4}


def test_small_denominator_rolls_up_to_parent(client):
    admin = auth(client, "admin")
    u = units(client, admin)
    post_fact(client, u["Підрозділ А-1"], "hiring_checks", 2, 3, period="2026-10")
    post_fact(client, u["Підрозділ А-2"], "hiring_checks", 3, 3, period="2026-10")
    params = {"months": 3, "end": "2026-11-01"}

    small = client.get(f"{API}/units/{u['Підрозділ А-1']}/indicators", params=params, headers=admin).json()[0]
    assert small["status"] == "too_few_people" and small["numerator"] is None
    assert small["label"].endswith("замало людей для показу")

    parent = client.get(f"{API}/units/{u['Підрозділ А']}/indicators", params=params, headers=admin).json()[0]
    assert parent["status"] == "ok" and parent["numerator"] == 5 and parent["denominator"] == 6


def test_risk_signals_show_raw_counts(client):
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    post_fact(client, root, "procurement_flags_reviewed", 4, 10, period="2026-10")
    post_fact(client, root, "procurement_flags_reviewed", 3, 6, period="2026-07")
    signals = client.get(f"{API}/units/{root}/risk-signals", params={"months": 3, "end": "2026-11-01"}, headers=admin).json()
    [proc] = signals
    assert proc["found"] == 10 and proc["handled"] == 4 and proc["pending"] == 6
    assert proc["previous_found"] == 6 and proc["change"] == 4
