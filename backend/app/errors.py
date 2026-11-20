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
from sqlalchemy.exc import DataError, IntegrityError
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


def _num(value) -> str:
    return str(value).replace(".", ",")


def _chars(n) -> str:
    n = int(n)
    word = "символ" if n % 10 == 1 and n % 100 != 11 else (
        "символи" if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else "символів")
    return f"{n} {word}"


def _items(n) -> str:
    n = int(n)
    word = "елемент" if n % 10 == 1 and n % 100 != 11 else (
        "елементи" if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else "елементів")
    return f"{n} {word}"


def validation_message(error: dict) -> str:
    """Повідомлення pydantic українською. Раніше користувач бачив «String should have at least 1 character»."""
    kind, ctx, msg = error.get("type", ""), error.get("ctx") or {}, error.get("msg", "")
    if kind == "missing":
        return "Обов'язкове поле"
    if kind == "string_too_short":
        return "Заповніть поле" if int(ctx.get("min_length", 1)) <= 1 else f"Щонайменше {_chars(ctx['min_length'])}"
    if kind == "string_too_long":
        return f"Не більше {_chars(ctx.get('max_length', 0))}"
    if kind == "too_short":
        return "Додайте хоча б один елемент" if int(ctx.get("min_length", 1)) <= 1 else \
            f"Щонайменше {_items(ctx['min_length'])}"
    if kind == "too_long":
        return f"Не більше {_items(ctx.get('max_length', 0))}"
    if kind in ("greater_than_equal", "greater_than"):
        bound = ctx.get("ge", ctx.get("gt"))
        return f"Значення має бути {'не менше' if kind == 'greater_than_equal' else 'більше за'} {_num(bound)}"
    if kind in ("less_than_equal", "less_than"):
        bound = ctx.get("le", ctx.get("lt"))
        return f"Значення має бути {'не більше' if kind == 'less_than_equal' else 'менше за'} {_num(bound)}"
    if kind == "string_pattern_mismatch":
        return "Неправильний формат"
    if kind in ("int_parsing", "int_type", "int_from_float"):
        return "Потрібне ціле число"
    if kind in ("float_parsing", "float_type", "decimal_parsing"):
        return "Потрібне число"
    if kind in ("bool_parsing", "bool_type"):
        return "Потрібно так або ні (true/false)"
    if kind in ("uuid_parsing", "uuid_type"):
        return "Неправильний ідентифікатор"
    if kind in ("date_parsing", "date_from_datetime_parsing", "date_type", "date_from_datetime_inexact"):
        return "Потрібна дата у форматі РРРР-ММ-ДД"
    if kind in ("datetime_parsing", "datetime_type", "datetime_from_date_parsing"):
        return "Потрібні дата й час (ISO 8601)"
    if kind in ("enum", "literal_error"):
        expected = ctx.get("expected")
        return f"Допустимі значення: {expected}" if expected else "Недопустиме значення"
    if kind in ("string_type", "list_type", "dict_type", "model_type", "model_attributes_type"):
        return "Неправильний тип значення"
    if kind == "extra_forbidden":
        return "Невідоме поле"
    if kind == "json_invalid":
        return "Тіло запиту не є коректним JSON"
    if kind in ("value_error", "assertion_error"):
        # Наші валідатори вже пишуть українською; прибираємо службовий префікс pydantic.
        return msg.removeprefix("Value error, ").removeprefix("Assertion failed, ")
    return msg


def _where(request: Request) -> str:
    # Лише метод і шлях: рядок запиту й заголовки (токени, X-Response-Token) у журнал не потрапляють
    return f"{request.method} {request.url.path}"


