"""Перевірка декларацій НАЗК: строк подання та 6 правил конфлікту інтересів.

Чисті детерміновані функції: без мережі, графа, LLM. Структура `data` це JSON
декларації НАЗК (step_1..step_16). Помилки структури не кидають винятків: правило мовчить.
У результаті немає ПІБ, РНОКПП, адрес, назв компаній і сум: лише коди правил, дати й хеш ідентифікатора.
"""
import hashlib
from datetime import date, timedelta
from typing import Any, Callable

DEFAULT_CONFIG: dict[str, Any] = {
    "large_family_income_threshold": 1_000_000,  # грн, дохід одного родича від однієї компанії
    "dismissal_deadline_days": 30,
    "annual_deadline_md": (3, 31),
    "ngo_markers": ("благодійн", "фонд", "громадськ", "громадян"),
}

_LAW = "Закон України «Про запобігання корупції»"
_LAW_REFS = {
    "declaration_late": [f"{_LAW}, розділ про фінансовий контроль (декларування)"],
    "self_interest": [f"{_LAW}, розділ про запобігання та врегулювання конфлікту інтересів"],
    "business_ownership": [f"{_LAW}, розділ про обмеження щодо сумісництва та суміщення з іншими видами діяльності"],
    "ngo_risk": [f"{_LAW}, розділ про обмеження щодо сумісництва та суміщення з іншими видами діяльності"],
    "family_conflict": [f"{_LAW}, розділ про запобігання та врегулювання конфлікту інтересів",
                        f"{_LAW}, розділ про обмеження щодо спільної роботи близьких осіб"],
    "suspicious_gifts": [f"{_LAW}, розділ про обмеження щодо отримання подарунків"],
    "large_family_income": [f"{_LAW}, розділ про фінансовий контроль (декларування)"],
}

RULES: dict[str, dict] = {
    "declaration_late": {"title": "Щорічну декларацію подано після строку", "severity_default": "medium",
                         "description": "Щорічна декларація за рік N подана після 31 березня року N+1."},
    "self_interest": {"title": "Робота або дохід у власній компанії", "severity_default": "high",
                      "description": "Декларант володіє компанією (або є бенефіціаром) і водночас працює в ній чи отримує від неї дохід."},
    "business_ownership": {"title": "Володіння комерційною компанією", "severity_default": "medium",
                           "description": "Декларант має корпоративні права в компанії, що не є благодійною чи громадською організацією."},
    "ngo_risk": {"title": "Зв'язок з благодійною або громадською організацією", "severity_default": "low",
                 "description": "Декларант засновник чи член НУО; high, якщо ця організація є його місцем роботи."},
    "family_conflict": {"title": "Родич отримує дохід від компанії декларанта", "severity_default": "high",
                        "description": "Член сім'ї отримує дохід від компанії, де декларант працює або якою володіє."},
    "suspicious_gifts": {"title": "Подарунок від стороннього", "severity_default": "medium",
                         "description": "Декларант отримав подарунок від особи, що не є членом сім'ї."},
    "large_family_income": {"title": "Великий дохід родича від сторонньої компанії", "severity_default": "medium",
                            "description": "Родич отримав від компанії дохід вище порогу, а декларант там не працює."},
}


def law_refs_for(rule_id: str) -> list[str]:
    return list(_LAW_REFS.get(rule_id, []))


def _flag(rule_id: str, severity: str | None = None) -> dict:
    r = RULES[rule_id]
    return {"rule_id": rule_id, "severity": severity or r["severity_default"],
            "title": r["title"], "law_refs": law_refs_for(rule_id)}


# ---------- допоміжне читання data (толерантне до зіпсованої структури) ----------

def _d(x: Any) -> dict:
    return x if isinstance(x, dict) else {}


def _step_list(data: Any, step: str) -> list[dict]:
    items = _d(_d(data).get(step)).get("data")
    return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []


