"""«Адвокат диявола»: найнеприємніші питання зовнішнього аудитора до результатів хвилі.

Кожне питання дає явне правило (RULES): умова на числах знімка, вага (наскільки болюче питання),
посилання на конкретне число і що підготувати. Модель тут нічого не вирішує. Опційно вона лише
перефразовує вже знайдені питання (routers/insights.py), а числа звіряються з оригіналом.

Питання стосуються системи доброчесності, а не людей: жодних імен, рейтингів підрозділів чи оцінок осіб.
"""

from collections.abc import Callable

from app.services import methodology as m
from app.services.plural import plural
from app.services.text import points, shorten

# Короткий опис кожного правила для прозорості (GET .../devils-advocate віддає їх разом із питаннями).
RULES: dict[str, str] = {
    "reliability_c": "Достовірність індексу C: хоч один серйозний прапорець або ≥ 3 незначних.",
    "cut_by_facts": "Самооцінку компонента обрізано фактами: S > F + 25 (правило реальності).",
    "low_fact": "Об'єктивний показник на рівні 1–2 за порогами методики.",
    "category_gap": "Робоча група й особовий склад розходяться більше ніж на 25 балів.",
    "suspiciously_perfect": "Понад 30% анкет групи мають лише найвищі відповіді.",
    "low_participation": "Участь групи нижча за 60%.",
    "checklist_unconfirmed": "Пункти чек-листа «повністю» без підтвердження.",
    "checklist_not_started": "Пункти чек-листа «підлягає впровадженню».",
    "declared_above_computed": "Заявлений учасниками рівень вищий за розрахований з їхніх же відповідей.",
    "critical_question": "Питання анкети в критичній зоні (< 40 балів).",
    "component_drop": "Компонент знизився значуще (більше ніж на 5 балів) з минулої хвилі.",
    "growth_unconfirmed": "Індекс зріс, але зміна позначена «перевірити дані».",
    "no_facts": "Для компонента немає жодного об'єктивного показника.",
    "measures_overdue": "Є прострочені заходи.",
    "measure_no_effect": "Захід виконано, але компонент у наступній хвилі не покращився.",
    "rejected_recommendation": "Рекомендацію відхилено.",
    "accepted_without_measure": "Рекомендацію прийнято, але заходу в трекері немає.",
    "risk_signal_growth": "Кількість знайдених ризиків зросла до попереднього періоду.",
    "candor_concealment": "Непряма оцінка («скільки з переліку») суттєво вища за пряму відповідь.",
    "candor_pluralistic": "Про себе кажуть «повідомив би», про колег — «змовчали б».",
    "goodhart": "Детектор Гудхарта знайшов ознаки підгонки показників.",
}

CATEGORY_TITLES = {"staff": "особовий склад", "working_group": "робоча група", "expert": "експерти"}


def num(value, digits: int = 1) -> str:
    if value is None:
        return "—"
    if isinstance(value, float) and not value.is_integer():
        return f"{value:.{digits}f}".replace(".", ",")
    return str(int(value)) if isinstance(value, float) else str(value)


def _q(rule: str, key: str, severity: int, category: str, question: str, why: str,
       evidence: list[dict], prepare: str, view: str) -> dict:
    return {"id": f"{rule}:{key}", "rule_id": rule, "severity": severity, "category": category,
            "question": question, "why": why, "evidence": evidence, "prepare": prepare,
            "link": {"view": view, "ref": key}}


def ev(label: str, value, unit: str = "", path: str = "") -> dict:
    return {"label": label, "value": value, "text": f"{num(value)}{unit}", "path": path}


# ---------- Правила ----------

def r_reliability(data: dict) -> list[dict]:
    idx = data["index"]
    if idx.get("reliability") != "C":
        return []
    reasons = idx.get("reliability_reasons") or []
    return [_q("reliability_c", "index", 95, "Достовірність",
               "Достовірність ваших результатів — C. Чому керівництво має довіряти цим числам більше, ніж власному "
               "враженню?",
               "Причини: " + "; ".join(reasons) if reasons else RULES["reliability_c"],
               [ev("Індекс доброчесності", idx.get("score"), path="index.score"),
                ev("Достовірність", None, path="index.reliability") | {"text": "C"}],
               "Для кожної причини — що вже зроблено, щоб її усунути (захід у трекері, перевірка даних).",
               "explain")]


