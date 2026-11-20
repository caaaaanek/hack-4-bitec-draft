"""Виправлення за аудитом бекенду 18.11: склад хвилі, результати за посиланням, поріг питання,
участь без знаменника, трекер заходів, доступи."""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Question, QuestionType, RespondentCategory
from app.services import scoring
from tests.conftest import auth, create_person
from tests.helpers import API, ROOT, answer, close, full_wave, open_campaign, questionnaire_ids, results, units

STAFF = "nazk-maturity-staff"


def users_by_login(client, _=None) -> dict:
    return {u["login"]: u for u in client.get(f"{API}/admin/users", headers=auth(client, "coordinator")).json()}


# ---------- B4. Склад фіксується при відкритті ----------

def test_blocking_people_after_submission_does_not_inflate_participation(client):
    campaign_id, q, admin = open_campaign(client, (STAFF,))
    for i in range(1, 11):
        answer(client, campaign_id, q[STAFF], f"staff{i:02d}", lambda _: 2)
    before = client.get(f"{API}/campaigns/{campaign_id}/progress", headers=admin).json()["items"][0]
    users = users_by_login(client, admin)
    for i in range(11, 19):  # блокуємо тих, хто НЕ пройшов: раніше це піднімало участь
        r = client.patch(f"{API}/admin/users/{users[f'staff{i:02d}']['id']}", json={"is_active": False},
                         headers=auth(client, "coordinator"))
        assert r.status_code == 200, r.text
    after = client.get(f"{API}/campaigns/{campaign_id}/progress", headers=admin).json()["items"][0]
    assert after["eligible"] == before["eligible"] and after["percent"] == before["percent"]
    close(client, campaign_id, admin)
    group = results(client, campaign_id, admin)["groups"][0]
    assert group["eligible"] == before["eligible"] and group["participation_percent"] == before["percent"]
    assert "low_participation" in group["flags"]


def test_structural_user_changes_are_blocked_during_open_wave(client):
    campaign_id, q, admin = open_campaign(client, (STAFF,))
    u = units(client, admin)
    staff = users_by_login(client)["staff01"]
    co = auth(client, "coordinator")
    r = client.patch(f"{API}/admin/users/{staff['id']}", json={"unit_id": u["Підрозділ В"]}, headers=co)
    assert r.status_code == 409 and r.json()["code"] == "campaign_open"
    r = client.patch(f"{API}/admin/users/{staff['id']}", json={"category": "working_group"}, headers=co)
    assert r.status_code == 409
    # Блокування дозволено (людина пішла), і знаменник від цього не змінюється.
    assert client.patch(f"{API}/admin/users/{staff['id']}", json={"is_active": False}, headers=co).status_code == 200
    close(client, campaign_id, admin)
    assert client.patch(f"{API}/admin/users/{staff['id']}", json={"unit_id": u["Підрозділ В"]},
                        headers=co).status_code == 200


def test_user_created_after_opening_is_not_in_wave(client):
    campaign_id, q, admin = open_campaign(client, (STAFF,))
    root = units(client, admin)[ROOT]
    create_person(client, "late01", unit_id=root)
    late = auth(client, "late01")
    assert client.get(f"{API}/me/assignments", headers=late).json() == []
    r = client.get(f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}/form", headers=late)
    assert r.status_code == 403


