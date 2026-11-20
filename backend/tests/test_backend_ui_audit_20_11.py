"""Бекенд-пункти UI-аудиту з сервером 20.11 (integra-ui-audit-server.md, integra-zhyttievyi-tsykl-khvyli.md)."""

import uuid
from datetime import timedelta

from app.clock import today
from app.db import SessionLocal
from app.models import GeneratedReport
from tests.conftest import auth
from tests.helpers import API, ROOT, answer, full_wave, open_campaign, questionnaire_ids, units

STAFF = "nazk-maturity-staff"


def kinds(client, login) -> set[str]:
    return {n["kind"] for n in client.get(f"{API}/me/notifications", headers=auth(client, login)).json()}


# ---------- п. 7, 33: сповіщення й звіт після будь-якого відкриття та закриття ----------

def test_manual_open_and_close_notify_and_prepare_report(client):
    # Раніше сповіщення й Word-звіт робив лише автопілот: ручне закриття нікого не сповіщало.
    campaign_id, _, _ = full_wave(client)
    assert {"opened", "results"} <= kinds(client, "staff01")
    assert "recommendations" in kinds(client, "leader")
    with SessionLocal() as db:
        assert db.query(GeneratedReport).filter(GeneratedReport.campaign_id == uuid.UUID(campaign_id)).count() == 1
    # Події автопілота для хвилі без автопілота не пишуться.
    state = client.get(f"{API}/campaigns/{campaign_id}/autopilot", headers=auth(client, "admin")).json()
    assert state["events"] == []


def test_autopilot_open_via_approval_logs_open_and_notifies(client, setting):
    # Відкриття підтвердженням аудиту лишало журнал автопілота на «Чекає підтвердження», учасники не знали.
    setting(four_eyes_enabled=True)
    admin = auth(client, "admin")
    q = questionnaire_ids(client, admin)
    r = client.post(f"{API}/campaigns", json={"title": "Автопілот", "unit_id": units(client, admin)[ROOT],
                                              "questionnaire_ids": [q[STAFF]]}, headers=admin)
    campaign_id = r.json()["id"]
    url = f"{API}/campaigns/{campaign_id}/autopilot"
    plan = {"enabled": True, "planned_open_on": today().isoformat(),
            "planned_close_on": (today() + timedelta(days=14)).isoformat(), "remind_every_days": 1}
    assert client.put(url, json=plan, headers=admin).status_code == 200
    client.post(f"{API}/autopilot/tick", headers=admin)
    approval = next(a for a in client.get(f"{API}/admin/approvals", headers=auth(client, "auditor")).json()
                    if a["kind"] == "open_campaign" and a["status"] == "pending")
    assert client.post(f"{API}/admin/approvals/{approval['id']}/approve",
                       headers=auth(client, "auditor")).status_code == 200
    state = client.get(url, headers=admin).json()
    assert state["events"][0]["step"] == "open" and state["events"][0]["status"] == "ok"
    assert "підтвердження" in state["events"][0]["message"]
    assert "opened" in kinds(client, "staff01")
    note = next(n for n in client.get(f"{API}/me/notifications", headers=auth(client, "staff01")).json()
                if n["kind"] == "opened")
    assert " k " not in note["body"] and "не менше 5 осіб" in note["body"]
    # «кожні 1 день» → «щодня»
    assert any("щодня" in s for s in state["plan"]), state["plan"]


# ---------- п. 1, 2, 29: висновок звіту за Додатком Г, факти з балом, «Індекс доброчесності» ----------

def test_report_g_effective_and_attention_do_not_overlap():
    from app.services import report_g

    questions = [{"code": f"q{i}", "text": f"Питання {i}", "component": "culture", "score": s}
                 for i, s in enumerate((40.0, 45.5, 50.0), start=1)]
    report = {"index": {"score": 45.0, "reliability": "C", "level": {"level": 3}},
              "components": [], "questions": questions, "facts": []}
    c = report_g.conclusion(report)
    effective = {q["code"] for q in c["effective"]}
    attention = {q["code"] for q in c["attention"]}
    assert not effective & attention, (effective, attention)
    assert "Integrity Index" not in c["text"] and "індекс доброчесності" in c["text"]


