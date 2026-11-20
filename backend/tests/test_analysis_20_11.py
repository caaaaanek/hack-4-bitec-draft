"""Зміни за аналізом 20.11 (docs/analysis-20-11.md): довідники, відповідальні за пункти, ролі, захист від
колективного покарання, принципи безпеки, детектор відвертості, урна, квитанції, детектор Гудхарта, лотерея."""

import io
import uuid

import pytest

from app.config import get_settings
from app.db import SessionLocal
from app.models import AuditLog, ResponsePool
from app.services import ballots, candor, goodhart, scoring, urn
from tests.conftest import auth, create_person
from tests.helpers import (
    ALL, API, ROOT, answer, clamp, close, fill_checklist, full_wave, open_campaign, questionnaire_ids, results, submit_item,
    units,
)

STAFF = "nazk-maturity-staff"
WG = "nazk-maturity-wg"


def user_id(client, login):
    co = auth(client, "coordinator")
    return next(u["id"] for u in client.get(f"{API}/admin/users", headers=co).json() if u["login"] == login)


@pytest.fixture()
def setting(monkeypatch):
    def apply(**values):
        for key, value in values.items():
            monkeypatch.setattr(get_settings(), key, value)
    return apply


# ---------- Довідники ----------

def test_custom_category_without_weight_is_compared_but_not_in_index(client):
    admin, commissioner, co = auth(client, "admin"), auth(client, "department"), auth(client, "coordinator")
    assert client.post(f"{API}/dictionaries/categories", json={"code": "cadet", "title": "Курсанти"},
                       headers=admin).status_code == 403  # довідники людей — не уповноваженого
    r = client.post(f"{API}/dictionaries/categories", json={"code": "cadet", "title": "Курсанти"}, headers=co)
    assert r.status_code == 201 and r.json()["in_index"] is False
    assert client.post(f"{API}/dictionaries/categories", json={"code": "cadet", "title": "X"},
                       headers=co).status_code == 409
    # Департамент довідник категорій лише читає (рішення 20.11).
    assert client.post(f"{API}/dictionaries/categories", json={"code": "cadet2", "title": "X"},
                       headers=commissioner).status_code == 403
    codes = {c["code"] for c in client.get(f"{API}/dictionaries/categories", headers=auth(client, "staff01")).json()}
    assert {"working_group", "staff", "expert", "cadet"} <= codes
    # Невідому категорію не призначити.
    r = client.post(f"{API}/admin/users", headers=co, json={
        "login": "xx1", "display_name": "X", "role": "respondent", "category": "nope"})
    assert r.status_code == 422 and r.json()["code"] == "unknown_category"
    unit = units(client, admin)["Підрозділ А"]
    for i in range(5):
        create_person(client, f"cadet{i}", category="cadet", unit_id=unit, password="long-password-1")
    staff = client.get(f"{API}/questionnaires/{questionnaire_ids(client, admin)[STAFF]}", headers=commissioner).json()
    body = {"code": "cadet-survey", "title": "Анкета курсантів", "kind": "survey", "target_category": "cadet",
            "sections": [{"title": s["title"], "component": s["component"],
                          "questions": [{k: q[k] for k in ("code", "text", "type", "required", "weight", "params")}
                                        | {"options": [{"text": o["text"], "score": o["score"]} for o in q["options"]]}
                                        for q in s["questions"]]}
                         for s in staff["sections"] if s["component"] != "candor"]}
    r = client.post(f"{API}/questionnaires", json=body, headers=commissioner)
    assert r.status_code == 201, r.text
    assert client.post(f"{API}/questionnaires/{r.json()['id']}/publish", headers=commissioner).status_code == 200
    campaign_id, q, admin = open_campaign(client, (STAFF, "cadet-survey"))
    for i in range(1, 7):
        answer(client, campaign_id, q[STAFF], f"staff{i:02d}", lambda _: 2)
    for i in range(5):
        r = client.post(f"{API}/auth/login", data={"username": f"cadet{i}", "password": "long-password-1"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        url = f"{API}/campaigns/{campaign_id}/questionnaires/{q['cadet-survey']}"
        form = client.get(f"{url}/form", headers=h).json()
        ans = [{"question_id": x["id"], "option_ids": [x["options"][-1]["id"]]} for s in form["sections"] for x in s["questions"]]
        assert client.post(f"{url}/responses", json={"answers": ans}, headers=h).status_code == 201
    close(client, campaign_id, admin)
    data = results(client, campaign_id, admin)
    assert any(g["category"] == "cadet" and g["sufficient"] for g in data["groups"])
    assert data["index"]["score"] == 50.0  # лише особовий склад (рівень 3); курсанти без ваги
    # З вагою курсанти стають джерелом самооцінки (перерахунок за поточною методикою).
    assert client.patch(f"{API}/dictionaries/categories/cadet", json={"weight": 0.2}, headers=co).status_code == 200
    again = results(client, campaign_id, admin, recalculate=True)
    assert again["index"]["score"] > 50.0
    assert any(s["source"] == "cadet" for s in again["components"][0]["sources"])
    assert client.patch(f"{API}/dictionaries/categories/staff", json={"weight": 0.5}, headers=co).status_code == 409


def test_positions_and_facts_dictionaries(client):
    admin, co = auth(client, "admin"), auth(client, "coordinator")
    titles = [p["title"] for p in client.get(f"{API}/dictionaries/positions", headers=auth(client, "leader")).json()]
    assert "Начальник служби закупівель" in titles
    assert client.post(f"{API}/dictionaries/positions", json={"title": "Шевченко Т. Г."},
                       headers=co).json()["code"] == "person_name"
    assert client.post(f"{API}/dictionaries/positions", json={"title": "Начальник служби безпеки"},
                       headers=co).status_code == 201
    assert client.post(f"{API}/dictionaries/positions", json={"title": "Начальник відділу кадрів 2"},
                       headers=admin).status_code == 403
    fact = {"code": "gifts_registered", "title": "Подарунки задекларовано вчасно", "component": "culture",
            "thresholds": [60, 75, 90, 98]}
    assert client.post(f"{API}/dictionaries/facts", json={**fact, "thresholds": [90, 80, 70, 60]},
                       headers=admin).status_code == 422
    assert client.post(f"{API}/dictionaries/facts", json=fact, headers=co).status_code == 403  # факти — методика
    assert client.post(f"{API}/dictionaries/facts", json=fact, headers=admin).status_code == 201
    root = units(client, admin)[ROOT]
    r = client.post(f"{API}/indicators", json={"unit_id": root, "period": "2026-01", "indicator": "gifts_registered",
                                               "numerator": 9, "denominator": 10, "source": "test"},
                    headers={"X-Integration-Key": "test-integration-key"})
    assert r.status_code == 201, r.text
    assert "gifts_registered" in client.get(f"{API}/methodology", headers=admin).json()["facts"]
    r = client.post(f"{API}/indicators", json={"unit_id": root, "period": "2026-01", "indicator": "unknown_fact",
                                               "numerator": 1, "denominator": 1, "source": "test"},
                    headers={"X-Integration-Key": "test-integration-key"})
    assert r.status_code == 422


# ---------- Чек-лист: відповідальні ----------

def test_checklist_assignment_enterer_and_auditor_confirmer(client):
    campaign_id, q, admin = open_campaign(client, ("nazk-checklist", STAFF))
    items = client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=auth(client, "wg1")).json()["items"]
    item = items[0]["question_id"]
    people = {p["login"]: p["id"] for p in client.get(f"{API}/campaigns/{campaign_id}/people", headers=admin).json()}
    wg2, auditor = people["wg2"], people["auditor"]
    assert "coordinator" not in people and "department" not in people
    bad = client.put(f"{API}/campaigns/{campaign_id}/checklist/assignments",
                     json={"items": [{"question_id": item, "enterer_id": wg2, "confirmer_id": wg2}]}, headers=admin)
    assert bad.status_code == 422
    r = client.put(f"{API}/campaigns/{campaign_id}/checklist/assignments",
                   json={"items": [{"question_id": item, "enterer_id": wg2, "confirmer_id": auditor}]},
                   headers=admin)
    assert r.status_code == 200 and r.json()[0]["enterer"] == "Член робочої групи 2"
    body = {"status": "full", "evidence": "Наказ"}
    r = client.put(f"{API}/campaigns/{campaign_id}/checklist/{item}", json=body, headers=auth(client, "wg1"))
    assert r.status_code == 403 and r.json()["code"] == "not_assigned"
    assert submit_item(client, campaign_id, item, auth(client, "wg2")).status_code == 200
    r = client.post(f"{API}/campaigns/{campaign_id}/checklist/{item}/confirm", headers=auth(client, "department"))
    assert r.status_code == 403
    r = client.post(f"{API}/campaigns/{campaign_id}/checklist/{item}/confirm", headers=auth(client, "auditor"))
    assert r.status_code == 200 and r.json()["confirmed"] and r.json()["confirmer_id"] == auditor
    # Пункт без призначення: вносить будь-хто з РГ, підтверджує й аудит.
    other = items[1]["question_id"]
    assert submit_item(client, campaign_id, other, auth(client, "wg1")).status_code == 200
    assert client.post(f"{API}/campaigns/{campaign_id}/checklist/{other}/confirm",
                       headers=auth(client, "auditor")).status_code == 200


# ---------- Ролі, колективне покарання ----------

def test_department_and_leader_see_no_child_details(client):
    campaign_id, admin, root = full_wave(client)
    child = units(client, admin)["Підрозділ А"]
    dept = auth(client, "department")
    inst = client.get(f"{API}/department/institutions", headers=dept).json()
    assert [i["name"] for i in inst] == [ROOT] and "index" not in inst[0]
    detail = client.get(f"{API}/department/institutions/{root}", headers=dept).json()
    assert detail["latest"]["index"]["score"] is not None and "Рейтингу" in detail["note"]
    assert client.get(f"{API}/dashboard", headers=dept).json()["code"] == "unit_required"
    assert client.get(f"{API}/campaigns/{campaign_id}/results", params={"unit_id": child},
                      headers=dept).status_code == 403
    leader = auth(client, "leader")
    assert client.get(f"{API}/campaigns/{campaign_id}/results", headers=leader).status_code == 200
    assert client.get(f"{API}/campaigns/{campaign_id}/results", params={"unit_id": child},
                      headers=leader).status_code == 403
    assert client.get(f"{API}/units/{child}/history", headers=leader).status_code == 403
    levels = client.get(f"{API}/units/{root}/children-levels", headers=leader).json()
    assert "names" not in str(levels) and levels["children_total"] == 6
    assert levels["hidden"] or sum(levels["levels"].values()) == levels["with_data"]
    # Адміністратор бачить дочірній підрозділ, але перегляд записується для аудиту.
    assert client.get(f"{API}/campaigns/{campaign_id}/results", params={"unit_id": child},
                      headers=admin).status_code == 200
    report = client.get(f"{API}/admin/result-views", headers=auth(client, "auditor")).json()
    assert report["by_actor"][0]["login"] == "admin" and report["by_actor"][0]["units"] == ["Підрозділ А"]
    # Керівник підрозділу бачить свій підрозділ.
    assert client.get(f"{API}/campaigns/{campaign_id}/results", params={"unit_id": child},
                      headers=auth(client, "leader_a")).status_code == 200


def test_tech_admin_is_separate(client):
    body = {"login": "newbie", "display_name": "Новий", "role": "leader"}
    assert client.post(f"{API}/admin/users", json=body, headers=auth(client, "admin")).status_code == 403
    assert client.post(f"{API}/admin/users", json=body, headers=auth(client, "coordinator")).status_code == 201
    # Технічний адміністратор результатів не бачить.
    assert client.get(f"{API}/dashboard", headers=auth(client, "coordinator")).status_code == 403
    assert client.get(f"{API}/config").json()["policies"]["separate_tech_admin"] is True


# ---------- Облікові записи: запрошення, дві особи ----------

def test_invite_password_set_by_person(client):
    co = auth(client, "coordinator")
    r = client.post(f"{API}/admin/users", headers=co, json={"login": "invited", "display_name": "Запрошений",
                                                            "role": "leader"})
    assert r.status_code == 201 and r.json()["invite_link"].count("/invite/") == 1
    token = r.json()["invite_link"].rsplit("/", 1)[1]
    assert client.post(f"{API}/auth/login", data={"username": "invited", "password": "whatever-123"}).status_code == 401
    assert client.post(f"{API}/auth/invite", json={"token": "x" * 20, "password": "my-own-pass-1"}).status_code == 404
    assert client.post(f"{API}/auth/invite", json={"token": token, "password": "my-own-pass-1"}).status_code == 204
    assert client.post(f"{API}/auth/invite", json={"token": token, "password": "my-own-pass-2"}).status_code == 404
    assert client.post(f"{API}/auth/login", data={"username": "invited", "password": "my-own-pass-1"}).status_code == 200
    # Пароля адміністратор не задає взагалі.
    r = client.post(f"{API}/admin/users", headers=co, json={"login": "pw1", "display_name": "П",
                                                            "password": "long-password-1", "role": "leader"})
    assert r.status_code == 422
    uid = user_id(client, "invited")
    assert client.patch(f"{API}/admin/users/{uid}", json={"password": "long-password-9"}, headers=co).status_code == 422
    # Скидання — новим запрошенням: старий пароль більше не діє.
    assert client.post(f"{API}/admin/users/{uid}/invite", headers=co).status_code == 201
    assert client.post(f"{API}/auth/login", data={"username": "invited", "password": "my-own-pass-1"}).status_code == 401


def test_four_eyes_matrix(client, setting):
    setting(four_eyes_enabled=True)
    admin, co, auditor = auth(client, "admin"), auth(client, "coordinator"), auth(client, "auditor")
    # Новий обліковий запис просить техадмін, підтверджує уповноважений (не техадмін і не аудит).
    r = client.post(f"{API}/admin/users", headers=co, json={"login": "boss", "display_name": "Б", "role": "auditor"})
    assert r.status_code == 201 and r.json()["is_active"] is False
    approval = r.json()["pending_approval_id"]
    r = client.post(f"{API}/admin/approvals/{approval}/approve", headers=co)
    assert r.status_code == 403 and r.json()["code"] == "same_person" and "уповноважений" in r.json()["hint"]
    assert client.post(f"{API}/admin/approvals/{approval}/approve", headers=auditor).json()["code"] == "forbidden_role"
    listed = client.get(f"{API}/admin/approvals", headers=admin).json()
    assert next(x for x in listed if x["id"] == approval)["can_decide"] is True
    assert client.post(f"{API}/admin/approvals/{approval}/approve", headers=admin).status_code == 200
    # Зміна категорії — через запит.
    uid = user_id(client, "staff20")
    r = client.patch(f"{API}/admin/users/{uid}", json={"category": "working_group"}, headers=co)
    assert r.json()["category"] == "staff" and r.json()["pending_approval_id"]
    # Відкриття хвилі: просить уповноважений, підтверджує лише внутрішній аудит.
    campaign_id, _, admin = open_campaign(client, (STAFF,), open_it=False)
    r = client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "draft" and r.json()["pending_approval_id"]
    req = next(x for x in client.get(f"{API}/admin/approvals", headers=auditor).json() if x["kind"] == "open_campaign")
    assert "created_last_30_days" in req["payload"] and req["approver_roles"] == ["auditor"]
    assert client.post(f"{API}/admin/approvals/{req['id']}/approve", headers=co).status_code == 403
    assert client.post(f"{API}/admin/approvals/{req['id']}/approve", headers=admin).status_code == 403
    assert client.post(f"{API}/admin/approvals/{req['id']}/approve", headers=auditor).status_code == 200
    assert client.get(f"{API}/campaigns/{campaign_id}", headers=admin).json()["status"] == "open"
    # Техадмін бачить свої запити, але не може нічого вирішити.
    mine = client.get(f"{API}/admin/approvals", params={"status": "pending"}, headers=co).json()
    assert mine and all(not x["can_decide"] for x in mine)


def test_first_launch_needs_admin_before_anyone_else(client, setting):
    from app.db import SessionLocal
    from app.models import Role, User

    setting(four_eyes_enabled=True)
    with SessionLocal() as db:  # «порожня» система: уповноваженого ще немає
        db.query(User).filter(User.role == Role.ADMIN).update({"is_active": False})
        db.commit()
    co = auth(client, "coordinator")
    r = client.post(f"{API}/admin/users", headers=co, json={"login": "st1", "display_name": "S", "role": "respondent",
                                                            "category": "staff"})
    assert r.status_code == 409 and r.json()["code"] == "bootstrap_incomplete", r.text
    r = client.post(f"{API}/admin/users", headers=co, json={"login": "boss", "display_name": "Б", "role": "admin"})
    assert r.status_code == 201 and r.json()["is_active"] is True and r.json()["pending_approval_id"] is None
    # Тепер уповноважений є: наступний запис — уже через підтвердження.
    r = client.post(f"{API}/admin/users", headers=co, json={"login": "st1", "display_name": "S", "role": "respondent",
                                                            "category": "staff"})
    assert r.status_code == 201 and r.json()["pending_approval_id"]


def test_composition_frozen_from_creation(client):
    campaign_id, _, admin = open_campaign(client, (STAFF,), open_it=False)
    assert client.get(f"{API}/campaigns/{campaign_id}", headers=admin).json()["eligible_frozen"] is True
    uid, other = user_id(client, "staff01"), units(client, admin)["Підрозділ Б"]
    co = auth(client, "coordinator")
    r = client.patch(f"{API}/admin/users/{uid}", json={"unit_id": other}, headers=co)
    assert r.status_code == 409 and r.json()["code"] == "campaign_open"
    assert client.delete(f"{API}/campaigns/{campaign_id}", headers=admin).status_code == 204
    assert client.patch(f"{API}/admin/users/{uid}", json={"unit_id": other}, headers=co).status_code == 200


def test_audit_anchor_detects_rewrite(client):
    auditor = auth(client, "auditor")
    open_campaign(client, (STAFF,))
    anchor = client.post(f"{API}/admin/audit-log/anchor", json={"note": "друк"}, headers=auditor).json()
    check = {"seq": anchor["seq"], "hash": anchor["hash"]}
    assert client.post(f"{API}/admin/audit-log/verify-anchor", json=check, headers=auditor).json()["ok"] is True
    with SessionLocal() as db:  # «адміністратор БД» переписує запис і весь ланцюжок після нього
        row = db.query(AuditLog).filter(AuditLog.seq == anchor["seq"]).one()
        row.hash = "f" * 64
        db.commit()
    out = client.post(f"{API}/admin/audit-log/verify-anchor", json=check, headers=auditor).json()
    assert out["ok"] is False and out["matches"] is False


# ---------- Анонімність ----------

def test_open_blocked_when_questionnaire_has_fewer_than_k(client):
    campaign_id, _, admin = open_campaign(client, (WG,), min_group_size=10, open_it=False)
    r = client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin)
    assert r.status_code == 409 and r.json()["code"] == "group_too_small"


