from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.schemas import MeOut, TokenOut
from app.security import create_access_token, get_current_user, login_throttle, verify_password, verify_password_dummy

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Вхід. Після кількох невдалих спроб для пари логін + IP повертається 429."""
    key = (form.username.lower(), request.client.host if request.client else "")
    retry_after = login_throttle.blocked_for(key)
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Забагато невдалих спроб входу. Спробуйте пізніше.",
            headers={"Retry-After": str(retry_after)},
        )
    user = db.scalar(select(User).where(User.login == form.username))
    if user is None:
        verify_password_dummy(form.password)  # однаковий час відповіді: не видаємо, чи існує логін
        ok = False
    else:
        ok = user.is_active and verify_password(form.password, user.password_hash)
    if not ok:
        login_throttle.fail(key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Невірний логін або пароль")
    login_throttle.reset(key)
    return TokenOut(access_token=create_access_token(user))


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)):
    return user
