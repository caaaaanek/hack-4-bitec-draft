from tests.conftest import auth

API = "/api/v1"

DRAFT = {
    "code": "pulse-survey",
    "title": "Експрес-опитування",
    "kind": "survey",
    "target_category": "staff",
    "sections": [
        {
            "title": "Довіра",
            "component": "culture",
            "questions": [
                {
                    "code": "trust.report",
                    "text": "Я знаю, куди повідомити про порушення",
                    "type": "single_choice",
                    "options": [{"text": "Ні", "score": 1}, {"text": "Частково", "score": 3}, {"text": "Так", "score": 5}],
                },
                {"code": "trust.scale", "text": "Наскільки ви довіряєте каналам повідомлень?", "type": "scale", "scale_min": 1, "scale_max": 5},
            ],
        }
    ],
}


def test_commissioner_builds_and_publishes(client):
    headers = auth(client, "department")
    r = client.post(f"{API}/questionnaires", json=DRAFT, headers=headers)
    assert r.status_code == 201, r.text
    q = r.json()
    assert q["status"] == "draft" and q["version"] == 1
    assert [o["position"] for o in q["sections"][0]["questions"][0]["options"]] == [1, 2, 3]

    assert client.get(f"{API}/questionnaires/{q['id']}/validate", headers=headers).json() == []
    r = client.post(f"{API}/questionnaires/{q['id']}/publish", headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "published"


def test_respondent_cannot_use_constructor(client):
    r = client.post(f"{API}/questionnaires", json=DRAFT, headers=auth(client, "staff01"))
    assert r.status_code == 403


def test_publish_blocked_by_validation(client):
    headers = auth(client, "department")
    broken = {**DRAFT, "code": "broken"}
    broken["sections"] = [
        {
            "title": "Порожній розділ",
            "component": "culture",
            "questions": [
                {"code": "a", "text": "Один варіант", "type": "single_choice", "options": [{"text": "Так", "score": 1}]},
                {"code": "a", "text": "Шкала без меж", "type": "scale"},
            ],
        },
        {"title": "Без питань", "component": "system", "questions": []},
    ]
    q = client.post(f"{API}/questionnaires", json=broken, headers=headers).json()
    issues = client.get(f"{API}/questionnaires/{q['id']}/validate", headers=headers).json()
    messages = " ".join(i["message"] for i in issues)
    assert "2 варіанти" in messages
    assert "повторюється" in messages
    assert "scale_min" in messages
    assert "жодного питання" in messages
    assert client.post(f"{API}/questionnaires/{q['id']}/publish", headers=headers).status_code == 422


def test_published_is_immutable_and_versioned(client):
    headers = auth(client, "department")
    q = client.post(f"{API}/questionnaires", json=DRAFT, headers=headers).json()
    client.post(f"{API}/questionnaires/{q['id']}/publish", headers=headers)

    r = client.put(f"{API}/questionnaires/{q['id']}/structure", json={"sections": DRAFT["sections"]}, headers=headers)
    assert r.status_code == 409

    r = client.post(f"{API}/questionnaires/{q['id']}/new-version", headers=headers)
    assert r.status_code == 201
    v2 = r.json()
    assert v2["version"] == 2 and v2["status"] == "draft" and v2["previous_version_id"] == q["id"]
    assert v2["sections"][0]["questions"][0]["code"] == "trust.report"

    new_sections = [{**DRAFT["sections"][0], "title": "Довіра і безпека"}]
    r = client.put(f"{API}/questionnaires/{v2['id']}/structure", json={"sections": new_sections}, headers=headers)
    assert r.status_code == 200
    assert r.json()["sections"][0]["title"] == "Довіра і безпека"

    original = client.get(f"{API}/questionnaires/{q['id']}", headers=headers).json()
    assert original["sections"][0]["title"] == "Довіра"


def test_delete_only_drafts(client):
    headers = auth(client, "department")
    q = client.post(f"{API}/questionnaires", json=DRAFT, headers=headers).json()
    assert client.delete(f"{API}/questionnaires/{q['id']}", headers=headers).status_code == 204

    seeded = client.get(f"{API}/questionnaires?status=published", headers=headers).json()
    assert client.delete(f"{API}/questionnaires/{seeded[0]['id']}", headers=headers).status_code == 409


def test_seeded_instruments(client):
    headers = auth(client, "department")
    items = {q["code"]: q for q in client.get(f"{API}/questionnaires", headers=headers).json()}
    assert set(items) == {"nazk-maturity-wg", "nazk-maturity-staff", "nazk-maturity-expert", "nazk-checklist"}

    staff = client.get(f"{API}/questionnaires/{items['nazk-maturity-staff']['id']}", headers=headers).json()
    questions = {q["code"]: q for s in staff["sections"] for q in s["questions"]}
    assert len(questions) == 14  # 10 питань Моделі зрілості + 4 розділу «Відвертість» (в індекс не входять)
    assert questions["candor.favor_list"]["type"] == "list_count"
    assert questions["candor.report_mirror"]["params"] == {"mirror_of": "candor.report_self"}
    assert [o["score"] for o in questions["accountability.whistleblowers"]["options"]] == [1, 2, 3, 4, 5, 5]

    checklist = client.get(f"{API}/questionnaires/{items['nazk-checklist']['id']}", headers=headers).json()
    assert sum(len(s["questions"]) for s in checklist["sections"]) == 36


def test_admin_cannot_use_constructor(client):
    """Розподіл обов'язків: адмін запускає хвилі, але не складає анкети."""
    commissioner = auth(client, "department")
    draft = client.post(f"{API}/questionnaires", json=DRAFT, headers=commissioner).json()

    admin = auth(client, "admin")
    assert client.post(f"{API}/questionnaires", json=DRAFT, headers=admin).status_code == 403
    r = client.put(f"{API}/questionnaires/{draft['id']}/structure", json={"sections": []}, headers=admin)
    assert r.status_code == 403
    assert client.post(f"{API}/questionnaires/{draft['id']}/publish", headers=admin).status_code == 403

    # Бачить лише опубліковані анкети, щоб обрати їх для хвилі.
    listed = client.get(f"{API}/questionnaires", headers=admin).json()
    assert {q["status"] for q in listed} == {"published"}
    assert client.get(f"{API}/questionnaires/{draft['id']}", headers=admin).status_code == 404
    assert client.get(f"{API}/questionnaires/{listed[0]['id']}", headers=admin).status_code == 200
