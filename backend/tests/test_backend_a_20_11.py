"""Таски людини A після аудиту 20.11: вибір хвилі з індексом, перемикач хвиль, null ≠ 0, правила достовірності."""

import uuid

from tests.conftest import auth
from tests.helpers import API, close, full_wave, questionnaire_ids, units

STAFF = "nazk-maturity-staff"


def partial_wave(client, admin, unit_name="Підрозділ Б", title="Власна анкета Б"):
    """Хвиля з однією анкетою для одного дочірнього підрозділу, без відповідей: індексу в ній немає."""
    q = questionnaire_ids(client, admin)
    r = client.post(f"{API}/campaigns", json={"title": title, "unit_id": units(client, admin)[unit_name],
                                              "questionnaire_ids": [q[STAFF]]}, headers=admin)
    assert r.status_code == 201, r.text
    campaign_id = r.json()["id"]
    assert client.post(f"{API}/campaigns/{campaign_id}/open", headers=admin).status_code == 200
    close(client, campaign_id, admin)
    return campaign_id


# ---------- A1: «поточна» хвиля з урахуванням охоплення ----------

def test_no_indexed_wave_is_404_not_substitute(client):
    admin = auth(client, "admin")
    r = client.get(f"{API}/dashboard", headers=admin)
    assert r.status_code == 404 and r.json()["code"] == "no_indexed_wave", r.text
    partial_wave(client, admin)
    r = client.get(f"{API}/dashboard", headers=admin)  # хвиля лише для Підрозділу Б не стає «поточною» закладу
    assert r.status_code == 404 and r.json()["code"] == "no_indexed_wave", r.text


def test_partial_wave_does_not_replace_full_one(client):
    first, admin, root = full_wave(client, title="Хвиля 1")
    second, _, _ = full_wave(client, title="Хвиля 2")
    partial = partial_wave(client, admin)

    for headers in (admin, auth(client, "leader")):
        d = client.get(f"{API}/dashboard", headers=headers).json()
        assert d["campaign_id"] == second and d["unit_id"] == root, d.get("campaign_title")
        assert d["index"]["score"] is not None
        assert d["index_delta"] is not None  # рахується від попередньої повної хвилі

    # Явно обрана хвиля без індексу відкривається, але дельту від неї ніхто не рахує.
    b = units(client, admin)["Підрозділ Б"]
    d = client.get(f"{API}/dashboard", params={"campaign_id": partial, "unit_id": b}, headers=admin).json()
    assert d["index"]["score"] is None and d["index_delta"] is None
    assert first != second


# ---------- A2: перемикач хвилі і розрив у динаміці ----------

def test_waves_list_marks_index_and_current(client):
    first, admin, root = full_wave(client, title="Хвиля 1")
    second, _, _ = full_wave(client, title="Хвиля 2")
    partial = partial_wave(client, admin)

    waves = client.get(f"{API}/dashboard/waves", headers=admin).json()
    assert [w["id"] for w in waves] == [second, first]  # від нових до старих; часткова хвиля корінь не охоплює
    assert [w["is_current"] for w in waves] == [True, False]
    assert all(w["has_index"] and w["unit_name"] for w in waves)

    b = units(client, admin)["Підрозділ Б"]
    by_id = {w["id"]: w for w in client.get(f"{API}/dashboard/waves", params={"unit_id": b}, headers=admin).json()}
    assert set(by_id) == {first, second, partial}
    assert by_id[partial]["has_index"] is False and by_id[partial]["unit_name"] == "Підрозділ Б"
    # У Підрозділі Б груп менше k, індексу не було в жодній хвилі: поточна — остання закрита (з null), а не 404.
    assert not any(w["has_index"] for w in by_id.values())
    assert [w["id"] for w in by_id.values() if w["is_current"]] == [partial]

    leader_waves = client.get(f"{API}/dashboard/waves", headers=auth(client, "leader")).json()
    assert [w["id"] for w in leader_waves] == [second, first]

    trend = client.get(f"{API}/dashboard", params={"campaign_id": partial, "unit_id": b}, headers=admin).json()["trend"]
    gap = next(t for t in trend if t["campaign_id"] == partial)
    assert gap["has_index"] is False and gap["index"] is None  # розрив, а не нуль


# ---------- A3: контракт «немає даних = null, а не 0» і кількість респондентів ----------

def test_no_data_is_null_not_zero(client):
    first, admin, _ = full_wave(client, title="Хвиля 1")
    partial = partial_wave(client, admin)
    b = units(client, admin)["Підрозділ Б"]
    d = client.get(f"{API}/dashboard", params={"campaign_id": partial, "unit_id": b}, headers=admin).json()
    assert d["index"]["score"] is None
    assert d["components"] and all(c["score"] is None for c in d["components"]), d["components"]
    assert d["index_delta"] is None
    point = next(t for t in d["trend"] if t["campaign_id"] == partial)
    assert point["index"] is None and point["index_self"] is None

    r = client.get(f"{API}/campaigns/{partial}/results", params={"unit_id": b}, headers=admin).json()
    assert r["index"]["score"] is None and all(c["score"] is None for c in r["components"])


