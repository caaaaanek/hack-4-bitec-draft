"""Словник термінів асистента (app/data/glossary.json) і інструмент explain_term."""

import json
import re

from app.services import assistant_tools
from app.services.assistant_tools import find_terms, glossary
from app.services.methodology import COMPONENTS, MATURITY_LEVELS
from tests.conftest import auth
from tests.test_llm import final, llm_env, scripted_model, tool_call  # noqa: F401 — фікстура llm_env


def _names(term):
    return [term["term"], *term.get("aliases", [])]


def test_every_term_is_complete():
    terms = glossary()
    assert len(terms) >= 30
    for t in terms:
        assert t["term"].strip() and t["definition"].strip() and t["source"].strip(), t
        assert len(t["definition"]) <= 500, t["term"]


def test_names_are_unique():
    seen = {}
    for t in glossary():
        for name in _names(t):
            key = name.casefold()
            assert key not in seen, f"«{name}» є і в «{seen[key]}», і в «{t['term']}»"
            seen[key] = t["term"]


def test_levels_and_components_match_methodology():
    """Назви рівнів і компонентів — ті самі, що в методиці, тож словник не розійдеться з розрахунком."""
    terms = {t["term"] for t in glossary()}
    assert {x["title"] for x in MATURITY_LEVELS} <= terms
    assert {c["title"] for c in COMPONENTS.values()} <= terms


def test_definitions_do_not_duplicate_methodology_numbers():
    """Ваги, пороги й межі рівнів дає get_methodology; у визначеннях їх немає, щоб не розійтися з кодом."""
    for t in glossary():
        assert not re.search(r"\d+,\d|\d+\s*%|\d+\s*бал", t["definition"]), t["term"]  # дати наказів (17.04.2025) можна
        assert "Integrity Index" not in t["definition"], t["term"]  # модель повторює визначення дослівно


def test_find_exact_alias_and_partial():
    assert find_terms("Додаток Б")[0]["term"] == "Контрольний чек-лист"
    assert find_terms("що таке правило реальності?")[0]["term"] == "Правило реальності"
    assert find_terms("tone at the top")[0]["term"] == "«Тон згори»"
    assert find_terms("Integrity Index")[0]["term"] == "Індекс доброчесності"
    assert find_terms("c")[0]["term"] == "Достовірність"  # однолітерний синонім — лише точний збіг
    assert find_terms("зовсім невідоме слово") == []


def test_explain_term_tool(client):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import User

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.login == "leader_a"))
        _check_explain_term(db, user)


def _check_explain_term(db, user):
    out = json.loads(assistant_tools.run_tool(db, user, "explain_term", {"term": "викривач"}))
    assert out["items"][0]["term"] == "Викривач" and out["items"][0]["source"]
    assert "access_scope" not in out  # довідка, а не дані підрозділу
    missing = json.loads(assistant_tools.run_tool(db, user, "explain_term", '{"term": "квантова доброчесність"}'))
    assert "error" in missing and "Викривач" in missing["terms"]
    everything = json.loads(assistant_tools.run_tool(db, user, "explain_term", {}))
    assert len(everything["terms"]) == len(glossary())


def test_model_explains_term_via_tool(client, llm_env, monkeypatch):  # noqa: F811
    llm_env(LLM_ALLOW_EXTERNAL="true", LLM_BASE_URL="https://llm.example.test/v1", LLM_MODEL="gemma4-26b")
    calls = scripted_model(monkeypatch, [(200, tool_call("explain_term", '{"term": "Додаток Д"}')),
                                         (200, final("План трансформації — це…"))])
    r = client.post("/api/assistant", json={"question": "Що таке Додаток Д?"}, headers=auth(client, "leader"))
    assert r.status_code == 200, r.text
    assert r.json()["tools"] == ["explain_term"]
    assert "explain_term" in {t["function"]["name"] for t in calls[0]["tools"]}
    assert "explain_term" in calls[0]["messages"][0]["content"]  # правило в системному промпті
    tool_msg = next(m for m in calls[1]["messages"] if m["role"] == "tool")
    assert "План трансформації" in tool_msg["content"] and "Рекомендації НУОУ" in tool_msg["content"]
