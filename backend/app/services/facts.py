"""Факти з інших систем: агрегування за періодом і підрозділом, поріг k, вторинне приховування.

Періоди складаються лише із завершених календарних кварталів (3, 6 або 12 місяців, що закінчуються
останнім повним кварталом перед датою), а поріг k і вторинне приховування перевіряються для кожного
кварталу окремо. Так різниця двох будь-яких доступних вікон (зокрема того самого запиту в різні дні)
дає щонайбільше суму цілих кварталів, кожен з яких сам не менший за k, і значення за окремий місяць
чи малий квартал не обчислити.
"""

import uuid
from collections.abc import Iterable
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Indicator
from app.services import methodology as m
from app.services.anonymity import suppressed_nodes
from app.services.units import Children, subtree_from, top_root, unit_tree


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def months_back(end: date, count: int) -> list[str]:
    """Список місяців YYYY-MM: `count` місяців, що закінчуються місяцем `end` (включно)."""
    year, month = end.year, end.month
    result = []
    for _ in range(count):
        result.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return sorted(result)


def quarter_of(period: str) -> str:
    """'2026-05' -> '2026-Q2'."""
    return f"{period[:4]}-Q{(int(period[5:7]) - 1) // 3 + 1}"


def last_full_quarter_end(d: date) -> date:
    """Перше число останнього місяця останнього завершеного кварталу перед d.

    17.11.2026 -> 01.09.2026 (III квартал); 01.04.2026 -> 01.03.2026 (I квартал).
    """
    first_month = ((d.month - 1) // 3) * 3 + 1  # перший місяць поточного кварталу
    year, month = d.year, first_month - 1
    if month == 0:
        year, month = year - 1, 12
    return date(year, month, 1)


def window(end: date, months: int) -> list[str]:
    """Місяці періоду: `months` (кратне 3) місяців, що закінчуються останнім повним кварталом перед end."""
    if months % 3:
        raise ValueError("Період має складатися з цілих кварталів (3, 6, 12 місяців)")
    return months_back(last_full_quarter_end(end), months)


def load_rows(db: Session, units: set[uuid.UUID], periods: list[str]) -> list[Indicator]:
    if not units or not periods:
        return []
    return list(db.scalars(select(Indicator).where(Indicator.unit_id.in_(units), Indicator.period.in_(periods))))


def _subtree_totals(children: Children, direct: dict, root) -> dict:
    totals: dict = {}

    def total(node) -> int:
        if node not in totals:
            totals[node] = direct.get(node, 0) + sum(total(c) for c in children.get(node, []))
        return totals[node]

    total(root)
    return totals


def hidden_map(rows: Iterable[Indicator], children: Children, root: uuid.UUID, k: int) -> dict[str, set]:
    """Показник -> підрозділи, де його треба приховати вторинним приховуванням (у якомусь кварталі).

    Рахується один раз на дерево: для кожного кварталу окремо знаменники дочірніх підрозділів,
    менші за k, не можна отримати різницею «батько − показані діти». Підрозділ, у якого в
    кварталі даних немає, цим кварталом не приховується.
    """
    direct: dict[tuple[str, str], dict[uuid.UUID, int]] = {}
    for row in rows:
        counts = direct.setdefault((row.indicator, quarter_of(row.period)), {})
        counts[row.unit_id] = counts.get(row.unit_id, 0) + row.denominator
    result: dict[str, set] = {}
    for (code, _), counts in direct.items():
        totals = _subtree_totals(children, counts, root)
        hidden = suppressed_nodes(children, counts, root, k)
        result.setdefault(code, set()).update(n for n in hidden if totals.get(n, 0) > 0)
    return result


def hidden_indicators(rows: Iterable[Indicator], children: Children, root: uuid.UUID, scope: uuid.UUID, k: int,
                      cache: dict[str, set] | None = None) -> set[str]:
    """Показники, які для scope треба приховати вторинним приховуванням (див. hidden_map)."""
    hidden = cache if cache is not None else hidden_map(rows, children, root, k)
    return {code for code, units in hidden.items() if scope in units}


def aggregate_rows(rows: Iterable[Indicator], periods: list[str], k: int, hidden: set[str] | None = None) -> list[dict]:
    """Сума numerator/denominator по підрозділах і місяцях для кожного факту.

    Якщо знаменник менший за k (або показник приховано вторинним приховуванням),
    цифри не показуються і в індекс не йдуть: вони враховуються лише у вищому підрозділі.
    """
    hidden = hidden or set()
    sums: dict[str, dict] = {}
    for row in rows:
        if row.indicator not in m.FACTS:
            continue
        item = sums.setdefault(row.indicator, {"numerator": 0, "denominator": 0, "extra": {}, "sources": set(),
                                               "quarters": {}})
        item["numerator"] += row.numerator
        item["denominator"] += row.denominator
        q = quarter_of(row.period)
        item["quarters"][q] = item["quarters"].get(q, 0) + row.denominator
        item["sources"].add(row.source)
        for key, value in (row.extra_counts or {}).items():
            item["extra"][key] = item["extra"].get(key, 0) + value

    result = []
    for code, meta in m.FACTS.items():
        item = sums.get(code)
        if item is None:
            continue
        num, den = item["numerator"], item["denominator"]
        base = {
            "indicator": code,
            "title": meta["title"],
            "component": meta["component"],
            "periods": f"з {periods[0]} по {periods[-1]}",
            "sources": sorted(item["sources"]),
        }
        empty = {"numerator": None, "denominator": None, "percent": None, "level": None, "score": None, "extra_counts": {}}
        if den == 0:
            result.append({**base, **empty, "status": "no_denominator",
                           "label": f"{meta['title']}: немає даних (знаменник 0)", "rule": "Знаменник 0: факт не враховується."})
            continue
        small_quarters = sorted(q for q, n in item["quarters"].items() if 0 < n < k)
        if den < k or small_quarters or code in hidden:
            if den < k:
                rule = f"Знаменник менший за {k}: цифри враховуються лише у вищому підрозділі."
            elif small_quarters:
                rule = (f"У кварталі {', '.join(small_quarters)} знаменник менший за {k}: щоб його не можна було "
                        "обчислити різницею сусідніх періодів, цифри враховуються лише у вищому підрозділі.")
            else:
                rule = (f"У сусідньому підрозділі знаменник менший за {k}: щоб його не можна було обчислити різницею, "
                        "цифри цього підрозділу теж приховано й враховуються лише у вищому.")
            result.append({**base, **empty, "status": "too_few_people",
                           "label": f"{meta['title']}: замало людей для показу", "rule": rule})
            continue
        percent = round(100 * num / den, 1)
        level = m.fact_level(code, 100 * num / den)
        result.append(
            {
                **base,
                "status": "ok",
                "numerator": num,
                "denominator": den,
                "percent": percent,
                "level": level,
                "score": (level - 1) * m.POINTS_PER_LEVEL,
                "extra_counts": item["extra"],
                # Бал рівня поруч із часткою: інакше «бал 0» читали як «0 справ» (UI-аудит 20.11, п. 2).
                "label": (f"{meta['title']}: {meta['denominator']} {den} · {meta['numerator']} {num} · "
                          f"{meta['rest']} {den - num} ({round(percent)}%), бал {(level - 1) * m.POINTS_PER_LEVEL:g} з 100"),
                "rule": f"{num} з {den} = {percent}% → рівень {level} за порогами {meta['thresholds']} → {(level - 1) * m.POINTS_PER_LEVEL:g} балів.",
            }
        )
    return result


def aggregate(db: Session, units: set[uuid.UUID], periods: list[str], k: int) -> list[dict]:
    """Без вторинного приховування (для одного підрозділу без дерева). Див. aggregate_for_unit."""
    return aggregate_rows(load_rows(db, units, periods), periods, k)


def aggregate_for_unit(db: Session, unit_id: uuid.UUID, periods: list[str], k: int) -> list[dict]:
    """Факти підрозділу з дочірніми, з вторинним приховуванням у межах усього дерева."""
    children, parents = unit_tree(db)
    root = top_root(parents, unit_id)
    all_rows = load_rows(db, subtree_from(children, root), periods)
    scope = subtree_from(children, unit_id)
    hidden = hidden_indicators(all_rows, children, root, unit_id, k)
    return aggregate_rows([r for r in all_rows if r.unit_id in scope], periods, k, hidden)


RISK_INDICATORS = ("coi_reviewed", "procurement_flags_reviewed", "reports_handled")


def previous_period_end(first_month: str) -> date:
    year, month = int(first_month[:4]), int(first_month[5:]) - 1
    if month == 0:
        year, month = year - 1, 12
    return date(year, month, 1)


def risk_signals(db: Session, unit_id: uuid.UUID, months: int, end: date, k: int) -> list[dict]:
    """Сирі кількості знайденого і їх зміна до попереднього такого самого періоду.

    На індекс не впливає: кількість знайдених проблем не є поганою оцінкою.
    """
    current = window(end, months)
    previous = months_back(previous_period_end(current[0]), months)
    now = {f["indicator"]: f for f in aggregate_for_unit(db, unit_id, current, k)}
    before = {f["indicator"]: f for f in aggregate_for_unit(db, unit_id, previous, k)}
    signals = []
    for code in RISK_INDICATORS:
        f = now.get(code)
        if f is None:
            continue
        prev = before.get(code)
        found = f["denominator"]
        prev_found = prev["denominator"] if prev else None
        signals.append({
            "indicator": code,
            "title": m.FACTS[code]["title"],
            "status": f["status"],
            "found": found,
            "handled": f["numerator"],
            "pending": None if found is None else found - f["numerator"],
            "previous_found": prev_found,
            "change": None if found is None or prev_found is None else found - prev_found,
            "extra_counts": f["extra_counts"],
        })
    return signals
