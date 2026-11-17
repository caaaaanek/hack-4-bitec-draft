"""Поточна дата в часовому поясі системи (за замовчуванням Europe/Kyiv), а не сервера."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from app.config import get_settings

# Зафіксована дата для демо-seed (хвилі «в минулому»). У роботі сервера завжди None.
_frozen: date | None = None


def now() -> datetime:
    tz = ZoneInfo(get_settings().timezone)
    if _frozen is not None:
        return datetime.combine(_frozen, time(12), tz)
    return datetime.now(tz)


def today() -> date:
    return now().date()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@contextmanager
def frozen_on(day: date) -> Iterator[None]:
    """Тимчасово фіксує today() на заданій даті. Лише для seed і тестів, не потокобезпечно."""
    global _frozen
    previous, _frozen = _frozen, day
    try:
        yield
    finally:
        _frozen = previous
