"""Поточна дата в часовому поясі системи (за замовчуванням Europe/Kyiv), а не сервера."""

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.config import get_settings


def now() -> datetime:
    return datetime.now(ZoneInfo(get_settings().timezone))


def today() -> date:
    return now().date()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
