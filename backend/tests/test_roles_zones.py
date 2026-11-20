"""Беклог бекенду 20.11 (ролі, два адміністратори, зони, автопілот, чек-лист з документами).

Зона: уповноважений і аудит з підрозділом бачать лише свій підрозділ і піддерево. Уповноважений одного
закладу чи департаменту не обирає чужого підрозділу для хвилі й не бачить чужих хвиль.
"""

from datetime import timedelta

from app.clock import today
from app.db import SessionLocal
from app.models import Role, Unit, User
from app.security import hash_password
from tests.conftest import PASSWORD, auth
from tests.helpers import API, ROOT, open_campaign, questionnaire_ids, submit_item, units

STAFF = "nazk-maturity-staff"


def second_institution(client) -> dict[str, str]:
    """Другий заклад зі своїм уповноваженим (admin_b) і аудитором (auditor_b)."""
    with SessionLocal() as db:
        root = Unit(name="Заклад Б")
        db.add(root)
        db.flush()
        child = Unit(name="Заклад Б: кафедра", parent_id=root.id)
        db.add(child)
        db.flush()
        for login, role in (("admin_b", Role.ADMIN), ("auditor_b", Role.AUDITOR)):
            db.add(User(login=login, display_name=login, password_hash=hash_password(PASSWORD), role=role,
                        unit_id=root.id))
        ids = {"root": str(root.id), "child": str(child.id)}
        db.commit()
    return ids


def test_admin_cannot_pick_other_institution_for_wave(client):
    b = second_institution(client)
    campaign_a, q, admin_a = open_campaign(client, (STAFF,))  # admin без підрозділу: увесь «Заклад А»
    admin_b = auth(client, "admin_b")
    a_root = units(client, admin_a)[ROOT]

    # Підрозділи: лише своя зона.
    names = {u["name"] for u in client.get(f"{API}/units", headers=admin_b).json()}
    assert names == {"Заклад Б", "Заклад Б: кафедра"}
    # Створити хвилю в чужому закладі не можна, у своєму — можна.
    body = {"title": "Чужа", "unit_id": a_root, "questionnaire_ids": [q[STAFF]]}
    r = client.post(f"{API}/campaigns", json=body, headers=admin_b)
    assert r.status_code == 422 and r.json()["code"] == "out_of_zone"
    r = client.post(f"{API}/campaigns", json={**body, "title": "Своя", "unit_id": b["child"]}, headers=admin_b)
    assert r.status_code == 201, r.text
    own = r.json()["id"]
    # І перенести свою чернетку в чужий заклад теж.
    r = client.patch(f"{API}/campaigns/{own}", json={"unit_id": a_root}, headers=admin_b)
    assert r.status_code == 422 and r.json()["code"] == "out_of_zone"

    # Чужих хвиль не видно ні в списку, ні за id (404, ніби її немає), ні через вкладені маршрути.
    assert [c["id"] for c in client.get(f"{API}/campaigns", headers=admin_b).json()] == [own]
    for method, path in (("get", f"/campaigns/{campaign_a}"), ("get", f"/campaigns/{campaign_a}/progress"),
                         ("get", f"/campaigns/{campaign_a}/participants"), ("get", f"/campaigns/{campaign_a}/people"),
                         ("get", f"/campaigns/{campaign_a}/checklist"), ("get", f"/campaigns/{campaign_a}/autopilot"),
                         ("post", f"/campaigns/{campaign_a}/close"), ("get", f"/campaigns/{campaign_a}/results")):
        r = getattr(client, method)(f"{API}{path}", headers=admin_b)
        assert r.status_code == 404, (path, r.status_code)
    # Уповноважений закладу А свою хвилю бачить і чужої (Б) — ні.
    assert client.get(f"{API}/campaigns/{campaign_a}", headers=admin_a).status_code == 200
    # Аудит закладу Б — так само лише своя зона.
    auditor_b = auth(client, "auditor_b")
    assert client.get(f"{API}/campaigns/{campaign_a}", headers=auditor_b).status_code == 404
    assert [c["id"] for c in client.get(f"{API}/campaigns", headers=auditor_b).json()] == [own]


def test_approvals_stay_in_zone(client, setting):
    second_institution(client)
    setting(four_eyes_enabled=True)
    campaign_a, _, admin_a = open_campaign(client, (STAFF,), open_it=False)
    r = client.post(f"{API}/campaigns/{campaign_a}/open", headers=admin_a)
    approval = r.json()["pending_approval_id"]
    # Аудит іншого закладу запиту не бачить і не підтвердить.
    auditor_b = auth(client, "auditor_b")
    assert all(x["id"] != approval for x in client.get(f"{API}/admin/approvals", headers=auditor_b).json())
    r = client.post(f"{API}/admin/approvals/{approval}/approve", headers=auditor_b)
    assert r.status_code == 403 and r.json()["code"] == "out_of_zone"
    # Нового респондента закладу А не активує уповноважений закладу Б.
    co = auth(client, "coordinator")
    r = client.post(f"{API}/admin/users", headers=co, json={"login": "new_a", "display_name": "А", "role": "respondent",
                                                            "category": "staff", "unit_id": units(client, admin_a)[ROOT]})
    r = client.post(f"{API}/admin/approvals/{r.json()['pending_approval_id']}/approve", headers=auth(client, "admin_b"))
    assert r.status_code == 403 and r.json()["code"] == "out_of_zone"
    # Свій аудит відкриває.
    assert client.post(f"{API}/admin/approvals/{approval}/approve", headers=auth(client, "auditor")).status_code == 200


