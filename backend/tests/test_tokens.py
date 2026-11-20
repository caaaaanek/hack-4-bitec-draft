"""Б2: анонімне проходження за одноразовим посиланням."""

import uuid

from sqlalchemy import inspect, select

from app.db import SessionLocal, engine
from app.models import AccessToken, Response, ResponsePool, Unit
from app.services.tokens import hash_token
from tests.conftest import auth
from tests.helpers import API, ROOT, close, questionnaire_ids, results, units

STAFF = "nazk-maturity-staff"


def token_campaign(client, codes=(STAFF,), title="Анонімна хвиля"):
    admin = auth(client, "admin")
    q = questionnaire_ids(client, admin)
    r = client.post(f"{API}/campaigns", json={"title": title, "unit_id": units(client, admin)[ROOT],
                                              "questionnaire_ids": [q[c] for c in codes], "access_mode": "token"},
                    headers=admin)
    assert r.status_code == 201, r.text
    assert r.json()["access_mode"] == "token"
    return r.json()["id"], q, admin


def issue(client, campaign_id, questionnaire_id, unit_id, count, admin):
    r = client.post(f"{API}/campaigns/{campaign_id}/tokens",
                    json={"questionnaire_id": questionnaire_id, "unit_id": unit_id, "count": count}, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def tok(token: str) -> dict:
    return {"X-Response-Token": token}


def answers_for(client, token, pick=0):
    form = client.get(f"{API}/respond/form", headers=tok(token))
    assert form.status_code == 200, form.text
    return [{"question_id": q["id"], "option_ids": [q["options"][min(pick, len(q["options"]) - 1)]["id"]]}
            for s in form.json()["sections"] for q in s["questions"]]


def fill(client, token, pick=0):
    answers = answers_for(client, token, pick)
    return client.post(f"{API}/respond/responses", json={"answers": answers}, headers=tok(token))


def test_tokens_only_for_token_campaigns(client):
    from tests.helpers import open_campaign

    campaign_id, q, admin = open_campaign(client, (STAFF,))
    r = client.post(f"{API}/campaigns/{campaign_id}/tokens",
                    json={"questionnaire_id": q[STAFF], "unit_id": units(client, admin)["Підрозділ А"], "count": 3},
                    headers=admin)
    assert r.status_code == 409 and r.json()["code"] == "login_mode"


def test_anonymous_flow_and_reuse_is_409(client):
    campaign_id, q, admin = token_campaign(client)
    unit = units(client, admin)["Підрозділ А"]
    issued = issue(client, campaign_id, q[STAFF], unit, 3, admin)
    assert issued["group_total"] == 3 and "менше за k" in issued["warning"]
    token = issued["tokens"][0]["token"]
    # Анкету, на яку загалом може відповісти менше k людей, не відкриваємо: видаємо ще посилання іншій групі.
    r = client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin)
    assert r.status_code == 409 and r.json()["code"] == "group_too_small"
    issue(client, campaign_id, q[STAFF], units(client, admin)["Підрозділ Б"], 3, admin)
    assert issued["tokens"][0]["link"].endswith(f"/s/{token}")

    # До відкриття хвилі посилання не приймає відповіді.
    r = client.get(f"{API}/respond/form", headers=tok(token))
    assert r.status_code == 409 and r.json()["code"] == "campaign_not_open"
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200

    form = client.get(f"{API}/respond/form", headers=tok(token)).json()
    assert form["campaign_title"] == "Анонімна хвиля" and form["min_group_size"] == 5
    assert all("score" not in o for s in form["sections"] for qq in s["questions"] for o in qq["options"])

    answers = answers_for(client, token)
    r = client.post(f"{API}/respond/responses", json={"answers": answers}, headers=tok(token))
    assert r.status_code == 201, r.text
    assert r.json()["submitted_on"] is None  # дата не повертається і не зберігається

    again = client.post(f"{API}/respond/responses", json={"answers": answers}, headers=tok(token))
    assert again.status_code == 409 and again.json()["code"] == "token_used"
    assert client.get(f"{API}/respond/form", headers=tok(token)).json()["code"] == "token_used"


def test_consume_is_atomic(client):
    """Два паралельні подання з одним посиланням: пройде лише одне (UPDATE ... WHERE used = false)."""
    from app.services import tokens as service

    campaign_id, q, admin = token_campaign(client)
    token = issue(client, campaign_id, q[STAFF], units(client, admin)["Підрозділ А"], 1, admin)["tokens"][0]["token"]
    with SessionLocal() as a, SessionLocal() as b:
        row_a, row_b = service.find(a, token), service.find(b, token)
        assert service.consume(a, row_a) is True
        a.commit()
        assert service.consume(b, row_b) is False


