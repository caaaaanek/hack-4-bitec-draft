"""Методика Integrity Index, версія 2.

Усі ваги й пороги зібрано тут і доступні через GET /api/v1/methodology.
Розрахунок детермінований і працює без ШІ.

Значення — пропозиція, остаточно їх затверджує команда. Змінюючи будь-яке
значення, підніміть METHODOLOGY_VERSION: старі знімки хвиль зберігають версію,
за якою їх пораховано.
"""

import re

METHODOLOGY_VERSION = "2.0"

# 1 рівень зрілості = 25 балів шкали 0-100.
POINTS_PER_LEVEL = 25.0

# ---------- Компоненти (Модель зрілості НАЗК), рівні ваги ----------

COMPONENTS: dict[str, dict] = {
    "culture": {"title": "Культура", "weight": 1 / 3},
    "system": {"title": "Система", "weight": 1 / 3},
    "accountability": {"title": "Підзвітність", "weight": 1 / 3},
}

# Розділ анкети "Загальна самооцінка" в індекс не входить,
# лишається як сигнал "заявлений проти розрахованого".
DECLARED_COMPONENT = "overall"

# ---------- Крок 1. Самооцінка компонента S_c ----------

# Ваги джерел самооцінки. Якщо джерело без даних (n < k), його вага
# ділиться між рештою пропорційно.
SOURCE_WEIGHTS: dict[str, float] = {
    "staff": 0.35,          # особовий склад: "користується" системою
    "working_group": 0.25,  # робоча група: будує систему, схильна завищувати
    "expert": 0.20,         # експерти: зовнішній погляд
    "checklist": 0.20,      # контрольний чек-лист (додаток Б)
}

SOURCE_TITLES: dict[str, str] = {
    "staff": "особовий склад",
    "working_group": "робоча група",
    "expert": "експерти",
    "checklist": "чек-лист",
}

