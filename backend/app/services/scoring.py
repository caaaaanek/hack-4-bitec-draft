"""Розрахунок Integrity Index (методика v2).

Модуль не звертається до БД: отримує готові дані й повертає словник.
Ядро — функція combine(): вона приймає бали джерел і факти для кожного
компонента і застосовує кроки 1-5 методики. Її легко перевірити вручну.
"""

from dataclasses import dataclass, field
from statistics import fmean, pstdev

from app.models import Question, Questionnaire, QuestionType
from app.services import methodology as m

SURVEY_SOURCES = ("staff", "working_group", "expert")


@dataclass
class ResponseData:
    """Одна анонімна анкета: question_id -> обрані option_id або значення шкали."""

    options: dict = field(default_factory=dict)
    values: dict = field(default_factory=dict)


@dataclass
class GroupInput:
    """Відповіді на одну анкету в межах хвилі й обраного підрозділу."""

    questionnaire: Questionnaire
    responses: list[ResponseData]
    eligible: int
    submitted: int
    # Групу приховано вторинним приховуванням: сама вона не менша за k,
    # але її показ дозволив би обчислити меншу сусідню групу.
    suppressed: bool = False


@dataclass
class ChecklistItem:
    code: str
    number: str
    component: str | None
    score: float | None  # None — пункт не заповнено
    confirmed: bool
    text: str = ""
    status: str | None = None  # full / partial / none


def r1(x: float | None) -> float | None:
    return None if x is None else round(x, 1)


def weighted_mean(pairs: list[tuple[float, float]]) -> float | None:
    total = sum(w for _, w in pairs)
    if total <= 0:
        return None
    return sum(v * w for v, w in pairs) / total


def fmt(x: float) -> str:
    """Число для текстових пояснень: 33.333 -> '33,3'."""
    return f"{round(x, 1):g}".replace(".", ",")


# ---------- Відповіді анкет ----------

def option_range(question: Question) -> tuple[float, float]:
    if question.type == QuestionType.SCALE:
        return float(question.scale_min), float(question.scale_max)
    scores = [o.score for o in question.options]
    return min(scores), max(scores)


def normalize(question: Question, raw: float) -> float:
    low, high = option_range(question)
    if high == low:
        return 100.0
    return (raw - low) / (high - low) * 100


def raw_answer(question: Question, response: ResponseData) -> float | None:
    if question.type == QuestionType.SCALE:
        return response.values.get(question.id)
    chosen = response.options.get(question.id)
    if not chosen:
        return None
    scores = {o.id: o.score for o in question.options}
    return fmean(scores[o] for o in chosen if o in scores)


def is_perfect(questions: list[Question], response: ResponseData) -> bool:
    answered = False
    for q in questions:
        raw = raw_answer(q, response)
        if raw is None:
            continue
        answered = True
        if raw < option_range(q)[1]:
            return False
    return answered


