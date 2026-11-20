"""«Детектор відвертості»: наскільки люди недоговорюють, не дізнавшись нічого про жодну людину.

Умова завдання називає соціально бажані відповіді головною загрозою достовірності. Прапорець «підозріло
ідеальні» їх лише підозрює; тут вони вимірюються двома інструментами з соціології чутливих тем.

1. Непряме питання «скільки з переліку» (list experiment, тип list_count). Анкета випадково видається
   у варіанті A (N нейтральних тверджень) або B (ті самі + одне чутливе). Людина називає лише КІЛЬКІСТЬ
   правдивих для неї тверджень. Різниця середніх B − A — оцінка частки тих, хто стикався з чутливою
   ситуацією. Окрема відповідь нічого не розкриває: невідомо, чи «так» було саме на чутливе твердження.
   Поруч пряме питання про те саме (params.direct_code). Розрив «непряма − пряма» — виміряний страх
   відповідати чесно.
2. «Дзеркало» (params.mirror_of): після питання про себе — «а як відповіла б більшість колег?».
   Якщо про себе кажуть «я б повідомив», а про колег «вони б змовчали», це плюралістичне незнання:
   кожен вважає себе винятком. Лікується показом реальної норми (комунікаційні заходи, розділ 5 чек-листа).

Пороги анонімності: кожна група відповідей не менша за k, для непрямої оцінки ще й не менше
CANDOR_MIN_PER_VARIANT на кожен варіант (інакше «недостатньо даних»). Довірчий інтервал 95 %.
Варіант видається випадково під час видачі форми й зберігається лише у відповіді, не в людини.
Розділ «Відвертість» (компонент candor) в індекс не входить; дає прапорці достовірності.
"""

import random
import uuid
from math import sqrt
from statistics import fmean, pvariance

from app.config import get_settings
from app.models import Question, QuestionType
from app.services import methodology as m
from app.services.text import shorten

_rng = random.SystemRandom()

Z95 = 1.96
# Прапорець «приховування»: непряма оцінка перевищує пряму щонайменше на стільки п. п.,
# і нижня межа інтервалу вища за пряму частку.
CONCEALMENT_GAP_POINTS = 10.0
# «Плюралістичне незнання»: «я — так» перевищує «колеги — так» щонайменше на стільки п. п.
PLURALISTIC_GAP_POINTS = 20.0


def sensitive_option(question: Question):
    return next((o for o in question.options if o.score == 1), None)


def is_yes(question: Question, option_id) -> bool:
    """«Так» у прямому питанні й у «дзеркалі»: варіант з найвищим балом."""
    top = max((o.score for o in question.options), default=None)
    return any(o.id == option_id and o.score == top for o in question.options)


# ---------- Форма ----------

def count_option_id(question_id, variant: str, count: int) -> uuid.UUID:
    """Ідентифікатор варіанта «кількість» у формі: детермінований, кодує варіант переліку й кількість.

    Так непряме питання проходить і звичайним вибором одного варіанта (будь-який фронтенд, що вміє
    single_choice), а сервер відновлює з нього кількість і варіант A/B.
    """
    return uuid.uuid5(uuid.UUID(str(question_id)), f"list_count:{variant}:{count}")


def form_sections(questionnaire) -> list[dict]:
    """Розділи форми для респондента.

    Для list_count: випадковий варіант A/B (у варіанті A без чутливого твердження). Твердження — у statements
    і в help_text списком, а варіанти відповіді — кількості «0» … «N» (див. count_option_id).
    """
    out = []
    for s in questionnaire.sections:
        questions = []
        for q in s.questions:
            options = [{"id": o.id, "text": o.text} for o in q.options]
            variant, statements, help_text = None, None, q.help_text
            if (q.params or {}).get("mirror_of"):
                # Пояснення прийому «дзеркало» респонденту не показуємо: воно підказує, як «правильно» відповісти.
                # (У базах, засіяних раніше, підказка ще лежить у help_text анкети.)
                help_text = ""
            if q.type == QuestionType.LIST_COUNT:
                variant = _rng.choice("AB")
                sensitive = sensitive_option(q)
                shown = [o for o in q.options if not (variant == "A" and sensitive is not None and o.id == sensitive.id)]
                statements = [o.text for o in shown]
                help_text = (q.help_text + "\n" if q.help_text else "") + "\n".join(f"• {t}" for t in statements)
                options = [{"id": count_option_id(q.id, variant, c), "text": str(c)} for c in range(len(shown) + 1)]
            questions.append({"id": q.id, "text": q.text, "help_text": help_text, "type": q.type,
                              "required": q.required, "scale_min": q.scale_min, "scale_max": q.scale_max,
                              "options": options, "variant": variant, "statements": statements})
        out.append({"id": s.id, "title": s.title, "component": s.component, "questions": questions})
    return out


def normalize_answers(questionnaire, answers: list) -> list:
    """Відповідь на list_count вибором варіанта «кількість» → value + variant (до перевірки й збереження)."""
    lists = {q.id: q for s in questionnaire.sections for q in s.questions if q.type == QuestionType.LIST_COUNT}
    if not lists:
        return answers
    out = []
    for a in answers:
        q = lists.get(a.question_id)
        if q is not None and len(a.option_ids) == 1 and a.value is None:
            decoded = next(((v, c) for v in "AB" for c in range(len(q.options) + 1)
                            if count_option_id(q.id, v, c) == a.option_ids[0]), None)
            if decoded is not None:
                a = a.model_copy(update={"option_ids": [], "value": float(decoded[1]), "variant": decoded[0]})
        out.append(a)
    return out


# ---------- Аналіз ----------

