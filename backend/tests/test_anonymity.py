"""Буфер відповідей, вторинне приховування, нижня межа k."""

import pytest
from sqlalchemy import func, select, text

from app.db import SessionLocal, engine
from app.models import Response, ResponsePool
from app.services.anonymity import suppressed_nodes
from tests.conftest import auth
from tests.helpers import API, answer, close, open_campaign, results, units


def count(model) -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(model))


# ---------- Вторинне приховування (чиста функція) ----------

def test_suppression_hides_sibling_when_difference_reveals_small_group():
    # батько 10 = a 7 + b 3: b прихована, але a показати не можна, бо b = 10 − 7.
    children = {"p": ["a", "b"]}
    hidden = suppressed_nodes(children, {"a": 7, "b": 3}, "p", 5)
    assert hidden == {"a", "b"}


def test_suppression_keeps_groups_when_remainder_is_large_enough():
    children = {"p": ["a", "b", "c"]}
    assert suppressed_nodes(children, {"a": 5, "b": 6, "c": 0}, "p", 5) == {"c"}
    # Залишок 0 (c порожня) нічого не розкриває.


def test_suppression_counts_own_members_of_parent():
    # Батько має 2 власних членів: показ a дав би 2 = 9 − 7.
    children = {"p": ["a"]}
    assert suppressed_nodes(children, {"p": 2, "a": 7}, "p", 5) == {"a"}


def test_suppression_on_demo_tree():
    # Як у seed: по 4 особи в кожному некореневому підрозділі, k = 5.
    children = {"R": ["A", "B", "V"], "A": ["A1", "A2"], "B": ["B1"]}
    direct = {"A": 4, "A1": 4, "A2": 4, "B": 4, "B1": 4, "V": 4}
    hidden = suppressed_nodes(children, direct, "R", 5)
    # V (4) прихований; R − A − B розкрив би V, тому ховається й найменший показаний: B (8).
    assert hidden == {"V", "B", "B1", "A1", "A2"}
    assert "A" not in hidden and "R" not in hidden


# ---------- Через API ----------

def test_minimum_k_cannot_be_lowered(client):
    admin = auth(client, "admin")
    root = units(client, admin)["Організація (демо)"]
    q = {x["code"]: x["id"] for x in client.get(f"{API}/questionnaires", headers=admin).json()}
    r = client.post(f"{API}/campaigns", json={"title": "Х", "unit_id": root, "questionnaire_ids": [q["nazk-maturity-staff"]],
                                              "min_group_size": 3}, headers=admin)
    assert r.status_code == 422


def test_answers_go_through_pool_in_batches(client):
    campaign_id, q, admin = open_campaign(client, ("nazk-maturity-staff",))
    answer(client, campaign_id, q["nazk-maturity-staff"], "staff01", lambda _: 0)
    assert count(Response) == 0 and count(ResponsePool) == 1

    for i in range(2, 10):
        answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda _: 0)
    assert count(Response) == 0 and count(ResponsePool) == 9  # менше 2k = 10

    answer(client, campaign_id, q["nazk-maturity-staff"], "staff10", lambda _: 0)
    # 10 = 2k: переноситься пачка 5, ще 5 лишається в буфері.
    assert count(Response) == 5 and count(ResponsePool) == 5

    close(client, campaign_id, admin)
    assert count(Response) == 10 and count(ResponsePool) == 0


def test_sibling_of_small_group_is_suppressed_in_results(client):
    """Корінь 24 = А 12 + Б 8 + В 4. В менший за k, тому Б теж приховано, інакше В = корінь − А − Б."""
    campaign_id, q, admin = open_campaign(client, ("nazk-maturity-staff",))
    for i in range(1, 25):
        answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda _: 1)
    close(client, campaign_id, admin)
    u = units(client, admin)

    root = results(client, campaign_id, admin)
    a = results(client, campaign_id, admin, unit_id=u["Підрозділ А"])
    b = results(client, campaign_id, admin, unit_id=u["Підрозділ Б"])
    v = results(client, campaign_id, admin, unit_id=u["Підрозділ В"])

    assert root["index"]["score"] is not None
    assert a["index"]["score"] is not None
    assert v["index"]["score"] is None
    assert b["index"]["score"] is None
    group_b = b["groups"][0]
    assert group_b["suppressed"] is True and group_b["n"] is None and group_b["eligible"] is None


def test_response_rows_do_not_share_transaction_with_participation(client):
    """Лише PostgreSQL: системне поле xmin відповідей не збігається з xmin записів участі."""
    if engine.dialect.name != "postgresql":
        pytest.skip("xmin є лише в PostgreSQL (задайте TEST_DATABASE_URL)")
    campaign_id, q, admin = open_campaign(client, ("nazk-maturity-staff",))
    for i in range(1, 11):
        answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda _: 0)
    close(client, campaign_id, admin)
    with engine.connect() as c:
        participations = {r[0] for r in c.execute(text("SELECT xmin::text FROM participations"))}
        responses = [r[0] for r in c.execute(text("SELECT xmin::text FROM responses"))]
    assert not participations & set(responses)
    # Кожна пачка містить щонайменше k відповідей.
    assert min(responses.count(x) for x in set(responses)) >= 5