def test_report_groups_count_real_participation(client):
    """submitted у звіті — це кількість Participation, а не оцінка фронтенду (respGroups)."""
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import Participation

    campaign_id, admin, _ = full_wave(client)
    report = client.get(f"{API}/campaigns/{campaign_id}/report", params={"format": "json"}, headers=admin).json()
    with SessionLocal() as db:
        counts = dict(db.execute(select(Participation.questionnaire_id, func.count())
                                 .where(Participation.campaign_id == uuid.UUID(campaign_id))
                                 .group_by(Participation.questionnaire_id)).all())
    groups = {g["category"]: g for g in report["groups"]}
    expected = {"staff": 6, "working_group": 5, "expert": 5}  # стільки відповідає full_wave
    for category, n in expected.items():
        g = groups[category]
        assert g["submitted"] == n == counts[next(k for k in counts if str(k) == g["questionnaire_id"])], g
        assert g["eligible"] >= g["submitted"]


# ---------- A4: правила достовірності з одного джерела ----------

def test_methodology_explains_every_flag_with_thresholds(client):
    from app.services import candor
    from app.services import methodology as m

    rel = client.get(f"{API}/methodology", headers=auth(client, "leader")).json()["reliability"]
    assert set(rel["flags"]) == set(m.FLAGS)  # усі 11, а не 4 демо-прапорці
    for code, f in rel["flags"].items():
        assert f["title"] and f["severity"] in ("serious", "minor", "info") and len(f["explain"]) > 20, code
    # Пороги підставлені з констант, тож текст не розійдеться з розрахунком.
    assert f"{m.PARTICIPATION_MIN_PERCENT:g} %" in rel["flags"]["low_participation"]["explain"]
    assert f"{m.PERFECT_SHARE_MAX * 100:g} %" in rel["flags"]["suspiciously_perfect"]["explain"]
    assert f"{m.CATEGORY_GAP_POINTS:g}" in rel["flags"]["category_gap"]["explain"]
    assert f"{candor.CONCEALMENT_GAP_POINTS:g}" in rel["flags"]["concealment"]["explain"]
    assert set(rel["grades"]) >= {"A", "B", "C"}
    assert str(m.MINOR_FLAGS_FOR_C) in rel["grades"]["C"]


def test_grade_rule_text_matches_reliability_function():
    """Текст правила A/B/C описує саме те, що рахує reliability()."""
    from app.services import methodology as m

    minor = [c for c, f in m.FLAGS.items() if f["severity"] == "minor"]
    serious = next(c for c, f in m.FLAGS.items() if f["severity"] == "serious")
    info = [c for c, f in m.FLAGS.items() if f["severity"] == "info"]
    assert m.reliability(info) == "A"  # «до відома» літеру не змінює
    assert m.reliability(minor[:m.MINOR_FLAGS_FOR_C - 1]) == "B"
    assert m.reliability(minor[:m.MINOR_FLAGS_FOR_C]) == "C"
    assert m.reliability([serious]) == "C"


# ---------- A5: рекомендації без повторів, з рангом, групами й цілими словами ----------

def test_shorten_cuts_on_word_boundary():
    from app.services.text import shorten

    assert shorten("коротко", 90) == "коротко"
    long = "Забезпечити проведення перевірки декларацій посадових осіб у встановлені законом строки " * 2
    cut = shorten(long, 90)
    assert len(cut) <= 90 and cut.endswith("…")
    assert long.startswith(cut[:-1]) and long[len(cut) - 1] == " "  # ріже перед пробілом, а не посеред слова


def test_recommendations_are_unique_ranked_and_grouped(client):
    from app.services.recommendations import TITLE_MAX

    campaign_id, admin, _ = full_wave(client, staff_pick=0, checklist_status="none")
    body = client.get(f"{API}/campaigns/{campaign_id}/recommendations", headers=admin).json()
    items = body["items"]
    assert len(items) > 5, [i["code"] for i in items]
    assert body["total"] == len(items)

    titles = [" ".join(i["title"].casefold().split()) for i in items]
    assert len(titles) == len(set(titles)), titles
    numbers = [x["catalog_number"] for i in items for x in i["suggested_measures"] if x["catalog_number"]]
    assert len(numbers) == len(set(numbers)), numbers  # кожен захід Додатка Д — лише в одній рекомендації
    codes = {i["code"] for i in items}
    assert not codes & {c for i in items for c in i["covers"]}

    for i in items:
        assert len(i["title"]) <= TITLE_MAX, i["title"]
        assert i["description"].strip() != i["rule"].strip(), i["code"]  # обґрунтування не повторює опис
    assert [i["rank"] for i in items] == list(range(1, len(items) + 1))
    assert not any(i["collapsed"] for i in items)
    assert sum(g["count"] for g in body["groups"]) == len(items)
    assert {g["group"] for g in body["groups"]} == {i["group"] for i in items}

    top = client.get(f"{API}/campaigns/{campaign_id}/recommendations", params={"top": 5}, headers=admin).json()["items"]
    assert [i["collapsed"] for i in top] == [False] * 5 + [True] * (len(top) - 5)

    d = client.get(f"{API}/dashboard", headers=admin).json()
    assert d["recommendations_total"] == len(items)
    assert [r["code"] for r in d["recommendations"]] == [i["code"] for i in items[:5]]