def pct(x: float | None) -> float | None:
    return None if x is None else round(100 * x, 1)


def list_experiment(question: Question, responses: list, direct: Question | None, k: int, min_per_variant: int) -> dict:
    a = [r.values[question.id] for r in responses if r.variants.get(question.id) == "A" and question.id in r.values]
    b = [r.values[question.id] for r in responses if r.variants.get(question.id) == "B" and question.id in r.values]
    sensitive = sensitive_option(question)
    need = max(k, min_per_variant)
    item = {"code": question.code, "statement": sensitive.text if sensitive else "", "direct_code": None,
            "n_a": len(a) if len(a) >= k else None, "n_b": len(b) if len(b) >= k else None,
            "min_per_variant": need, "sufficient": False, "estimate": None, "ci": None,
            "direct_share": None, "gap": None, "concealment": False, "rule": ""}
    if direct is not None:
        item["direct_code"] = direct.code
        answers = [o for r in responses for o in r.options.get(direct.id, [])]
        if len(answers) >= k:
            item["direct_share"] = pct(sum(1 for o in answers if is_yes(direct, o)) / len(answers))
    if len(a) < need or len(b) < need:
        item["rule"] = (f"Недостатньо даних: потрібно щонайменше {need} відповідей на кожен варіант "
                        "(поріг k і мінімум для непрямої оцінки).")
        return item
    diff = fmean(b) - fmean(a)
    se = sqrt(pvariance(a) / len(a) + pvariance(b) / len(b))
    estimate = min(max(diff, 0.0), 1.0)
    lo, hi = max(diff - Z95 * se, 0.0), min(diff + Z95 * se, 1.0)
    item.update(sufficient=True, estimate=pct(estimate), ci=[pct(lo), pct(hi)],
                rule="Непряма оцінка = середнє B − середнє A; інтервал 95 % = ±1,96·√(varA/nA + varB/nB).")
    if item["direct_share"] is not None:
        item["gap"] = round(item["estimate"] - item["direct_share"], 1)
        item["concealment"] = (item["gap"] >= CONCEALMENT_GAP_POINTS and item["ci"][0] > item["direct_share"])
        if item["direct_share"] > 0:
            item["ratio"] = round(item["estimate"] / item["direct_share"], 1)
    return item


def mirror(question: Question, self_question: Question, responses: list, k: int) -> dict:
    own = [o for r in responses for o in r.options.get(self_question.id, [])]
    others = [o for r in responses for o in r.options.get(question.id, [])]
    item = {"code": question.code, "self_code": self_question.code, "self_text": self_question.text,
            "n": None, "self_share": None, "others_share": None, "gap": None, "pluralistic_ignorance": False}
    if len(own) < k or len(others) < k:
        return item
    item["n"] = min(len(own), len(others))
    item["self_share"] = pct(sum(1 for o in own if is_yes(self_question, o)) / len(own))
    item["others_share"] = pct(sum(1 for o in others if is_yes(question, o)) / len(others))
    item["gap"] = round(item["self_share"] - item["others_share"], 1)
    item["pluralistic_ignorance"] = item["gap"] >= PLURALISTIC_GAP_POINTS
    return item


def analyze(groups: list, k: int, min_per_variant: int | None = None) -> dict:
    """groups: scoring.GroupInput. Повертає непрямі оцінки, «дзеркала» і прапорці."""
    min_per_variant = get_settings().candor_min_per_variant if min_per_variant is None else min_per_variant
    lists, mirrors = [], []
    for g in groups:
        if g.suppressed or len(g.responses) < k:
            continue
        by_code = {q.code: q for s in g.questionnaire.sections for q in s.questions}
        for s in g.questionnaire.sections:
            if s.component != m.CANDOR_COMPONENT:
                continue
            for q in s.questions:
                params = q.params or {}
                if q.type == QuestionType.LIST_COUNT:
                    item = list_experiment(q, g.responses, by_code.get(params.get("direct_code")), k, min_per_variant)
                    lists.append({"category": str(g.questionnaire.target_category), **item})
                elif params.get("mirror_of") and params["mirror_of"] in by_code:
                    item = mirror(q, by_code[params["mirror_of"]], g.responses, k)
                    mirrors.append({"category": str(g.questionnaire.target_category), **item})
    flags = []
    if any(i["concealment"] for i in lists):
        flags.append("concealment")
    if any(i["pluralistic_ignorance"] for i in mirrors):
        flags.append("pluralistic_ignorance")
    return {"list_experiments": lists, "mirrors": mirrors, "flags": flags,
            "card": card(lists, mirrors),
            "rule": "Розділ «Відвертість» в індекс не входить. Прапорець «приховування» знижує достовірність, "
                    "«плюралістичне незнання» — інформаційний."}


def card(lists: list[dict], mirrors: list[dict]) -> list[str]:
    """Рядки картки «Що люди бояться сказати прямо» для «Огляду»."""
    lines = []
    for i in lists:
        if not i["sufficient"]:
            continue
        line = f"«{shorten(i['statement'], 80)}»: "
        if i["direct_share"] is not None:
            line += f"прямо визнали {m_fmt(i['direct_share'])}%, "
        line += f"непряма оцінка {m_fmt(i['estimate'])}% (від {m_fmt(i['ci'][0])} до {m_fmt(i['ci'][1])}%)."
        lines.append(line)
    for i in mirrors:
        if i["self_share"] is None:
            continue
        lines.append(f"Дзеркало: {m_fmt(i['self_share'])}% кажуть, що вчинили б так самі; про колег так думають "
                     f"лише {m_fmt(i['others_share'])}%.")
    return lines


def m_fmt(x: float) -> str:
    return f"{round(x, 1):g}".replace(".", ",")
