import hashlib
import hmac
import ipaddress
import time
import uuid
from contextvars import ContextVar
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
from app.db import PENDING_VIEWS, get_db
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


# bcrypt враховує лише перші 72 байти, а bcrypt 5 на довшому паролі кидає ValueError (було 500 на вході).
# Кирилиця — 2 байти на літеру, тож 72 байти ≈ 36 українських літер.
BCRYPT_MAX_BYTES = 72


def password_too_long(password: str) -> bool:
    return len(password.encode()) > BCRYPT_MAX_BYTES


def hash_password(password: str) -> str:
    if password_too_long(password):
        raise ValueError(f"Пароль довший за {BCRYPT_MAX_BYTES} байти")
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=get_settings().bcrypt_rounds)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash or password_hash.startswith("!"):
        # Пароля ще немає (очікує запрошення) або вхід паролем вимкнено для облікового запису.
        verify_password_dummy("")
        return False
    if password_too_long(password):
        # Такого пароля не могло бути збережено; час відповіді той самий, що й для звичайної спроби.
        verify_password_dummy("")
        return False
    return bcrypt.checkpw(password.encode(), password_hash.encode())


@lru_cache
def _dummy_hash() -> bytes:
    return bcrypt.hashpw(b"dummy-password", bcrypt.gensalt(rounds=get_settings().bcrypt_rounds))


def verify_password_dummy(password: str) -> None:
    """Перевірка проти фіктивного хешу, щоб час відповіді не видавав неіснуючий логін."""
    bcrypt.checkpw(password.encode()[:BCRYPT_MAX_BYTES], _dummy_hash())


def keys_equal(given: str | None, expected: str | None) -> bool:
    """Порівняння секретів сталого часу. hmac.compare_digest на str з не-ASCII кидає TypeError
    (заголовок із кирилицею давав 500), тому порівнюємо байти."""
    if not given or not expected:
        return False
    return hmac.compare_digest(given.encode("utf-8", "surrogateescape"), expected.encode("utf-8", "surrogateescape"))


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


class UnitHidden(HTTPException):
    """Деталі дочірнього підрозділу закриті: захист від колективного покарання (docs/abuse-analysis.md, Б-серія)."""

    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_403_FORBIDDEN,
                         detail="Деталі іншого підрозділу бачить лише сам підрозділ")


def allowed_units(db: Session, user: User) -> set[uuid.UUID] | None:
    """Підрозділи, результати яких бачить користувач. None — усе дерево.

    - Уповноважений (admin) і аудитор: своя зона (zone_of): підрозділ unit_id і його піддерево; без unit_id —
      усе дерево (розгортання на один заклад). Перегляди дочірніх пишуться в result_views.
    - Керівник: лише свій підрозділ (без підрозділу — кореневі). Про дочірні — розподіл рівнів без назв
      (GET /units/{id}/children-levels). LEADER_CHILD_DETAILS=true повертає старе правило «усе піддерево».
    - Департамент: лише заклади (корені хвиль) свого піддерева, кожен окремо.
    """
    from app.services.units import subtree_ids  # уникаємо циклічного імпорту

    if user.role == Role.LEADER:
        if get_settings().leader_child_details:
            return subtree_ids(db, user.unit_id) if user.unit_id is not None else None
        if user.unit_id is not None:
            return {user.unit_id}
        from app.models import Unit

        return set(db.scalars(select(Unit.id).where(Unit.parent_id.is_(None))))
    if user.role == Role.DEPARTMENT:
        from app.models import Campaign

        roots = set(db.scalars(select(Campaign.unit_id).distinct()))
        if user.unit_id is None:
            return roots
        return roots & subtree_ids(db, user.unit_id)
    return zone_of(db, user)


ZONED_ROLES = (Role.ADMIN, Role.AUDITOR)