def test_staff_token_only(client, setting):
    setting(staff_token_only=True)
    admin = auth(client, "admin")
    q = questionnaire_ids(client, admin)
    body = {"title": "Х", "unit_id": units(client, admin)[ROOT], "questionnaire_ids": [q[STAFF]]}
    r = client.post(f"{API}/campaigns", json=body, headers=admin)
    assert r.status_code == 422 and r.json()["code"] == "staff_token_only"
    assert client.post(f"{API}/campaigns", json={**body, "access_mode": "token"}, headers=admin).status_code == 201
    assert client.get(f"{API}/config").json()["policies"]["staff_token_only"] is True


def test_privacy_notice_and_org_terms(client):
    notice = client.get(f"{API}/respond/privacy").json()
    assert notice["title"] == "Що саме ми зберігаємо" and "ballot" in notice["modes"]
    assert client.get(f"{API}/config").json()["org_terms"]["nominative"] == "заклад"


def test_pool_key_file(tmp_path, setting):
    key = tmp_path / "pool.key"
    key.write_text("secret-from-vault\n")
    setting(pool_encryption_key_file=str(key))
    assert get_settings().pool_key_material == "secret-from-vault"
    setting(pool_encryption_key_file=str(tmp_path / "missing"))
    with pytest.raises(RuntimeError):
        get_settings().pool_key_material  # noqa: B018


