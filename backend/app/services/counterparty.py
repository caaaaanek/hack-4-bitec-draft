"""Перевірка контрагентів (пункт 4.5.1 чек-листа): адаптер до комерційного API на кшталт Youcontrol.

Два режими:
- live (EXTERNAL_FETCH_ENABLED=true і COUNTERPARTY_API_URL + COUNTERPARTY_API_KEY): GET {url}/{ЄДРПОУ};
  формат відповіді припущено (поля sanctions, bankruptcy, tax_debt, court_cases, registered_on), його
  треба звірити з договором на API;
- mock (за замовчуванням, закритий контур): детерміновані синтетичні прапорці за кодом.

Зберігаються лише код ЄДРПОУ (публічний ідентифікатор юрособи), рівень ризику й назви прапорців.
"""

import hashlib
from datetime import date

import httpx

from app.clock import today
from app.config import get_settings

FLAG_TITLES = {
    "sanctions": "контрагент під санкціями",
    "bankruptcy": "процедура банкрутства",
    "tax_debt": "податковий борг",
    "court_cases": "судові справи як відповідач",
    "young_company": "зареєстровано менше року тому",
}
HIGH = {"sanctions", "bankruptcy"}


class CounterpartyError(Exception):
    pass


def level(flags: list[str]) -> str:
    if HIGH & set(flags):
        return "high"
    return "medium" if len(flags) >= 2 else ("low" if flags else "none")


def mock_flags(code: str) -> list[str]:
    h = int(hashlib.sha256(code.encode()).hexdigest(), 16)
    flags = []
    if h % 23 == 0:
        flags.append("sanctions")
    if h % 17 == 0:
        flags.append("bankruptcy")
    if h % 5 == 0:
        flags.append("tax_debt")
    if h % 7 == 0:
        flags.append("court_cases")
    if h % 11 == 0:
        flags.append("young_company")
    return flags


def live_flags(code: str) -> list[str]:
    s = get_settings()
    try:
        r = httpx.get(f"{s.counterparty_api_url.rstrip('/')}/{code}", params={"apiKey": s.counterparty_api_key},
                      timeout=10.0)
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise CounterpartyError(f"Сервіс перевірки контрагентів не відповів ({type(e).__name__})") from e
    if not isinstance(data, dict):
        raise CounterpartyError("Сервіс перевірки контрагентів віддав неочікувану відповідь")
    flags = [f for f in ("sanctions", "bankruptcy", "tax_debt", "court_cases") if data.get(f)]
    registered = data.get("registered_on")
    if registered:
        try:
            if (today() - date.fromisoformat(str(registered)[:10])).days < 365:
                flags.append("young_company")
        except ValueError:
            pass
    return flags


def live_available() -> bool:
    s = get_settings()
    return s.external_fetch_enabled and bool(s.counterparty_api_url and s.counterparty_api_key)


def check(codes: list[str]) -> tuple[str, list[dict]]:
    source = "youcontrol" if live_available() else "mock"
    out = []
    for code in dict.fromkeys(codes):
        flags = live_flags(code) if source == "youcontrol" else mock_flags(code)
        out.append({"edrpou": code, "risk_level": level(flags), "flags": flags,
                    "titles": [FLAG_TITLES[f] for f in flags]})
    return source, out
