import logging
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


engine = create_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


# Ключ у Session.info: перегляди чужих підрозділів, які треба записати в result_views (security.record_view).
PENDING_VIEWS = "pending_result_views"


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    views: list[dict] = []
    try:
        yield db
        views = db.info.pop(PENDING_VIEWS, [])
    finally:
        db.close()
    if views:
        store_views(views)


def store_views(views: list[dict]) -> None:
    """Окрема транзакція: перегляд лишає слід, навіть якщо ендпойнт нічого не комітить.

    Пишеться лише після успішного запиту (помилка в ендпойнті — перегляду не було).
    """
    from app.models import ResultView  # уникаємо циклічного імпорту

    try:
        with SessionLocal() as s:
            s.add_all(ResultView(**v) for v in views)
            s.commit()
    except Exception:  # noqa: BLE001 — збій журналу переглядів не має ламати відповідь, але має бути видно
        logging.getLogger(__name__).exception("Не вдалося записати перегляди результатів (result_views)")