def test_autopilot_waits_for_approval_and_reports_schedule(client, setting):
    setting(four_eyes_enabled=True, autopilot_interval_seconds=300)
    campaign_id, _, admin = open_campaign(client, (STAFF,), open_it=False)
    r = client.put(f"{API}/campaigns/{campaign_id}/autopilot", headers=admin,
                   json={"enabled": True, "planned_open_on": str(today()),
                         "planned_close_on": str(today() + timedelta(days=10))})
    assert r.status_code == 200, r.text
    assert r.json()["interval_seconds"] == 300 and r.json()["next_tick_at"] is None  # у тестах потоку немає
    events = client.post(f"{API}/autopilot/tick", headers=admin).json()["events"]
    assert any(e["step"] == "open" and e["status"] == "waiting" for e in events)
    state = client.get(f"{API}/campaigns/{campaign_id}/autopilot", headers=admin).json()
    assert state["status"] == "draft" and state["waiting_approval_id"]
    # Повторний крок другого запиту не створює.
    client.post(f"{API}/autopilot/tick", headers=admin)
    pending = [x for x in client.get(f"{API}/admin/approvals", headers=auth(client, "auditor")).json()
               if x["kind"] == "open_campaign"]
    assert len(pending) == 1
    assert client.post(f"{API}/admin/approvals/{pending[0]['id']}/approve", headers=auth(client, "auditor")).status_code == 200
    assert client.get(f"{API}/campaigns/{campaign_id}", headers=admin).json()["status"] == "open"


def test_checklist_files_only_by_enterer_and_confirm_only_by_auditor(client):
    campaign_id, _, admin = open_campaign(client, ("nazk-checklist",))
    items = client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=auth(client, "wg1")).json()["items"]
    item = items[0]["question_id"]
    people = {p["login"]: p["id"] for p in client.get(f"{API}/campaigns/{campaign_id}/people", headers=admin).json()}
    r = client.put(f"{API}/campaigns/{campaign_id}/checklist/assignments", headers=admin,
                   json={"items": [{"question_id": item, "enterer_id": people["wg1"], "confirmer_id": people["auditor"]}]})
    assert r.status_code == 200, r.text
    base = f"{API}/campaigns/{campaign_id}/checklist/{item}"
    pdf = ("nakaz.pdf", b"%PDF-1.4\n% x\n%%EOF\n", "application/pdf")
    # Файл додає лише призначений член робочої групи; аудит і уповноважений лише завантажують.
    assert client.post(f"{base}/files", files={"file": pdf}, headers=auth(client, "wg2")).status_code == 403
    assert client.post(f"{base}/files", files={"file": pdf}, headers=auth(client, "auditor")).status_code == 403
    assert client.post(f"{base}/files", files={"file": pdf}, headers=admin).status_code == 403
    r = submit_item(client, campaign_id, item, auth(client, "wg1"))
    assert r.status_code == 200
    file_id = r.json()["files"][0]["id"]
    assert client.delete(f"{base}/files/{file_id}", headers=auth(client, "wg2")).status_code == 403
    assert client.get(f"{base}/files/{file_id}", headers=auth(client, "auditor")).status_code == 200
    # Підтверджує лише аудит (CHECKLIST_CONFIRMERS=auditor), не член РГ і не уповноважений.
    for login in ("wg1", "wg2", "admin", "department"):
        assert client.post(f"{base}/confirm", headers=auth(client, login)).status_code == 403, login
    r = client.post(f"{base}/confirm", headers=auth(client, "auditor"))
    assert r.status_code == 200 and r.json()["confirmed"]
    # Журнал: підтверджено за конкретними файлами (sha256).
    log = client.get(f"{API}/admin/audit-log", params={"action": "confirm"}, headers=auth(client, "auditor")).json()
    assert log[0]["details"]["files"] == [r.json()["files"][0]["sha256"]]
    assert client.get(f"{API}/config").json()["policies"]["checklist_confirmers"] == ["auditor"]


def test_department_owns_questionnaires(client):
    q = questionnaire_ids(client, auth(client, "admin"))
    body = {"code": "dep-survey", "title": "Анкета", "kind": "survey", "target_category": "staff"}
    assert client.post(f"{API}/questionnaires", json=body, headers=auth(client, "admin")).status_code == 403
    assert client.post(f"{API}/questionnaires", json=body, headers=auth(client, "department")).status_code == 201
    # Уповноважений лише читає опубліковані.
    assert client.get(f"{API}/questionnaires/{q[STAFF]}", headers=auth(client, "admin")).status_code == 200
    assert client.post(f"{API}/questionnaires/{q[STAFF]}/archive", headers=auth(client, "admin")).status_code == 403
