"""Рев'ю бекенду 20.11 (архів _10): offset без меж, гонка ключів жетонів, async-ендпойнти з синхронною БД."""

import inspect
import uuid

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import BlindKey, Campaign, Questionnaire
from app.routers import admin, campaigns, checklist, risks
from app.services import ballots
from tests.conftest import auth
from tests.helpers import API, clamp, open_campaign

STAFF = "nazk-maturity-staff"
EXPERT = "nazk-maturity-expert"


def test_huge_offset_is_422_not_500(client):
    # Раніше offset понад межу цілого БД давав 500 (SQLite OverflowError, PostgreSQL bigint out of range).
    huge = 10**20
    r = client.get(f"{API}/admin/audit-log", params={"offset": huge}, headers=auth(client, "admin"))
    assert r.status_code == 422, r.text
    r = client.get(f"{API}/checks/findings", params={"offset": huge}, headers=auth(client, "admin"))
    assert r.status_code == 422, r.text
    assert client.get(f"{API}/admin/audit-log", params={"offset": 5}, headers=auth(client, "admin")).status_code == 200


def test_upload_endpoints_do_not_block_event_loop():
    # Синхронна БД і запис на диск в async def зупиняли обробку всіх інших запитів на час завантаження.
    for fn in (checklist.submit_entry, checklist.upload_file, campaigns.import_participants, admin.import_users,
               risks.import_risks):
        assert not inspect.iscoroutinefunction(fn), fn.__name__


def _extra_key(campaign_id, questionnaire_id, unit_id) -> uuid.UUID:
    """Другий ключ тієї ж групи з найменшим id: так виглядає наслідок гонки двох перших звернень."""
    from cryptography.hazmat.primitives.asymmetric import rsa

    private = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    numbers = private.private_numbers()
    key_id = uuid.UUID(int=1)
    with SessionLocal() as db:
        db.add(BlindKey(id=key_id, campaign_id=uuid.UUID(campaign_id), questionnaire_id=uuid.UUID(questionnaire_id),
                        unit_id=unit_id, n=format(numbers.public_numbers.n, "x"), e=numbers.public_numbers.e,
                        sealed_d=ballots._seal_d(numbers.d)))
        db.commit()
    return key_id


def test_ballot_signed_with_key_client_blinded_with(client):
    # Експерти — група без підрозділу: NULL не перевіряється унікальністю, і два одночасні перші звернення
    # створювали два ключі. Раніше сервер підписував довільним із них, жетон не перевірявся, а участь уже записано.
    campaign_id, q, _ = open_campaign(client, (EXPERT,))
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{q[EXPERT]}"
    h = auth(client, "expert1")
    key = client.get(f"{url}/ballot-key", headers=h).json()
    other = _extra_key(campaign_id, q[EXPERT], None)
    # Після «гонки» група має два ключі; сервер обирає їх у сталому порядку.
    assert client.get(f"{url}/ballot-key", headers=auth(client, "expert2")).json()["key_id"] == str(other)

    n, e = int(key["n"], 16), key["e"]
    nonce = uuid.uuid4().bytes + uuid.uuid4().bytes
    blinded, r = ballots.client_blind(n, e, nonce)
    signed = client.post(f"{url}/ballot", json={"blinded": format(blinded, "x"), "key_id": key["key_id"]}, headers=h)
    assert signed.status_code == 201, signed.text
    assert signed.json()["key_id"] == key["key_id"]
    signature = ballots.client_unblind(n, int(signed.json()["blinded_signature"], 16), r)
    form = client.get(f"{url}/form", headers=auth(client, "expert3")).json()
    answers = [{"question_id": x["id"], "option_ids": [x["options"][clamp(x, 2)]["id"]]}
               for s in form["sections"] for x in s["questions"]]
    body = {"key_id": key["key_id"], "nonce": nonce.hex(), "signature": format(signature, "x"), "answers": answers}
    sent = client.post(f"{API}/respond/ballot", json=body)
    assert sent.status_code == 201, sent.text


