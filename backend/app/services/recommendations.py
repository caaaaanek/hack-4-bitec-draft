"""Recommendations Engine: явні правила без ШІ.

Вхід: результати хвилі (знімок, як їх віддає results_for) і, за потреби, ризик-сигнали.
Вихід: список рекомендацій зі стабільним кодом, пріоритетом, поясненням `rule`
і запропонованими заходами з типового плану (Додаток Д Рекомендацій НУОУ).

Ті самі вхідні дані завжди дають ті самі рекомендації в тому самому порядку.
"""

import json
from functools import lru_cache
from pathlib import Path

from app.services import methodology as m
from app.services.scoring import fmt
from app.services.text import shorten

CATALOG_FILE = Path(__file__).resolve().parent.parent / "seed" / "data" / "measures_catalog.json"

PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
PRIORITY_TITLES = {"high": "високий", "medium": "середній", "low": "низький"}

# Довжина назви рекомендації: довші обрізаються по межі слова, повний текст лишається в `basis`.
TITLE_MAX = 90
GENERAL_GROUP = "general"
GENERAL_GROUP_TITLE = "Загальне"

# Поріг "слабкого" питання чи факту: нижче рівня 3 («Визначений»).
WEAK_SCORE = 37.5
WEAK_FACT_LEVEL = 2

# Який пункт типового плану виправляє показник фактів.
FACT_MEASURES: dict[str, list[str]] = {
    "declarations_on_time": ["2.5", "2.3"],
    "training_coverage": ["2.6", "5.2"],
    "coi_reviewed": ["4.1.2", "4.1.1"],
    "procurement_flags_reviewed": ["4.5.2", "4.5.1"],
    "reports_handled": ["2.7"],
    "hiring_checks": ["4.1.1", "2.2"],
}

# Заходи, яких немає в типовому плані, але які прямо випливають із прапорців достовірності.
GENERIC_MEASURES: dict[str, dict] = {
    "discuss_results": {
        "title": "Обговорити результати оцінювання з особовим складом і робочою групою, з'ясувати причини розбіжності оцінок",
        "responsible": "Керівник, робоча група, антикорупційний уповноважений",
        "indicator": "Проведено обговорення, зафіксовано причини розбіжності й узгоджені кроки",
    },
    "repeat_survey": {
        "title": "Пояснити гарантії анонімності й повторити опитування в наступній хвилі",
        "responsible": "Робоча група",
        "indicator": "Частка анкет лише з найвищими відповідями нижча за поріг",
    },
    "raise_participation": {
        "title": "Підвищити участь в опитуванні: роз'яснення мети, час на проходження у робочий час",
        "responsible": "Керівники підрозділів, робоча група",
        "indicator": f"Участь кожної категорії не менша за {m.PARTICIPATION_MIN_PERCENT:g}%",
    },
    "confirm_checklist": {
        "title": "Зібрати докази й підтвердити пункти контрольного чек-листа",
        "responsible": "Робоча група, розробник анкет (підтверджує)",
        "indicator": f"Підтверджено не менше {m.CHECKLIST_CONFIRMED_MIN_SHARE:.0%} пунктів чек-листа",
    },
    "connect_facts": {
        "title": "Підключити джерела фактів (декларації, навчання, повідомлення, закупівлі) для перевірки самооцінки",
        "responsible": "Адміністратор системи, власники систем-джерел",
        "indicator": "Для кожного компонента є хоча б один факт",
    },
    "communicate_mechanisms": {
        "title": "Поінформувати особовий склад про наявні механізми доброчесності (канали повідомлень, навчання, політики)",
        "responsible": "Антикорупційний уповноважений",
        "indicator": "Самооцінка наблизилась до рівня фактів у наступній хвилі",
    },
    "whistleblower_protection": {
        "title": "Посилити захист викривачів: анонімний канал, гарантії нерозголошення, публічні приклади розгляду без наслідків для заявника",
        "responsible": "Антикорупційний уповноважений, керівник",
        "indicator": "Розрив між прямою і непрямою оцінкою в наступній хвилі зменшився",
    },
    "social_norms": {
        "title": "Кампанія соціальних норм: показати особовому складу реальну частку тих, хто готовий повідомити про порушення",
        "responsible": "Антикорупційний уповноважений, робоча група",
        "indicator": "Розрив «я — колеги» у «дзеркалі» наступної хвилі зменшився",
    },
    "check_gaming": {
        "title": "Перевірити сигнали підгонки показників: первинні документи, дати змін, вибіркова перевірка аудитом",
        "responsible": "Внутрішній аудит",
        "indicator": "Сигнали детектора Гудхарта пояснено або усунено",
    },
    "review_risks": {
        "title": "Розібрати накопичені ризик-сигнали та налагодити розгляд у встановлені строки",
        "responsible": "Антикорупційний уповноважений",
        "indicator": "Кількість нерозглянутих сигналів зменшилась",
    },
}


