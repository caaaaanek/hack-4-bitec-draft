"""Нові модулі 18.11: ескалація координатора, «Адвокат диявола», агент-черговий, нормативка,
флешкартки й охоплення навчанням, автопілот хвилі, сповіщення."""

import io
from datetime import timedelta

from docx import Document

from app.clock import frozen_on, today
from tests.conftest import auth
from tests.helpers import API, ROOT, answer, full_wave, open_campaign, questionnaire_ids, units

STAFF = "nazk-maturity-staff"


def users_by_login(client, headers) -> dict:
    return {u["login"]: u for u in client.get(f"{API}/admin/users", headers=headers).json()}


# ---------- Координатор не може стати адміністратором ----------

def test_coordinator_cannot_escalate(client):
    co = auth(client, "coordinator")
    users = users_by_login(client, co)
    body = {"login": "evil", "display_name": "x", "password": "password123", "role": "admin"}
    assert client.post(f"{API}/admin/users", json=body, headers=co).status_code == 403
    assert client.post(f"{API}/admin/users", json={**body, "role": "coordinator"}, headers=co).status_code == 403
    assert client.patch(f"{API}/admin/users/{users['admin']['id']}", json={"password": "hijacked123"},
                        headers=co).status_code == 403
    assert client.patch(f"{API}/admin/users/{users['admin']['id']}", json={"is_active": False}, headers=co).status_code == 403
    assert client.patch(f"{API}/admin/users/{users['auditor']['id']}", json={"role": "admin"}, headers=co).status_code == 403
    assert client.patch(f"{API}/admin/users/{users['coordinator']['id']}", json={"role": "admin"},
                        headers=co).status_code in (403, 422)  # власну роль не змінити
    # Звичайна робота координатора лишається: респонденти, керівники, власний пароль.
    r = client.post(f"{API}/admin/users", json={"login": "new_staff", "display_name": "Новий", "password": "password123",
                                                "role": "respondent", "category": "staff"}, headers=co)
    assert r.status_code == 201, r.text
    assert client.patch(f"{API}/admin/users/{users['leader']['id']}", json={"display_name": "Керівник"},
                        headers=co).status_code == 200
    assert client.patch(f"{API}/admin/users/{users['coordinator']['id']}", json={"password": "newpassword123"},
                        headers=co).status_code == 200
    # Адміністратор може все.
    admin = auth(client, "admin")
    assert client.patch(f"{API}/admin/users/{users['auditor']['id']}", json={"role": "coordinator"},
                        headers=admin).status_code == 200


# ---------- «Адвокат диявола» ----------

def test_devils_advocate_questions_point_to_numbers(client):
    campaign_id, admin, root = full_wave(client)
    leader = auth(client, "leader")
    r = client.get(f"{API}/campaigns/{campaign_id}/devils-advocate", headers=leader)
    assert r.status_code == 200, r.text
    data = r.json()
    assert 0 < len(data["questions"]) <= 10 and data["rephrased_by_model"] is None
    rules = {q["rule_id"] for q in data["questions"]}
    assert "cut_by_facts" in rules  # Підзвітність зрізається фактами в прикладі ТЗ
    for q in data["questions"]:
        assert q["evidence"] and q["why"] and q["prepare"]
        assert all(e["path"] for e in q["evidence"])
    assert [q["severity"] for q in data["questions"]] == sorted((q["severity"] for q in data["questions"]), reverse=True)
    # Детерміновано: той самий вхід — ті самі питання.
    again = client.get(f"{API}/campaigns/{campaign_id}/devils-advocate", headers=leader).json()
    assert [q["id"] for q in again["questions"]] == [q["id"] for q in data["questions"]]
    assert {r["id"] for r in data["rules"]} >= rules
    assert len(client.get(f"{API}/campaigns/{campaign_id}/devils-advocate", params={"limit": 3},
                          headers=leader).json()["questions"]) <= 3
    # Без моделі перефразування нічого не ламає.
    assert client.get(f"{API}/campaigns/{campaign_id}/devils-advocate", params={"rephrase": "true"},
                      headers=leader).json()["rephrased_by_model"] is None
    assert client.get(f"{API}/campaigns/{campaign_id}/devils-advocate", headers=auth(client, "staff01")).status_code == 403


def test_devils_advocate_needs_closed_wave(client):
    campaign_id, _, admin = open_campaign(client, (STAFF,))
    assert client.get(f"{API}/campaigns/{campaign_id}/devils-advocate", headers=admin).status_code == 409