def r_cut(data: dict) -> list[dict]:
    out = []
    for c in data["components"]:
        if not c.get("cut_by_facts"):
            continue
        weakest = sorted([f for f in c.get("facts", []) if f.get("percent") is not None],
                         key=lambda f: f["percent"])[:1]
        evidence = [ev(f"«{c['title']}»: самооцінка", c.get("self_score"), path=f"components.{c['code']}.self_score"),
                    ev("за фактами", c.get("facts_score"), path=f"components.{c['code']}.facts_score")]
        tail = ""
        if weakest:
            f = weakest[0]
            evidence.append(ev(f["title"], f["percent"], "%", f"facts.{f['indicator']}") |
                            {"text": f"{num(f['percent'])}% ({f['numerator']} з {f['denominator']})"})
            tail = f" Наприклад, «{f['title'].lower()}» — лише {num(f['percent'])}%."
        out.append(_q("cut_by_facts", c["code"], 100, "Факти проти самооцінки",
                      f"Ви оцінюєте «{c['title']}» на {points(c.get('self_score'))}, а факти показують "
                      f"{num(c.get('facts_score'))}. Чому система, на вашу думку, краща, ніж кажуть дані?{tail}",
                      c.get("rule", RULES["cut_by_facts"]), evidence,
                      "Пояснення розриву по кожному факту: що саме не розглянуто вчасно і чому; план, коли частка "
                      "досягне наступного порогу.", "compare"))
    return out


def r_low_facts(data: dict) -> list[dict]:
    out = []
    for f in data.get("facts", []):
        if f.get("status") != "ok" or f.get("level") is None or f["level"] > 2:
            continue
        rest = (f["denominator"] or 0) - (f["numerator"] or 0)
        out.append(_q("low_fact", f["indicator"], 80 + (3 - f["level"]) * 5, "Об'єктивні показники",
                      f"«{f['title']}»: {f['numerator']} з {f['denominator']} ({num(f['percent'])}%). "
                      f"Що сталося з рештою {rest} і хто за це відповідає як посадова функція?",
                      f.get("rule", RULES["low_fact"]),
                      [ev(f["title"], f["percent"], "%", f"facts.{f['indicator']}") |
                       {"text": f"{f['numerator']} з {f['denominator']} ({num(f['percent'])}%)"}],
                      "Перелік нерозглянутих випадків за статусами (без імен), строки розгляду, причини затримок.",
                      "sources"))
    return out


def r_category_gap(data: dict) -> list[dict]:
    out = []
    for c in data["components"]:
        src = {s["source"]: s.get("score") for s in c.get("sources", [])}
        wg, staff = src.get("working_group"), src.get("staff")
        if wg is None or staff is None or abs(wg - staff) <= m.CATEGORY_GAP_POINTS:
            continue
        hi, lo = ("робоча група", "особовий склад") if wg > staff else ("особовий склад", "робоча група")
        out.append(_q("category_gap", c["code"], 85, "Розбіжність джерел",
                      f"У «{c['title']}» {hi} ставить {num(max(wg, staff))}, а {lo} — {num(min(wg, staff))}. "
                      "Хто з них помиляється і як ви це перевіряли?",
                      RULES["category_gap"],
                      [ev("Робоча група", wg, path=f"components.{c['code']}.sources.working_group"),
                       ev("Особовий склад", staff, path=f"components.{c['code']}.sources.staff")],
                      "Питання з найбільшим розривом (екран «Порівняння») і що робоча група знає, а особовий склад ні.",
                      "compare"))
    return out


