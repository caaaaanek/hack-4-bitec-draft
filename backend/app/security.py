import ipaddress
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.config import check_settings, get_settings
from app.db import get_db
from app.models import Role, User

# Відносна адреса: працює і під ROOT_PATH (кнопка Authorize у /docs).
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login")


def _networks(items: list[str]) -> list:
    nets = []
    for item in items:
        try:
            nets.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            continue
    return nets


def is_trusted_proxy(host: str | None) -> bool:
    if not host:
        return False
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr in net for net in _networks(get_settings().trusted_proxy_list))


def client_ip(request: Request) -> str:
    """Адреса клієнта. X-Forwarded-For враховується лише від довіреного проксі."""
    peer = request.client.host if request.client else ""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and is_trusted_proxy(peer):
        # Беремо найправішу адресу, яку додав не довірений проксі.
        for hop in reversed([h.strip() for h in forwarded.split(",") if h.strip()]):
            if not is_trusted_proxy(hop):
                return hop
    return peer


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=get_settings().bcrypt_rounds)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


@lru_cache
def _dummy_hash() -> bytes:
    return bcrypt.hashpw(b"dummy-password", bcrypt.gensalt(rounds=get_settings().bcrypt_rounds))


def verify_password_dummy(password: str) -> None:
    """Перевірка проти фіктивного хешу, щоб час відповіді не видавав неіснуючий логін."""
    bcrypt.checkpw(password.encode(), _dummy_hash())


class LoginThrottle:
    """Невдалі спроби входу в пам'яті процесу. Для кількох процесів варто винести в Redis чи БД."""

    def __init__(self) -> None:
        self._failures: dict[tuple, list[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: tuple, now: float) -> list[float]:
        window = get_settings().login_window_seconds
        items = [t for t in self._failures.get(key, []) if now - t < window]
        self._failures[key] = items
        return items

    def blocked_for(self, key: tuple) -> int:
        """Скільки секунд ще чекати (0, якщо вхід дозволено)."""
        settings = get_settings()
        now = time.monotonic()
        with self._lock:
            items = self._recent(key, now)
            if len(items) < settings.login_max_failures:
                return 0
            return max(1, int(settings.login_window_seconds - (now - items[0])))

    def fail(self, key: tuple) -> None:
        with self._lock:
            self._recent(key, time.monotonic()).append(time.monotonic())

    def reset(self, key: tuple | None = None) -> None:
        with self._lock:
            if key is None:
                self._failures.clear()
            else:
                self._failures.pop(key, None)


login_throttle = LoginThrottle()


def create_access_token(user: User) -> str:
    settings = get_settings()
    check_settings(settings)
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user.id), "role": user.role.value, "exp": expire, "iat": datetime.now(timezone.utc)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    settings = get_settings()
    check_settings(settings)
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Потрібна авторизація",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    return user


def require_roles(*roles: Role):
    """Залежність FastAPI: пускає лише користувачів із переліченими ролями."""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостатньо прав")
        return user

    return checker


def ensure_unit_access(db: Session, user: User, unit_id: uuid.UUID) -> None:
    """Керівник, прив'язаний до підрозділу, бачить лише свій підрозділ і дочірні.

    Інші ролі з правом читання результатів (admin, commissioner, auditor) і керівник
    без підрозділу бачать усе дерево.
    """
    if user.role != Role.LEADER or user.unit_id is None:
        return
    from app.services.units import subtree_ids  # уникаємо циклічного імпорту

    if unit_id not in subtree_ids(db, user.unit_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Підрозділ поза вашою зоною відповідальності")


# Хто читає результати, динаміку, факти, рекомендації, заходи.
RESULT_READERS = (Role.ADMIN, Role.COMMISSIONER, Role.LEADER, Role.AUDITOR)
