"""Спільна частина адаптерів: агрегація записів джерела у факти «X з Y» і передача в POST /indicators.

Адаптер працює на боці джерела (або поруч із ним) і передає лише агрегати за місяць на підрозділ.
Записи джерела (справи, декларації, звернення) з адаптера не виходять: ні ідентифікаторів, ні дат, ні імен.
"""

import json
import os
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

UNITS_FILE = Path(__file__).parent / "units.json"


@dataclass(frozen=True)
class Fact:
    org_code: str
    period: str  # YYYY-MM
    indicator: str
    numerator: int
    denominator: int
    source: str
    why: str = ""
    extra_counts: dict[str, int] = field(default_factory=dict)


def month_of(value: str | date) -> str:
    return (value if isinstance(value, date) else date.fromisoformat(value)).strftime("%Y-%m")


def days_between(start: str, end: str | None) -> int | None:
    if end is None:
        return None
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def tally(
    records: Iterable[dict],
    *,
    source: str,
    indicator: str,
    when: str,
    ok: Callable[[dict], bool],
    why: str,
    extra: dict[str, Callable[[dict], bool]] | None = None,
    periods: set[str] | None = None,
) -> list[Fact]:
    """Групує записи за (підрозділ, місяць поля `when`): знаменник — усі, чисельник — ті, де ok()."""
    groups: dict[tuple[str, str], list[dict]] = {}
    for record in records:
        period = month_of(record[when])
        if periods is None or period in periods:
            groups.setdefault((record["org_code"], period), []).append(record)
    facts = []
    for (org, period), items in sorted(groups.items()):
        counts = {name: sum(1 for r in items if test(r)) for name, test in (extra or {}).items()}
        facts.append(Fact(org, period, indicator, sum(1 for r in items if ok(r)), len(items), source, why,
                          {k: v for k, v in counts.items() if v}))
    return facts


def load_unit_codes(path: Path = UNITS_FILE) -> dict[str, str]:
    """Код підрозділу в джерелі -> назва підрозділу в системі."""
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_key(source: str, explicit: str | None = None) -> str:
    """Ключ джерела: --key, ADAPTER_KEY_<SOURCE>, пара з INTEGRATION_KEYS або спільний INTEGRATION_API_KEY."""
    if explicit:
        return explicit
    own = os.environ.get(f"ADAPTER_KEY_{source.upper().replace('-', '_')}")
    if own:
        return own
    for pair in os.environ.get("INTEGRATION_KEYS", "").split(";"):
        name, _, key = pair.partition("=")
        if name.strip() == source and key.strip():
            return key.strip()
    shared = os.environ.get("INTEGRATION_API_KEY", "")
    if shared:
        return shared
    raise SystemExit(f"Немає ключа для джерела «{source}»: задайте --key, ADAPTER_KEY_{source.upper()} або INTEGRATION_KEYS")


class Pusher:
    """Передає факти в API одного джерела. client — httpx.Client (або TestClient у тестах)."""

    def __init__(self, client, base_url: str, key: str, unit_codes: dict[str, str] | None = None):
        self.client = client
        self.api = base_url.rstrip("/") + "/api/v1"
        self.headers = {"X-Integration-Key": key}
        self.unit_codes = unit_codes if unit_codes is not None else load_unit_codes()
        self._unit_ids: dict[str, str] | None = None

    def unit_ids(self) -> dict[str, str]:
        if self._unit_ids is None:
            r = self.client.get(f"{self.api}/indicators/units", headers=self.headers)
            r.raise_for_status()
            by_name = {u["name"]: u["id"] for u in r.json()}
            self._unit_ids = {code: by_name[name] for code, name in self.unit_codes.items() if name in by_name}
        return self._unit_ids

    def push(self, facts: Iterable[Fact]) -> tuple[int, list[str]]:
        """Повертає (передано, попередження). Невідомий код підрозділу пропускається з попередженням."""
        sent, warnings = 0, []
        ids = self.unit_ids()
        for fact in facts:
            unit_id = ids.get(fact.org_code)
            if unit_id is None:
                warnings.append(f"{fact.source}: невідомий підрозділ «{fact.org_code}», пропущено")
                continue
            body = {"unit_id": unit_id, "period": fact.period, "indicator": fact.indicator,
                    "numerator": fact.numerator, "denominator": fact.denominator, "source": fact.source,
                    "why": fact.why, "extra_counts": fact.extra_counts}
            r = self.client.post(f"{self.api}/indicators", json=body, headers=self.headers)
            if r.status_code >= 300:
                warnings.append(f"{fact.source} {fact.org_code} {fact.period} {fact.indicator}: {r.status_code} {r.text}")
                continue
            sent += 1
        return sent, warnings