def home_unit(db: Session, user: User) -> uuid.UUID | None:
    """Підрозділ «за замовчуванням», коли в запиті немає unit_id.

    Керівник, уповноважений і аудит, прив'язані до підрозділу, — свій підрозділ (а не корінь дерева, якого вони
    не бачать: раніше дашборд зонального уповноваженого без unit_id давав 403). Департамент — корінь дерева, якщо
    він у зоні, або єдиний заклад зони; кілька закладів — 422 unit_required. Решта — корінь дерева.
    None — підрозділів немає зовсім.
    """
    from app.models import Unit

    if user.unit_id is not None and user.role in (Role.LEADER, *ZONED_ROLES):
        return user.unit_id
    root = db.scalars(select(Unit.id).where(Unit.parent_id.is_(None)).order_by(Unit.name)).first()
    if user.role == Role.DEPARTMENT:
        allowed = allowed_units(db, user) or set()
        if root is not None and root in allowed:
            return root
        if len(allowed) == 1:
            return next(iter(allowed))
        from app.errors import ApiError

        raise ApiError(422, "Оберіть заклад", code="unit_required",
                       hint="Департамент дивиться кожен заклад окремо: оберіть його в розділі «Заклади».")
    return root


def visible_unit_filter(db: Session, user: User) -> set[uuid.UUID] | None:
    """Усі підрозділи, дані яких (заходи, перевірки) користувач бачить у списках без unit_id. None — без обмеження.

    Для департаменту — піддерева його закладів (allowed_units дає лише корені), для решти — allowed_units.
    """
    allowed = allowed_units(db, user)
    if allowed is None:
        return None
    if user.role == Role.DEPARTMENT or (user.role == Role.LEADER and user.unit_id is None):
        from app.services.units import subtree_ids

        out: set[uuid.UUID] = set()
        for unit_id in allowed:
            out |= subtree_ids(db, unit_id)
        return out
    return allowed


def zone_of(db: Session, user: User) -> set[uuid.UUID] | None:
    """Зона уповноваженого й аудитора: свій підрозділ і піддерево. None — без обмеження (немає unit_id)
    або роль без зони. Уповноважений одного закладу чи департаменту не бачить і не обирає чужих підрозділів."""
    if user.role not in ZONED_ROLES or user.unit_id is None:
        return None
    from app.services.units import subtree_ids

    return subtree_ids(db, user.unit_id)


def ensure_in_zone(db: Session, user: User, unit_id: uuid.UUID) -> None:
    """422, якщо уповноважений обирає підрозділ поза своєю зоною (створення чи зміна хвилі)."""
    zone = zone_of(db, user)
    if zone is not None and unit_id not in zone:
        from app.errors import ApiError

        raise ApiError(422, "Підрозділ поза вашою зоною відповідальності", code="out_of_zone",
                       hint="Хвилю можна створити лише для свого підрозділу або його дочірніх.")


def campaign_visible(db: Session, user: User, campaign) -> bool:
    """Чи бачить користувач хвилю. Уповноважений, аудитор, Департамент — лише хвилі свого піддерева;
    керівник — хвилі, що охоплюють його підрозділ або лежать у його піддереві."""
    if user.unit_id is None or user.role not in (*ZONED_ROLES, Role.DEPARTMENT, Role.LEADER):
        return True
    from app.services.units import subtree_ids

    if campaign.unit_id in subtree_ids(db, user.unit_id):
        return True
    return user.role == Role.LEADER and user.unit_id in subtree_ids(db, campaign.unit_id)


def campaign_zone_guard(request: Request, db: Session = Depends(get_db)) -> None:
    """Залежність усіх роутерів: хвиля з чужої зони (campaign_id у шляху чи запиті) — 404, ніби її немає.

    Одна перевірка замість десятків у кожному ендпойнті. Автентифікацію не замінює: без токена чи з
    недійсним токеном нічого не робить, далі спрацює звичайна перевірка ендпойнта.
    """
    raw = request.path_params.get("campaign_id") or request.query_params.get("campaign_id")
    header = request.headers.get("authorization", "")
    if not raw or not header.lower().startswith("bearer "):
        return
    try:
        campaign_id = uuid.UUID(str(raw))
        user = user_from_payload(decode_token(header[7:].strip()), db)
    except (ValueError, jwt.PyJWTError, HTTPException):
        return
    from app.models import Campaign

    campaign = db.get(Campaign, campaign_id)
    if campaign is not None and not campaign_visible(db, user, campaign):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Хвилю не знайдено")