def r_groups(data: dict) -> list[dict]:
    out = []
    for g in data.get("groups", []):
        if g.get("suppressed") or not g.get("sufficient"):
            continue
        who = CATEGORY_TITLES.get(g["category"], g["category"])
        share = g.get("perfect_share") or 0
        if share > m.PERFECT_SHARE_MAX:
            out.append(_q("suspiciously_perfect", g["category"], 90, "Соціально бажані відповіді",
                          f"{num(share * 100)}% анкет групи «{who}» мають лише найвищі відповіді. Як ви виключили "
                          "тиск на респондентів чи «правильні» відповіді?",
                          RULES["suspiciously_perfect"],
                          [ev(f"Частка «ідеальних» анкет ({who})", round(share * 100, 1), "%",
                              f"groups.{g['category']}.perfect_share")],
                          "Як поширювали анкету, хто мав доступ до посилань, чи були інструкції «як відповідати».",
                          "explain"))
        pct = g.get("participation_percent")
        if pct is not None and pct < m.PARTICIPATION_MIN_PERCENT:
            out.append(_q("low_participation", g["category"], 70, "Охоплення",
                          f"Анкету групи «{who}» пройшли лише {num(pct)}%. Чи не мовчать саме ті, хто незадоволений?",
                          RULES["low_participation"],
                          [ev(f"Участь ({who})", pct, "%", f"groups.{g['category']}.participation_percent")],
                          "Як інформували людей, чому участь низька, що зміните в наступній хвилі.", "manage"))
        declared, computed = g.get("declared_level"), g.get("computed_level")
        if declared and computed and declared > computed:
            out.append(_q("declared_above_computed", g["category"], 60, "Самооцінка",
                          f"Група «{who}» сама оцінила зрілість на рівень {declared}, а її ж відповіді по суті дають "
                          f"{computed}. Звідки цей оптимізм?",
                          RULES["declared_above_computed"],
                          [ev("Заявлений рівень", declared, path=f"groups.{g['category']}.declared_level"),
                           ev("Розрахований рівень", computed, path=f"groups.{g['category']}.computed_level")],
                          "Питання, де відповіді найнижчі, — вони показують, чого не бачать у загальній самооцінці.",
                          "explain"))
    return out


def r_checklist(data: dict) -> list[dict]:
    items = (data.get("checklist") or {}).get("items") or []
    out = []
    unconfirmed = [i for i in items if i.get("status") == "full" and not i.get("confirmed")]
    if unconfirmed:
        numbers = ", ".join(i["number"] for i in unconfirmed[:5] if i.get("number"))
        out.append(_q("checklist_unconfirmed", "full", 75, "Чек-лист",
                      f"{plural(len(unconfirmed), 'пункт', 'пункти', 'пунктів')} чек-листа позначено «впроваджено "
                      "повністю» без підтвердження "
                      f"(п. {numbers}). Покажіть документи.",
                      RULES["checklist_unconfirmed"] + f" Такий пункт рахується як {points(m.UNCONFIRMED_FULL_SCORE)}.",
                      [ev("Непідтверджених «повністю»", len(unconfirmed), path="checklist.items")],
                      "Наказ, положення чи протокол для кожного пункту; хто підтверджує (не той, хто вносив).",
                      "checklist"))
    not_started = [i for i in items if i.get("status") == "none"]
    if not_started:
        numbers = ", ".join(i["number"] for i in not_started[:5] if i.get("number"))
        out.append(_q("checklist_not_started", "none", 65, "Чек-лист",
                      f"{plural(len(not_started), 'пункт', 'пункти', 'пунктів')} чек-листа досі «підлягає "
                      f"впровадженню» (п. {numbers}). "
                      "Коли і хто?",
                      RULES["checklist_not_started"],
                      [ev("Пунктів «підлягає впровадженню»", len(not_started), path="checklist.items")],
                      "Захід у трекері з відповідальним і строком для кожного пункту.", "tracker"))
    return out


def r_questions(data: dict) -> list[dict]:
    out = []
    for q in data.get("questions", []):
        score = q.get("score")
        if score is None or score >= 40:
            continue
        out.append(_q("critical_question", q["code"], 65, "Слабкі місця",
                      f"Питання «{shorten(q['text'], 120)}» має {points(score)} — критична зона. Що змінилося на практиці, "
                      "а не на папері?",
                      RULES["critical_question"], [ev("Бал питання", score, path=f"questions.{q['code']}.score")],
                      "Конкретні дії за останній рік по цьому напряму і як про них дізналися люди.", "explain"))
    return out