@lru_cache
def catalog() -> dict[str, dict]:
    data = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    return {item["number"]: item for item in data["items"]}


def catalog_measure(number: str) -> dict | None:
    item = catalog().get(number)
    if item is None:
        return None
    return {"catalog_number": number, "title": item["title"], "responsible": item["responsible"],
            "indicator": item["indicator"], "source": "Додаток Д"}


def generic_measure(key: str) -> dict:
    return {"catalog_number": None, **GENERIC_MEASURES[key], "source": "правило системи"}


def component_numbers(component: str) -> list[str]:
    """Номери пунктів чек-листа (і типового плану), що належать компоненту."""
    return [n for n in catalog() if m.checklist_component(n) == component]


def _rec(code, priority, component, title, description, rule, basis=None, measures=None, pick=None) -> dict:
    """`pick` — скільки заходів лишити після дедуплікації: решта `measures` — запасні кандидати."""
    component_title = m.COMPONENTS[component]["title"] if component in m.COMPONENTS else None
    return {
        "code": code,
        "priority": priority,
        "priority_title": PRIORITY_TITLES[priority],
        "component": component,
        "component_title": component_title,
        "group": component if component_title else GENERAL_GROUP,
        "group_title": component_title or GENERAL_GROUP_TITLE,
        "title": shorten(title, TITLE_MAX),
        "description": description,
        "rule": rule,
        "basis": basis or {},
        "suggested_measures": [x for x in (measures or []) if x],
        "covers": [],
        "pick": pick,
    }


def dedupe(recs: list[dict]) -> list[dict]:
    """Прибрати повтори (у вже відсортованому списку перша рекомендація — найважливіша).

    - однакова назва: пізніша рекомендація зливається з першою (її код — у `covers` першої);
    - захід із каталогу (номер Додатка Д) пропонується лише в одній рекомендації — у першій;
    - пункт чек-листа, чий захід уже запропоновано вище, не дублюється окремою рекомендацією;
    - `pick`: скільки заходів лишити з кандидатів після відсіву вже запропонованих.
    """
    out: list[dict] = []
    by_title: dict[str, dict] = {}
    owner_of: dict[str, dict] = {}
    for r in recs:
        pick = r.pop("pick", None)
        key = " ".join(r["title"].casefold().split())
        if key in by_title:
            by_title[key]["covers"].append(r["code"])
            continue
        measures, seen, taken_by = [], set(), None
        for x in r["suggested_measures"]:
            number = x["catalog_number"]
            if (number or x["title"]) in seen:
                continue
            if number and number in owner_of:
                taken_by = taken_by or owner_of[number]
                continue
            seen.add(number or x["title"])
            measures.append(x)
        if pick is not None:
            measures = measures[:pick]
        if not measures and taken_by is not None and r["code"].startswith("checklist:"):
            taken_by["covers"].append(r["code"])
            continue
        r["suggested_measures"] = measures
        for x in measures:
            if x["catalog_number"]:
                owner_of[x["catalog_number"]] = r
        by_title[key] = r
        out.append(r)
    for rank, r in enumerate(out, start=1):
        r["rank"] = rank
    return out