def _s(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def _ids(code: Any, name: Any) -> set[str]:
    """Ідентифікатори компанії: код і/або нормалізована назва (лише для порівняння всередині розрахунку)."""
    out = {f"c:{_s(code)}"} if _s(code) else set()
    if _s(name):
        out.add(f"n:{_s(name).lower()}")
    return out


def _amount(v: Any) -> float:
    try:
        return float(_s(v).replace(" ", "").replace(",", "."))
    except ValueError:
        return 0.0


def _person_key(item: dict, prefix: str = "") -> str:
    return " ".join(_s(item.get(f"{prefix}{k}")).lower() for k in ("lastname", "firstname", "middlename")).strip()


def _is_ngo(name: Any, markers: tuple) -> bool:
    n = _s(name).lower()
    return any(m in n for m in markers)


def _workplace(data: Any) -> set[str]:
    s1 = _d(_d(_d(data).get("step_1")).get("data"))
    return _ids(s1.get("workPlaceEdrpou"), s1.get("workPlace"))


def _owned(data: Any) -> list[tuple[set[str], str, float | None]]:
    """Компанії декларанта: (ідентифікатори, назва, відсоток). Крок 8 (корп. права) та 9 (бенефіціар)."""
    out = []
    for cr in _step_list(data, "step_8"):
        rights = [r for r in cr.get("rights", []) if isinstance(r, dict)] if isinstance(cr.get("rights"), list) else []
        if any(_s(r.get("rightBelongs")) == "1" for r in rights):
            out.append((_ids(cr.get("corporate_rights_company_code"), cr.get("name")), _s(cr.get("name")),
                        _amount(cr.get("cost_percent"))))
    for b in _step_list(data, "step_9"):
        who = b.get("person_who_care") if isinstance(b.get("person_who_care"), list) else []
        if any(isinstance(p, dict) and _s(p.get("rightBelongs", "1")) == "1" for p in who):
            name = b.get("ua_company_name_beneficial_owner") or b.get("en_company_name_beneficial_owner")
            out.append((_ids(b.get("company_code_beneficial_owner"), name), _s(name), None))
    return [o for o in out if o[0]]


def _incomes(data: Any) -> list[dict]:
    """Доходи: {receiver, ids, source_name, is_human, amount, type}."""
    out = []
    for inc in _step_list(data, "step_11"):
        who = inc.get("person_who_care")
        receiver = _s(_d(who[0]).get("person", "1")) if isinstance(who, list) and who else "1"
        srcs = inc.get("sources")
        srcs = [srcs] if isinstance(srcs, dict) else srcs if isinstance(srcs, list) else []
        for s in srcs:
            if not isinstance(s, dict):
                continue
            name = s.get("source_ua_company_name") or s.get("source_eng_fullname") or \
                f"{_s(s.get('source_ua_lastname'))} {_s(s.get('source_ua_firstname'))}".strip()
            out.append({"receiver": receiver, "ids": _ids(s.get("source_ua_company_code"), name),
                        "person": _person_key(s, "source_ua_") or _s(name).lower(),
                        "is_human": s.get("source_citizen") == "Громадянин України" and not _s(name).isupper(),
                        "amount": _amount(inc.get("sizeIncome")), "type": _s(inc.get("objectType")).lower()})
    return out


def _family(data: Any) -> tuple[set[str], set[str]]:
    """(id членів сім'ї, їхні нормалізовані ПІБ для зіставлення з джерелами подарунків)."""
    items = _step_list(data, "step_2")
    return {_s(m.get("id")) for m in items if _s(m.get("id"))}, {_person_key(m) for m in items} - {""}


# ---------- правила КІ ----------

def _rule_self_interest(data: Any, config: dict | None = None) -> list[dict]:
    work = _workplace(data)
    incs = [i for i in _incomes(data) if i["receiver"] == "1"]
    for ids, _name, _pct in _owned(data):
        if ids & work or any(ids & i["ids"] for i in incs):
            return [_flag("self_interest")]
    return []


def _rule_business_ownership(data: Any, config: dict | None = None) -> list[dict]:
    markers = (config or DEFAULT_CONFIG)["ngo_markers"]
    n = sum(1 for _ids_, name, _p in _owned(data) if not _is_ngo(name, markers))
    return [_flag("business_ownership")] if n else []


def _rule_ngo_risk(data: Any, config: dict | None = None) -> list[dict]:
    markers = (config or DEFAULT_CONFIG)["ngo_markers"]
    work = _workplace(data)
    ngos = [ids for ids, name, _p in _owned(data) if _is_ngo(name, markers)]
    s16 = _d(_d(_d(data).get("step_16")).get("data")).get("part_org")
    for o in s16 if isinstance(s16, list) else []:
        if isinstance(o, dict):
            ngos.append(_ids(o.get("reestrCode"), o.get("objectName")))
    if not ngos:
        return []
    return [_flag("ngo_risk", "high" if any(i & work for i in ngos) else "low")]


def _rule_family_conflict(data: Any, config: dict | None = None) -> list[dict]:
    fam_ids, _ = _family(data)
    mine = _workplace(data).copy()
    for ids, _n, _p in _owned(data):
        mine |= ids
    if mine and any(i["receiver"] in fam_ids and i["ids"] & mine for i in _incomes(data)):
        return [_flag("family_conflict")]
    return []


def _rule_suspicious_gifts(data: Any, config: dict | None = None) -> list[dict]:
    _, fam_names = _family(data)
    for i in _incomes(data):
        if i["receiver"] == "1" and "подарун" in i["type"] and i["person"] not in fam_names:
            return [_flag("suspicious_gifts")]
    return []


def _rule_large_family_income(data: Any, config: dict | None = None) -> list[dict]:
    limit = (config or DEFAULT_CONFIG)["large_family_income_threshold"]
    fam_ids, _ = _family(data)
    work = _workplace(data)
    for i in _incomes(data):
        if i["receiver"] in fam_ids and not i["is_human"] and i["amount"] > limit and not (i["ids"] & work):
            return [_flag("large_family_income")]
    return []


_COI_RULES: list[Callable[..., list[dict]]] = [
    _rule_self_interest, _rule_business_ownership, _rule_ngo_risk,
    _rule_family_conflict, _rule_suspicious_gifts, _rule_large_family_income,
]


# ---------- строк подання ----------

def _parse_date(v: Any) -> date | None:
    try:
        return date.fromisoformat(_s(v)[:10])
    except ValueError:
        return None


def _deadline(item: dict, year: int, cfg: dict) -> str | None:
    t = item.get("declaration_type")
    if t == 1:
        if item.get("declaration_year") != year:
            return None
        m, d = cfg["annual_deadline_md"]
        return date(year + 1, m, d).isoformat()
    if t in (2, 3):
        dismissed = _parse_date(_d(_d(_d(item.get("data")).get("step_1")).get("data")).get("dismissalDate"))
        if dismissed:
            return (dismissed + timedelta(days=cfg["dismissal_deadline_days"])).isoformat()
    return None


_RISK_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3}


def evaluate_declarations(items: list[dict], *, year: int, config: dict | None = None) -> list[dict]:
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    results = []
    for item in items:
        did = _s(item.get("declaration_id"))
        submitted = _parse_date(item.get("date"))
        deadline = _deadline(item, year, cfg)
        on_time = (submitted <= date.fromisoformat(deadline)) if submitted and deadline else None
        if on_time is None:
            deadline = deadline if submitted else None
        flags = []
        if on_time is False and item.get("declaration_type") == 1:
            flags.append(_flag("declaration_late"))
        data = item.get("data")
        if isinstance(data, dict):
            for rule in _COI_RULES:
                try:
                    flags.extend(rule(data, cfg))
                except Exception:  # зіпсована структура: правило мовчить
                    continue
        results.append({
            "declaration_id": did,
            "record_ref": "d-" + hashlib.sha256(did.encode()).hexdigest()[:12],
            "on_time": on_time,
            "submitted_on": submitted.isoformat() if submitted else None,
            "deadline": deadline,
            "flags": flags,
            "risk_level": max((f["severity"] for f in flags), key=_RISK_ORDER.get, default="none"),
        })
    return results
