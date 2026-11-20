"""Буфер відповідей, вторинне приховування, нижня межа k."""

import json
import uuid

import pytest
from sqlalchemy import func, select, text

from app.db import SessionLocal, engine
from app.models import Response, ResponsePool
from app.services.anonymity import generalize, seal, suppressed_nodes, unseal
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


def test_answers_stay_encrypted_in_pool_until_close(client):
    campaign_id, q, admin = open_campaign(client, ("nazk-maturity-staff",))
    for i in range(1, 12):
        answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda _: 0)
    # Жодного переносу до закриття: усе в буфері.
    assert count(Response) == 0 and count(ResponsePool) == 11
    with SessionLocal() as db:
        rows = db.scalars(select(ResponsePool)).all()
        for row in rows:
            # У відкритому вигляді немає ні відповідей, ні підрозділу.
            assert row.unit_id is None
            assert set(row.answers) == {"v", "n", "c"}
            assert "question_id" not in json.dumps(row.answers)
        # Шифротекст розшифровується лише ключем застосунку.
        answers, unit = unseal(rows[0])
        assert answers and unit is not None
    close(client, campaign_id, admin)
    assert count(Response) == 11 and count(ResponsePool) == 0


def test_pool_ciphertext_differs_for_identical_answers():
    a = seal({"unit_id": None, "answers": [{"question_id": "x", "option_id": "y", "value": None}]})
    b = seal({"unit_id": None, "answers": [{"question_id": "x", "option_id": "y", "value": None}]})
    assert a["c"] != b["c"] and a["n"] != b["n"]


def test_legacy_plain_pool_rows_are_still_read():
    row = ResponsePool(answers=[{"question_id": "q", "option_id": None, "value": 3}], unit_id=None)
    assert unseal(row) == ([{"question_id": "q", "option_id": None, "value": 3}], None)


# ---------- Узагальнення підрозділу при зберіганні ----------

def test_generalize_lifts_small_units_to_parent():
    children = {"R": ["A", "B"], "A": ["A1", "A2"]}
    # A1 = 1, A2 = 6, B = 7: A2 і B самі по собі ≥ k, A1 — ні.
    label = generalize(children, {"A1": 1, "A2": 6, "B": 7}, "R", 5)
    assert label["B"] == "B"
    # A1 піднімається до кореня, але одна відповідь під коренем впізнавана → корінь приєднує найменшу групу (A2).
    assert label["A1"] == "R" and label["A2"] == "R"
    sizes = {}
    for u, t in label.items():
        sizes[t] = sizes.get(t, 0) + {"A1": 1, "A2": 6, "B": 7}[u]
    assert min(sizes.values()) >= 5


def test_generalize_every_label_has_at_least_k():
    children = {"R": ["A", "B", "V"], "A": ["A1", "A2"], "B": ["B1"]}
    direct = {"A": 4, "A1": 4, "A2": 1, "B": 2, "B1": 2, "V": 3}
    label = generalize(children, direct, "R", 5)
    sizes = {}
    for u, t in label.items():
        sizes[t] = sizes.get(t, 0) + direct[u]
    assert set(label) == set(direct)
    assert all(n >= 5 for n in sizes.values()), sizes


def test_small_unit_is_not_visible_in_storage(client):
    """Підрозділ з однією людиною: її відповідь зберігається під вищим підрозділом."""
    co = auth(client, "coordinator")
    u = units(client, auth(client, "admin"))
    root = u["Організація (демо)"]
    solo = client.post(f"{API}/admin/units", json={"name": "Solo", "parent_id": root}, headers=co).json()["id"]
    users = {x["login"]: x for x in client.get(f"{API}/admin/users", headers=co).json()}
    assert client.patch(f"{API}/admin/users/{users['staff01']['id']}", json={"unit_id": solo},
                        headers=co).status_code == 200
    campaign_id, q, admin = open_campaign(client, ("nazk-maturity-staff",))
    for i in range(1, 12):
        answer(client, campaign_id, q["nazk-maturity-staff"], f"staff{i:02d}", lambda _: 1)
    close(client, campaign_id, admin)
    with SessionLocal() as db:
        labels = [r.unit_id for r in db.scalars(select(Response))]
    assert uuid.UUID(solo) not in labels
    assert min(labels.count(x) for x in set(labels)) >= 5


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
    """Лише PostgreSQL: системне поле xmin відповідей не збігається з xmin записів участі.

    Відповіді переносяться з буфера однією транзакцією при закритті: у всіх відповідей хвилі один xmin.
    """
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
    assert len(set(responses)) == 1 and len(responses) == 10