def test_fact_label_shows_share_and_score(client):
    campaign_id, admin, _ = full_wave(client)
    facts = client.get(f"{API}/campaigns/{campaign_id}/results", headers=admin).json()["facts"]
    coi = next(f for f in facts if f["indicator"] == "coi_reviewed")
    # «бал 0» без частки читали як «0 справ»: у мітці тепер і «X з Y (%)», і бал.
    assert "(55%)" in coi["label"] and coi["label"].endswith(f"бал {coi['score']:g} з 100")


# ---------- п. 6, 10, 13: історія й доказ заходу, назва хвилі, імена в журналі ----------

def test_measure_card_has_history_evidence_and_wave(client):
    campaign_id, _, root = full_wave(client)
    leader = auth(client, "leader")
    due = (today() + timedelta(days=30)).isoformat()
    r = client.post(f"{API}/measures", headers=leader, json={
        "unit_id": root, "title": "Оновити порядок", "owner": "Уповноважений", "due_date": due,
        "campaign_id": campaign_id})
    measure_id = r.json()["id"]
    assert r.json()["campaign_title"] == "Хвиля 1"
    url = f"{API}/measures/{measure_id}"
    assert client.patch(url, json={"status": "in_progress"}, headers=leader).status_code == 200
    assert client.patch(url, json={"status": "done", "evidence": "Наказ № 51"}, headers=leader).status_code == 200
    card = client.get(url, headers=leader).json()
    assert card["evidence"] == "Наказ № 51" and card["done_on"]
    texts = [h["text"] for h in card["history"]]
    assert texts[0] == "Захід створено"
    assert "Статус: заплановано → в роботі" in texts[1]
    assert "Статус: в роботі → виконано" in texts[2] and "Доказ: Наказ № 51" in texts[2]
    assert all(h["actor"] for h in card["history"])
    # У списку історії немає (зайві запити), назва хвилі є.
    listed = client.get(f"{API}/measures", params={"campaign_id": campaign_id}, headers=leader).json()
    assert listed[0]["history"] is None and listed[0]["campaign_title"] == "Хвиля 1"


def test_audit_log_has_actor_names_for_auditor(client):
    full_wave(client)
    log = client.get(f"{API}/admin/audit-log", params={"entity": "campaign"}, headers=auth(client, "auditor")).json()
    opened = next(e for e in log if e["action"] == "open")
    assert opened["actor_name"] and opened["actor_role"] == "admin"


# ---------- п. 12: помилки валідації українською ----------

def test_validation_errors_in_ukrainian(client):
    # Конструктор: порожня анкета давала «String should have at least 1 character».
    r = client.post(f"{API}/questionnaires", headers=auth(client, "department"), json={
        "code": "t-empty", "title": "", "kind": "survey", "target_category": "staff",
        "sections": [{"title": "", "questions": []}]})
    assert r.status_code == 422, r.text
    body = r.json()
    texts = " ".join([body["message"]] + [e["message"] for e in body["errors"]])
    assert "should" not in texts and "String" not in texts, texts
    by_path = {e["path"]: e["message"] for e in body["errors"]}
    assert by_path.get("title") == "Заповніть поле", by_path
    r = client.get(f"{API}/admin/audit-log", params={"limit": 0}, headers=auth(client, "admin"))
    assert r.json()["errors"][0]["message"] == "Значення має бути не менше 1"


def test_mirror_question_has_no_method_hint_for_respondent(client):
    campaign_id, q, _ = open_campaign(client, (STAFF,))
    form = client.get(f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}/form",
                      headers=auth(client, "staff01")).json()
    texts = [x["help_text"] or "" for s in form["sections"] for x in s["questions"]]
    assert not any("Дзеркало" in t for t in texts)


# ---------- п. 3: розподіл рівнів дочірніх без campaign_id ----------