def ensure_unit_access(db: Session, user: User, unit_id: uuid.UUID, purpose: str = "results",
                       campaign_id: uuid.UUID | None = None, root_id: uuid.UUID | None = None) -> None:
    """Кидає 403, якщо підрозділ поза тим, що користувач може бачити (allowed_units).

    purpose="results" — перегляд результатів: якщо підрозділ чужий (не свій, не корінь хвилі, не корінь дерева),
    перегляд автоматично записується в result_views. Тому окремо викликати record_view в ендпойнтах не треба.
    purpose="manage" — керування заходами (без індексів): керівник діє в усьому своєму піддереві, як і раніше.
    """
    if purpose == "manage" and user.role == Role.LEADER:
        from app.services.units import subtree_ids

        if user.unit_id is not None and unit_id not in subtree_ids(db, user.unit_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Підрозділ поза вашою зоною відповідальності")
        return
    allowed = allowed_units(db, user)
    if allowed is not None and unit_id not in allowed:
        if user.role == Role.LEADER and get_settings().leader_child_details:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Підрозділ поза вашою зоною відповідальності")
        raise UnitHidden()
    if purpose == "results":
        record_view(db, user, unit_id, campaign_id, None, root_id)


# Маршрут поточного запиту (шаблон шляху без /api/v1): назва ендпойнта для result_views.
_current_route: ContextVar[str | None] = ContextVar("current_route", default=None)


async def remember_route(request: Request) -> None:
    """Залежність роутерів: запам'ятовує шаблон маршруту, щоб record_view знав, звідки перегляд.

    Асинхронна навмисно: виконується в контексті запиту, і синхронні ендпойнти в пулі потоків бачать значення.
    """
    route = request.scope.get("route")
    path = getattr(route, "path", None) or request.url.path
    _current_route.set(path.removeprefix("/api/v1"))


def record_view(db: Session, user: User, unit_id: uuid.UUID, campaign_id: uuid.UUID | None, endpoint: str | None,
                root_id: uuid.UUID | None = None) -> None:
    """Ставить у чергу запис про перегляд результатів чужого підрозділу.

    Не пишеться: свій підрозділ, корінь хвилі, корінь дерева (заклад). Запис зберігає get_db окремою транзакцією
    після успішного запиту, тож навіть ендпойнти лише для читання, що не комітять, лишають слід.
    Окремо від журналу дій: без блокування голови ланцюжка. Звіт для аудитора: GET /admin/result-views.
    """
    if unit_id == root_id or unit_id == user.unit_id:
        return
    from app.models import Unit

    unit = db.get(Unit, unit_id)
    if unit is None or unit.parent_id is None:
        return
    endpoint = (endpoint or _current_route.get() or "unknown")[:64]
    pending = db.info.setdefault(PENDING_VIEWS, [])
    item = {"actor_id": user.id, "unit_id": unit_id, "campaign_id": campaign_id, "endpoint": endpoint}
    if item not in pending:
        pending.append(item)


# Хто читає результати, динаміку, факти, рекомендації, заходи. Лише агрегати з порогом k: відповіді окремих
# людей не бачить ніхто, зокрема уповноважений. Технічний адміністратор (coordinator) результатів не бачить.
RESULT_READERS = (Role.ADMIN, Role.LEADER, Role.AUDITOR, Role.DEPARTMENT)


def people_managers_roles() -> tuple[Role, ...]:
    """Хто керує людьми й підрозділами: лише технічний адміністратор (coordinator)."""
    return (Role.COORDINATOR,)


def require_people_manager(user: User = Depends(get_current_user)) -> User:
    if user.role not in people_managers_roles():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостатньо прав")
    return user
