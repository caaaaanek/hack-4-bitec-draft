"""Вхід.

Три способи, усі видають той самий JWT:
- `POST /auth/login` — form-data (OAuth2, кнопка Authorize у /docs);
- `POST /auth/session` — JSON `{login, password}` для фронтенду;
- `POST /auth/proxy` — вхід через довірений зворотний проксі організації (SSO), див. services/proxy_auth.py.

JWT без стану: `DELETE /auth/session` лише підтверджує вихід, фронтенд видаляє токен у себе.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import User
from app.schemas import InviteAcceptIn, MeOut, SessionOut, TokenOut
from app.security import (
    hash_password,
    revoke_all_tokens,
    get_token_payload,
    revoke_token,
    client_ip,
    create_access_token,
    get_current_user,
    LoginThrottle,
    login_throttle,
    verify_password,
    verify_password_dummy,
)
from app.services import invites
from app.services.proxy_auth import proxy_login

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


def token_for(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user),
        expires_in=get_settings().jwt_expire_minutes * 60,
        role=user.role,
    )


def password_login(request: Request, username: str, password: str, db: Session) -> User:
    if not get_settings().password_login_enabled:
        raise ApiError(403, "Вхід паролем вимкнено", code="password_login_disabled",
                       hint="Увійдіть через систему входу організації.")
    key = (username.lower(), client_ip(request))
    retry_after = login_throttle.blocked_for(key)
    if retry_after:
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Забагато невдалих спроб входу. Спробуйте пізніше.",
            hint=f"Спробуйте через {retry_after} с.",
            headers={"Retry-After": str(retry_after)},
        )
    user = db.scalar(select(User).where(User.login == username))
    if user is None:
        verify_password_dummy(password)  # однаковий час відповіді: не видаємо, чи існує логін
        ok = False
    else:
        ok = user.is_active and verify_password(password, user.password_hash)
    if not ok:
        login_throttle.fail(key)
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "Невірний логін або пароль", code="bad_credentials",
                       hint="Перевірте логін і пароль.")
    login_throttle.reset(key)
    return user


@router.post("/login", response_model=TokenOut)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Вхід (form-data `username`, `password`). Після кількох невдалих спроб для пари логін + IP повертається 429."""
    return token_for(password_login(request, form.username, form.password, db))


@router.post("/session", response_model=SessionOut)
def create_session(data: LoginIn, request: Request, db: Session = Depends(get_db)):
    """Вхід для фронтенду: JSON `{login, password}` → токен і профіль одним запитом."""
    user = password_login(request, data.login, data.password, db)
    return SessionOut(**token_for(user).model_dump(), user=MeOut.model_validate(user))


@router.get("/session", response_model=MeOut)
def get_session(user: User = Depends(get_current_user)):
    return user


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    _: User = Depends(get_current_user),
    payload: dict = Depends(get_token_payload),
    db: Session = Depends(get_db),
):
    """Вихід: цей токен відкликається на сервері до закінчення строку дії (інші сесії користувача діють далі)."""
    revoke_token(db, payload)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/proxy", response_model=SessionOut)
def login_via_proxy(request: Request, db: Session = Depends(get_db)):
    """Вхід через довірений проксі (SSO організації).

    Працює, лише якщо PROXY_AUTH_ENABLED=true і запит прийшов з адреси з TRUSTED_PROXIES.
    Логін береться із заголовка PROXY_AUTH_HEADER і має збігатися з наявним обліковим записом:
    автоматично користувачі не створюються, ролі призначає адміністратор.
    """
    user = proxy_login(request, db)
    log_action(db, user, "login_proxy", "user", user.id, {})
    db.commit()
    return SessionOut(**token_for(user).model_dump(), user=MeOut.model_validate(user))


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)):
    return user


# ---------- Запрошення: пароль ставить сама людина ----------

invite_throttle = LoginThrottle("invite")


@router.post("/invite", status_code=status.HTTP_204_NO_CONTENT)
def accept_invite(data: InviteAcceptIn, request: Request, db: Session = Depends(get_db)):
    """Поставити свій пароль за одноразовим запрошенням. Адміністратор пароля не бачить і не знає.

    Запрошення діє один раз і до строку (INVITE_TTL_HOURS). Усі попередні сесії облікового запису закриваються.
    """
    key = ("invite", client_ip(request))
    retry_after = invite_throttle.blocked_for(key)
    if retry_after:
        raise ApiError(429, "Забагато спроб", hint=f"Спробуйте через {retry_after} с.",
                       headers={"Retry-After": str(retry_after)})
    row = invites.find_valid(db, data.token)
    user = db.get(User, row.user_id) if row else None
    if row is None or user is None:
        invite_throttle.fail(key)
        raise ApiError(404, "Запрошення недійсне або прострочене", code="invite_invalid",
                       hint="Попросіть адміністратора надіслати нове запрошення.")
    user.password_hash = hash_password(data.password)
    revoke_all_tokens(user)
    row.used_at = datetime.now(timezone.utc)
    log_action(db, user, "accept_invite", "user", user.id, {})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
