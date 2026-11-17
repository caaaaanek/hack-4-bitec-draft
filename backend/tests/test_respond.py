from sqlalchemy import inspect

from app.db import engine
from tests.conftest import auth

API = "/api/v1"


def open_campaign(client) -> tuple[str, dict[str, str]]:
    admin = auth(client, "admin")
    commissioner = auth(client, "commissioner")
    questionnaires = {q["code"]: q["id"] for q in client.get(f"{API}/questionnaires", headers=commissioner).json()}
    root = next(u for u in client.get(f"{API}/admin/units", headers=admin).json() if u["parent_id"] is None)
    r = client.post(
        f"{API}/campaigns",
        json={
            "title": "Хвиля 1",
            "unit_id": root["id"],
            "questionnaire_ids": [questionnaires["nazk-maturity-wg"], questionnaires["nazk-maturity-staff"]],
        },
        headers=admin,
    )
    assert r.status_code == 201, r.text
    campaign_id = r.json()["id"]
    assert r.json()["min_group_size"] == 5
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    return campaign_id, questionnaires


def full_answers(form: dict, pick: int = 0) -> list[dict]:
    return [
        {"question_id": q["id"], "option_ids": [q["options"][min(pick, len(q["options"]) - 1)]["id"]]}
        for s in form["sections"]
        for q in s["questions"]
    ]


def test_respondent_flow(client):
    campaign_id, questionnaires = open_campaign(client)
    staff = auth(client, "staff01")

    assignments = client.get(f"{API}/me/assignments", headers=staff).json()
    assert [a["questionnaire_id"] for a in assignments] == [questionnaires["nazk-maturity-staff"]]
    assert assignments[0]["submitted"] is False

    url = f"{API}/campaigns/{campaign_id}/questionnaires/{questionnaires['nazk-maturity-staff']}"
    form = client.get(f"{url}/form", headers=staff).json()
    option = form["sections"][0]["questions"][0]["options"][0]
    assert "score" not in option  # респондент не бачить балів

    answers = full_answers(form, pick=2)
    r = client.post(f"{url}/responses", json={"answers": answers[:-1]}, headers=staff)
    assert r.status_code == 422  # неповна анкета

    r = client.post(f"{url}/responses", json={"answers": answers}, headers=staff)
    assert r.status_code == 201, r.text
    assert client.post(f"{url}/responses", json={"answers": answers}, headers=staff).status_code == 409

    assert client.get(f"{API}/me/assignments", headers=staff).json()[0]["submitted"] is True

    progress = client.get(f"{API}/campaigns/{campaign_id}/progress", headers=auth(client, "admin")).json()
    by_q = {i["questionnaire_id"]: i for i in progress["items"]}
    assert by_q[questionnaires["nazk-maturity-staff"]]["eligible"] == 24
    assert by_q[questionnaires["nazk-maturity-staff"]]["submitted"] == 1
    assert by_q[questionnaires["nazk-maturity-wg"]]["eligible"] == 6


def test_wrong_category_and_bad_option(client):
    campaign_id, questionnaires = open_campaign(client)
    wg_url = f"{API}/campaigns/{campaign_id}/questionnaires/{questionnaires['nazk-maturity-wg']}"
    assert client.get(f"{wg_url}/form", headers=auth(client, "staff01")).status_code == 403

    wg = auth(client, "wg1")
    form = client.get(f"{wg_url}/form", headers=wg).json()
    answers = full_answers(form)
    staff_form = client.get(
        f"{API}/campaigns/{campaign_id}/questionnaires/{questionnaires['nazk-maturity-staff']}/form",
        headers=auth(client, "staff01"),
    ).json()
    answers[0]["option_ids"] = [staff_form["sections"][0]["questions"][0]["options"][0]["id"]]
    assert client.post(f"{wg_url}/responses", json={"answers": answers}, headers=wg).status_code == 422


def test_closed_campaign_rejects_answers(client):
    campaign_id, questionnaires = open_campaign(client)
    client.post(f"{API}/campaigns/{campaign_id}/close", headers=auth(client, "admin"))
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{questionnaires['nazk-maturity-staff']}"
    assert client.get(f"{url}/form", headers=auth(client, "staff01")).status_code == 409


def test_campaign_requires_published_questionnaire(client):
    commissioner = auth(client, "commissioner")
    draft = client.post(
        f"{API}/questionnaires",
        json={"code": "draft-only", "title": "Чернетка", "kind": "survey", "target_category": "staff"},
        headers=commissioner,
    ).json()
    admin = auth(client, "admin")
    root = next(u for u in client.get(f"{API}/admin/units", headers=admin).json() if u["parent_id"] is None)
    r = client.post(
        f"{API}/campaigns",
        json={"title": "Х", "unit_id": root["id"], "questionnaire_ids": [draft["id"]]},
        headers=admin,
    )
    assert r.status_code == 422


def test_storage_keeps_answers_anonymous(client):
    """Таблиці відповідей і буфера не містять ні користувача, ні часу, ні дати."""
    for table in ("responses", "response_pool"):
        columns = {c["name"] for c in inspect(engine).get_columns(table)}
        assert not columns & {"user_id", "created_at", "submitted_at", "submitted_on", "login"}

    campaign_id, questionnaires = open_campaign(client)
    staff = auth(client, "staff03")
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{questionnaires['nazk-maturity-staff']}"
    form = client.get(f"{url}/form", headers=staff).json()
    client.post(f"{url}/responses", json={"answers": full_answers(form)}, headers=staff)

    log = client.get(f"{API}/admin/audit-log", headers=auth(client, "admin")).json()
    assert all(e["entity"] not in {"response", "participation"} for e in log)