def test_rephrase_keeps_numbers(monkeypatch):
    from app.routers import insights, llm
    q = {"id": "low_fact:x", "question": "Розібрано 40 з 100. Чому?", "why": "правило",
         "evidence": [{"text": "40 з 100"}]}
    monkeypatch.setattr(llm, "endpoint", lambda: ("http://localhost:11434/v1", "", "local-model"))
    monkeypatch.setattr(llm, "chat", lambda *a: '{"low_fact:x": "Лише 40 зі 100 розібрано — де решта 60?"}')
    original = dict(q)
    assert insights.rephrase([q]) is None  # «60» — нове число: лишається оригінал
    assert q["question"] == original["question"]
    monkeypatch.setattr(llm, "chat", lambda *a: '{"low_fact:x": "Лише 40 зі 100 розібрано. Хто відповідає?"}')
    assert insights.rephrase([q]) == "local-model"
    assert q["original_question"] == original["question"] and "Хто відповідає" in q["question"]


# ---------- Агент-черговий ----------

def test_digest_explains_drop_by_sources(client):
    full_wave(client, title="Хвиля 1", staff_pick=-1)  # високі відповіді ОС
    full_wave(client, title="Хвиля 2", staff_pick=0)   # низькі відповіді ОС
    admin = auth(client, "admin")
    r = client.get(f"{API}/agent/digest", headers=admin)
    assert r.status_code == 200, r.text
    data = r.json()
    drops = [i for i in data["items"] if i["category"] == "drop" and i["id"].startswith("drop:") and i["id"] != "drop:none"]
    assert drops, data["items"]
    d = drops[0]
    assert d["severity"] in ("warning", "critical") and d["fix"] and d["why"]
    staff = [p for p in d["data"]["contributions"] if p["source"] == "staff"][0]
    assert staff["contribution"] < 0  # падіння пояснено внеском особового складу
    assert data["status"] in ("attention", "critical")
    assert any(i["category"] == "technical" for i in data["items"])  # адмін бачить технічні пункти
    leader = client.get(f"{API}/agent/digest", headers=auth(client, "leader")).json()
    assert not any(i["category"] == "technical" for i in leader["items"])
    assert client.get(f"{API}/agent/digest", headers=auth(client, "staff01")).status_code == 403


# ---------- Нормативка ----------

COI_TEXT = """Наказ (синтетичний)

1. Антикорупційному уповноваженому забезпечити розгляд повідомлень про потенційний конфлікт інтересів
працівників і своєчасне врегулювання конфлікту інтересів.

2. Створити захищені канали для повідомлень викривачів, у тому числі анонімні."""


def test_normative_finds_affected_checklist_items(client):
    leader = auth(client, "leader")
    r = client.post(f"{API}/normative/analyze", data={"text": COI_TEXT, "title": "Наказ"}, headers=leader)
    assert r.status_code == 200, r.text
    data = r.json()
    refs = {m["ref"] for m in data["matches"]}
    assert {"checklist.4.1.1", "checklist.4.1.2"} & refs
    assert any(m["kind"] == "question" and "whistle" in m["ref"] for m in data["matches"])
    top = data["matches"][0]
    assert top["matched_terms"] and top["fragment"] and 0 < top["score"] <= 1
    assert r.json() == client.post(f"{API}/normative/analyze", data={"text": COI_TEXT, "title": "Наказ"},
                                   headers=leader).json()  # детерміновано


