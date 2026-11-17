"""Адаптери джерел фактів → POST /api/v1/indicators.

Приклади:
    python -m adapters artemida --file export.json            # справжній експорт ARTEMIDA
    python -m adapters artemida --mock --months 12            # синтетичний експорт ARTEMIDA
    python -m adapters all --mock --months 12                 # усі джерела (ARTEMIDA + 4 моки)
    python -m adapters all --mock --months 3 --dry-run        # лише показати факти, нічого не передавати
    python -m adapters all --mock --save-dir exports/         # зберегти згенеровані «рідні» експорти

Ключ кожного джерела: --key, ADAPTER_KEY_<ДЖЕРЕЛО> або пара з INTEGRATION_KEYS ("artemida=…;atestat=…").
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from adapters.base import Pusher, load_unit_codes, resolve_key
from adapters.sources import ORG_QUALITY, SOURCES


def months_back(end: date, count: int) -> list[str]:
    result, year, month = [], end.year, end.month
    for _ in range(count):
        result.append(f"{year:04d}-{month:02d}")
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    return sorted(result)


def run(argv: list[str] | None = None, client=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m adapters", description="Передача фактів «X з Y» з інших систем")
    parser.add_argument("source", choices=[*SOURCES, "all"])
    parser.add_argument("--file", type=Path, help="Експорт джерела (лише для artemida)")
    parser.add_argument("--mock", action="store_true", help="Згенерувати синтетичні записи джерела")
    parser.add_argument("--months", type=int, default=12, help="Скільки місяців до поточного (включно)")
    parser.add_argument("--as-of", type=date.fromisoformat, default=None, help="Дата вивантаження, за замовчуванням сьогодні")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--key", help="Ключ інтеграції (лише коли передається одне джерело)")
    parser.add_argument("--dry-run", action="store_true", help="Показати факти, нічого не передавати")
    parser.add_argument("--save-dir", type=Path, help="Зберегти «рідні» записи моків як JSON-експорти")
    args = parser.parse_args(argv)

    if args.file and args.mock:
        parser.error("--file і --mock разом не можна")
    names = list(SOURCES) if args.source == "all" else [args.source]
    if args.file and names != ["artemida"]:
        parser.error("--file підтримується лише для artemida")
    if not args.file and not args.mock:
        parser.error("потрібно --file (експорт) або --mock")
    if args.key and len(names) > 1:
        parser.error("--key лише для одного джерела; для all — ADAPTER_KEY_<ДЖЕРЕЛО> або INTEGRATION_KEYS")

    as_of = args.as_of or date.today()
    periods = months_back(as_of, args.months)
    unit_codes = load_unit_codes()
    orgs = [code for code in unit_codes if code in ORG_QUALITY]
    own_client = None
    if client is None and not args.dry_run:
        import httpx

        client = own_client = httpx.Client(timeout=30)

    total_sent, problems = 0, []
    try:
        for name in names:
            source = SOURCES[name]
            data = source.read_file(args.file) if args.file else source.mock_records(orgs, periods, as_of)
            if args.save_dir:
                args.save_dir.mkdir(parents=True, exist_ok=True)
                (args.save_dir / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
            facts = source.facts(data, set(periods), as_of)
            if args.dry_run:
                for f in facts:
                    print(f"{f.source:18} {f.org_code:7} {f.period} {f.indicator:27} {f.numerator} з {f.denominator} {f.extra_counts or ''}")
                print(f"{source.title}: {len(facts)} фактів (не передано, --dry-run)")
                continue
            pusher = Pusher(client, args.url, resolve_key(name, args.key), unit_codes)
            sent, warnings = pusher.push(facts)
            total_sent += sent
            problems += warnings
            print(f"{source.title}: передано {sent} з {len(facts)}")
    finally:
        if own_client is not None:
            own_client.close()
    for line in problems:
        print(f"  ! {line}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(run())
