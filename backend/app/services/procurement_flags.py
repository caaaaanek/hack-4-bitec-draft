"""Червоні прапорці для публічних закупівель: детерміновані правила без LLM і мережі.

Адаптовано з rules.py (використання дозволене автором). Чистий Python, лише stdlib.
Вхід: нормалізовані записи закупівель (один запис = один лот: record_id, expected_value,
bids[].bidder, winner, dates, ...).

Публічний інтерфейс:
    evaluate_records(records, dataset=None, config=None) -> list[dict]
    risk_level(flags) -> "none" | "low" | "medium" | "high"
    law_refs_for(rule_id) -> list[str]
    RULES, DEFAULT_CONFIG

ПРИВАТНІСТЬ: у результаті лише rule_id, severity, title, law_refs. Назви компаній, телефони,
пошта, адреси, ЄДРПОУ учасників використовуються тільки всередині розрахунку і назовні
не повертаються.

Прапорець означає "рекомендується перевірити", а не висновок про порушення.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Iterable

Record = dict[str, Any]

SEVERITY_ORDER = {"low": 1, "medium": 2, "high": 3}

DEFAULT_CONFIG: dict[str, Any] = {
    # Пороги ст. 3 ч. 1 п. 1 ЗУ "Про публічні закупівлі" для замовників п. 1-3 ч. 1 ст. 2:
    # товари/послуги 200 000 грн, роботи 1 500 000 грн. Діють і для buyer.kind = null.
    "threshold_goods_services": 200_000,
    "threshold_works": 1_500_000,
    # Для special (замовники п. 4 ч. 1 ст. 2) ст. 3 ч. 1 п. 2: 1 000 000 і 5 000 000 грн.
    "thresholds_by_buyer_kind": {
        "special": {"goods_services": 1_000_000, "works": 5_000_000},
    },

    "single_bidder_min_amount": 1_000_000,
    "single_bidder_high_amount": 5_000_000,
    "single_bidder_method_types": ["aboveThreshold", "belowThreshold"],

    "near_expected_min_ratio": 0.98,
    "near_expected_max_ratio": 1.0,

    # Мінімальний tender_period_days за типом процедури. Типів, яких тут немає, не перевіряємо.
    # aboveThreshold: п. 34 Особливостей (постанова КМУ № 1178) у редакції постанови № 957,
    # чинної з 01.09.2026. belowThreshold: ст. 14 ч. 3 п. 9 ЗУ 922 (2 робочі дні, нижня межа
    # 2 календарні). aboveThresholdUA/EU: ст. 20 ч. 3 ЗУ 922.
    "min_tender_period_days": {
        "aboveThreshold": 15,
        "belowThreshold": 2,
        "aboveThresholdUA": 15,
        "aboveThresholdEU": 30,
    },
    # Попередня редакція п. 34: для оголошень до "until" 7 днів (товари, послуги), 14 (роботи).
    "min_tender_period_before": {
        "aboveThreshold": {"until": "2026-09-01", "days": 7, "works_days": 14},
    },

    "winner_not_cheapest_min_gap": 0.10,
    "winner_not_cheapest_medium_gap": 0.20,
    "winner_not_cheapest_high_gap": 0.30,
    "winner_not_cheapest_min_amount": 50_000,
    # Розрив понад 100% частіше означає помилку в ціні: не вище medium.
    "winner_not_cheapest_suspicious_gap": 1.0,

    "rejected_statuses": ["unsuccessful", "cancelled"],

    "many_changes_min": 3,

    "split_window_days": 30,
    "split_min_records": 3,

    "email_word_min_len": 4,
    # Галузеві корені: слово з назви, що містить такий корінь, не вважається характерним.
    "email_generic_roots": [
        "техно", "офіс", "фарм", "енерго", "петрол",
        "буд", "сервіс", "торг", "груп", "трейд", "постач", "медик", "авто", "агро",
        "електро", "пром", "укр",
    ],

    "shared_max_group": None,  # None = без обмеження розміру групи зі спільним контактом
}

RULES: dict[str, dict[str, str]] = {
    "single_bidder_high_value": {
        "title": "Один учасник при великій сумі", "severity_default": "medium",
        "description": "Подано лише одну пропозицію у відкритій процедурі на суму від 1 млн грн "
                       "(від 5 млн грн severity high).",
    },
    "winner_price_near_expected": {
        "title": "Ціна переможця майже дорівнює очікуваній", "severity_default": "medium",
        "description": "При кількох учасниках ціна переможця становить 98-100% очікуваної вартості.",
    },
    "short_tender_period": {
        "title": "Короткий строк подання пропозицій", "severity_default": "medium",
        "description": "Строк подання пропозицій коротший за мінімальний для типу процедури.",
    },
    "shared_phone": {
        "title": "Спільний телефон у різних учасників", "severity_default": "high",
        "description": "Учасники з різними ЄДРПОУ вказали однаковий телефон.",
    },
    "shared_email": {
        "title": "Спільний email у різних учасників", "severity_default": "high",
        "description": "Учасники з різними ЄДРПОУ вказали однакову електронну пошту.",
    },
    "shared_address": {
        "title": "Спільна адреса у різних учасників", "severity_default": "medium",
        "description": "Учасники з різними ЄДРПОУ вказали однакову адресу.",
    },
    "email_matches_other_bidder": {
        "title": "Email учасника містить назву іншого учасника", "severity_default": "medium",
        "description": "Пошта одного учасника містить характерне слово з назви іншого учасника.",
    },
    "winner_not_cheapest": {
        "title": "Переможець не найдешевший", "severity_default": "medium",
        "description": "Ціна переможця вища за найнижчу пропозицію щонайменше на 10% "
                       "(severity за розривом: від 20% medium, від 30% high).",
    },
    "cheaper_rejected_near_max": {
        "title": "Дешевші пропозиції відхилено, переможець біля максимуму",
        "severity_default": "high",
        "description": "Усі дешевші за переможця пропозиції відхилено, а його ціна "
                       "становить 98% і більше очікуваної вартості.",
    },
    "non_competitive_high_value": {
        "title": "Неконкурентна процедура на велику суму", "severity_default": "medium",
        "description": "Закупівля без конкурентного відбору (limited) на суму від порогу ст. 3 ЗУ 922.",
    },
    "many_contract_changes": {
        "title": "Багато змін до договору", "severity_default": "medium",
        "description": "До договору внесено 3 і більше змін.",
    },
    "shared_owner": {
        "title": "Спільна особа у різних учасників", "severity_default": "high",
        "description": "Одна особа пов'язана (власник, директор) з кількома учасниками.",
    },
    "complaints_present": {
        "title": "Є скарги", "severity_default": "low",
        "description": "До закупівлі подано скарги.",
    },
    "split_purchase": {
        "title": "Можливе дроблення закупівлі", "severity_default": "high",
        "description": "Замовник за 30 днів оголосив 3 і більше закупівель з тим самим CPV (4 цифри), "
                       "кожна нижче порогу, разом не нижче порогу.",
    },
}

_ZU = "ЗУ «Про публічні закупівлі»"
_KMU = "Постанова КМУ № 1178"
_RELATED = [f"{_ZU}, ст. 17 ч. 1 п. 7", f"{_KMU}, п. 47 підп. 7"]

# Відповідність норм (перенесено з rules_map.json, без цитат).
_LAW_REFS: dict[str, list[str]] = {
    "single_bidder_high_value": [f"{_KMU}, п. 35", f"{_KMU}, п. 36"],
    "winner_price_near_expected": [f"{_KMU}, п. 32", f"{_ZU}, ст. 5 ч. 1 п. 2"],
    "short_tender_period": [f"{_KMU}, п. 34", f"{_ZU}, ст. 14 ч. 3 п. 9"],
    "shared_phone": _RELATED,
    "shared_email": _RELATED,
    "shared_address": _RELATED,
    "email_matches_other_bidder": _RELATED,
    "winner_not_cheapest": [f"{_ZU}, ст. 29 ч. 11", f"{_KMU}, п. 44"],
    "cheaper_rejected_near_max": [f"{_KMU}, п. 44 підп. 2", f"{_KMU}, п. 44"],
    "non_competitive_high_value": [
        f"{_ZU}, ст. 40 ч. 1", f"{_ZU}, ст. 3 ч. 1 п. 1", f"{_ZU}, ст. 3 ч. 1 п. 2",
    ],
    "many_contract_changes": [f"{_ZU}, ст. 41 ч. 5 п. 2"],
    "shared_owner": [f"{_ZU}, ст. 1 ч. 1 п. 20", f"{_ZU}, ст. 17 ч. 1 п. 7"],
    "complaints_present": [f"{_ZU}, ст. 18 ч. 1", f"{_KMU}, п. 55"],
    "split_purchase": [
        f"{_KMU}, п. 6", f"{_ZU}, ст. 3 ч. 1 п. 1", f"{_ZU}, ст. 3 ч. 1 п. 2",
    ],
}

# Слова з назв, які не є "характерними" (організаційна форма, загальні слова).
NAME_STOPWORDS = {
    "тов", "тзов", "товариство", "обмеженою", "відповідальністю", "додатковою",
    "компанія", "компанії", "корпорація", "група", "груп", "фірма", "фоп",
    "фізична", "особа", "підприємець", "приватне", "приватна", "підприємство",
    "державне", "комунальне", "акціонерне", "публічне", "дочірнє",
    "виробниче", "виробничо", "комерційна", "комерційне", "науково", "торговий",
    "торгова", "торговельний", "будинок", "україна", "українська", "український",
    "центр", "сервіс", "сервис", "трейд", "плюс", "постач", "постачання", "холдинг",
    "інвест", "консалтинг", "технології", "технологія", "системи", "системс",
    "ltd", "llc", "group", "company", "trade", "service",
}

_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e", "є": "ie",
    "ж": "zh", "з": "z", "и": "y", "і": "i", "ї": "i", "й": "i", "к": "k", "л": "l",
    "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ь": "",
    "ю": "iu", "я": "ia", "ё": "e", "ы": "y", "э": "e", "ъ": "", "'": "", "’": "",
}

# Зведення різних варіантів латинки до одного "скелета": shch/sch, kh/h, g/h, y/i, ...
_SKELETON = [
    ("shch", "sh"), ("sch", "sh"), ("kh", "h"), ("zh", "z"), ("ts", "c"), ("tz", "c"),
    ("ye", "e"), ("ie", "e"), ("yi", "i"), ("yu", "u"), ("iu", "u"), ("ya", "a"),
    ("ia", "a"), ("g", "h"), ("y", "i"), ("w", "v"), ("x", "ks"), ("q", "k"),
]


# ---------------------------------------------------------------- утиліти

def law_refs_for(rule_id: str) -> list[str]:
    return list(_LAW_REFS.get(rule_id, []))


def _cfg(config: dict[str, Any] | None) -> dict[str, Any]:
    return DEFAULT_CONFIG if not config else {**DEFAULT_CONFIG, **config}


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _parse_date(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.replace(tzinfo=None)


def _obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _buyer_kind(record: Record) -> str | None:
    kind = _obj(record.get("buyer")).get("kind")
    return kind if isinstance(kind, str) and kind else None


def _threshold(record: Record, cfg: dict[str, Any]) -> float:
    works = record.get("category") == "works"
    by_kind = (cfg.get("thresholds_by_buyer_kind") or {}).get(_buyer_kind(record))
    if by_kind:
        return by_kind["works" if works else "goods_services"]
    return cfg["threshold_works"] if works else cfg["threshold_goods_services"]


def _bids(record: Record) -> list[dict[str, Any]]:
    bids = record.get("bids")
    return [b for b in bids if isinstance(b, dict)] if isinstance(bids, list) else []


def _bidder(bid: dict[str, Any]) -> dict[str, Any]:
    bidder = bid.get("bidder")
    return bidder if isinstance(bidder, dict) else bid


def _bidders_count(record: Record) -> int:
    ids = {_bidder(b).get("edrpou") or b.get("bid_id") for b in _bids(record)}
    ids.discard(None)
    return len(ids)


def _winner_amount(record: Record) -> float | None:
    return _num(_obj(record.get("winner")).get("amount"))


def _winner_bid(record: Record) -> dict[str, Any] | None:
    w_id = _obj(record.get("winner")).get("edrpou")
    if not w_id:
        return None
    same = [b for b in _bids(record) if _bidder(b).get("edrpou") == w_id]
    active = [b for b in same if b.get("award_status") == "active"]
    return (active or same or [None])[0]


# ---------------------------------------------------------------- нормалізація

def _normalize_phone(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    digits = re.sub(r"\D", "", value)
    if len(digits) == 10 and digits.startswith("0"):
        digits = "38" + digits
    elif len(digits) == 9:
        digits = "380" + digits
    if len(digits) < 7:
        return None
    return "+" + digits if digits.startswith("380") else digits


def _bidder_phones(bidder: dict[str, Any]) -> set[str]:
    phones = bidder.get("phones")
    if not phones and bidder.get("phone"):
        phones = [bidder["phone"]]
    if isinstance(phones, str):
        phones = [phones]
    if not isinstance(phones, list):
        return set()
    return {p for p in (_normalize_phone(x) for x in phones) if p}


def _normalize_email(value: Any) -> str | None:
    if isinstance(value, str) and "@" in value:
        return value.strip().lower()
    return None


_ADDR_DROP = re.compile(
    r"\b(україна|вулиця|вул|будинок|буд|квартира|кв|місто|м)\b\.?", re.IGNORECASE
)
_ADDR_REGION = re.compile(r"[\w'’-]+\s+(область|обл|район|р-н)\b\.?", re.IGNORECASE)


def _clean_address_text(text: str) -> str:
    text = text.lower().replace("’", "'")
    text = _ADDR_REGION.sub(" ", text)
    text = re.sub(r"\b\d{5}\b", " ", text)          # поштовий індекс
    text = re.sub(r"[^\w\s]", " ", text)            # розділові знаки
    text = _ADDR_DROP.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_address(address: Any) -> str | None:
    """Ключ адреси: множина токенів вулиці + населений пункт. None без вулиці з номером."""
    if not isinstance(address, dict):
        return None
    street = address.get("street")
    if not isinstance(street, str) or not street.strip():
        return None
    tokens = _clean_address_text(street).split()
    if not any(t.isalpha() for t in tokens) or not any(c.isdigit() for t in tokens for c in t):
        return None
    locality = address.get("locality")
    if isinstance(locality, str):
        tokens += _clean_address_text(locality).split()
    return " ".join(sorted(set(tokens)))


def _transliterate(text: str) -> str:
    return "".join(_TRANSLIT.get(ch, ch) for ch in text.lower())


def _skeleton(latin: str) -> str:
    s = re.sub(r"[^a-z]", "", latin.lower())
    for old, new in _SKELETON:
        s = s.replace(old, new)
    return s


def _name_keywords(name: Any, min_len: int, generic_roots: Iterable[str]) -> set[str]:
    """Характерні слова назви (кирилицею), без організаційної форми і галузевих коренів."""
    if not isinstance(name, str):
        return set()
    words = re.findall(r"[^\W\d_]+(?:['’][^\W\d_]+)?", name.lower())
    is_fop = bool(words) and (words[0] == "фоп" or "підприємець" in words)
    words = [w for w in words if w not in NAME_STOPWORDS]
    if is_fop:
        words = words[:1]  # для ФОП тільки прізвище: імена й по батькові надто поширені
    roots = [r.lower() for r in generic_roots]
    return {w for w in words if len(w) >= min_len and not any(r in w for r in roots)}


def _shared_contact_groups(record: Record, max_group: int | None) -> set[str]:
    """rule_id спільних контактів (shared_phone/email/address) з >= 2 різними ЄДРПОУ."""
    groups: dict[tuple[str, str], set[str]] = defaultdict(set)
    for item in _bids(record):
        bidder = _bidder(item)
        edrpou = bidder.get("edrpou")
        if not edrpou:
            continue
        keys = [("shared_phone", p) for p in _bidder_phones(bidder)]
        email = _normalize_email(bidder.get("email"))
        if email:
            keys.append(("shared_email", email))
        address = _normalize_address(bidder.get("address"))
        if address:
            keys.append(("shared_address", address))
        for key in keys:
            groups[key].add(str(edrpou))
    return {
        rule for (rule, _), ids in groups.items()
        if len(ids) >= 2 and (max_group is None or len(ids) <= max_group)
    }


# ---------------------------------------------------------------- правила
# Кожне правило повертає список severity (порожній, якщо не спрацювало).

def _rule_single_bidder_high_value(record: Record, cfg: dict[str, Any]) -> list[str]:
    if record.get("procurement_method_type") not in cfg["single_bidder_method_types"]:
        return []
    if len(_bids(record)) != 1:
        return []
    amount = _winner_amount(record) or _num(record.get("expected_value"))
    if amount is None or amount < cfg["single_bidder_min_amount"]:
        return []
    return ["high" if amount >= cfg["single_bidder_high_amount"] else "medium"]


def _rule_winner_price_near_expected(record: Record, cfg: dict[str, Any]) -> list[str]:
    if _bidders_count(record) <= 1:
        return []
    winner = _winner_amount(record)
    expected = _num(record.get("expected_value"))
    if winner is None or not expected:
        return []
    ratio = winner / expected
    ok = cfg["near_expected_min_ratio"] <= ratio <= cfg["near_expected_max_ratio"]
    return ["medium"] if ok else []


def _min_tender_period(record: Record, cfg: dict[str, Any]) -> float | None:
    method = record.get("procurement_method_type")
    before = (cfg.get("min_tender_period_before") or {}).get(method)
    if before:
        dates = _obj(record.get("dates"))
        announced = _parse_date(dates.get("tender_start")) or _parse_date(dates.get("created_at"))
        until = _parse_date(before["until"])
        if announced and until and announced < until:
            return before["works_days"] if record.get("category") == "works" else before["days"]
    return cfg["min_tender_period_days"].get(method)


def _rule_short_tender_period(record: Record, cfg: dict[str, Any]) -> list[str]:
    minimum = _min_tender_period(record, cfg)
    days = _num(_obj(record.get("dates")).get("tender_period_days"))
    if minimum is None or days is None or days >= minimum:
        return []
    return ["medium"]


def _rule_email_matches_other_bidder(record: Record, cfg: dict[str, Any]) -> list[str]:
    bids = _bids(record)
    for a in bids:
        ba = _bidder(a)
        email = _normalize_email(ba.get("email"))
        if not ba.get("edrpou") or not email:
            continue
        email_sk = _skeleton(email)
        for b in bids:
            bb = _bidder(b)
            if a is b or ba.get("edrpou") == bb.get("edrpou"):
                continue
            for word in _name_keywords(bb.get("name"), cfg["email_word_min_len"],
                                       cfg["email_generic_roots"]):
                word_sk = _skeleton(_transliterate(word))
                if len(word_sk) >= cfg["email_word_min_len"] and word_sk in email_sk:
                    return ["medium"]
    return []


def _rule_winner_not_cheapest(record: Record, cfg: dict[str, Any]) -> list[str]:
    winner = _winner_amount(record)
    if winner is None or winner < cfg["winner_not_cheapest_min_amount"]:
        return []
    priced = [(b, _num(b.get("amount"))) for b in _bids(record)]
    priced = [(b, a) for b, a in priced if a is not None and a > 0]
    if len(priced) < 2:
        return []
    low = min(a for _, a in priced)
    if winner <= low:
        return []
    gap = (winner - low) / low
    if gap < cfg["winner_not_cheapest_min_gap"]:
        return []
    if gap >= cfg["winner_not_cheapest_high_gap"]:
        severity = "high"
    elif gap >= cfg["winner_not_cheapest_medium_gap"]:
        severity = "medium"
    else:
        severity = "low"
    wbid = _winner_bid(record)
    cheaper = [b for b, a in priced if b is not wbid and a < winner]
    all_rejected = all(b.get("award_status") in cfg["rejected_statuses"] for b in cheaper)
    # Відхилені дешевші пропозиції окремо ловить cheaper_rejected_near_max.
    if severity == "high" and (all_rejected or gap > cfg["winner_not_cheapest_suspicious_gap"]):
        severity = "medium"
    return [severity]


def _rule_cheaper_rejected_near_max(record: Record, cfg: dict[str, Any]) -> list[str]:
    winner = _winner_amount(record)
    expected = _num(record.get("expected_value"))
    if winner is None or not expected or winner / expected < cfg["near_expected_min_ratio"]:
        return []
    wbid = _winner_bid(record)
    cheaper = [b for b in _bids(record)
               if b is not wbid and (_num(b.get("amount")) or 0) > 0
               and _num(b.get("amount")) < winner]
    if not cheaper:
        return []
    if not all(b.get("award_status") in cfg["rejected_statuses"] for b in cheaper):
        return []
    return ["high"]


def _rule_non_competitive_high_value(record: Record, cfg: dict[str, Any]) -> list[str]:
    if record.get("procurement_method") != "limited":
        return []
    amount = _winner_amount(record) or _num(record.get("expected_value"))
    if amount is None or amount < _threshold(record, cfg):
        return []
    return ["medium"]


def _rule_many_contract_changes(record: Record, cfg: dict[str, Any]) -> list[str]:
    changes = _obj(record.get("contract")).get("changes_count")
    if isinstance(changes, bool) or not isinstance(changes, int) or changes < cfg["many_changes_min"]:
        return []
    return ["medium"]


def _norm_person(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = re.sub(r"\s+", " ", re.sub(r"[^\w\s'’-]", " ", value.lower())).strip()
    return text or None


def _rule_shared_owner(record: Record, cfg: dict[str, Any]) -> list[str]:
    bens = record.get("beneficiaries")
    if not isinstance(bens, list):
        return []
    bidder_ids = {str(_bidder(b).get("edrpou")) for b in _bids(record) if _bidder(b).get("edrpou")}
    persons: dict[str, set[str]] = defaultdict(set)
    for ben in bens:
        if not isinstance(ben, dict):
            continue
        person = _norm_person(ben.get("person"))
        company = str(ben.get("company_edrpou") or "")
        if person and company in bidder_ids:
            persons[person].add(company)
    return ["high"] if any(len(c) >= 2 for c in persons.values()) else []


def _rule_complaints_present(record: Record, cfg: dict[str, Any]) -> list[str]:
    count = record.get("complaints_count")
    if isinstance(count, bool) or not isinstance(count, int) or count <= 0:
        return []
    return ["low"]


# ---------------------------------------------------------------- дроблення

def _split_key(record: Record) -> tuple[str, str] | None:
    edrpou = _obj(record.get("buyer")).get("edrpou")
    cpv = record.get("cpv")
    if not edrpou or not isinstance(cpv, str) or len(cpv) < 4:
        return None
    return str(edrpou), cpv[:4]


def _build_split_index(dataset: list[Record]) -> dict[tuple[str, str], list[Record]]:
    index: dict[tuple[str, str], list[Record]] = defaultdict(list)
    for r in dataset:
        key = _split_key(r) if isinstance(r, dict) else None
        if key:
            index[key].append(r)
    return dict(index)


def _tender_key(record: Record) -> str:
    return str(record.get("id") or record.get("record_id") or id(record))


def _rule_split_purchase(record: Record, index: dict[tuple[str, str], list[Record]],
                         cfg: dict[str, Any]) -> list[str]:
    key = _split_key(record)
    if key is None:
        return []
    threshold = _threshold(record, cfg)
    # Лоти одного тендера це одна закупівля: сумуємо, дата = найраніша.
    tenders: dict[str, dict[str, Any]] = {}
    for r in index.get(key, []):
        amount = _num(r.get("expected_value"))
        date = _parse_date(_obj(r.get("dates")).get("created_at"))
        if amount is None or date is None:
            continue
        t = tenders.setdefault(_tender_key(r), {"amount": 0.0, "date": date})
        t["amount"] += amount
        t["date"] = min(t["date"], date)
    own = tenders.get(_tender_key(record))
    if own is None or own["amount"] >= threshold:
        return []
    items = sorted((t for t in tenders.values() if t["amount"] < threshold),
                   key=lambda t: t["date"])
    window = timedelta(days=cfg["split_window_days"])
    for start in items:
        if not start["date"] <= own["date"] <= start["date"] + window:
            continue
        group = [t for t in items if start["date"] <= t["date"] <= start["date"] + window]
        if (len(group) >= cfg["split_min_records"]
                and sum(t["amount"] for t in group) >= threshold):
            return ["high"]
    return []


# ---------------------------------------------------------------- вхід

_SIMPLE_RULES = {
    "single_bidder_high_value": _rule_single_bidder_high_value,
    "winner_price_near_expected": _rule_winner_price_near_expected,
    "short_tender_period": _rule_short_tender_period,
    "email_matches_other_bidder": _rule_email_matches_other_bidder,
    "winner_not_cheapest": _rule_winner_not_cheapest,
    "cheaper_rejected_near_max": _rule_cheaper_rejected_near_max,
    "non_competitive_high_value": _rule_non_competitive_high_value,
    "many_contract_changes": _rule_many_contract_changes,
    "shared_owner": _rule_shared_owner,
    "complaints_present": _rule_complaints_present,
}


def _flag(rule_id: str, severity: str) -> dict[str, Any]:
    return {"rule_id": rule_id, "severity": severity, "title": RULES[rule_id]["title"],
            "law_refs": law_refs_for(rule_id)}


def _evaluate_one(record: Record, index: dict[tuple[str, str], list[Record]],
                  cfg: dict[str, Any]) -> list[dict[str, Any]]:
    found: dict[str, str] = {}  # rule_id -> найвища severity (один прапорець на правило)

    def add(rule_id: str, severities: Iterable[str]) -> None:
        for sev in severities:
            if SEVERITY_ORDER[sev] > SEVERITY_ORDER.get(found.get(rule_id, ""), 0):
                found[rule_id] = sev

    # Дефектний запис не повинен валити решту: збій одного правила означає "мовчить".
    for rule_id, rule in _SIMPLE_RULES.items():
        try:
            add(rule_id, rule(record, cfg))
        except Exception:
            pass
    try:
        for rule_id in _shared_contact_groups(record, cfg["shared_max_group"]):
            add(rule_id, [RULES[rule_id]["severity_default"]])
    except Exception:
        pass
    try:
        add("split_purchase", _rule_split_purchase(record, index, cfg))
    except Exception:
        pass

    flags = [_flag(rule_id, sev) for rule_id, sev in found.items()]
    flags.sort(key=lambda f: -SEVERITY_ORDER[f["severity"]])
    return flags


def evaluate_records(records: list[dict], dataset: list[dict] | None = None,
                     config: dict | None = None) -> list[dict]:
    """По одному елементу на кожен запис, у тому ж порядку.

    {"record_id", "risk_level", "flags": [{"rule_id", "severity", "title", "law_refs"}]}.
    dataset потрібен для split_purchase; якщо не задано, береться весь масив records.
    Запис без record_id (або не dict) дає record_id "" і risk_level "none".
    """
    cfg = _cfg(config)
    index = _build_split_index(dataset if dataset is not None else records)
    out = []
    for record in records:
        rid = record.get("record_id") if isinstance(record, dict) else None
        if not isinstance(rid, str) or not rid:
            out.append({"record_id": "", "risk_level": "none", "flags": []})
            continue
        flags = _evaluate_one(record, index, cfg)
        out.append({"record_id": rid, "risk_level": risk_level(flags), "flags": flags})
    return out


def risk_level(flags: Iterable[Any]) -> str:
    """high: є high або >= 3 medium; medium: є medium або >= 2 low; low: є low."""
    counts = {"low": 0, "medium": 0, "high": 0}
    for f in flags:
        sev = f.get("severity") if isinstance(f, dict) else getattr(f, "severity", None)
        if sev in counts:
            counts[sev] += 1
    if counts["high"] or counts["medium"] >= 3:
        return "high"
    if counts["medium"] or counts["low"] >= 2:
        return "medium"
    if counts["low"]:
        return "low"
    return "none"


__all__ = ["DEFAULT_CONFIG", "RULES", "evaluate_records", "risk_level", "law_refs_for"]