# ---------- Урна з трьома ключами ----------

def test_shamir_two_of_three():
    secret = 123456789 ** 5
    shares = urn.split(secret)
    assert urn.combine(shares[:2]) == secret and urn.combine([shares[0], shares[2]]) == secret
    assert urn.combine(shares[1:]) == secret and urn.combine(shares[:1]) != secret


def test_urn_ceremony(client):
    campaign_id, q, admin = open_campaign(client, (STAFF,), open_it=False)
    holders = ["leader", "auditor", "staff24"]
    r = client.put(f"{API}/campaigns/{campaign_id}/urn", json={"holder_ids": [user_id(client, h) for h in holders]},
                   headers=admin)
    assert r.status_code == 200 and r.json()["enabled"] and not r.json()["ready"]
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).json()["code"] == "urn_not_ready"
    shares = {}
    for h in holders:
        shares[h] = client.get(f"{API}/campaigns/{campaign_id}/urn/my-share", headers=auth(client, h)).json()["share"]
        assert client.get(f"{API}/campaigns/{campaign_id}/urn/my-share", headers=auth(client, h)).status_code == 409
    assert client.get(f"{API}/campaigns/{campaign_id}/urn/my-share", headers=admin).status_code == 403
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    for i in range(1, 7):
        answer(client, campaign_id, q[STAFF], f"staff{i:02d}", lambda _: 2)
    with SessionLocal() as db:  # у буфері лише шифротекст відкритим ключем хвилі
        assert all(row.answers["v"] == 2 for row in db.query(ResponsePool).all())
    r = client.post(f"{API}/campaigns/{campaign_id}/close", headers=admin)
    assert r.status_code == 409 and r.json()["code"] == "urn_pending"
    # Чужа частина не підходить.
    bad = client.post(f"{API}/campaigns/{campaign_id}/urn/shares", json={"share": shares["auditor"]},
                      headers=auth(client, "leader"))
    assert bad.json()["code"] == "urn_wrong_share"
    r = client.post(f"{API}/campaigns/{campaign_id}/urn/shares", json={"share": shares["leader"]},
                    headers=auth(client, "leader"))
    assert r.json()["status"] == "waiting"
    r = client.post(f"{API}/campaigns/{campaign_id}/urn/shares", json={"share": shares["staff24"]},
                    headers=auth(client, "staff24"))
    assert r.status_code == 200 and r.json()["status"] == "closed" and r.json()["responses_moved"] == 6
    assert results(client, campaign_id, admin)["index"]["score"] == 50.0


