"""Єдиний формат помилок API.

Кожна помилка повертається як

    {"code": "conflict", "message": "Хвиля не відкрита", "hint": "...", "detail": ..., "errors": [...]}

- `code` — стабільний код для програми (не залежить від мови тексту);
- `message` — що сталося, людською мовою;
- `hint` — що робити далі;
- `detail` — те саме, що повертав FastAPI раніше (рядок або список), для сумісності;
- `errors` — для 422: перелік `{path, message}` по полях.

Роутери й далі кидають звичайний `HTTPException`; код і підказка беруться зі статусу.
Щоб задати свій код, кидайте `ApiError`.
"""

import logging
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app.errors")

REQUEST_ID_HEADER = "X-Request-ID"

# статус -> (код, підказка за замовчуванням)
STATUS_CODES: dict[int, tuple[str, str]] = {
    400: ("bad_request", "Перевірте запит."),
    401: ("unauthorized", "Увійдіть знову."),
    403: ("forbidden", "Ця дія недоступна для вашої ролі."),
    404: ("not_found", "Перевірте адресу або оновіть сторінку."),
    405: ("method_not_allowed", "Перевірте метод запиту."),
    409: ("conflict", "Дія недоступна в поточному стані. Оновіть сторінку."),
    413: ("too_large", "Зменште розмір файлу."),
    415: ("unsupported_type", "Оберіть файл дозволеного типу."),
    422: ("invalid", "Виправте позначені поля."),
    429: ("too_many_requests", "Зачекайте й спробуйте ще раз."),
    500: ("internal", "Спробуйте пізніше. Якщо повторюється, передайте адміністратору код запиту."),
    502: ("bad_gateway", "Зовнішня система недоступна. Спробуйте пізніше."),
    503: ("unavailable", "Сервіс тимчасово недоступний. Спробуйте пізніше."),
}

DEFAULT_MESSAGES = {
    401: "Потрібна авторизація",
    404: "Не знайдено",
    405: "Метод не дозволено",
    422: "Дані не пройшли перевірку",
    500: "Внутрішня помилка сервера",
}


class ApiError(HTTPException):
    """HTTPException зі своїм кодом і підказкою."""

    def __init__(self, status_code: int, message: str, code: str | None = None, hint: str | None = None,
                 headers: dict[str, str] | None = None, **extra) -> None:
        super().__init__(status_code=status_code, detail=message, headers=headers)
        self.code = code
        self.hint = hint
        self.extra = extra


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex


def error_body(status: int, detail, code: str | None = None, hint: str | None = None, **extra) -> dict:
    default_code, default_hint = STATUS_CODES.get(status, ("error", "Спробуйте ще раз."))
    errors = None
    if isinstance(detail, str):
        message = detail
    elif isinstance(detail, list):
        # Список {path, message} (наприклад, перевірка анкети) або помилки pydantic.
        message = DEFAULT_MESSAGES.get(status, "Дані не пройшли перевірку")
        errors = [
            {"path": str(i.get("path", "")), "message": str(i.get("message", i))} if isinstance(i, dict)
            else {"path": "", "message": str(i)}
            for i in detail
        ]
    else:
        message = DEFAULT_MESSAGES.get(status, "Помилка")
    body = {"code": code or default_code, "message": message, "hint": hint or default_hint, "detail": detail}
    if errors is not None:
        body["errors"] = errors
    body.update({k: v for k, v in extra.items() if v is not None})
    return body


def _loc(loc) -> str:
    # ("body", "answers", 0, "question_id") -> "answers.0.question_id"
    parts = [str(p) for p in loc]
    if parts and parts[0] in ("body", "query", "path", "header", "form"):
        parts = parts[1:] or parts
    return ".".join(parts)


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_id(request: Request, call_next):
        rid = request.headers.get(REQUEST_ID_HEADER)
        # Не довіряємо довгим або дивним значенням від клієнта.
        if not rid or len(rid) > 64 or not rid.replace("-", "").isalnum():
            rid = uuid.uuid4().hex
        request.state.request_id = rid
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = rid
        return response

    @app.middleware("http")
    async def body_limit(request: Request, call_next):
        # Грубий захист від завеликих тіл до розбору: найбільше легітимне тіло — файл-доказ.
        from app.config import get_settings

        limit = get_settings().evidence_max_bytes + 1024 * 1024
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > limit:
            body = error_body(413, "Запит завеликий", code="too_large",
                              hint=f"Максимум {get_settings().evidence_max_bytes // (1024 * 1024)} МБ на файл.")
            body["request_id"] = _request_id(request)
            return JSONResponse(body, status_code=413)
        return await call_next(request)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code = getattr(exc, "code", None)
        hint = getattr(exc, "hint", None)
        extra = getattr(exc, "extra", {}) or {}
        detail = exc.detail
        if exc.status_code in DEFAULT_MESSAGES and detail in ("Not Found", "Method Not Allowed", "Unauthorized"):
            detail = DEFAULT_MESSAGES[exc.status_code]
        body = error_body(exc.status_code, detail, code, hint, **extra)
        body["request_id"] = _request_id(request)
        return JSONResponse(body, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = [{"path": _loc(e.get("loc", ())), "message": e.get("msg", "")} for e in exc.errors()]
        body = error_body(422, errors)
        body["request_id"] = _request_id(request)
        return JSONResponse(body, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        rid = _request_id(request)
        log.exception("Необроблена помилка, request_id=%s", rid)
        body = error_body(500, DEFAULT_MESSAGES[500])
        body["request_id"] = rid
        return JSONResponse(body, status_code=500)