def recommend(result: dict, risk_signals: list[dict] | None = None) -> list[dict]:
    """Рекомендації за правилами. `result` — результати хвилі (знімок)."""
    recs: list[dict] = []
    if result.get("index", {}).get("score") is None:
        return dedupe([_rec("no_data", "high", None, "Зібрати достатньо відповідей для розрахунку",
                     "Жодне джерело не досягло порогу анонімності, тому індекс не розраховано.",
                     f"Усі групи менші за k = {result.get('min_group_size')}.",
                     measures=[generic_measure("raise_participation")])])

    components = {c["code"]: c for c in result["components"]}
    checklist = result.get("checklist") or {}
    checklist_items = {i["number"]: i for i in checklist.get("items", [])}

    def open_items(component: str) -> list[str]:
        """Пункти компонента, що впроваджені не повністю (або не підтверджені)."""
        numbers = component_numbers(component)
        if not checklist_items:
            return numbers
        return [n for n in numbers if (checklist_items.get(n) or {}).get("score") != 100.0]

    # 1. Найслабший компонент.
    with_data = [c for c in components.values() if c["score"] is not None]
    if len(with_data) >= 2:
        weakest = min(with_data, key=lambda c: (c["score"], c["code"]))
        if weakest["zone"]["code"] in ("critical", "attention"):
            priority = "high" if weakest["zone"]["code"] == "critical" else "medium"
            recs.append(_rec(
                f"weakest:{weakest['code']}", priority, weakest["code"],
                f"Почати заходи з компонента «{weakest['title']}»",
                f"Найслабший компонент: {fmt(weakest['score'])} зі 100, зона «{weakest['zone']['title']}».",
                f"Компонент із найменшим балом серед {len(with_data)} і в зоні «{weakest['zone']['title']}» (менше 60).",
                {"score": weakest["score"], "zone": weakest["zone"]["code"]},
                [catalog_measure(n) for n in open_items(weakest["code"])], pick=3,
            ))

    for c in components.values():
        flags = {f["code"] for f in c.get("flags", [])}
        weak_facts = [f for f in c.get("facts", []) if f.get("status") == "ok" and f["level"] <= WEAK_FACT_LEVEL]

        # 2. Самооцінку не підтверджують факти.
        if c.get("cut_by_facts"):
            measures = [catalog_measure(FACT_MEASURES[f["indicator"]][0]) for f in weak_facts if f["indicator"] in FACT_MEASURES]
            recs.append(_rec(
                f"cut:{c['code']}", "high", c["code"],
                f"«{c['title']}»: виправити розрив між самооцінкою і фактами",
                f"Самооцінку {fmt(c['self_score'])} знижено до {fmt(c['score'])}, бо факти показують {fmt(c['facts_score'])}.",
                c["rule"],
                {"self_score": c["self_score"], "facts_score": c["facts_score"], "score": c["score"]},
                measures or [generic_measure("discuss_results")],
            ))
        else:
            # 3. Слабкі факти без обрізання.
            for f in weak_facts:
                if f["indicator"] not in FACT_MEASURES:
                    continue
                recs.append(_rec(
                    f"fact:{f['indicator']}", "medium", c["code"],
                    f"Покращити показник «{f['title']}»",
                    f"{f['label']}.",
                    f["rule"],
                    {"numerator": f["numerator"], "denominator": f["denominator"], "level": f["level"]},
                    [catalog_measure(n) for n in FACT_MEASURES[f["indicator"]]],
                ))

        if "category_gap" in flags:
            recs.append(_rec(
                f"gap:{c['code']}", "high", c["code"],
                f"«{c['title']}»: робоча група й особовий склад оцінюють по-різному",
                "Розбіжність більша за рівень зрілості: система може бути «на папері».",
                f"|РГ − ОС| на спільних питаннях компонента більше {m.CATEGORY_GAP_POINTS:g} балів.",
                measures=[generic_measure("discuss_results")],
            ))
        if "unaware_of_mechanisms" in flags:
            recs.append(_rec(
                f"unaware:{c['code']}", "low", c["code"],
                f"«{c['title']}»: люди можуть не знати про наявні механізми",
                f"Факти ({fmt(c['facts_score'])}) кращі за самооцінку ({fmt(c['self_score'])}).",
                c["rule"],
                measures=[generic_measure("communicate_mechanisms"), catalog_measure("5.1"), catalog_measure("2.8")],
            ))
        if "no_facts" in flags:
            recs.append(_rec(
                f"no_facts:{c['code']}", "low", c["code"],
                f"«{c['title']}»: немає фактів для перевірки самооцінки",
                "Без фактів самооцінка не перевіряється, достовірність нижча.",
                "Для компонента не надійшло жодного факту за 4 завершені квартали до закриття хвилі.",
                measures=[generic_measure("connect_facts")],
            ))

    # 4. Прапорці груп.
    groups = result.get("groups", [])
    perfect = [g for g in groups if "suspiciously_perfect" in g.get("flags", [])]
    if perfect:
        recs.append(_rec(
            "perfect", "high", None, "Перевірити щирість відповідей",
            "У частині груп забагато анкет лише з найвищими відповідями.",
            f"Частка таких анкет більша за {m.PERFECT_SHARE_MAX:.0%} у групах: {', '.join(g['category'] for g in perfect)}.",
            {"categories": [g["category"] for g in perfect]},
            [generic_measure("repeat_survey")],
        ))
    low = [g for g in groups if "low_participation" in g.get("flags", [])]
    if low:
        recs.append(_rec(
            "participation", "medium", None, "Підвищити участь в опитуванні",
            "Низька участь знижує достовірність результатів.",
            f"Участь менша за {m.PARTICIPATION_MIN_PERCENT:g}% у групах: {', '.join(g['category'] for g in low)}.",
            {"categories": [g["category"] for g in low]},
            [generic_measure("raise_participation")],
        ))

    # 4а. Детектор відвертості (services/candor.py).
    candor = result.get("candor") or {}
    concealed = [i for i in candor.get("list_experiments", []) if i.get("concealment")]
    if concealed:
        top = max(concealed, key=lambda i: i["gap"])
        recs.append(_rec(
            "candor:concealment", "high", "accountability", "Люди бояться відповідати чесно: посилити захист викривачів",
            f"Прямо визнали {fmt(top['direct_share'])}%, непряма оцінка {fmt(top['estimate'])}% "
            f"(інтервал {fmt(top['ci'][0])}–{fmt(top['ci'][1])}%).",
            "Непряма оцінка («скільки з переліку») перевищує пряму відповідь щонайменше на 10 п. п., і нижня межа "
            "інтервалу 95 % вища за пряму частку.",
            {"estimate": top["estimate"], "direct_share": top["direct_share"], "gap": top["gap"]},
            [generic_measure("whistleblower_protection"), catalog_measure("2.7")],
        ))
    ignorant = [i for i in candor.get("mirrors", []) if i.get("pluralistic_ignorance")]
    if ignorant:
        top = max(ignorant, key=lambda i: i["gap"])
        recs.append(_rec(
            "candor:pluralistic", "medium", "culture", "Кожен вважає себе винятком: показати людям реальну норму",
            f"{fmt(top['self_share'])}% кажуть, що вчинили б так самі; про колег так думають {fmt(top['others_share'])}%.",
            "«Дзеркало»: частка «я — так» перевищує «колеги — так» щонайменше на 20 п. п. (плюралістичне незнання).",
            {"self_share": top["self_share"], "others_share": top["others_share"]},
            [generic_measure("social_norms"), catalog_measure("5.1")],
        ))
    gaming = (result.get("goodhart") or {}).get("signals") or []
    if gaming:
        recs.append(_rec(
            "goodhart", "medium", None, "Перевірити ознаки підгонки показників",
            "; ".join(sg["title"] for sg in gaming) + ".",
            "Детектор Гудхарта: коли показник стає ціллю, його починають «малювати». Сигнал — привід для перевірки.",
            {"signals": [sg["code"] for sg in gaming]},
            [generic_measure("check_gaming")],
        ))

    # 5. Чек-лист.
    if checklist and checklist.get("filled") and checklist.get("confirmed_share", 1) < m.CHECKLIST_CONFIRMED_MIN_SHARE:
        recs.append(_rec(
            "checklist_unconfirmed", "medium", None, "Підтвердити пункти чек-листа доказами",
            f"Підтверджено {checklist['confirmed']} з {checklist['total']} пунктів.",
            f"Непідтверджене «повністю» рахується як «частково». Поріг: {m.CHECKLIST_CONFIRMED_MIN_SHARE:.0%}.",
            {"confirmed": checklist["confirmed"], "total": checklist["total"]},
            [generic_measure("confirm_checklist")],
        ))
    for number, item in checklist_items.items():
        if item.get("status") not in ("none", "partial"):
            continue
        priority = "medium" if item["status"] == "none" else "low"
        measure = catalog_measure(number)
        recs.append(_rec(
            f"checklist:{number}", priority, item.get("component"),
            measure["title"] if measure else f"Впровадити пункт {number} чек-листа",
            f"Пункт {number} чек-листа: {m.CHECKLIST_STATUS_TITLES[item['status']]}.",
            f"Статус пункту чек-листа «{m.CHECKLIST_STATUS_TITLES[item['status']]}» → захід за пунктом {number} типового плану.",
            {"status": item["status"]},
            [measure],
        ))

    # 6. Слабкі питання.
    for q in result.get("weakest_questions", []):
        if q["score"] is None or q["score"] >= WEAK_SCORE:
            continue
        component = q["code"].split(".")[0] if q["code"].split(".")[0] in m.COMPONENTS else None
        recs.append(_rec(
            f"question:{q['code']}", "low", component,
            f"Слабке місце: «{shorten(q['text'], TITLE_MAX - 16)}»",
            f"Середній бал питання {fmt(q['score'])} зі 100 (нижче рівня «Визначений»).",
            f"Бал питання менший за {WEAK_SCORE:g}.",
            {"score": q["score"], "question": q["text"]},
            [catalog_measure(n) for n in open_items(component)] if component else [], pick=1,
        ))

    # 7. Ризик-сигнали (окремо від індексу).
    for s in risk_signals or []:
        if s.get("status") == "ok" and (s.get("pending") or 0) > 0 and (s.get("change") or 0) > 0:
            recs.append(_rec(
                f"risk:{s['indicator']}", "medium", m.FACTS[s["indicator"]]["component"],
                f"Зростає кількість сигналів: {s['title'].lower()}",
                f"Знайдено {s['found']} (на {s['change']} більше, ніж у попередньому періоді), чекають розгляду {s['pending']}.",
                "Ризик-сигнали на індекс не впливають: рекомендація стосується швидкості розгляду, а не кількості знайденого.",
                {"found": s["found"], "pending": s["pending"], "change": s["change"]},
                [generic_measure("review_risks")] + [catalog_measure(n) for n in FACT_MEASURES.get(s["indicator"], [])[:1]],
            ))

    score_of = {c["code"]: (c["score"] if c["score"] is not None else 101) for c in components.values()}
    recs.sort(key=lambda r: (PRIORITY_ORDER[r["priority"]], score_of.get(r["component"], 102), r["code"]))
    return dedupe(recs)