# ---------- Квитанції зі сліпим підписом ----------

def test_blind_ballot_and_receipt(client):
    campaign_id, q, admin = open_campaign(client, (STAFF,))
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}"
    receipts = []
    for i in range(1, 6):
        h = auth(client, f"staff{i:02d}")
        key = client.get(f"{url}/ballot-key", headers=h).json()
        n, e = int(key["n"], 16), key["e"]
        nonce = uuid.uuid4().bytes + uuid.uuid4().bytes
        blinded, r = ballots.client_blind(n, e, nonce)
        signed = client.post(f"{url}/ballot", json={"blinded": format(blinded, "x")}, headers=h)
        assert signed.status_code == 201, signed.text
        assert client.post(f"{url}/ballot", json={"blinded": format(blinded, "x")}, headers=h).status_code == 409
        signature = ballots.client_unblind(n, int(signed.json()["blinded_signature"], 16), r)
        form = client.get(f"{API}/respond/privacy")  # без входу
        assert form.status_code == 200
        f = client.get(f"{url}/form", headers=auth(client, "staff06")).json()
        answers = [{"question_id": x["id"], "option_ids": [x["options"][clamp(x, 2)]["id"]]}
                   for s in f["sections"] for x in s["questions"]]
        body = {"key_id": key["key_id"], "nonce": nonce.hex(), "signature": format(signature, "x"), "answers": answers}
        sent = client.post(f"{API}/respond/ballot", json=body)
        assert sent.status_code == 201, sent.text
        receipts.append(sent.json()["receipt"])
        assert client.post(f"{API}/respond/ballot", json=body).json()["code"] == "ballot_used"
        forged = {**body, "nonce": (b"x" * 32).hex()}
        assert client.post(f"{API}/respond/ballot", json=forged).json()["code"] == "ballot_invalid"
    # Жетон записав участь: звичайне подання вже не пройде.
    h = auth(client, "staff01")
    assert client.post(f"{url}/responses", json={"answers": []}, headers=h).json()["code"] == "already_submitted"
    close(client, campaign_id, admin)
    assert results(client, campaign_id, admin)["groups"][0]["n"] == 5
    check = client.get(f"{API}/respond/receipts/{receipts[0]}").json()
    assert check["counted"] and check["campaign_closed"]
    assert client.get(f"{API}/respond/receipts/{'0' * 64}").json()["counted"] is False
    listed = client.get(f"{API}/campaigns/{campaign_id}/receipts", headers=auth(client, "staff01")).json()
    assert sorted(receipts) == listed["receipts"]