def test_question_title_and_title_duplicates():
    from app.services.recommendations import TITLE_MAX, _rec, dedupe
    from app.services.text import shorten

    text = "Чи повідомляють працівники про конфлікт інтересів керівникові до прийняття рішення, яке його стосується"
    title = f"Слабке місце: «{shorten(text, TITLE_MAX - 16)}»"
    assert len(title) <= TITLE_MAX and title.endswith("…»")
    recs = dedupe([_rec("a", "high", None, "Те саме", "x", "y"), _rec("b", "low", None, "те  саме", "x", "y")])
    assert [r["code"] for r in recs] == ["a"] and recs[0]["covers"] == ["b"]


# ---------- A6: у текстах — людські назви, а не службові коди ----------

RAW_CODES = ("none", "partial", "full", "planned", "in_progress", "cancelled", "clarify")


def has_raw_code(text: str) -> bool:
    import re

    return any(re.search(rf"(?<![\w-]){code}(?![\w-])", text) for code in RAW_CODES)


def test_what_if_texts_have_no_raw_statuses(client):
    campaign_id, _, _ = full_wave(client, checklist_status="none")
    leader = auth(client, "leader")
    body = client.post(f"{API}/campaigns/{campaign_id}/what-if", json={}, headers=leader).json()
    levers = body["levers"]
    assert levers, body.keys()
    for lever in levers:
        assert not has_raw_code(lever["change"]), lever["change"]
    item = next(x for x in levers if x["kind"] == "checklist")
    assert "не впроваджено → повністю" in item["change"]

    applied = client.post(f"{API}/campaigns/{campaign_id}/what-if", json={"checklist": {item["number"]: "partial"}},
                          headers=leader).json()["applied"]
    assert applied[0]["note"].startswith("не впроваджено → частково"), applied[0]["note"]


def test_titles_cover_every_enum_value():
    from app.models import MeasureStatus, RecommendationDecisionType, Role
    from app.services import titles

    assert set(titles.MEASURE_STATUS_TITLES) == {s.value for s in MeasureStatus}
    assert set(titles.DECISION_TITLES) == {d.value for d in RecommendationDecisionType}
    assert set(titles.ROLE_TITLES) == {r.value for r in Role}
    assert titles.checklist_status(None) == "не заповнено" and titles.checklist_status("none") == "не впроваджено"


# ---------- A8: «джерело → його питання» для «Розкладу» ----------

def test_breakdown_source_questions(client):
    campaign_id, admin, _ = full_wave(client)
    url = f"{API}/campaigns/{campaign_id}/breakdown"
    leader = auth(client, "leader")

    overview = client.get(url, headers=leader).json()
    sources = {s["category"]: s for s in overview["sources"]}
    assert {"staff", "working_group", "expert"} <= set(sources)
    assert sources["staff"]["sufficient"] and sources["staff"]["questions"] > 0 and sources["staff"]["title"]
    assert overview["questions"] == [] and overview["source"] is None

    staff = client.get(url, params={"source": "staff"}, headers=leader).json()
    assert staff["sufficient"] is True and len(staff["questions"]) == sources["staff"]["questions"]
    k = staff["min_group_size"]
    assert all(q["n"] >= k and q["score"] is not None for q in staff["questions"])

    culture = client.get(url, params={"source": "staff", "component": "culture"}, headers=leader).json()["questions"]
    assert culture and all(q["component"] == "culture" for q in culture)
    assert len(culture) < len(staff["questions"])

    r = client.get(url, params={"source": "nobody"}, headers=leader)
    assert r.status_code == 422 and r.json()["code"] == "unknown_source"
    r = client.get(url, params={"component": "x"}, headers=leader)
    assert r.status_code == 422 and r.json()["code"] == "unknown_component"


def test_breakdown_hides_group_below_k(client):
    full_wave(client)
    admin = auth(client, "admin")
    partial = partial_wave(client, admin)
    b = units(client, admin)["Підрозділ Б"]
    body = client.get(f"{API}/campaigns/{partial}/breakdown", params={"unit_id": b, "source": "staff"},
                      headers=admin).json()
    assert body["sufficient"] is False and body["questions"] == []
    assert f"k = {body['min_group_size']}" in body["note"]
