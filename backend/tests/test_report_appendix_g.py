"""Звіт за Додатком Г (крос-таблиці, збіги/розбіжності, висновок, пропозиції), Word/Excel
і перевірка заходів наступною хвилею."""

import io
from datetime import timedelta

from docx import Document
from openpyxl import load_workbook

from app.clock import frozen_on, today
from app.services import report_g
from tests.conftest import auth
from tests.helpers import API, full_wave


def dist(*percents):
    return [{"option_text": f"варіант {i}", "option_score": float(i), "count": 0, "percent": p}
            for i, p in enumerate(percents, start=1)]


def test_agreement_rules():
    same = report_g.agreement({"working_group": {"score": 60.0, "distribution": dist(0, 0, 60, 40, 0)},
                               "staff": {"score": 55.0, "distribution": dist(0, 10, 50, 40, 0)}})
    assert same["type"] == "consensus" and "рівень 3" in same["text"]

    far = report_g.agreement({"working_group": {"score": 80.0, "distribution": dist(0, 0, 0, 100, 0)},
                              "staff": {"score": 30.0, "distribution": dist(0, 100, 0, 0, 0)}})
    assert far["type"] == "divergence" and far["delta"] == 50.0 and "РГ оцінює вище" in far["text"]

    near = report_g.agreement({"working_group": {"score": 50.0, "distribution": dist(0, 0, 55, 45, 0)},
                               "staff": {"score": 45.0, "distribution": dist(0, 0, 45, 55, 0)}})
    assert near["type"] == "partial"

    alone = report_g.agreement({"working_group": {"score": 50.0, "distribution": dist(0, 0, 100, 0, 0)}})
    assert alone["type"] == "insufficient"


def test_modal_tie_takes_lower_level():
    assert report_g.modal(dist(0, 50, 50, 0, 0))["level"] == 2
    assert report_g.modal(dist(0, 0, 0, 0, 0)) is None


def test_report_has_appendix_g(client):
    campaign_id, _, _ = full_wave(client)
    leader = auth(client, "leader")
    report = client.get(f"{API}/campaigns/{campaign_id}/report", headers=leader).json()
    g = report["appendix_g"]

    titles = [s["title"] for s in g["sections"]]
    assert titles == ["Культура", "Система", "Підзвітність", "Рівень зрілості доброчесності"]
    culture = g["sections"][0]["questions"]
    assert [q["number"] for q in culture] == [f"1.{i}" for i in range(1, len(culture) + 1)]
    assert culture[0]["code"] == "culture.leader"  # порядок як в анкеті

    for section in g["sections"]:
        for q in section["questions"]:
            for c in q["categories"]:
                total = sum(r["percent"][c["category"]] or 0 for r in q["rows"])
                assert abs(total - 100) < 0.5, (q["code"], c["category"], total)
            assert {r["level"] for r in q["rows"]} <= {1, 2, 3, 4, 5}
            assert q["agreement"]["rule"]

    # РГ обирає останній варіант, ОС третій: на спільних питаннях розбіжність.
    values = next(q for q in culture if q["code"] == "culture.values")
    assert values["agreement"]["type"] == "divergence"
    # «Роль керівника» є лише в анкеті РГ: порівняти нема з чим.
    assert culture[0]["agreement"]["type"] == "insufficient"

    c = g["conclusion"]
    assert c["level"] == report["index"]["level"]
    assert len(c["effective"]) == 2 and len(c["attention"]) == 3
    assert c["attention"][0]["score"] <= c["effective"][0]["score"]
    assert c["facts"], "факти з інших систем мають бути у висновку"

    p = g["proposals"]
    assert p["target_level"]["level"] == min(p["current_level"]["level"] + 1, 5)
    assert any(x["code"] == "cut:accountability" for x in p["priorities"])
    assert {x["category"] for x in g["participants"]} == {"working_group", "staff", "expert"}


def test_report_word_and_excel(client):
    campaign_id, _, _ = full_wave(client)
    leader = auth(client, "leader")
    url = f"{API}/campaigns/{campaign_id}/report"

    r = client.get(url, params={"format": "docx"}, headers=leader)
    assert r.status_code == 200 and "wordprocessingml" in r.headers["content-type"]
    assert 'filename="integrity-report-' in r.headers["content-disposition"]
    doc = Document(io.BytesIO(r.content))
    text = "\n".join(p.text for p in doc.paragraphs)
    for part in ("ЗВІТ", "Основна частина", "Висновок", "Пропозиції", "Найбільш ефективні напрями"):
        assert part in text
    assert len(doc.tables) >= 10  # крос-таблиця на кожне питання

    r = client.get(url, params={"format": "xlsx"}, headers=leader)
    assert r.status_code == 200 and "spreadsheetml" in r.headers["content-type"]
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Підсумок", "Крос-таблиці", "Збіги і розбіжності", "Компоненти", "Факти", "Рекомендації", "Заходи"]
    assert wb["Крос-таблиці"].max_row > 40

    assert client.get(url, params={"format": "pdf"}, headers=leader).status_code == 422
    assert client.get(url, params={"format": "docx"}, headers=auth(client, "staff01")).status_code == 403