def configure_logging() -> None:
    """Логер app пише в stderr з часом і рівнем, якщо його ще не налаштовано (uvicorn налаштовує лише свої)."""
    logger = logging.getLogger("app")
    if logger.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class BodyLimit:
    """Грубий захист від завеликих тіл: найбільше легітимне тіло — файл-доказ (+1 МБ на форму).

    Перевіряє і Content-Length (одразу, до розбору), і фактично прочитані байти: тіло частинами
    (Transfer-Encoding: chunked) приходить без Content-Length і раніше проходило без обмеження.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        from app.config import get_settings

        max_mb = get_settings().evidence_max_bytes // (1024 * 1024)
        limit = get_settings().evidence_max_bytes + 1024 * 1024
        hint = f"Максимум {max_mb} МБ на файл."
        length = dict(scope.get("headers") or []).get(b"content-length", b"")
        if length.isdigit() and int(length) > limit:
            body = error_body(413, "Запит завеликий", code="too_large", hint=hint)
            body["request_id"] = uuid.uuid4().hex
            return await JSONResponse(body, status_code=413)(scope, receive, send)

        received = 0
        rejected = False

        async def reject() -> None:
            body = error_body(413, "Запит завеликий", code="too_large", hint=hint)
            body["request_id"] = uuid.uuid4().hex
            await JSONResponse(body, status_code=413)(scope, receive, send)

        async def limited_receive():
            nonlocal received, rejected
            if rejected:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Відповідаємо 413 самі (виняток тут FastAPI перетворив би на 400 «помилка розбору тіла»),
                    # а застосунку кажемо, що клієнт відключився: далі він нічого не читає й не відповідає.
                    rejected = True
                    await reject()
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message) -> None:
            if not rejected:
                await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            if not rejected:
                raise


def integrity_kind(exc: IntegrityError) -> str:
    """unique | not_null | foreign_key | other — за SQLSTATE (PostgreSQL) чи текстом помилки (SQLite)."""
    orig = exc.orig
    code = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    text = str(orig).lower() if orig is not None else ""
    if code == "23502" or "not null constraint" in text or "null value in column" in text:
        return "not_null"
    if code == "23503" or "foreign key" in text:
        return "foreign_key"
    if code == "23505" or "unique" in text or "duplicate key" in text:
        return "unique"
    return "other"


def install(app: FastAPI) -> None:
    configure_logging()

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

    app.add_middleware(BodyLimit)

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
        if exc.status_code >= 500:
            log.error("%s → %s: %s (request_id=%s)", _where(request), exc.status_code, detail, body["request_id"])
        return JSONResponse(body, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = [{"path": _loc(e.get("loc", ())), "message": validation_message(e)} for e in exc.errors()]
        body = error_body(422, errors)
        body["request_id"] = _request_id(request)
        return JSONResponse(body, status_code=422)

    @app.exception_handler(IntegrityError)
    async def integrity_error(request: Request, exc: IntegrityError):
        # Паралельний запит (подвійний клік, адмін і автопілот одночасно) уже створив такий самий запис:
        # це конфлікт стану, а не збій сервера. Транзакцію відкотить get_db при закритті сесії.
        rid = _request_id(request)
        reason = str(exc.orig).splitlines()[0] if exc.orig else type(exc).__name__
        kind = integrity_kind(exc)
        if kind == "not_null":
            # Явний null в обов'язковому полі (PATCH {"title": null}) — помилка запиту, а не «надіслано двічі».
            status, body = 422, error_body(422, "Обов'язкове поле не може бути порожнім (null)", code="null_value",
                                           hint="Не передавайте null для обов'язкових полів: пропустіть поле, "
                                                "щоб лишити як є.")
        elif kind == "foreign_key":
            status, body = 409, error_body(409, "Запис пов'язаний з іншими даними або посилається на відсутні",
                                           code="conflict", hint="Оновіть сторінку й перевірте пов'язані записи.")
        else:
            status, body = 409, error_body(409, "Такий запис уже існує: схоже, запит надіслано двічі", code="conflict",
                                           hint="Оновіть сторінку: перша дія вже виконана.")
        log.warning("%s → %s: порушення цілісності БД (%s, request_id=%s): %s", _where(request), status, kind, rid,
                    reason)
        body["request_id"] = rid
        return JSONResponse(body, status_code=status, headers={REQUEST_ID_HEADER: rid})

    @app.exception_handler(DataError)
    async def data_error(request: Request, exc: DataError):
        # Значення, яке пройшло перевірку схеми, але БД його не приймає: байт NUL у тексті (PostgreSQL),
        # рядок довший за колонку, число поза діапазоном. Це помилка запиту, а не збій сервера (раніше — 500).
        # Транзакцію відкотить get_db при закритті сесії.
        rid = _request_id(request)
        reason = str(exc.orig).splitlines()[0] if exc.orig else type(exc).__name__
        log.warning("%s → 422: БД не прийняла значення (request_id=%s): %s", _where(request), rid, reason)
        body = error_body(422, "Недопустиме значення в запиті", code="invalid_value",
                          hint="Перевірте поля: керівні символи (зокрема NUL), довжину тексту й діапазон чисел.")
        body["request_id"] = rid
        return JSONResponse(body, status_code=422, headers={REQUEST_ID_HEADER: rid})

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        rid = _request_id(request)
        log.error("Необроблена помилка %s (request_id=%s): %s: %s", _where(request), rid, type(exc).__name__, exc,
                  exc_info=exc)
        body = error_body(500, DEFAULT_MESSAGES[500])
        body["request_id"] = rid
        # Цей обробник працює поза middleware request_id, тож заголовок ставимо тут, щоб клієнт його бачив
        return JSONResponse(body, status_code=500, headers={REQUEST_ID_HEADER: rid})