# ---------- Детектор відвертості ----------

def test_list_count_form_and_submission(client):
    campaign_id, q, admin = open_campaign(client, (STAFF,))
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}"
    h = auth(client, "staff01")
    form = client.get(f"{url}/form", headers=h).json()
    lc = next(x for s in form["sections"] for x in s["questions"] if x["type"] == "list_count")
    assert lc["variant"] in ("A", "B") and len(lc["options"]) == len(lc["statements"]) + 1
    assert len(lc["statements"]) == (4 if lc["variant"] == "A" else 5)
    assert all(st in lc["help_text"] for st in lc["statements"])
    # Явно: value + variant; поза межами — 422.
    answers = [{"question_id": x["id"], "option_ids": [x["options"][0]["id"]]} for s in form["sections"]
               for x in s["questions"] if x["type"] != "list_count"]
    too_many = answers + [{"question_id": lc["id"], "value": 9, "variant": lc["variant"]}]
    assert client.post(f"{url}/responses", json={"answers": too_many}, headers=h).status_code == 422
    ok = answers + [{"question_id": lc["id"], "value": 2, "variant": lc["variant"]}]
    assert client.post(f"{url}/responses", json={"answers": ok}, headers=h).status_code == 201


class R:
    def __init__(self, options=None, values=None, variants=None):
        self.options, self.values, self.variants = options or {}, values or {}, variants or {}


