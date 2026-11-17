"""Моки 5 джерел фактів → POST /api/v1/indicators, кожне джерело зі своїм ключем.

Джерела: artemida (конфлікти інтересів), atestat (декларації, перевірки при призначенні),
training (навчання), procurement (закупівлі), reports (повідомлення). Логіка — пакет adapters/.

Запуск з backend/ (сервер має працювати, ключі — в INTEGRATION_KEYS або ADAPTER_KEY_<ДЖЕРЕЛО>):
    python scripts/mock_sources.py                     # усі джерела, 12 місяців
    python scripts/mock_sources.py --months 3 --dry-run
    python scripts/mock_sources.py --source atestat --url http://localhost:8000
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters.__main__ import run  # noqa: E402
from adapters.sources import SOURCES  # noqa: E402


def main(argv: list[str] | None = None, client=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", choices=[*SOURCES, "all"], default="all")
    parser.add_argument("--months", type=int, default=12)
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--as-of", default=None, help="Дата вивантаження YYYY-MM-DD, за замовчуванням сьогодні")
    parser.add_argument("--dry-run", action="store_true", help="Показати факти, нічого не передавати")
    args = parser.parse_args(argv)
    forwarded = [args.source, "--mock", "--months", str(args.months), "--url", args.url]
    if args.as_of:
        forwarded += ["--as-of", args.as_of]
    if args.dry_run:
        forwarded.append("--dry-run")
    return run(forwarded, client=client)


if __name__ == "__main__":
    sys.exit(main())