def test_children_levels_skips_newer_wave_without_child_data(client):
    from tests.helpers import close

    campaign_id, admin, root = full_wave(client)
    leader = auth(client, "leader")
    first = client.get(f"{API}/units/{root}/children-levels", headers=leader).json()
    # Нова тестова хвиля без відповідей (як «123123123» на стенді) закрита пізніше.
    empty_id, _, _ = open_campaign(client, (STAFF,), title="123123123")
    close(client, empty_id, admin)
    levels = client.get(f"{API}/units/{root}/children-levels", headers=leader).json()
    assert levels["campaign_id"] == first["campaign_id"] == campaign_id
    assert isinstance(levels["with_data"], int)
    explicit = client.get(f"{API}/units/{root}/children-levels", params={"campaign_id": empty_id}, headers=leader)
    assert explicit.json()["campaign_id"] == empty_id


# ---------- п. 25: той самий файл двічі в одному пункті ----------

def test_submit_rejects_same_file_twice_atomically(client):
    from tests.helpers import EVIDENCE_PDF, submit_item

    campaign_id, _, _ = open_campaign(client, ("nazk-checklist",))
    wg = auth(client, "wg1")
    item = client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=wg).json()["items"][0]["question_id"]
    assert submit_item(client, campaign_id, item, wg).status_code == 200
    # Повторне внесення з тим самим документом: 409, і нічого не змінено.
    r = client.post(f"{API}/campaigns/{campaign_id}/checklist/{item}/submit",
                    data={"status": "partial", "evidence": "інше"},
                    files=[("files", ("copy.pdf", EVIDENCE_PDF, "application/pdf"))], headers=wg)
    assert r.status_code == 409 and r.json()["code"] == "duplicate_file"
    files = client.get(f"{API}/campaigns/{campaign_id}/checklist/{item}/files", headers=wg).json()
    assert len(files) == 1
    row = next(i for i in client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=wg).json()["items"]
               if i["question_id"] == item)
    assert row["status"] == "full"
    # Два однакові файли в одному запиті — теж 409.
    r = client.post(f"{API}/campaigns/{campaign_id}/checklist/{item}/submit", data={"status": "full"},
                    files=[("files", ("x.txt", b"same", "text/plain")), ("files", ("y.txt", b"same", "text/plain"))],
                    headers=wg)
    assert r.status_code == 409


# ---------- п. 7, 9, 12, 26: урна — тексти, назва хвилі в респондента, сповіщення після закриття урною ----------

def test_urn_close_texts_title_and_notifications(client):
    from tests.conftest import user_ids

    campaign_id, q, admin = open_campaign(client, (STAFF,), open_it=False)
    ids = user_ids(client)
    holders = ["leader", "auditor", "staff24"]
    client.put(f"{API}/campaigns/{campaign_id}/urn", json={"holder_ids": [ids[h] for h in holders]}, headers=admin)
    shares = {h: client.get(f"{API}/campaigns/{campaign_id}/urn/my-share", headers=auth(client, h)).json()["share"]
              for h in holders}
    status = client.get(f"{API}/campaigns/{campaign_id}/urn", headers=auth(client, "staff24")).json()
    assert status["campaign_title"] == "Хвиля 1" and status["campaign_status"] == "draft"
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    for i in range(1, 7):
        answer(client, campaign_id, q[STAFF], f"staff{i:02d}", lambda _: 2)
    r = client.post(f"{API}/campaigns/{campaign_id}/close", headers=admin)
    assert r.status_code == 409 and "POST" not in r.json()["hint"] and "«Урна»" in r.json()["hint"]
    for h in ("auditor", "staff24"):
        client.post(f"{API}/campaigns/{campaign_id}/urn/shares", json={"share": shares[h]}, headers=auth(client, h))
    assert client.get(f"{API}/campaigns/{campaign_id}/urn", headers=admin).json()["campaign_status"] == "closed"
    # Закриття урною тепер сповіщає так само, як автопілот.
    assert "results" in kinds(client, "staff01")
    assert "recommendations" in kinds(client, "leader")


def test_assignments_for_wave_without_checklist_is_empty(client):
    campaign_id, _, admin = open_campaign(client, (STAFF,))
    r = client.get(f"{API}/campaigns/{campaign_id}/checklist/assignments", headers=admin)
    assert r.status_code == 200 and r.json() == []