def test_ballot_key_conflict_returns_existing(client):
    # Друге з двох одночасних звернень підрозділу впиралось в унікальність ключа (раніше 409 «запит двічі»).
    from sqlalchemy import false

    campaign_id, q, _ = open_campaign(client, (STAFF,))
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}"
    first = client.get(f"{url}/ballot-key", headers=auth(client, "staff01")).json()
    with SessionLocal() as db:
        existing = db.get(BlindKey, uuid.UUID(first["key_id"]))
        campaign, questionnaire = db.get(Campaign, existing.campaign_id), db.get(Questionnaire, existing.questionnaire_id)
        calls = []

        def stale_first_lookup(real):
            def lookup(query, *args, **kwargs):
                # Імітуємо гонку: перший пошук ще не бачить ключа, створеного паралельним запитом.
                calls.append(query)
                return real(query.where(false()) if len(calls) == 1 else query, *args, **kwargs)
            return lookup

        db.scalar, db.scalars = stale_first_lookup(db.scalar), stale_first_lookup(db.scalars)
        key = ballots.key_for(db, campaign, questionnaire, existing.unit_id)
        assert key.id == existing.id
        assert db.scalar(select(func.count()).select_from(BlindKey).where(
            BlindKey.campaign_id == campaign.id)) == 1


def test_ballot_key_from_other_group_rejected(client):
    campaign_id, q, _ = open_campaign(client, (STAFF,))
    url = f"{API}/campaigns/{campaign_id}/questionnaires/{q[STAFF]}"
    h = auth(client, "staff01")
    key = client.get(f"{url}/ballot-key", headers=h).json()
    blinded, _ = ballots.client_blind(int(key["n"], 16), key["e"], b"n" * 32)
    r = client.post(f"{url}/ballot", json={"blinded": format(blinded, "x"), "key_id": str(uuid.uuid4())}, headers=h)
    assert r.status_code == 422 and r.json()["code"] == "invalid"
    # Відмова не записала участь: з правильним ключем жетон видається.
    r = client.post(f"{url}/ballot", json={"blinded": format(blinded, "x"), "key_id": key["key_id"]}, headers=h)
    assert r.status_code == 201, r.text


def test_out_of_range_ints_are_422(client):
    # Колонки INTEGER: у PostgreSQL понад 2³¹−1 запис падав з 500 (на SQLite — понад 2⁶³).
    admin = auth(client, "admin")
    r = client.post(f"{API}/admin/audit-log/verify-anchor", json={"seq": 10**20, "hash": "0" * 64}, headers=admin)
    assert r.status_code == 422, r.text
    unit_id = client.get(f"{API}/units", headers=admin).json()[0]["id"]
    big = 2**31
    body = {"unit_id": unit_id, "period": "2026-01", "indicator": "training_coverage", "numerator": big,
            "denominator": big, "source": "test-mock"}
    headers = {"X-Integration-Key": "test-integration-key"}
    r = client.post(f"{API}/indicators", headers=headers, json=body)
    assert r.status_code == 422, r.text
    r = client.post(f"{API}/indicators", headers=headers, json={**body, "numerator": big - 1, "denominator": big - 1})
    assert r.status_code < 300, r.text


def test_nul_byte_in_text_is_not_500(client):
    # PostgreSQL не зберігає NUL у тексті: DataError давав 500 навіть на вході. Тепер 422 invalid_value
    # (SQLite NUL приймає, там звичайна відповідь). CI проганяє тести й на PostgreSQL.
    r = client.post(f"{API}/auth/session", json={"login": "adm\x00in", "password": "x"})
    assert r.status_code in (401, 422), r.text
    r = client.post(f"{API}/auth/login", data={"username": "\x00", "password": "x"})
    assert r.status_code in (401, 422), r.text
    r = client.post(f"{API}/admin/units", json={"name": "\x00"}, headers=auth(client, "coordinator"))
    assert r.status_code < 500, r.text
    if r.status_code == 422:
        assert r.json()["code"] == "invalid_value"