def r_dynamics(data: dict) -> list[dict]:
    dyn = data.get("dynamics")
    if not dyn:
        return []
    out = []
    for c in dyn.get("components", []):
        delta = c.get("delta")
        if delta is not None and delta < -m.SIGNIFICANT_DELTA:
            out.append(_q("component_drop", c["code"], 88, "Динаміка",
                          f"«{c['title']}» знизився з {num(c['previous'])} до {num(c['current'])} "
                          f"({num(delta)}). Що пішло не так?",
                          RULES["component_drop"],
                          [ev("Було", c["previous"], path=f"dynamics.components.{c['code']}.previous"),
                           ev("Стало", c["current"], path=f"dynamics.components.{c['code']}.current")],
                          "Розклад падіння за джерелами (агент-черговий) і план відновлення.", "trends"))
    sig = (dyn.get("index_significance") or {}).get("code")
    if (dyn.get("index_delta") or 0) > m.SIGNIFICANT_DELTA and sig == "check_data":
        out.append(_q("growth_unconfirmed", "index", 70, "Динаміка",
                      f"Індекс зріс на {num(dyn['index_delta'])} з минулої хвилі, але зміну позначено «перевірити дані». "
                      "Чим, крім анкет, підтверджено покращення?",
                      RULES["growth_unconfirmed"],
                      [ev("Зміна індексу", dyn["index_delta"], path="dynamics.index_delta"),
                       ev("Попередня достовірність", None, path="dynamics.previous_reliability") |
                       {"text": dyn.get("previous_reliability") or "—"}],
                      "Які факти й пункти чек-листа змінилися разом з анкетами; виконані заходи з доказами.", "trends"))
    return out


def r_no_facts(data: dict) -> list[dict]:
    return [_q("no_facts", c["code"], 60, "Об'єктивні показники",
               f"Для «{c['title']}» немає жодного об'єктивного показника. Як ви знаєте, що це працює, а не лише "
               "здається?",
               RULES["no_facts"], [ev("Бал компонента", c.get("score"), path=f"components.{c['code']}.score")],
               "Яке джерело даних можна підключити і хто його веде.", "sources")
            # Прапорці компонента — словники {code, severity, title}: рядок "no_facts" у списку не знаходився ніколи.
            for c in data["components"] if any(f.get("code") == "no_facts" for f in (c.get("flags") or []))]


def r_measures(measures: list[dict]) -> list[dict]:
    out = []
    overdue = sorted([x for x in measures if x.get("overdue")], key=lambda x: -(x.get("overdue_days") or 0))
    if overdue:
        worst = overdue[0]
        out.append(_q("measures_overdue", "overdue", 80, "Виконання заходів",
                      f"Прострочено {plural(len(overdue), 'захід', 'заходи', 'заходів')}; найдовше — "
                      f"«{shorten(worst['title'], 100)}» на {plural(worst['overdue_days'], 'день', 'дні', 'днів')}. "
                      "Чому рекомендації не доводяться до дії?",
                      RULES["measures_overdue"],
                      [ev("Прострочених заходів", len(overdue), path="measures.overdue"),
                       ev("Найбільше прострочення, днів", worst["overdue_days"], path=f"measures.{worst['id']}")],
                      "Причина по кожному простроченому заходу і новий реалістичний строк.", "tracker"))
    for x in measures:
        v = x.get("verification") or {}
        if v.get("status") in ("worsened", "within_error"):
            out.append(_q("measure_no_effect", str(x["id"]), 75, "Виконання заходів",
                          f"Захід «{shorten(x['title'], 100)}» виконано, але «{v.get('component') or ''}» у наступній хвилі "
                          f"змінився на {num(v.get('delta'))}. Захід справді був дієвим?",
                          v.get("rule") or RULES["measure_no_effect"],
                          [ev("Було", v.get("previous"), path=f"measures.{x['id']}.verification.previous"),
                           ev("Стало", v.get("current"), path=f"measures.{x['id']}.verification.current")],
                          "Що саме зроблено (доказ), чому ефекту немає, чи потрібен інший захід.", "tracker"))
    return out


def r_decisions(recs: list[dict], measures: list[dict]) -> list[dict]:
    out = []
    with_measure = {x.get("recommendation_code") for x in measures}
    for r in recs:
        d = r.get("decision") or {}
        decision = d.get("decision")
        decision = getattr(decision, "value", decision)
        if decision == "rejected":
            out.append(_q("rejected_recommendation", r["code"], 60, "Рішення керівництва",
                          f"Ви відхилили рекомендацію «{shorten(r['title'], 120)}». На якій підставі?",
                          f"{RULES['rejected_recommendation']} Коментар: {d.get('comment') or '—'}",
                          [ev("Пріоритет рекомендації", None, path=f"recommendations.{r['code']}") |
                           {"text": r.get("priority_title", "")}],
                          "Письмове обґрунтування і чим закрито ризик, на який указувала рекомендація.", "recs"))
        elif decision == "accepted" and r["code"] not in with_measure:
            out.append(_q("accepted_without_measure", r["code"], 70, "Рішення керівництва",
                          f"Рекомендацію «{shorten(r['title'], 120)}» прийнято, але заходу в трекері немає. Хто і коли?",
                          RULES["accepted_without_measure"],
                          [ev("Рекомендація", None, path=f"recommendations.{r['code']}") | {"text": "прийнято"}],
                          "Захід з відповідальним (посада) і строком.", "tracker"))
    return out