def score_group(group: GroupInput, k: int) -> dict:
    """Бали однієї групи (одна анкета = одна категорія) з порогом k."""
    q = group.questionnaire
    questions = [(s, question) for s in q.sections for question in s.questions]
    n = len(group.responses)
    sufficient = n >= k
    population_ok = group.eligible >= k and not group.suppressed
    participation = round(100 * group.submitted / group.eligible, 1) if group.eligible else 0.0

    result = {
        "questionnaire_id": q.id,
        "title": q.title,
        "category": q.target_category.value,
        # Кількості показуємо лише для груп від k людей.
        "eligible": group.eligible if population_ok else None,
        "submitted": group.submitted if population_ok else None,
        "participation_percent": participation if population_ok else None,
        "n": n if sufficient else None,
        "sufficient": sufficient,
        "spread": None,
        "perfect_share": None,
        "declared_level": None,
        "computed_level": None,
        "flags": [],
        "suppressed": group.suppressed,
        "components": {},
        "questions": [],
    }
    if group.suppressed:
        result["flags"].append("suppressed")
        return result
    if participation < m.PARTICIPATION_MIN_PERCENT:
        result["flags"].append("low_participation")
    if not sufficient:
        result["flags"].append("insufficient_data")
        return result

    component_pairs: dict[str, list[tuple[float, float]]] = {}
    declared_raw: list[float] = []
    for section, question in questions:
        raws = [x for r in group.responses if (x := raw_answer(question, r)) is not None]
        if not raws:
            continue
        score = fmean(normalize(question, x) for x in raws)
        component = m.survey_component(section.component)
        if section.component == m.DECLARED_COMPONENT:
            declared_raw.extend(raws)
        if component:
            component_pairs.setdefault(component, []).append((score, question.weight))

        distribution = []
        if question.type != QuestionType.SCALE:
            counts = {o.id: 0 for o in question.options}
            for r in group.responses:
                for option_id in r.options.get(question.id, []):
                    if option_id in counts:
                        counts[option_id] += 1
            distribution = [
                {"option_text": o.text, "option_score": o.score, "count": counts[o.id],
                 "percent": round(100 * counts[o.id] / len(raws), 1)}
                for o in question.options
            ]
        result["questions"].append(
            {"code": question.code, "text": question.text, "section": section.title,
             "component": component or section.component, "n": len(raws), "score": score,
             "distribution": distribution}
        )

    result["components"] = {c: weighted_mean(pairs) for c, pairs in component_pairs.items()}

    plain = [question for _, question in questions]
    per_response = [
        fmean(values)
        for r in group.responses
        if (values := [normalize(qq, x) for qq in plain if (x := raw_answer(qq, r)) is not None])
    ]
    result["spread"] = r1(pstdev(per_response)) if len(per_response) > 1 else 0.0
    perfect = sum(1 for r in group.responses if is_perfect(plain, r))
    result["perfect_share"] = round(perfect / n, 2)
    if result["perfect_share"] > m.PERFECT_SHARE_MAX:
        result["flags"].append("suspiciously_perfect")

    if declared_raw:
        result["declared_level"] = int(fmean(declared_raw) + 0.5)
        own = weighted_mean([(s, 1.0) for s in result["components"].values() if s is not None])
        if own is not None:
            result["computed_level"] = m.maturity_level(own)["level"]
    return result


# ---------- Ядро: кроки 1-5 ----------

def flag_list(codes: list[str]) -> list[dict]:
    seen = []
    for code in codes:
        if code not in seen:
            seen.append(code)
    return [{"code": c, "severity": m.FLAGS[c]["severity"], "title": m.FLAGS[c]["title"]} for c in seen]