def test_normative_reads_docx_and_validates(client):
    doc = Document()
    for line in COI_TEXT.split("\n\n"):
        doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    admin = auth(client, "admin")
    files = {"file": ("nakaz.docx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    r = client.post(f"{API}/normative/analyze", files=files, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["document"]["name"] == "nakaz.docx" and r.json()["matches"]
    assert client.post(f"{API}/normative/analyze", data={"text": "коротко"}, headers=admin).status_code == 422
    assert client.post(f"{API}/normative/analyze", data={}, headers=admin).status_code == 422
    assert client.post(f"{API}/normative/analyze", data={"text": COI_TEXT},
                       headers=auth(client, "staff01")).status_code == 403
    log = client.get(f"{API}/admin/audit-log", params={"entity": "normative"}, headers=admin).json()
    entries = log["items"] if isinstance(log, dict) else log
    assert entries and "sha256" in entries[0]["details"] and COI_TEXT[:20] not in str(entries[0]["details"])


# ---------- Флешкартки й охоплення навчанням ----------

def complete_all(client, headers, codes):
    for code in codes:
        deck = client.get(f"{API}/learning/decks/{code}", headers=headers).json()
        r = client.post(f"{API}/learning/decks/{code}/complete", json={"seen": [c["id"] for c in deck["cards"]]},
                        headers=headers)
        assert r.status_code == 200, r.text
    return r.json()


def test_flashcards_completion_and_coverage(client):
    staff = auth(client, "staff01")
    decks = client.get(f"{API}/learning/decks", headers=staff).json()
    assert decks["required"] and not decks["i_am_trained"]
    deck = client.get(f"{API}/learning/decks/coi", headers=staff).json()
    assert deck["cards"] and all(c["steps"] for c in deck["cards"])
    r = client.post(f"{API}/learning/decks/coi/complete", json={"seen": [deck["cards"][0]["id"]]}, headers=staff)
    assert r.status_code == 422  # не всі картки переглянуто
    assert client.get(f"{API}/learning/decks/nope", headers=staff).status_code == 404

    assert complete_all(client, staff, decks["required"])["i_am_trained"] is True
    mine = client.get(f"{API}/learning/decks", headers=staff).json()
    assert mine["i_am_trained"] and all(d["my_valid"] for d in mine["decks"] if d["required"])

    admin = auth(client, "admin")
    u = units(client, admin)
    small = client.get(f"{API}/learning/stats", params={"unit_id": u["Підрозділ А-1"]}, headers=admin).json()
    assert small["suppressed"] and small["trained"] is None and small["eligible"] is None  # 4 людини < k
    for login in ("staff02", "staff03", "wg1", "wg2"):
        complete_all(client, auth(client, login), decks["required"])
    whole = client.get(f"{API}/learning/stats", headers=admin).json()
    assert not whole["suppressed"] and whole["trained"] == 5 and whole["eligible"] == 30
    assert client.get(f"{API}/learning/stats", headers=staff).status_code == 403

    pub = client.post(f"{API}/learning/publish", json={}, headers=admin)
    assert pub.status_code == 200, pub.text
    assert pub.json()["numerator"] == 5 and pub.json()["denominator"] == 30
    facts = client.get(f"{API}/units/{u[ROOT]}/indicators", params={"months": 3,
                       "end": (today() + timedelta(days=0)).isoformat()}, headers=admin).json()
    assert isinstance(facts, list)  # поточний квартал ще не завершено — показник з'явиться після нього
    from app.db import SessionLocal
    from app.models import Indicator
    with SessionLocal() as db:
        rows = db.query(Indicator).filter(Indicator.indicator == "training_coverage").all()
        assert rows and {r.source for r in rows} == {"learning"} and sum(r.numerator for r in rows) == 5


# ---------- Автопілот ----------

def test_autopilot_full_cycle(client):
    admin = auth(client, "admin")
    q = questionnaire_ids(client, admin)
    root = units(client, admin)[ROOT]
    r = client.post(f"{API}/campaigns", json={"title": "Автопілот", "unit_id": root, "questionnaire_ids": [q[STAFF]]},
                    headers=admin)
    campaign_id = r.json()["id"]
    url = f"{API}/campaigns/{campaign_id}/autopilot"
    assert client.put(url, json={"enabled": True}, headers=admin).status_code == 422  # немає умови закриття
    plan = {"enabled": True, "planned_open_on": today().isoformat(),
            "planned_close_on": (today() + timedelta(days=14)).isoformat(), "close_at_percent": 40,
            "remind_every_days": 3}
    r = client.put(url, json=plan, headers=admin)
    assert r.status_code == 200, r.text
    assert any("Відкриє" in s for s in r.json()["plan"])
    assert client.put(url, json=plan, headers=auth(client, "coordinator")).status_code == 403

    events = client.post(f"{API}/autopilot/tick", headers=admin).json()["events"]
    assert any(e["step"] == "open" and e["status"] == "ok" for e in events)
    assert client.get(f"{API}/campaigns/{campaign_id}", headers=admin).json()["status"] == "open"
    notes = client.get(f"{API}/me/notifications", headers=auth(client, "staff01")).json()
    assert any(n["kind"] == "opened" for n in notes)

    # Нагадування через 3 дні — усім учасникам.
    with frozen_on(today() + timedelta(days=3)):
        events = client.post(f"{API}/autopilot/tick", headers=admin).json()["events"]
        assert any(e["step"] == "reminder" for e in events)
        again = client.post(f"{API}/autopilot/tick", headers=admin).json()["events"]
        assert not any(e["step"] == "reminder" for e in again)  # не частіше ніж раз на 3 дні

    # Участь 40%: 10 з 24 → автопілот закриває раніше строку.
    for i in range(1, 11):
        answer(client, campaign_id, q[STAFF], f"staff{i:02d}", lambda _: 2)
    events = client.post(f"{API}/autopilot/tick", headers=admin).json()["events"]
    steps = {e["step"]: e["status"] for e in events if e["campaign_id"] == campaign_id}
    assert steps["close"] == "ok" and steps["report"] == "ok" and steps["recommendations"] == "ok"
    assert steps["theme2"] == "skipped"
    assert client.get(f"{API}/campaigns/{campaign_id}", headers=admin).json()["status"] == "closed"

    state = client.get(url, headers=admin).json()
    assert state["report_ready"] and [e["step"] for e in state["events"]][:1]
    report = client.get(f"{API}/campaigns/{campaign_id}/autopilot/report", headers=auth(client, "leader"))
    assert report.status_code == 200 and report.content[:2] == b"PK"
    # Рекомендації не прийнято автоматично.
    recs = client.get(f"{API}/campaigns/{campaign_id}/recommendations", headers=auth(client, "leader")).json()
    items = recs["items"] if isinstance(recs, dict) else recs
    assert all(not r.get("decision") for r in items)
    leader_notes = client.get(f"{API}/me/notifications", headers=auth(client, "leader")).json()
    assert any(n["kind"] == "recommendations" for n in leader_notes)
    staff_notes = client.get(f"{API}/me/notifications", headers=auth(client, "staff01")).json()
    assert any(n["kind"] == "results" for n in staff_notes)
    assert not any(n["audience"] == "leaders" for n in staff_notes)
    # Журнал дій: відкриття й закриття від імені системи.
    log = client.get(f"{API}/admin/audit-log", params={"entity": "campaign"}, headers=admin).json()
    entries = log["items"] if isinstance(log, dict) else log
    assert any(e["action"] == "close" and e["details"].get("via") == "autopilot" for e in entries)


def test_autopilot_daily_publishes_learning_and_digest(client):
    admin = auth(client, "admin")
    events = client.post(f"{API}/autopilot/tick", headers=admin).json()["events"]
    assert any(e["step"] == "daily" and e["status"] == "ok" for e in events)
    assert not any(e["step"] == "daily" for e in client.post(f"{API}/autopilot/tick", headers=admin).json()["events"])


def test_closed_wave_rejects_autopilot(client):
    campaign_id, admin, _ = full_wave(client)
    r = client.put(f"{API}/campaigns/{campaign_id}/autopilot",
                   json={"enabled": True, "planned_close_on": today().isoformat()}, headers=admin)
    assert r.status_code == 409



# ---------- Джерела: факти з модулів системи ----------

def test_seed_facts_come_from_system_modules(client):
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import CheckFinding, Indicator, TrainingCompletion, Unit
    from app.seed import seed

    with SessionLocal() as db:
        units = {u.name: u for u in db.scalars(select(Unit))}
        seed.seed_indicators(db, units, months=12)
        db.commit()
        sources = dict(db.execute(select(Indicator.indicator, func.min(Indicator.source)).group_by(Indicator.indicator)).all())
        assert sources["declarations_on_time"] == sources["coi_reviewed"] == "checks"
        assert sources["training_coverage"] == "learning"
        assert sources["reports_handled"] == "reports"
        assert db.scalar(select(func.count()).select_from(CheckFinding).where(CheckFinding.status == "reviewed"))
        assert db.scalar(select(func.count()).select_from(TrainingCompletion))
        # Числа декларацій ті самі, що й у шаблоні: 24 з 25 за місяць на підрозділ.
        row = db.scalars(select(Indicator).where(Indicator.indicator == "declarations_on_time")).first()
        assert (row.numerator, row.denominator) in {(24, 25), (22, 25), (23, 25)}
        before = db.scalar(select(func.count()).select_from(CheckFinding))
        seed.seed_indicators(db, units, months=12)  # повторний запуск нічого не дублює
        assert db.scalar(select(func.count()).select_from(CheckFinding)) == before