# Розподіл 36 пунктів чек-листа між компонентами.
CHECKLIST_COMPONENTS: dict[str, list[str]] = {
    "culture": ["1.2", "1.3", "2.6", "2.8", "5.1", "5.2", "5.3", "5.4", "5.5"],
    "system": ["1.1", "2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "3.3"],
    "accountability": ["2.7", "3.2", "3.4", "4.*", "6.1", "6.2", "6.3", "6.4"],
}

# Бали статусів пункту чек-листа.
CHECKLIST_STATUS_SCORES: dict[str, float] = {"full": 100.0, "partial": 50.0, "none": 0.0}
CHECKLIST_STATUS_TITLES: dict[str, str] = {
    "full": "впроваджено повністю",
    "partial": "впроваджено частково",
    "none": "підлягає впровадженню",
}
# "Повністю" без підтвердження рахується як "частково".
# Підтвердити пункт можна лише з доказом, тож підтверджений пункт завжди має доказ.
UNCONFIRMED_FULL_SCORE = 50.0

# ---------- Крок 2. Факти F_c ----------

# Межі частки (у відсотках) для рівнів 2, 3, 4, 5. Нижче першої межі — рівень 1.
FACTS: dict[str, dict] = {
    "declarations_on_time": {
        "title": "Декларації подано вчасно",
        "component": "system",
        "thresholds": [80, 90, 95, 99],
        "numerator": "подали вчасно",
        "denominator": "мали подати",
        "rest": "не подали вчасно",
    },
    "training_coverage": {
        "title": "Охоплення навчанням за 12 місяців",
        "component": "culture",
        "thresholds": [50, 70, 85, 95],
        "numerator": "пройшли навчання",
        "denominator": "мали пройти",
        "rest": "не пройшли",
    },
    "coi_reviewed": {
        "title": "Можливі конфлікти інтересів розібрано вчасно",
        "component": "accountability",
        "thresholds": [60, 75, 90, 98],
        "numerator": "розібрано вчасно",
        "denominator": "знайдено можливих",
        "rest": "чекають",
    },
    "procurement_flags_reviewed": {
        "title": "Підозрілі закупівлі розібрано",
        "component": "accountability",
        "thresholds": [50, 70, 85, 95],
        "numerator": "розібрано",
        "denominator": "позначено підозрілих",
        "rest": "чекають",
    },
    "reports_handled": {
        "title": "Повідомлення розглянуто вчасно",
        "component": "accountability",
        "thresholds": [70, 85, 95, 100],
        "numerator": "розглянуто вчасно",
        "denominator": "надійшло",
        "rest": "не розглянуто вчасно",
    },
    "hiring_checks": {
        "title": "Призначення з перевіркою доброчесності",
        "component": "accountability",
        "thresholds": [70, 85, 95, 100],
        "numerator": "з перевіркою",
        "denominator": "всього призначень",
        "rest": "без перевірки",
    },
}

# Для індексу хвилі беруться факти за стільки місяців до закриття хвилі (включно).
FACTS_WINDOW_MONTHS = 12

# ---------- Крок 3. Правило реальності ----------

# Самооцінка не може перевищувати факти більш ніж на 1 рівень.
REALITY_MARGIN = POINTS_PER_LEVEL

# ---------- Крок 4. Індекс і рівень ----------

MATURITY_LEVELS: list[dict] = [
    {"level": 1, "title": "Початковий", "min": 0.0},
    {"level": 2, "title": "Керований", "min": 12.5},
    {"level": 3, "title": "Визначений", "min": 37.5},
    {"level": 4, "title": "Вимірюваний", "min": 62.5},
    {"level": 5, "title": "Оптимізуючий", "min": 87.5},
]

# Загальний рівень не може бути вищим за рівень найслабшого компонента більше ніж на стільки.
WEAK_LINK_MAX_GAP = 1

ZONES: list[dict] = [
    {"code": "critical", "title": "Критична зона", "min": 0.0},
    {"code": "attention", "title": "Потребує уваги", "min": 40.0},
    {"code": "moderate", "title": "Задовільно", "min": 60.0},
    {"code": "strong", "title": "Сильна сторона", "min": 75.0},
]

# ---------- Крок 5. Достовірність ----------

PARTICIPATION_MIN_PERCENT = 60.0     # low_participation
CATEGORY_GAP_POINTS = 25.0           # category_gap: |РГ − ОС| більше
PERFECT_SHARE_MAX = 0.30             # suspiciously_perfect: частка більше
CHECKLIST_CONFIRMED_MIN_SHARE = 0.5  # checklist_unconfirmed: підтверджено менше

FLAGS: dict[str, dict] = {
    "low_participation": {"severity": "minor", "title": "Низька участь або випала категорія респондентів"},
    "category_gap": {"severity": "serious", "title": "Робоча група й особовий склад оцінюють суттєво по-різному"},
    "suspiciously_perfect": {"severity": "serious", "title": "Забагато анкет лише з найвищими відповідями"},
    "self_not_confirmed": {"severity": "serious", "title": "Самооцінку не підтверджують факти"},
    "checklist_unconfirmed": {"severity": "minor", "title": "Підтверджено менше половини пунктів чек-листа"},
    "no_facts": {"severity": "minor", "title": "Немає фактів для перевірки самооцінки"},
    "unaware_of_mechanisms": {"severity": "info", "title": "Факти кращі за самооцінку: люди можуть не знати про наявні механізми"},
}

# B — 1-2 незначних прапорці; C — хоч один серйозний або стільки незначних.
MINOR_FLAGS_FOR_C = 3

# ---------- Динаміка ----------

# Зміна менша за стільки балів вважається "в межах похибки".
SIGNIFICANT_DELTA = 5.0


# ---------- Допоміжні функції ----------

def checklist_component(item_number: str) -> str | None:
    """'4.3.1' -> 'accountability'. Номер пункту береться з коду 'checklist.4.3.1'."""
    for component, patterns in CHECKLIST_COMPONENTS.items():
        for pattern in patterns:
            if pattern.endswith(".*"):
                if item_number.startswith(pattern[:-1]):
                    return component
            elif item_number == pattern:
                return component
    return None


def checklist_item_number(question_code: str) -> str | None:
    match = re.fullmatch(r"checklist\.([\d.]+)", question_code)
    return match.group(1) if match else None


def survey_component(section_component: str) -> str | None:
    return section_component if section_component in COMPONENTS else None


def score_to_level_value(score: float) -> float:
    """Бал 0-100 у дробовий рівень 1-5 (для пояснень)."""
    return 1 + score / POINTS_PER_LEVEL


def maturity_level(score: float) -> dict:
    current = MATURITY_LEVELS[0]
    for level in MATURITY_LEVELS:
        if score >= level["min"]:
            current = level
    return {"level": current["level"], "title": current["title"]}


def level_by_number(number: int) -> dict:
    item = next(x for x in MATURITY_LEVELS if x["level"] == number)
    return {"level": item["level"], "title": item["title"]}


def zone(score: float) -> dict:
    current = ZONES[0]
    for z in ZONES:
        if score >= z["min"]:
            current = z
    return {"code": current["code"], "title": current["title"]}


def fact_level(indicator: str, percent: float) -> int:
    level = 1
    for i, threshold in enumerate(FACTS[indicator]["thresholds"], start=2):
        if percent >= threshold:
            level = i
    return level


def reliability(flags: list[str]) -> str:
    """A: немає прапорців; B: 1-2 незначних; C: серйозний або 3+ незначних."""
    severities = [FLAGS[f]["severity"] for f in flags if f in FLAGS]
    if "serious" in severities:
        return "C"
    minors = severities.count("minor")
    if minors >= MINOR_FLAGS_FOR_C:
        return "C"
    return "B" if minors else "A"


def worst_reliability(grades: list[str]) -> str:
    order = {"A": 0, "B": 1, "C": 2}
    return max(grades, key=lambda g: order[g]) if grades else "A"


def significance(delta: float | None, reliabilities: list[str | None]) -> dict:
    """Правило значущості зміни між двома хвилями."""
    if delta is None:
        return {"code": "no_data", "title": "немає даних для порівняння"}
    if abs(delta) < SIGNIFICANT_DELTA:
        return {"code": "within_error", "title": "в межах похибки"}
    if "C" in reliabilities:
        return {"code": "check_data", "title": "перевірити дані"}
    if delta > 0:
        return {"code": "improved", "title": "покращилось"}
    return {"code": "worsened", "title": "погіршилось"}


def as_dict() -> dict:
    return {
        "version": METHODOLOGY_VERSION,
        "points_per_level": POINTS_PER_LEVEL,
        "components": COMPONENTS,
        "source_weights": SOURCE_WEIGHTS,
        "checklist_components": CHECKLIST_COMPONENTS,
        "checklist_status_scores": CHECKLIST_STATUS_SCORES,
        "unconfirmed_full_score": UNCONFIRMED_FULL_SCORE,
        "facts": FACTS,
        "facts_window_months": FACTS_WINDOW_MONTHS,
        "reality_margin": REALITY_MARGIN,
        "maturity_levels": MATURITY_LEVELS,
        "weak_link_max_gap": WEAK_LINK_MAX_GAP,
        "zones": ZONES,
        "reliability": {
            "participation_min_percent": PARTICIPATION_MIN_PERCENT,
            "category_gap_points": CATEGORY_GAP_POINTS,
            "perfect_share_max": PERFECT_SHARE_MAX,
            "checklist_confirmed_min_share": CHECKLIST_CONFIRMED_MIN_SHARE,
            "minor_flags_for_c": MINOR_FLAGS_FOR_C,
            "flags": FLAGS,
        },
        "significant_delta": SIGNIFICANT_DELTA,
        "rules": [
            "1. Бал відповіді переводиться у шкалу 0-100. 1 рівень зрілості = 25 балів.",
            "2. Групи, у яких менше відповідей, ніж поріг хвилі k, не враховуються. Їхні дані враховуються лише у вищому підрозділі.",
            "3. Самооцінка компонента S = 0,35·ОС + 0,25·РГ + 0,20·Експерти + 0,20·Чек-лист. Вага джерела без даних ділиться між рештою пропорційно.",
            "4. Пункт чек-листа: повністю 100, частково 50, підлягає 0. 'Повністю' без підтвердження з доказом = 50.",
            "5. Факт: частка X з Y переводиться в рівень за порогами, далі в бали (рівень − 1) × 25. F: середнє фактів компонента.",
            "6. Правило реальності: якщо S > F + 25, компонент = F + 25 (самооцінку не підтверджують факти). Факти лише обмежують, але не піднімають.",
            "7. Integrity Index = середнє трьох компонентів. Загальний рівень не вищий за рівень найслабшого компонента + 1.",
            "8. Достовірність: A без прапорців, B з 1-2 незначними, C з серйозним або 3+ незначними. Достовірність індексу: найгірша серед компонентів.",
            "9. Зміна між хвилями менша за 5 балів: 'в межах похибки'. Якщо одна з хвиль має достовірність C: 'перевірити дані'.",
            "10. Кількості фактів показуються й враховуються лише тоді, коли знаменник не менший за k.",
        ],
    }