def test_candor_analysis_estimates_concealment_and_pluralistic_ignorance(client):
    from app.db import SessionLocal
    from app.models import Questionnaire

    with SessionLocal() as db:
        questionnaire = db.query(Questionnaire).filter(Questionnaire.code == STAFF).one()
        qs = {x.code: x for s in questionnaire.sections for x in s.questions}
        lc, direct, own, mirror = (qs["candor.favor_list"], qs["candor.favor_direct"], qs["candor.report_self"],
                                   qs["candor.report_mirror"])
        yes = {x.code: x.options[0].id for x in (direct, own, mirror)}
        no = {x.code: x.options[1].id for x in (direct, own, mirror)}
        responses = []
        for p in range(120):
            variant = "AB"[p % 2]
            sensitive = variant == "B" and p % 10 < 4  # 20 % серед B
            responses.append(R(
                options={direct.id: [yes[direct.code] if p == 3 else no[direct.code]],
                         own.id: [yes[own.code] if p % 10 else no[own.code]],
                         mirror.id: [yes[mirror.code] if p % 10 < 4 else no[mirror.code]]},
                values={lc.id: 2 + sensitive}, variants={lc.id: variant}))
        group = scoring.GroupInput(questionnaire=questionnaire, responses=responses, eligible=120, submitted=120)
        out = candor.analyze([group], 5, 30)
        [item] = out["list_experiments"]
        assert item["sufficient"] and item["estimate"] == 40.0 and item["direct_share"] == pytest.approx(0.8)
        assert item["concealment"] and item["ci"][0] > item["direct_share"]
        [m] = out["mirrors"]
        assert m["self_share"] == 90.0 and m["others_share"] == 40.0 and m["pluralistic_ignorance"]
        assert set(out["flags"]) == {"concealment", "pluralistic_ignorance"} and len(out["card"]) == 2
        # Мало відповідей на варіант — «недостатньо даних».
        small = scoring.GroupInput(questionnaire=questionnaire, responses=responses[:40], eligible=40, submitted=40)
        assert candor.analyze([small], 5, 30)["list_experiments"][0]["sufficient"] is False