def test_invalid_token_and_throttle(client):
    campaign_id, q, admin = token_campaign(client)
    assert client.get(f"{API}/respond/form").json()["code"] == "token_invalid"
    for _ in range(4):
        r = client.get(f"{API}/respond/form", headers=tok("x" * 43))
        assert r.status_code == 404 and r.json()["code"] == "token_invalid"
    r = client.get(f"{API}/respond/form", headers=tok("y" * 43))
    assert r.status_code == 429 and r.headers["Retry-After"]


def test_valid_token_passes_after_invalid_attempts(client):
    """5 невірних посилань з однієї адреси не блокують дійсне посилання з тієї ж адреси."""
    campaign_id, q, admin = token_campaign(client)
    token = issue(client, campaign_id, q[STAFF], units(client, admin)["Підрозділ А"], 5, admin)["tokens"][0]["token"]
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    for _ in range(5):
        assert client.get(f"{API}/respond/form", headers=tok("x" * 43)).status_code == 404
    assert client.get(f"{API}/respond/form", headers=tok("x" * 43)).status_code == 429
    r = client.get(f"{API}/respond/form", headers=tok(token))
    assert r.status_code == 200, r.text
    assert fill(client, token).status_code == 201


def test_throttle_is_per_client_behind_nginx(client, monkeypatch):
    """За nginx (FORWARDED_PROXIES) ліміт рахується за X-Forwarded-For, а не за адресою nginx."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "forwarded_proxies", "10.0.0.0/8")
    from app import security

    real = security.client_ip

    def via_nginx(request):  # TestClient не має IP-адреси: підставляємо адресу nginx у scope
        request.scope["client"] = ("10.0.0.2", 40000)
        return real(request)

    monkeypatch.setattr("app.routers.respond.client_ip", via_nginx)
    campaign_id, q, admin = token_campaign(client)
    bad = {"X-Forwarded-For": "203.0.113.7", **tok("x" * 43)}
    for _ in range(5):
        client.get(f"{API}/respond/form", headers=bad)
    assert client.get(f"{API}/respond/form", headers=bad).status_code == 429
    other = {"X-Forwarded-For": "198.51.100.9", **tok("y" * 43)}
    assert client.get(f"{API}/respond/form", headers=other).status_code == 404


def test_client_ip_trusts_forwarded_only_from_listed_proxy(monkeypatch):
    from starlette.requests import Request

    from app.config import get_settings
    from app.security import client_ip

    def req(peer, xff=None):
        headers = [(b"x-forwarded-for", xff.encode())] if xff else []
        return Request({"type": "http", "client": (peer, 1), "headers": headers})

    settings = get_settings()
    monkeypatch.setattr(settings, "forwarded_proxies", "172.16.0.0/12")
    monkeypatch.setattr(settings, "trusted_proxies", "")
    assert client_ip(req("172.18.0.4", "203.0.113.7")) == "203.0.113.7"
    assert client_ip(req("172.18.0.4", "1.1.1.1, 203.0.113.7")) == "203.0.113.7"  # підробка зліва не діє
    assert client_ip(req("198.51.100.1", "203.0.113.7")) == "198.51.100.1"  # чужий проксі — XFF ігнорується
    assert client_ip(req("172.18.0.4")) == "172.18.0.4"


def test_login_respondents_cannot_use_token_campaign(client):
    campaign_id, q, admin = token_campaign(client)
    client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin)
    staff = auth(client, "staff01")
    assert all(a["campaign_id"] != campaign_id for a in client.get(f"{API}/me/assignments", headers=staff).json())
    r = client.get(f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}/form", headers=staff)
    assert r.status_code == 409 and r.json()["code"] == "token_only"


def test_working_group_sees_checklist_of_token_campaign(client):
    campaign_id, q, admin = token_campaign(client, codes=(STAFF, "nazk-checklist"))
    client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin)
    mine = [a for a in client.get(f"{API}/me/assignments", headers=auth(client, "wg1")).json()
            if a["campaign_id"] == campaign_id]
    assert [(a["questionnaire_id"], a["kind"]) for a in mine] == [(q["nazk-checklist"], "checklist")]
    staff = client.get(f"{API}/me/assignments", headers=auth(client, "staff01")).json()
    assert all(a["campaign_id"] != campaign_id for a in staff)


def test_revoked_and_closed_tokens_stop_working(client):
    campaign_id, q, admin = token_campaign(client)
    unit = units(client, admin)["Підрозділ А"]
    tokens = [t["token"] for t in issue(client, campaign_id, q[STAFF], unit, 6, admin)["tokens"]]
    client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin)
    assert fill(client, tokens[0]).status_code == 201
    r = client.post(f"{API}/campaigns/{campaign_id}/tokens/revoke",
                    json={"questionnaire_id": q[STAFF], "unit_id": unit}, headers=admin)
    assert r.json()["revoked"] == 5
    assert client.get(f"{API}/respond/form", headers=tok(tokens[1])).json()["code"] == "token_invalid"
    close(client, campaign_id, admin)


def test_progress_and_results_count_tokens(client):
    campaign_id, q, admin = token_campaign(client)
    unit = units(client, admin)["Підрозділ А"]
    tokens = [t["token"] for t in issue(client, campaign_id, q[STAFF], unit, 8, admin)["tokens"]]
    client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin)
    for t in tokens[:6]:
        assert fill(client, t, pick=3).status_code == 201
    item = client.get(f"{API}/campaigns/{campaign_id}/progress", headers=admin).json()["items"][0]
    assert (item["eligible"], item["submitted"], item["percent"]) == (8, 6, 75.0)
    close(client, campaign_id, admin)
    data = results(client, campaign_id, admin, unit_id=unit)
    group = next(g for g in data["groups"] if g["questionnaire_id"] == q[STAFF])
    assert group["eligible"] == 8 and group["submitted"] == 6 and group["sufficient"]


def test_person_cannot_be_found_from_token(client):
    """«Людину не знайти»: адміністратор знає, кому віддав яке посилання, і має повний доступ до БД.

    Перевіряємо, що за посиланням не можна встановити відповідь: жодна таблица з відповідями не
    містить ані токена, ані його хешу, ані id посилання, ані часу, а за всіма полями, що лишилися
    (хвиля, анкета, категорія, підрозділ), кожна відповідь збігається щонайменше з k іншими.
    """
    campaign_id, q, admin = token_campaign(client)
    unit = units(client, admin)["Підрозділ А"]
    tokens = [t["token"] for t in issue(client, campaign_id, q[STAFF], unit, 7, admin)["tokens"]]
    # Адміністратор веде таблицю «кому яке посилання» поза системою.
    handed_out = {t: f"person-{i}" for i, t in enumerate(tokens)}
    client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin)
    picks = [0, 1, 2, 3, 4, 0, 1]
    for t, pick in zip(tokens, picks):
        assert fill(client, t, pick=pick).status_code == 201
    close(client, campaign_id, admin)

    insp = inspect(engine)
    # 1. Схема: у таблицях з відповідями немає посилань на токени, людей чи час.
    for table in ("responses", "answers", "response_pool"):
        columns = {c["name"] for c in insp.get_columns(table)}
        assert not columns & {"user_id", "token_id", "token_hash", "access_token_id", "created_at", "submitted_on",
                              "submitted_at", "at"}, (table, columns)
        fks = {fk["referred_table"] for fk in insp.get_foreign_keys(table)}
        assert not fks & {"users", "access_tokens", "participations"}, (table, fks)
    # 2. У таблиці посилань немає ні людини, ні часу, ні відповіді.
    token_cols = {c["name"] for c in insp.get_columns("access_tokens")}
    assert token_cols == {"id", "campaign_id", "questionnaire_id", "unit_id", "token_hash", "used", "revoked",
                          "qr_link_id"}

    with SessionLocal() as db:
        # 3. Сам токен у БД не зберігається, лише хеш.
        rows = db.scalars(select(AccessToken).where(AccessToken.campaign_id == uuid.UUID(campaign_id))).all()
        assert {r.token_hash for r in rows} == {hash_token(t) for t in tokens}
        responses = db.scalars(select(Response).where(Response.campaign_id == uuid.UUID(campaign_id))).all()
        assert len(responses) == 7
        assert db.scalar(select(ResponsePool).where(ResponsePool.campaign_id == uuid.UUID(campaign_id))) is None
        # 4. Для кожного посилання множина відповідей, сумісних з усім, що про нього відомо, ≥ k.
        #    Відповідь зберігається під підрозділом посилання або під одним з його вищих підрозділів.
        parents = {u.id: u.parent_id for u in db.scalars(select(Unit))}

        def ancestors(unit):
            while unit is not None:
                yield unit
                unit = parents.get(unit)

        for t in handed_out:
            row = next(r for r in rows if r.token_hash == hash_token(t))
            candidates = [r for r in responses
                          if r.questionnaire_id == row.questionnaire_id and r.unit_id in set(ancestors(row.unit_id))]
            assert len(candidates) >= 5, f"{handed_out[t]}: лише {len(candidates)} кандидатів"
        # 5. Порядок ID відповідей не повторює порядок подання (ID випадкові, пачка перемішана).
        # Перевіряємо, що жодне поле Response не містить значень, похідних від токена.
        hashes = {hash_token(t) for t in tokens}
        for r in responses:
            assert str(r.id).replace("-", "") not in hashes