def test_measure_verified_by_next_wave(client):
    first_day = today() - timedelta(days=30)
    with frozen_on(first_day):
        first, _, root = full_wave(client, title="Хвиля 1")
    leader = auth(client, "leader")

    def create(title):
        r = client.post(f"{API}/measures", headers=leader, json={
            "unit_id": root, "campaign_id": first, "component": "culture", "title": title,
            "owner": "Антикорупційний уповноважений", "due_date": str(today() + timedelta(days=30))})
        assert r.status_code == 201, r.text
        return r.json()

    done, pending = create("Навчання з доброчесності"), create("Оновити сторінку на сайті")
    assert pending["verification"]["status"] == "not_done"
    r = client.patch(f"{API}/measures/{done['id']}", headers=leader, json={
        "status": "done", "evidence": "Протокол навчання (синтетичний)", "done_on": str(first_day + timedelta(days=5))})
    assert r.status_code == 200, r.text
    assert r.json()["verification"]["status"] == "awaiting_wave"

    # Друга хвиля: особовий склад обирає найвищі варіанти, Культура зростає.
    second, _, _ = full_wave(client, title="Хвиля 2", staff_pick=4)
    v = client.get(f"{API}/measures/{done['id']}", headers=leader).json()["verification"]
    assert v["next_campaign_id"] == second and v["next_campaign_title"] == "Хвиля 2"
    assert v["baseline_campaign_id"] == first
    assert v["delta"] is not None and v["delta"] > 0
    # Числа ті самі, що в динаміці результатів другої хвилі; статус за правилом значущості методики.
    dyn = client.get(f"{API}/campaigns/{second}/results", headers=leader).json()["dynamics"]
    culture = next(c for c in dyn["components"] if c["code"] == "culture")
    assert (v["previous"], v["current"], v["delta"]) == (culture["previous"], culture["current"], culture["delta"])
    assert v["status"] == culture["significance"]["code"] and v["rule"]

    listed = {x["id"]: x for x in client.get(f"{API}/measures", headers=leader).json()}
    assert listed[done["id"]]["verification"]["delta"] == v["delta"]
    assert listed[pending["id"]]["verification"]["status"] == "not_done"

    report = client.get(f"{API}/campaigns/{first}/report", headers=leader).json()
    assert {x["id"]: x["verification"]["status"] for x in report["measures"]}[done["id"]] == v["status"]


def test_report_templates(client):
    """Чотири шаблони: перелік, свій Word для кожного, JSON із полем template, невідомий шаблон — 422."""
    campaign_id, _, _ = full_wave(client)
    leader = auth(client, "leader")
    templates = client.get(f"{API}/report-templates", headers=leader).json()
    assert [t["code"] for t in templates] == ["appendix_g", "brief", "measures", "dynamics"]
    assert all(t["title"] and t["description"] for t in templates)
    assert client.get(f"{API}/report-templates", headers=auth(client, "staff01")).status_code == 403

    url = f"{API}/campaigns/{campaign_id}/report"
    assert client.get(url, headers=leader).json()["template"]["code"] == "appendix_g"
    assert client.get(url, params={"template": "brief"}, headers=leader).json()["template"]["title"] == "Довідка керівнику"
    expected = {
        "brief": ("ДОВІДКА КЕРІВНИКУ", "Головне", "Компоненти", "Потрібне рішення керівника"),
        "measures": ("СТАН ВИКОНАННЯ ПЛАНУ ЗАХОДІВ",),
        "dynamics": ("ДИНАМІКА МІЖ ХВИЛЯМИ", "Попередньої закритої хвилі"),  # перша хвиля: порівнювати нема з чим
    }
    for code, parts in expected.items():
        r = client.get(url, params={"format": "docx", "template": code}, headers=leader)
        assert r.status_code == 200, r.text
        assert f'filename="integrity-report-{code}-' in r.headers["content-disposition"]
        text = "\n".join(p.text for p in Document(io.BytesIO(r.content)).paragraphs)
        for part in parts:
            assert part in text, (code, part)
        assert "Основна частина" not in text  # не повний Додаток Г
    assert client.get(url, params={"template": "nope"}, headers=leader).status_code == 422


def test_report_template_dynamics_and_measures_after_two_waves(client):
    from tests.helpers import full_wave as wave

    wave(client, title="Хвиля 1")
    campaign_id, _, _ = wave(client, title="Хвиля 2", staff_pick=3)
    leader = auth(client, "leader")
    url = f"{API}/campaigns/{campaign_id}/report"
    doc = Document(io.BytesIO(client.get(url, params={"format": "docx", "template": "dynamics"}, headers=leader).content))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "«Хвиля 1»" in text and "Зміна" in text
    assert doc.tables and doc.tables[0].rows[0].cells[0].text == "Компонент"
