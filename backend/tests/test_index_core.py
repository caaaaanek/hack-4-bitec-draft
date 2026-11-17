"""Ядро методики v2 (scoring.combine) і правила з methodology.py без БД."""

import pytest

from app.services import methodology as m
from app.services.scoring import combine


def lv(level: float) -> float:
    """Рівень 1-5 у бали 0-100."""
    return (level - 1) * 25


ABSENT = object()  # джерела немає в хвилі взагалі (на відміну від None — "менше k відповідей")


def component(staff=ABSENT, wg=ABSENT, expert=ABSENT, checklist=ABSENT, facts=(), common=None, flags=()):
    given = {"staff": staff, "working_group": wg, "expert": expert, "checklist": checklist}
    return {
        "sources": {k: v for k, v in given.items() if v is not ABSENT},
        "common": common,
        "facts": list(facts),
        "flags": list(flags),
    }


def by_code(result):
    return {c["code"]: c for c in result["components"]}


def test_example_from_methodology():
    """Приклад з ТЗ: II = 47 (без фактів 52), рівень «Визначений», достовірність C."""
    inputs = {
        "culture": component(lv(2.6), lv(3.4), lv(2.8), lv(3.2), facts=[lv(2)],
                             common={"working_group": lv(3.4), "staff": lv(2.6)}),
        "system": component(lv(2.9), lv(3.8), lv(3.0), lv(3.8), facts=[lv(4)],
                            common={"working_group": lv(3.8), "staff": lv(2.9)}),
        "accountability": component(lv(2.2), lv(3.9), lv(2.5), lv(3.4), facts=[lv(1), lv(1), lv(2)],
                                    common={"working_group": lv(3.9), "staff": lv(2.2)}),
    }
    result = combine(inputs)
    c = by_code(result)

    assert c["culture"]["level_value"] == pytest.approx(2.96)
    assert c["system"]["level_value"] == pytest.approx(3.33, abs=0.01)
    assert c["accountability"]["self_score"] == pytest.approx(lv(2.925), abs=0.05)
    assert c["accountability"]["facts_score"] == pytest.approx(8.3)
    assert c["accountability"]["score"] == pytest.approx(33.3)
    assert c["accountability"]["cut_by_facts"] is True
    assert c["culture"]["cut_by_facts"] is False and c["system"]["cut_by_facts"] is False

    index = result["index"]
    assert round(index["score"]) == 47
    assert round(index["self_score"]) == 52
    assert index["level"] == {"level": 3, "title": "Визначений"}
    assert index["reliability"] == "C"
    flags = {f["code"] for f in c["accountability"]["flags"]}
    assert {"self_not_confirmed", "category_gap"} <= flags
    assert c["culture"]["reliability"] == "A" and c["system"]["reliability"] == "A"


def test_reality_rule_cuts_self_assessment():
    """S = 48, F = 8,3 → L = 33,3 і прапорець self_not_confirmed."""
    inputs = {"culture": component(staff=48, facts=[0, 0, 25])}
    c = by_code(combine(inputs))["culture"]
    assert c["self_score"] == 48
    assert c["score"] == pytest.approx(33.3)
    assert "self_not_confirmed" in {f["code"] for f in c["flags"]}
    assert c["rule"] == "Самооцінка 48 знижена до 33,3: факти показують 8,3 (+25)."


def test_better_facts_do_not_raise_score():
    inputs = {"system": component(staff=30, facts=[100])}
    c = by_code(combine(inputs))["system"]
    assert c["score"] == 30
    assert "unaware_of_mechanisms" in {f["code"] for f in c["flags"]}
    assert c["reliability"] == "A"  # інформаційний прапорець на достовірність не впливає


def test_no_facts_keeps_self_assessment_with_minor_flag():
    c = by_code(combine({"culture": component(staff=60)}))["culture"]
    assert c["score"] == 60
    assert [f["code"] for f in c["flags"]] == ["no_facts"]
    assert c["reliability"] == "B"