def combine(inputs: dict[str, dict]) -> dict:
    """Кроки 1-5 для трьох компонентів.

    inputs[component] = {
        "sources": {"staff": бал | None, "working_group": ..., "expert": ..., "checklist": ...},
        "common": {"working_group": бал, "staff": бал} | None  # спільні питання, для category_gap
        "facts": [бал факту 0-100, ...],
        "flags": [прапорці груп і чек-листа, що стосуються компонента],
    }
    Бали — у шкалі 0-100.
    """
    components = []
    for code, meta in m.COMPONENTS.items():
        data = inputs.get(code, {})
        sources = data.get("sources", {})
        flags = list(data.get("flags", []))

        # Крок 1. Самооцінка: вага джерел без даних ділиться між рештою пропорційно.
        available = {s: v for s, v in sources.items() if v is not None and s in m.SOURCE_WEIGHTS}
        total_weight = sum(m.SOURCE_WEIGHTS[s] for s in available)
        source_rows = []
        for s, base_weight in m.SOURCE_WEIGHTS.items():
            value = sources.get(s)
            effective = base_weight / total_weight if value is not None and total_weight else 0.0
            source_rows.append({"source": s, "title": m.SOURCE_TITLES[s], "weight": base_weight,
                                "effective_weight": round(effective, 3), "score": r1(value)})
        self_score = weighted_mean([(v, m.SOURCE_WEIGHTS[s]) for s, v in available.items()])
        if self_score is not None and len(available) < len(m.SOURCE_WEIGHTS):
            dropped_survey = [s for s in SURVEY_SOURCES if s in sources and sources[s] is None]
            if dropped_survey:
                flags.append("low_participation")
        self_rule = (
            "S = " + " + ".join(f"{str(round(r['effective_weight'], 3)).replace('.', ',')}·{r['title']} {fmt(r['score'])}" for r in source_rows if r["score"] is not None)
            + f" = {fmt(self_score)}"
            + (" (вага джерел без даних поділена між рештою)" if len(available) < len(m.SOURCE_WEIGHTS) else "")
            if self_score is not None
            else "Немає жодного джерела з достатньою кількістю даних."
        )

        common = data.get("common")
        if common and common.get("working_group") is not None and common.get("staff") is not None:
            if abs(common["working_group"] - common["staff"]) > m.CATEGORY_GAP_POINTS:
                flags.append("category_gap")

        # Крок 2. Факти.
        fact_scores = list(data.get("facts", []))
        facts_score = fmean(fact_scores) if fact_scores else None

        # Крок 3. Правило реальності.
        final = self_score
        cut = False
        if self_score is None:
            rule = "Недостатньо даних для самооцінки."
        elif facts_score is None:
            flags.append("no_facts")
            rule = f"Фактів немає: компонент = самооцінці {fmt(self_score)}."
        elif self_score > facts_score + m.REALITY_MARGIN:
            final = facts_score + m.REALITY_MARGIN
            cut = True
            flags.append("self_not_confirmed")
            rule = f"Самооцінка {fmt(self_score)} знижена до {fmt(final)}: факти показують {fmt(facts_score)} (+{m.REALITY_MARGIN:g})."
        elif facts_score > self_score + m.REALITY_MARGIN:
            flags.append("unaware_of_mechanisms")
            rule = f"Факти ({fmt(facts_score)}) кращі за самооцінку ({fmt(self_score)}): лишаємо самооцінку, факти не піднімають бал."
        else:
            rule = f"Самооцінка {fmt(self_score)} узгоджується з фактами {fmt(facts_score)} (різниця не більше {m.REALITY_MARGIN:g})."

        flags_out = flag_list(flags)
        grade = "insufficient_data" if final is None else m.reliability([f["code"] for f in flags_out])
        components.append(
            {
                "code": code,
                "title": meta["title"],
                "weight": round(meta["weight"], 4),
                "self_score": r1(self_score),
                "self_rule": self_rule,
                "sources": source_rows,
                "facts_score": r1(facts_score),
                "score": r1(final),
                "raw_score": final,
                "raw_self": self_score,
                "level": m.maturity_level(final) if final is not None else None,
                "level_value": round(m.score_to_level_value(final), 2) if final is not None else None,
                "zone": m.zone(final) if final is not None else None,
                "cut_by_facts": cut,
                "flags": flags_out,
                "reliability": grade,
                "rule": rule,
            }
        )

    # Крок 4. Індекс і слабка ланка.
    with_data = [c for c in components if c["raw_score"] is not None]
    complete = len(with_data) == len(m.COMPONENTS)
    index_score = fmean(c["raw_score"] for c in with_data) if with_data else None
    index_self = fmean(c["raw_self"] for c in with_data) if with_data else None
    index = {"score": r1(index_score), "self_score": r1(index_self), "complete": complete,
             "level": None, "level_uncapped": None, "zone": None, "weak_link_applied": False,
             "reliability": "insufficient_data", "reliability_reasons": [], "rule": ""}
    if index_score is not None:
        level = m.maturity_level(index_score)
        weakest = min(with_data, key=lambda c: c["raw_score"])
        cap = weakest["level"]["level"] + m.WEAK_LINK_MAX_GAP
        index["level_uncapped"] = level
        if level["level"] > cap:
            index["level"] = m.level_by_number(cap)
            index["weak_link_applied"] = True
        else:
            index["level"] = level
        index["zone"] = m.zone(index_score)

        # Крок 5. Достовірність індексу — найгірша серед компонентів.
        grades = [c["reliability"] for c in with_data]
        index["reliability"] = m.worst_reliability(grades)
        reasons = []
        for c in with_data:
            for f in c["flags"]:
                if f["severity"] in ("serious", "minor"):
                    reasons.append(f"{c['title']}: {f['title'].lower()}")
        index["reliability_reasons"] = reasons

        parts = " + ".join(fmt(c["raw_score"]) for c in with_data)
        index["rule"] = (
            f"II = ({parts}) / {len(with_data)} = {fmt(index_score)}."
            + ("" if complete else " Індекс неповний: не всі компоненти мають дані.")
            + (f" Без перевірки фактами було б {fmt(index_self)}." if r1(index_self) != r1(index_score) else "")
            + (f" Рівень обмежено до {cap}: найслабший компонент «{weakest['title']}» на рівні {weakest['level']['level']}."
               if index["weak_link_applied"] else "")
        )

    for c in components:
        c.pop("raw_score")
        c.pop("raw_self")
    return {"index": index, "components": components}