# ---------- Детектор Гудхарта, лотерея, план, брифінг, стійкість ----------

class Row:
    def __init__(self, indicator, n, d):
        self.indicator, self.numerator, self.denominator = indicator, n, d


def test_goodhart_threshold_cluster_rule():
    rows = [Row("declarations_on_time", 80, 100), Row("declarations_on_time", 90, 100),
            Row("declarations_on_time", 95, 100), Row("training_coverage", 50, 100)]
    assert goodhart.thresholds_cluster(rows)["values"] == {"above": 4, "below": 0}
    honest = rows[:2] + [Row("declarations_on_time", 79, 100), Row("training_coverage", 69, 100)]
    assert goodhart.thresholds_cluster(honest) is None


def test_wave_tools(client):
    campaign_id, admin, root = full_wave(client)
    auditor, leader = auth(client, "auditor"), auth(client, "leader")
    a = client.get(f"{API}/campaigns/{campaign_id}/audit-lottery", params={"count": 4}, headers=auditor).json()
    b = client.get(f"{API}/campaigns/{campaign_id}/audit-lottery", params={"count": 4}, headers=admin).json()
    assert a["items"] == b["items"] and len(a["items"]) == 4 and len(a["seed"]) == 64
    assert client.get(f"{API}/campaigns/{campaign_id}/audit-lottery", headers=leader).status_code == 403
    plan = client.get(f"{API}/campaigns/{campaign_id}/next-level-plan", headers=leader).json()
    assert plan["status"] in ("reached", "partial", "top") and all(s["responsible"] for s in plan["steps"])
    docx = client.get(f"{API}/campaigns/{campaign_id}/next-level-plan", params={"format": "docx"}, headers=leader)
    assert docx.status_code == 200 and docx.content[:2] == b"PK"
    brief = client.get(f"{API}/campaigns/{campaign_id}/briefing", headers=leader).json()
    assert len(brief["numbers"]) == 3 and len(brief["risks"]) <= 3 and len(brief["decisions"]) <= 3
    assert client.get(f"{API}/campaigns/{campaign_id}/briefing", params={"format": "docx"},
                      headers=leader).content[:2] == b"PK"
    sens = client.get(f"{API}/campaigns/{campaign_id}/sensitivity", headers=leader).json()
    assert len(sens["rows"]) == 8 and "verdict" in sens
    card = client.get(f"{API}/campaigns/{campaign_id}/candor", headers=leader).json()
    assert "list_experiments" in card["candor"] and "signals" in card["goodhart"]
    data = results(client, campaign_id, admin)
    assert data["index"]["modal_levels"]["staff"] == 3