def r_signals(signals: list[dict]) -> list[dict]:
    return [_q("risk_signal_growth", s["indicator"], 55, "Ризик-сигнали",
               f"«{s['title']}»: знайдено {s['found']}, на {s['change']} більше, ніж у попередньому періоді; "
               f"чекають розгляду {s['pending']}. Що зростає і чому?",
               RULES["risk_signal_growth"],
               [ev("Знайдено", s["found"], path=f"risk_signals.{s['indicator']}.found"),
                ev("Зміна", s["change"], path=f"risk_signals.{s['indicator']}.change")],
               "Що стоїть за зростанням: більше порушень чи краще виявлення (це добре).", "sources")
            for s in signals if s.get("status") == "ok" and (s.get("change") or 0) > 0]


def r_candor(data: dict) -> list[dict]:
    candor = data.get("candor") or {}
    out = []
    for i in candor.get("list_experiments", []):
        if not i.get("concealment"):
            continue
        ratio = i.get("ratio")
        times = f"у {num(ratio)} раза рідше" if ratio else "значно рідше"
        out.append(_q("candor_concealment", i["code"], 80, "Відвертість",
                      f"Чому прямо визнають {times}, ніж показує непряма оцінка ({num(i['direct_share'])}% проти "
                      f"{num(i['estimate'])}%)? Чого люди бояться?",
                      RULES["candor_concealment"],
                      [ev("Прямо", i["direct_share"], "%", f"candor.{i['code']}.direct_share"),
                       ev("Непряма оцінка", i["estimate"], "%", f"candor.{i['code']}.estimate")],
                      "Як захищено анонімність каналів повідомлень і що відбувається із заявником після повідомлення.",
                      "results"))
    for i in candor.get("mirrors", []):
        if i.get("pluralistic_ignorance"):
            out.append(_q("candor_pluralistic", i["code"], 60, "Відвертість",
                          f"{num(i['self_share'])}% кажуть, що повідомили б самі, але лише {num(i['others_share'])}% "
                          "вірять у це щодо колег. Як показати людям реальну норму?",
                          RULES["candor_pluralistic"],
                          [ev("Я — так", i["self_share"], "%", f"candor.{i['code']}.self_share"),
                           ev("Колеги — так", i["others_share"], "%", f"candor.{i['code']}.others_share")],
                          "План комунікацій: реальні дані про готовність повідомляти й приклади розгляду.", "results"))
    return out


def r_goodhart(data: dict) -> list[dict]:
    return [_q("goodhart", sg["code"], 70, "Підгонка показників",
               f"{sg['title']}: {sg['description']} Чим це пояснюється?", RULES["goodhart"],
               [ev(k, v, path=f"goodhart.{sg['code']}.{k}") for k, v in sg.get("values", {}).items()],
               "Первинні документи й дати змін, які пояснюють збіг.", "results")
            for sg in (data.get("goodhart") or {}).get("signals", [])]


DATA_RULES: list[Callable[[dict], list[dict]]] = [
    r_reliability, r_cut, r_low_facts, r_category_gap, r_groups, r_checklist, r_questions, r_dynamics, r_no_facts,
    r_candor, r_goodhart,
]


def questions(data: dict, signals: list[dict], recs: list[dict], measures: list[dict], limit: int = 10) -> dict:
    found: list[dict] = []
    for rule in DATA_RULES:
        found += rule(data)
    found += r_measures(measures) + r_decisions(recs, measures) + r_signals(signals)
    # Найболючіші спершу; за однакової ваги — стабільний порядок за id (той самий вхід дає той самий результат).
    found.sort(key=lambda q: (-q["severity"], q["id"]))
    top = found[:limit]
    for i, q in enumerate(top, 1):
        q["n"] = i
    return {"questions": top, "total_found": len(found),
            "rules": [{"id": k, "description": v} for k, v in RULES.items()]}