def test_import_into_open_wave_adds_to_frozen_set(client):
    campaign_id, q, admin = open_campaign(client, (STAFF,))
    create_person(client, "late02", unit_id=units(client, admin)["Підрозділ А"])  # людей заводить техадмін
    csv = "login,category,unit\nlate02,staff,Підрозділ А\n".encode()
    r = client.post(f"{API}/campaigns/{campaign_id}/participants/import", files={"file": ("p.csv", csv, "text/csv")},
                    headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["created_users"] == 0 and r.json()["credentials"] == []
    late = auth(client, "late02")
    assert [a["questionnaire_id"] for a in client.get(f"{API}/me/assignments", headers=late).json()] == [q[STAFF]]


# ---------- B5. Результати для учасника за посиланням ----------

def test_token_participant_sees_generalized_results_after_close(client):
    admin = auth(client, "admin")
    q = questionnaire_ids(client, admin)
    u = units(client, admin)
    r = client.post(f"{API}/campaigns", json={"title": "Анонімна", "unit_id": u[ROOT], "questionnaire_ids": [q[STAFF]],
                                              "access_mode": "token"}, headers=admin)
    campaign_id = r.json()["id"]
    tokens = client.post(f"{API}/campaigns/{campaign_id}/tokens",
                         json={"questionnaire_id": q[STAFF], "unit_id": u["Підрозділ А"], "count": 7},
                         headers=admin).json()["tokens"]
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    for t in tokens:
        h = {"X-Response-Token": t["token"]}
        form = client.get(f"{API}/respond/form", headers=h).json()
        answers = [{"question_id": x["id"], "option_ids": [x["options"][min(2, len(x["options"]) - 1)]["id"]]}
                   for s in form["sections"] for x in s["questions"]]
        assert client.post(f"{API}/respond/responses", json={"answers": answers}, headers=h).status_code == 201

    h = {"X-Response-Token": tokens[0]["token"]}
    r = client.get(f"{API}/respond/results", headers=h)
    assert r.status_code == 409 and r.json()["code"] == "campaign_not_closed"
    close(client, campaign_id, admin)
    r = client.get(f"{API}/respond/results", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["campaign_id"] == campaign_id and body["institution"]["index"]["score"] is not None
    assert body["my_unit"]["unit_name"] == "Підрозділ А"
    assert "questions" not in body["institution"]  # лише узагальнене
    assert client.get(f"{API}/respond/results", headers={"X-Response-Token": "nope"}).status_code == 404


# ---------- B7. Поріг k на рівні питання, B12. Участь без знаменника ----------

def _questionnaire(required_second: bool):
    from app.models import Option, Questionnaire, QuestionnaireKind, Section

    qn = Questionnaire(code="t", version=1, title="t", kind=QuestionnaireKind.SURVEY,
                       target_category=RespondentCategory.STAFF)
    section = Section(position=1, title="К", component="culture")
    for pos in (1, 2):
        question = Question(id=uuid.uuid4(), position=pos, code=f"culture.q{pos}", text=f"q{pos}",
                            type=QuestionType.SINGLE_CHOICE, required=pos == 1 or required_second, weight=1.0)
        question.options = [Option(id=uuid.uuid4(), position=i, text=str(i), score=float(i)) for i in range(1, 6)]
        section.questions.append(question)
    qn.sections = [section]
    return qn


def test_question_answered_by_fewer_than_k_is_hidden():
    qn = _questionnaire(required_second=False)
    q1, q2 = qn.sections[0].questions
    responses = []
    for i in range(6):
        r = scoring.ResponseData()
        r.options[q1.id] = [q1.options[2].id]
        if i < 2:  # на необов'язкове питання відповіли двоє
            r.options[q2.id] = [q2.options[0].id]
        responses.append(r)
    out = scoring.score_group(scoring.GroupInput(questionnaire=qn, responses=responses, eligible=6, submitted=6), 5)
    assert [x["code"] for x in out["questions"]] == ["culture.q1"]
    assert out["hidden_questions"] == 1
    assert out["components"]["culture"] == 50.0  # лише q1


def test_no_low_participation_flag_without_denominator():
    qn = _questionnaire(required_second=True)
    out = scoring.score_group(scoring.GroupInput(questionnaire=qn, responses=[], eligible=0, submitted=0), 5)
    assert "low_participation" not in out["flags"]


# ---------- B6. k хвилі в дашборді ----------

def test_dashboard_risk_signals_use_wave_k(client):
    from tests.helpers import post_fact

    campaign_id, q, admin = open_campaign(client, (STAFF,), min_group_size=10)
    for i in range(1, 13):
        answer(client, campaign_id, q[STAFF], f"staff{i:02d}", lambda _: 2)
    root = units(client, admin)[ROOT]
    post_fact(client, root, "reports_handled", 5, 7)  # 7 < k хвилі = 10, але ≥ загального k = 5
    close(client, campaign_id, admin)
    signals = client.get(f"{API}/dashboard", params={"campaign_id": campaign_id}, headers=auth(client, "leader")).json()
    signal = next(s for s in signals["risk_signals"] if s["indicator"] == "reports_handled")
    assert signal["status"] == "too_few_people" and signal["found"] is None


# ---------- B11. Трекер заходів ----------

def _measure(client):
    full_wave(client)
    leader = auth(client, "leader")
    root = units(client, auth(client, "admin"))[ROOT]
    r = client.post(f"{API}/measures", json={"unit_id": root, "title": "Навчання для особового складу",
                                             "owner": "Антикорупційний уповноважений", "due_date": "2027-03-01"},
                    headers=leader)
    assert r.status_code == 201, r.text
    return r.json()["id"], leader


def test_measure_status_transitions_and_reasons(client):
    mid, leader = _measure(client)
    url = f"{API}/measures/{mid}"
    # Виконано лише з непорожнім доказом.
    assert client.patch(url, json={"status": "done", "evidence": "   "}, headers=leader).status_code == 422
    assert client.patch(url, json={"status": "done", "evidence": "Наказ №5"}, headers=leader).status_code == 200
    # Стерти доказ у виконаного не можна.
    assert client.patch(url, json={"evidence": ""}, headers=leader).status_code == 422
    # done → cancelled не дозволено, done → in_progress лише з причиною.
    r = client.patch(url, json={"status": "cancelled", "reason": "Не актуально"}, headers=leader)
    assert r.status_code == 409 and r.json()["code"] == "bad_transition"
    r = client.patch(url, json={"status": "in_progress"}, headers=leader)
    assert r.status_code == 422 and r.json()["code"] == "reason_required"
    r = client.patch(url, json={"status": "in_progress", "reason": "Доказ виявився неповним"}, headers=leader)
    assert r.status_code == 200 and r.json()["done_on"] is None
    # Скасування — з причиною; зі скасованого лише назад у план.
    assert client.patch(url, json={"status": "cancelled"}, headers=leader).status_code == 422
    assert client.patch(url, json={"status": "cancelled", "reason": "Замінено іншим заходом"}, headers=leader).status_code == 200
    assert client.patch(url, json={"status": "done", "reason": "так"}, headers=leader).status_code == 409
    assert client.patch(url, json={"status": "planned", "reason": "Повернули в план"}, headers=leader).status_code == 200
    log = client.get(f"{API}/admin/audit-log", params={"entity": "measure"}, headers=auth(client, "admin")).json()
    assert any(e["details"].get("reason") == "Доказ виявився неповним" and e["details"].get("from_status") == "done"
               for e in log)


def test_measure_owner_must_be_position_not_person(client):
    mid, leader = _measure(client)
    root = units(client, auth(client, "admin"))[ROOT]
    for owner in ("Іваненко І. І.", "І.І. Іваненко", "Petrenko P. P."):
        r = client.post(f"{API}/measures", json={"unit_id": root, "title": "Захід", "owner": owner,
                                                 "due_date": "2027-03-01"}, headers=leader)
        assert r.status_code == 422, owner
    assert client.patch(f"{API}/measures/{mid}", json={"owner": "Петренко П. П."}, headers=leader).status_code == 422
    assert client.patch(f"{API}/measures/{mid}", json={"owner": "Начальник відділу кадрів"},
                        headers=leader).status_code == 200


# ---------- P2. Доступи ----------

def test_working_group_outside_wave_cannot_see_checklist(client):
    admin = auth(client, "admin")
    u = units(client, admin)
    q = questionnaire_ids(client, admin)
    r = client.post(f"{API}/campaigns", json={"title": "Лише А", "unit_id": u["Підрозділ А"],
                                              "questionnaire_ids": [q["nazk-checklist"]]}, headers=admin)
    campaign_id = r.json()["id"]
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    # wg1 — у корені, а не в Підрозділі А.
    assert client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=auth(client, "wg1")).status_code == 403
    assert client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=auth(client, "auditor")).status_code == 200