# ---------- Реєстр ризиків ----------

def test_risk_register_import(client):
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    text = ("code,title,component,likelihood,impact,measure,owner,status\n"
            "R1,Тиск на оцінювання,culture,4,5,Тренінг для викладачів,Уповноважена особа,open\n"
            "R2,Закупівлі в одного постачальника,accountability,3,4,,Начальник служби закупівель,open\n")
    r = client.post(f"{API}/units/{root}/risk-register/import", headers=admin,
                    files={"file": ("risks.csv", io.BytesIO(text.encode()), "text/csv")})
    assert r.status_code == 200 and r.json()["created"] == 2, r.text
    data = client.get(f"{API}/units/{root}/risk-register", headers=auth(client, "leader")).json()
    assert data["items"][0]["code"] == "R1" and data["items"][0]["score"] == 20
    assert data["by_component"]["accountability"]["without_measure"] == 1
    bad = "code,title,component\nR3,X,unknown\n"
    assert client.post(f"{API}/units/{root}/risk-register/import", headers=admin,
                       files={"file": ("r.csv", io.BytesIO(bad.encode()), "text/csv")}).status_code == 422



def test_counterparty_check_mock(client):
    admin = auth(client, "admin")
    root = units(client, admin)[ROOT]
    codes = [f"{i:08d}" for i in range(10000000, 10000060)]
    r = client.post(f"{API}/checks/counterparty", json={"unit_id": root, "period": "2026-10", "edrpou": codes},
                    headers=admin)
    assert r.status_code == 201 and r.json()["source"] == "mock" and r.json()["total"] == 60, r.text
    assert r.json()["flagged"] > 0
    findings = client.get(f"{API}/checks/findings", params={"run_id": r.json()["run_id"]}, headers=admin).json()
    assert findings and findings[0]["record_ref"].startswith("ЄДРПОУ")
    bad = client.post(f"{API}/checks/counterparty", json={"unit_id": root, "period": "2026-10", "edrpou": ["12"]},
                      headers=admin)
    assert bad.status_code == 422


def test_access_log_drops_survey_paths():
    import logging

    from app.main import RedactTokenPaths

    def rec(path):
        return logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                                 ("1.2.3.4", "POST", path, "1.1", 201), None)

    f = RedactTokenPaths()
    assert f.filter(rec(f"/api/v1/campaigns/{uuid.uuid4()}/questionnaires/{uuid.uuid4()}/responses")) is False
    assert f.filter(rec("/api/v1/respond/ballot")) is False
    assert f.filter(rec("/api/v1/dashboard")) is True