# ---------- Повний розрахунок хвилі ----------

def compute(groups: list[GroupInput], checklist: list[ChecklistItem] | None, facts: list[dict], k: int) -> dict:
    scored = [score_group(g, k) for g in groups]
    by_category = {g["category"]: g for g in scored}
    usable = [g for g in scored if g["sufficient"]]

    # Глобальні прапорці груп (стосуються всіх компонентів).
    group_flags = []
    for g in scored:
        if "low_participation" in g["flags"]:
            group_flags.append("low_participation")
        if "suspiciously_perfect" in g["flags"]:
            group_flags.append("suspiciously_perfect")

    # Чек-лист.
    checklist_summary = None
    checklist_flags = []
    if checklist:
        filled = [i for i in checklist if i.score is not None]
        confirmed = sum(1 for i in checklist if i.confirmed)
        share = confirmed / len(checklist)
        if filled and share < m.CHECKLIST_CONFIRMED_MIN_SHARE:
            checklist_flags.append("checklist_unconfirmed")
        per_component = {}
        for code in m.COMPONENTS:
            items = [i for i in checklist if i.component == code]
            scores = [i.score for i in items if i.score is not None]
            per_component[code] = {"score": r1(fmean(scores)) if scores else None,
                                   "filled": len(scores), "total": len(items),
                                   "confirmed": sum(1 for i in items if i.confirmed)}
        checklist_summary = {"total": len(checklist), "filled": len(filled), "confirmed": confirmed,
                             "confirmed_share": round(share, 2), "by_component": per_component,
                             "items": [{"code": i.code, "number": i.number, "component": i.component, "text": i.text,
                                        "status": i.status, "score": i.score, "confirmed": i.confirmed}
                                       for i in checklist]}

    # Спільні питання РГ і ОС для category_gap.
    def common_scores(component: str) -> dict | None:
        wg, staff = by_category.get("working_group"), by_category.get("staff")
        if not (wg and staff and wg["sufficient"] and staff["sufficient"]):
            return None
        wg_q = {q["code"]: q["score"] for q in wg["questions"] if q["component"] == component}
        st_q = {q["code"]: q["score"] for q in staff["questions"] if q["component"] == component}
        shared = sorted(set(wg_q) & set(st_q))
        if not shared:
            return None
        return {"working_group": fmean(wg_q[c] for c in shared), "staff": fmean(st_q[c] for c in shared)}

    inputs = {}
    for code in m.COMPONENTS:
        sources: dict[str, float | None] = {}
        for category in SURVEY_SOURCES:
            g = by_category.get(category)
            if g is not None:
                sources[category] = g["components"].get(code) if g["sufficient"] else None
        if checklist_summary is not None:
            sources["checklist"] = checklist_summary["by_component"][code]["score"]
        inputs[code] = {
            "sources": sources,
            "common": common_scores(code),
            "facts": [f["score"] for f in facts if f["component"] == code and f["status"] == "ok"],
            "flags": group_flags + checklist_flags,
        }
    core = combine(inputs)
    for c in core["components"]:
        c["facts"] = [f for f in facts if f["component"] == c["code"]]

    # Деталізація до питання.
    questions: dict[str, dict] = {}
    for g in usable:
        for qr in g["questions"]:
            item = questions.setdefault(qr["code"], {"code": qr["code"], "text": qr["text"], "section": qr["section"],
                                                     "component": qr["component"], "by_category": []})
            item["by_category"].append({"category": g["category"], "questionnaire_id": g["questionnaire_id"],
                                        "n": qr["n"], "score": r1(qr["score"]), "distribution": qr["distribution"]})
    for item in questions.values():
        item["score"] = r1(fmean(b["score"] for b in item["by_category"]))
        item["zone"] = m.zone(item["score"])

    with_data = [c for c in core["components"] if c["score"] is not None]
    ranked = sorted(with_data, key=lambda c: c["score"], reverse=True)
    weakest = sorted((q for q in questions.values() if q["component"] in m.COMPONENTS), key=lambda q: q["score"])

    return {
        "methodology_version": m.METHODOLOGY_VERSION,
        **core,
        "groups": [{key: v for key, v in g.items() if key not in ("components", "questions")} for g in scored],
        "checklist": checklist_summary,
        "facts": facts,
        "questions": sorted(questions.values(), key=lambda q: q["code"]),
        "strengths": [{"code": c["code"], "title": c["title"], "score": c["score"]} for c in ranked if c["zone"]["code"] == "strong"],
        "problems": [{"code": c["code"], "title": c["title"], "score": c["score"]}
                     for c in reversed(ranked) if c["zone"]["code"] in ("critical", "attention")],
        "weakest_questions": [{"code": q["code"], "text": q["text"], "score": q["score"]} for q in weakest[:5]],
        "discrepancies": find_discrepancies(usable, questions),
    }