def test_weight_redistribution_when_experts_missing():
    """Експертів менше k: вага 0,20 ділиться між рештою пропорційно (0,35 : 0,25 : 0,20)."""
    inputs = {"culture": component(staff=40, wg=80, expert=None, checklist=60, facts=[50])}
    c = by_code(combine(inputs))["culture"]
    expected = (0.35 * 40 + 0.25 * 80 + 0.20 * 60) / 0.80
    assert c["self_score"] == pytest.approx(round(expected, 1))
    weights = {s["source"]: s["effective_weight"] for s in c["sources"]}
    assert weights["expert"] == 0
    assert weights["staff"] == pytest.approx(0.4375, abs=0.001)
    assert "low_participation" in {f["code"] for f in c["flags"]}


def test_missing_checklist_does_not_flag_participation():
    inputs = {"culture": component(staff=40, wg=40, expert=40, checklist=None, facts=[40])}
    c = by_code(combine(inputs))["culture"]
    assert c["flags"] == []
    assert c["reliability"] == "A"


@pytest.mark.parametrize(
    ("flags", "grade"),
    [
        ([], "A"),
        (["no_facts"], "B"),
        (["no_facts", "checklist_unconfirmed"], "B"),
        (["no_facts", "checklist_unconfirmed", "low_participation"], "C"),
        (["category_gap"], "C"),
        (["suspiciously_perfect"], "C"),
        (["unaware_of_mechanisms"], "A"),
    ],
)
def test_reliability_grades(flags, grade):
    assert m.reliability(flags) == grade


def test_index_reliability_is_worst_of_components():
    inputs = {
        "culture": component(staff=60, facts=[60]),
        "system": component(staff=60, facts=[60]),
        "accountability": component(staff=60, facts=[60], flags=["suspiciously_perfect"]),
    }
    result = combine(inputs)
    assert result["index"]["reliability"] == "C"
    assert any("Підзвітність" in r for r in result["index"]["reliability_reasons"])


def test_weak_link_caps_overall_level():
    """Середнє дає рівень 4, але найслабший компонент на рівні 1 → загальний рівень не вищий за 2."""
    inputs = {
        "culture": component(staff=100, facts=[100]),
        "system": component(staff=100, facts=[100]),
        "accountability": component(staff=10, facts=[0]),
    }
    index = combine(inputs)["index"]
    assert index["score"] == 70.0
    assert index["level_uncapped"]["level"] == 4
    assert index["level"] == {"level": 2, "title": "Керований"}
    assert index["weak_link_applied"] is True
    assert "Рівень обмежено до 2" in index["rule"]


@pytest.mark.parametrize(
    ("delta", "grades", "code"),
    [
        (4, ["A", "A"], "within_error"),
        (-4.9, ["C", "A"], "within_error"),
        (6, ["A", "C"], "check_data"),
        (6, ["A", "B"], "improved"),
        (-7, ["B", "B"], "worsened"),
    ],
)
def test_significance(delta, grades, code):
    assert m.significance(delta, grades)["code"] == code


def test_fact_levels_by_thresholds():
    assert m.fact_level("declarations_on_time", 96) == 4
    assert m.fact_level("declarations_on_time", 79.9) == 1
    assert m.fact_level("training_coverage", 72) == 3
    assert m.fact_level("reports_handled", 100) == 5
    assert m.fact_level("reports_handled", 99.9) == 4


def test_combine_is_deterministic():
    inputs = {"culture": component(staff=41.3, wg=77.7, expert=55.5, checklist=62.5, facts=[25, 50])}
    assert combine(inputs) == combine(inputs)


def test_checklist_mapping_covers_all_items():
    assert m.checklist_component("4.3.1") == "accountability"
    assert m.checklist_component("1.1") == "system"
    assert m.checklist_component("5.4") == "culture"
    assert m.checklist_component("9.9") is None
