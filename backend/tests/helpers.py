"""Спільні кроки для інтеграційних тестів: хвиля, відповіді, чек-лист, факти."""

from datetime import date

from tests.conftest import auth

API = "/api/v1"
ROOT = "Організація (демо)"


def units(client, admin) -> dict[str, str]:
    return {u["name"]: u["id"] for u in client.get(f"{API}/admin/units", headers=admin).json()}


def questionnaire_ids(client, admin) -> dict[str, str]:
    return {q["code"]: q["id"] for q in client.get(f"{API}/questionnaires", headers=admin).json()}


def open_campaign(client, codes, title="Хвиля 1", min_group_size=None):
    admin = auth(client, "admin")
    q = questionnaire_ids(client, admin)
    body = {"title": title, "unit_id": units(client, admin)[ROOT], "questionnaire_ids": [q[c] for c in codes]}
    if min_group_size:
        body["min_group_size"] = min_group_size
    r = client.post(f"{API}/campaigns", json=body, headers=admin)
    assert r.status_code == 201, r.text
    campaign_id = r.json()["id"]
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    return campaign_id, q, admin


def answer(client, campaign_id, questionnaire_id, login, pick):
    """pick(question) -> позиція варіанта (0 = перший, -1 = останній)."""
    headers = auth(client, login)
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{questionnaire_id}"
    form = client.get(f"{url}/form", headers=headers).json()
    answers = [{"question_id": q["id"], "option_ids": [q["options"][pick(q)]["id"]]}
               for s in form["sections"] for q in s["questions"]]
    r = client.post(f"{url}/responses", json={"answers": answers}, headers=headers)
    assert r.status_code == 201, r.text


def fill_checklist(client, campaign_id, status="full", evidence="Наказ №1 (синтетичний)", confirm=True):
    wg = auth(client, "wg1")
    commissioner = auth(client, "commissioner")
    items = client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=wg).json()["items"]
    for item in items:
        r = client.put(f"{API}/campaigns/{campaign_id}/checklist/{item['question_id']}",
                       json={"status": status, "evidence": evidence}, headers=wg)
        assert r.status_code == 200, r.text
        if confirm:
            r = client.post(f"{API}/campaigns/{campaign_id}/checklist/{item['question_id']}/confirm", headers=commissioner)
            assert r.status_code == 200, r.text


def post_fact(client, unit_id, indicator, numerator, denominator, period=None):
    period = period or f"{date.today():%Y-%m}"
    r = client.post(
        f"{API}/indicators",
        json={"unit_id": unit_id, "period": period, "indicator": indicator, "numerator": numerator,
              "denominator": denominator, "source": "test-mock"},
        headers={"X-Integration-Key": "test-integration-key"},
    )
    assert r.status_code == 201, r.text


def close(client, campaign_id, admin):
    assert client.post(f"{API}/campaigns/{campaign_id}/close", headers=admin).status_code == 200


def results(client, campaign_id, admin, unit_id=None, recalculate=False):
    params = {}
    if unit_id:
        params["unit_id"] = unit_id
    if recalculate:
        params["recalculate"] = "true"
    r = client.get(f"{API}/campaigns/{campaign_id}/results", params=params, headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


ALL = ("nazk-maturity-staff", "nazk-maturity-wg", "nazk-maturity-expert", "nazk-checklist")


def full_wave(client, title="Хвиля 1", staff_pick=2, checklist_status="full"):
    """Повна хвиля з прикладу ТЗ: Підзвітність зрізається фактами. Повертає (campaign_id, admin, root_id)."""
    campaign_id, q, admin = open_campaign(client, ALL, title=title)
    for i in range(1, 7):
        answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda _: staff_pick)
    for i in range(1, 6):
        answer(client, campaign_id, q["nazk-maturity-wg"], f"wg{i}", lambda _: -1)
        answer(client, campaign_id, q["nazk-maturity-expert"], f"expert{i}", lambda _: 2)
    fill_checklist(client, campaign_id, status=checklist_status)
    root = units(client, admin)[ROOT]
    for indicator, num in (("training_coverage", 72), ("declarations_on_time", 96), ("coi_reviewed", 55),
                           ("procurement_flags_reviewed", 40), ("reports_handled", 80)):
        post_fact(client, root, indicator, num, 100)
    close(client, campaign_id, admin)
    return campaign_id, admin, root