def find_discrepancies(usable: list[dict], questions: dict[str, dict]) -> list[dict]:
    """Інформаційні сигнали для деталізації (на достовірність впливають прапорці компонентів)."""
    result = []
    for item in questions.values():
        scores = {b["category"]: b["score"] for b in item["by_category"]}
        if "working_group" in scores and "staff" in scores:
            gap = scores["working_group"] - scores["staff"]
            if abs(gap) > m.CATEGORY_GAP_POINTS:
                who = "робоча група" if gap > 0 else "особовий склад"
                result.append({"type": "category_gap", "subject": item["code"],
                               "description": f"«{item['text'][:90]}»: {who} оцінює на {fmt(abs(gap))} бала вище.",
                               "values": scores, "rule": f"|РГ − ОС| більше {m.CATEGORY_GAP_POINTS:g} балів."})
    for g in usable:
        declared, computed = g["declared_level"], g["computed_level"]
        if declared is not None and computed is not None and declared - computed >= 1:
            result.append({"type": "declared_vs_computed", "subject": g["category"],
                           "description": f"Категорія {g['category']} заявляє рівень {declared}, а відповіді на питання дають рівень {computed}.",
                           "values": {"declared": declared, "computed": computed},
                           "rule": "Заявлений рівень (розділ 4 анкети) вищий за розрахований на 1 або більше."})
    return result


def management_summary(result: dict, dynamics: dict | None) -> list[str]:
    idx = result["index"]
    if idx["score"] is None:
        return ["Недостатньо даних для розрахунку: жодне джерело не досягло порогу анонімності."]
    lines = [
        f"Integrity Index: {fmt(idx['score'])} зі 100, рівень {idx['level']['level']} «{idx['level']['title']}», достовірність {idx['reliability']}."
        + ("" if idx["complete"] else " Індекс неповний.")
    ]
    cut = [c for c in result["components"] if c["cut_by_facts"]]
    for c in cut:
        lines.append(f"{c['title']}: самооцінку не підтверджують факти ({fmt(c['self_score'])} → {fmt(c['score'])}).")
    if idx["self_score"] is not None and idx["self_score"] != idx["score"]:
        lines.append(f"Без перевірки фактами індекс був би {fmt(idx['self_score'])}.")
    with_data = [c for c in result["components"] if c["score"] is not None]
    if len(with_data) >= 2:
        worst = min(with_data, key=lambda c: c["score"])
        lines.append(f"Найслабший компонент: {worst['title']} ({fmt(worst['score'])}). З нього варто почати заходи.")
    if dynamics:
        sig = dynamics["index_significance"]
        lines.append(f"Порівняно з хвилею «{dynamics['previous_title']}»: {sig['title']}"
                     + (f" ({'+' if dynamics['index_delta'] > 0 else ''}{fmt(dynamics['index_delta'])})." if dynamics["index_delta"] is not None else "."))
    return lines
