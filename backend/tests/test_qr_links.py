"""QR для зали: одне посилання, кожен скан дає нову одноразову форму."""

from app.db import SessionLocal
from app.models import AccessToken, Campaign
from sqlalchemy import select
from tests.conftest import auth
from tests.helpers import API, units
from tests.test_tokens import STAFF, fill, token_campaign, tok

UNIT = "Підрозділ А"


def open_qr(client, expected=6):
    campaign_id, q, admin = token_campaign(client)
    unit = units(client, admin)[UNIT]
    r = client.post(f"{API}/campaigns/{campaign_id}/qr-links",
                    json={"questionnaire_id": q[STAFF], "unit_id": unit, "expected": expected}, headers=admin)
    assert r.status_code == 201, r.text
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    return campaign_id, r.json(), admin


def scan(client, code):
    return client.post(f"{API}/respond/qr/{code}")


def item(client, campaign_id, admin):
    r = client.get(f"{API}/campaigns/{campaign_id}/progress", headers=admin)
    assert r.status_code == 200, r.text
    return r.json()["items"][0]


def test_scan_gives_fresh_token_each_time(client):
    campaign_id, qr, admin = open_qr(client)
    assert qr["link"].endswith(f"/q/{qr['code']}")
    a, b = scan(client, qr["code"]), scan(client, qr["code"])
    assert a.status_code == b.status_code == 201
    assert a.json()["token"] != b.json()["token"]


def test_completed_counts_once_and_token_is_single_use(client):
    campaign_id, qr, admin = open_qr(client)
    token = scan(client, qr["code"]).json()["token"]
    assert fill(client, token).status_code == 201
    form = client.get(f"{API}/respond/form", headers=tok(token))
    assert form.status_code == 409 and form.json()["code"] == "token_used"  # той самий токен вдруге
    again = scan(client, qr["code"]).json()["token"]  # новий скан — нова форма
    assert fill(client, again, pick=1).status_code == 201
    it = item(client, campaign_id, admin)
    assert it["eligible"] == 6 and it["submitted"] == 2 and it["over_expected"] is False


def test_abandoned_form_does_not_count(client):
    campaign_id, qr, admin = open_qr(client)
    for _ in range(3):
        scan(client, qr["code"])  # відкрили й вийшли
    token = scan(client, qr["code"]).json()["token"]
    assert fill(client, token).status_code == 201
    it = item(client, campaign_id, admin)
    assert it["eligible"] == 6 and it["submitted"] == 1  # знаменник не росте від сканів
    listed = client.get(f"{API}/campaigns/{campaign_id}/qr-links", headers=admin).json()[0]
    assert listed["opened"] == 4 and listed["completed"] == 1


def test_more_answers_than_expected_is_flagged(client):
    campaign_id, qr, admin = open_qr(client, expected=5)
    for _ in range(6):
        assert fill(client, scan(client, qr["code"]).json()["token"]).status_code == 201
    it = item(client, campaign_id, admin)
    assert it["submitted"] == 6 and it["eligible"] == 5 and it["over_expected"] is True
    # Ознаку дає й сам QR (аудит 20.11: раніше її рахував лише фронтенд).
    listed = client.get(f"{API}/campaigns/{campaign_id}/qr-links", headers=admin).json()[0]
    assert listed["completed"] == 6 and listed["over_expected"] is True and listed["scan_limit_reached"] is False


def test_open_limit_is_three_times_expected(client):
    campaign_id, qr, admin = open_qr(client, expected=5)
    codes = [scan(client, qr["code"]).status_code for _ in range(16)]
    assert codes[:15] == [201] * 15 and codes[15] == 429
    listed = client.get(f"{API}/campaigns/{campaign_id}/qr-links", headers=admin).json()[0]
    assert listed["scan_limit_reached"] is True and listed["over_expected"] is False
    assert scan(client, qr["code"]).json()["code"] == "qr_limit"


def test_invalid_revoked_and_closed(client):
    campaign_id, qr, admin = open_qr(client)
    assert scan(client, "nope").json()["code"] == "qr_invalid"
    token = scan(client, qr["code"]).json()["token"]
    r = client.post(f"{API}/campaigns/{campaign_id}/qr-links/{qr['id']}/revoke", headers=admin)
    assert r.status_code == 200 and r.json()["revoked"] is True
    assert scan(client, qr["code"]).status_code == 404
    assert fill(client, token).status_code == 201  # відкриту форму можна дописати
    assert item(client, campaign_id, admin)["eligible"] == 6  # очікувана кількість лишається


def test_scan_requires_open_campaign(client):
    campaign_id, q, admin = token_campaign(client)
    unit = units(client, admin)[UNIT]
    qr = client.post(f"{API}/campaigns/{campaign_id}/qr-links",
                     json={"questionnaire_id": q[STAFF], "unit_id": unit, "expected": 3}, headers=admin).json()
    r = scan(client, qr["code"])  # чернетка
    assert r.status_code == 409 and r.json()["code"] == "campaign_not_open"


def test_admin_only_and_token_has_no_link_to_answer(client):
    campaign_id, qr, admin = open_qr(client)
    staff = auth(client, "staff01")
    assert client.get(f"{API}/campaigns/{campaign_id}/qr-links", headers=staff).status_code == 403
    token = scan(client, qr["code"]).json()["token"]
    fill(client, token)
    with SessionLocal() as db:
        cols = {c.name for c in AccessToken.__table__.columns}
        assert not cols & {"user_id", "created_at", "used_at", "ip"}
        assert db.scalar(select(Campaign.id)) is not None


def test_qr_codes_are_redacted_in_access_log():
    import logging

    from app.main import RedactTokenPaths

    for path in ("/q/abc123", "/api/v1/respond/qr/abc123", "/s/tok456"):
        record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                                   ("1.2.3.4", "POST", path, "1.1", 201), None)
        RedactTokenPaths().filter(record)
        assert "abc123" not in record.getMessage() and "tok456" not in record.getMessage()
