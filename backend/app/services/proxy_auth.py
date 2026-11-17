"""Вхід через довірений зворотний проксі (модуль для наявної ІС організації).

Схема: людина входить у систему організації (Keycloak, ADFS, oauth2-proxy, Authelia тощо),
проксі перевіряє її й передає логін у заголовку (за замовчуванням X-Remote-User).
Ми видаємо свій JWT для наявного облікового запису з таким логіном.

Захист від підробки заголовка:
1. Приймаємо його лише від адрес із TRUSTED_PROXIES (безпосередній співрозмовник TCP, не X-Forwarded-For).
2. Необов'язково: спільний секрет у X-Proxy-Secret (PROXY_AUTH_SECRET), порівнюється за сталий час.
3. Проксі зобов'язаний перезаписувати цей заголовок для всіх запитів (у nginx фронтенду він очищається).
4. Користувачів автоматично не створюємо: роль і підрозділ призначає адміністратор.
"""

import hmac
import re

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ApiError
from app.models import User
from app.security import is_trusted_proxy

LOGIN_RE = re.compile(r"^[A-Za-z0-9_.@-]{1,128}$")


def proxy_login(request: Request, db: Session) -> User:
    settings = get_settings()
    if not settings.proxy_auth_enabled:
        raise ApiError(404, "Вхід через проксі не налаштовано", code="proxy_auth_disabled",
                       hint="Увійдіть логіном і паролем.")
    peer = request.client.host if request.client else None
    if not is_trusted_proxy(peer):
        raise ApiError(403, "Запит прийшов не через довірений проксі", code="untrusted_proxy",
                       hint="Відкрийте систему через адресу організації.")
    if settings.proxy_auth_secret:
        given = request.headers.get("x-proxy-secret", "")
        if not hmac.compare_digest(given.encode(), settings.proxy_auth_secret.encode()):
            raise ApiError(403, "Проксі не підтвердив себе", code="untrusted_proxy")

    raw = (request.headers.get(settings.proxy_auth_header) or "").strip()
    if not raw:
        raise ApiError(401, "Проксі не передав користувача", code="no_proxy_user",
                       hint="Увійдіть у систему організації ще раз.")
    if not LOGIN_RE.match(raw):
        raise ApiError(401, "Некоректний логін від проксі", code="bad_proxy_user")
    # user@domain -> user, якщо в нас облікові записи без домену.
    candidates = [raw] + ([raw.split("@", 1)[0]] if "@" in raw else [])
    for login in candidates:
        user = db.scalar(select(User).where(User.login == login))
        if user is not None:
            if not user.is_active:
                break
            return user
    raise ApiError(403, "Обліковий запис не знайдено або заблоковано", code="unknown_user",
                   hint="Зверніться до адміністратора, щоб вам призначили роль.")