def test_unit_leader_sees_only_own_subtree_in_units(client):
    names = {u["name"] for u in client.get(f"{API}/units", headers=auth(client, "leader_a")).json()}
    assert "Підрозділ А" in names and "Підрозділ Б" not in names and ROOT not in names
    everything = {u["name"] for u in client.get(f"{API}/units", headers=auth(client, "leader")).json()}
    assert ROOT in everything


# ---------- B10. Чек-лист з конструктора ----------

def test_constructor_checklist_items_get_section_component(client):
    commissioner = auth(client, "department")
    body = {"code": "other-checklist", "title": "Чек-лист іншого органу", "kind": "checklist",
            "target_category": "working_group", "sections": [
                {"title": "Процедури", "component": "system", "questions": [
                    {"code": "proc.1", "text": "Є процедура", "type": "single_choice",
                     "options": [{"text": "так", "score": 1}, {"text": "ні", "score": 0}]}]},
                {"title": "Інше", "component": "overall", "questions": [
                    {"code": "misc.1", "text": "Щось", "type": "single_choice",
                     "options": [{"text": "так", "score": 1}, {"text": "ні", "score": 0}]}]}]}
    r = client.post(f"{API}/questionnaires", json=body, headers=commissioner)
    assert r.status_code == 201, r.text
    qid = r.json()["id"]
    issues = client.get(f"{API}/questionnaires/{qid}/validate", headers=commissioner).json()
    assert len(issues) == 1 and "misc.1" in issues[0]["message"]
    from app.services import methodology as m
    assert m.item_component("proc.1", "system") == "system"
    assert m.item_component("checklist.4.2", "checklist_4") == "accountability"
    assert m.item_component("misc.1", "overall") is None
    with SessionLocal() as db:
        assert db.scalar(select(Question).where(Question.code == "proc.1")) is not None
