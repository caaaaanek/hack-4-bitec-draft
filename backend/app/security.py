import hashlib
import ipaddress
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import check_settings, get_settings
from app.db import get_db
from app.models import LoginFailure, RevokedToken, Role, User

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


def _in_networks(host: str | None, items: list[str]) -> bool:
    if not host:
        return False
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr in net for net in _networks(items))


def is_trusted_proxy(host: str | None) -> bool:
    """Проксі SSO (TRUSTED_PROXIES): йому дозволено передавати логін у заголовку."""
    return _in_networks(host, get_settings().trusted_proxy_list)


def is_forwarding_proxy(host: str | None) -> bool:
    """Проксі, чиєму X-Forwarded-For віримо щодо адреси клієнта: FORWARDED_PROXIES і проксі SSO."""
    settings = get_settings()
    return _in_networks(host, settings.forwarded_proxy_list + settings.trusted_proxy_list)


def client_ip(request: Request) -> str:
    """Адреса клієнта. X-Forwarded-For враховується лише від проксі з FORWARDED_PROXIES / TRUSTED_PROXIES.

    Без цього за nginx усі запити мали б одну адресу (контейнера nginx), і ліміт спроб одного
    користувача блокував би всіх.
    """
    peer = request.client.host if request.client else ""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and is_forwarding_proxy(peer):
        # Беремо найправішу адресу, яку додав не довірений проксі.
        for hop in reversed([h.strip() for h in forwarded.split(",") if h.strip()]):
            if not is_forwarding_proxy(hop):
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
    """Невдалі спроби входу (чи анонімних посилань) у БД: ліміт спільний для всіх процесів і переживає перезапуск.

    Ключ зберігається лише як sha256 від (scope, частини ключа), тож логінів і IP у таблиці немає.
    Старі записи (старші за вікно) прибираються при кожній новій невдалій спробі.
    """

    def __init__(self, scope: str = "login") -> None:
        self.scope = scope

    def _hash(self, key: tuple) -> str:
        return hashlib.sha256("\x1f".join([self.scope, *map(str, key)]).encode()).hexdigest()

    @staticmethod
    def _session() -> Session:
        from app.db import SessionLocal  # пізній імпорт: тести підміняють DATABASE_URL до імпорту db

        return SessionLocal()

    def blocked_for(self, key: tuple) -> int:
        """Скільки секунд ще чекати (0, якщо вхід дозволено)."""
        settings = get_settings()
        now = time.time()
        with self._session() as db:
            times = db.scalars(
                select(LoginFailure.at)
                .where(LoginFailure.key == self._hash(key), LoginFailure.at > now - settings.login_window_seconds)
                .order_by(LoginFailure.at)
            ).all()
        if len(times) < settings.login_max_failures:
            return 0
        return max(1, int(settings.login_window_seconds - (now - times[0])))

    def fail(self, key: tuple) -> None:
        now = time.time()
        with self._session() as db:
            db.add(LoginFailure(scope=self.scope, key=self._hash(key), at=now))
            db.execute(delete(LoginFailure).where(LoginFailure.at < now - get_settings().login_window_seconds))
            db.commit()

    def reset(self, key: tuple | None = None) -> None:
        query = delete(LoginFailure).where(LoginFailure.scope == self.scope)
        if key is not None:
            query = query.where(LoginFailure.key == self._hash(key))
        with self._session() as db:
            try:
                db.execute(query)
                db.commit()
            except SQLAlchemyError:  # таблиці ще немає (до міграцій): скидати нічого
                db.rollback()


login_throttle = LoginThrottle("login")


def create_access_token(user: User) -> str:
    settings = get_settings()
    check_settings(settings)
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "exp": expire,
        "iat": now,
        # jti — щоб вихід відкликав саме цей токен; ver — щоб зміна пароля чи блокування відкликали всі
        "jti": uuid.uuid4().hex,
        "ver": user.token_version or 0,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def revoke_token(db: Session, payload: dict) -> None:
    """Відкликає токен до закінчення строку його дії (вихід). Прострочені записи прибираються тут же."""
    jti, exp = payload.get("jti"), payload.get("exp")
    if not jti or not exp:
        return
    now = time.time()
    db.execute(delete(RevokedToken).where(RevokedToken.expires_at < now))
    if db.get(RevokedToken, jti) is None:
        db.add(RevokedToken(jti=jti, expires_at=float(exp)))


def revoke_all_tokens(user: User) -> None:
    """Усі видані користувачу токени стають недійсними (зміна пароля, блокування)."""
    user.token_version = (user.token_version or 0) + 1


def get_token_payload(token: str = Depends(oauth2_scheme)) -> dict:
    try:
        return decode_token(token)
    except jwt.PyJWTError:
        raise _unauthorized()


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Потрібна авторизація",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    """Користувач за JWT. Можна викликати й напряму: get_current_user(token, db) (так робить /indicators)."""
    check_settings(get_settings())
    return user_from_payload(get_token_payload(token), db)


def user_from_payload(payload: dict, db: Session) -> User:
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError, TypeError):
        raise _unauthorized()
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized()
    # Токени, видані до зміни пароля чи блокування, недійсні. Старі токени без ver — це версія 0.
    if payload.get("ver", 0) != (user.token_version or 0):
        raise _unauthorized()
    jti = payload.get("jti")
    if jti and db.get(RevokedToken, jti) is not None:
        raise _unauthorized()
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
