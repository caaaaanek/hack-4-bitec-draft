"""Роздача зібраного фронтенду (frontend-proto/dist) самим API: один процес і один порт без nginx.

Вмикається змінною FRONTEND_DIST. Поведінка повторює frontend-proto/deploy/nginx.conf:
`/`, `/s/<токен>` і `/q/<код>` віддають index.html (без кешу, з тими самими заголовками безпеки), `/assets/*` кешується назавжди,
решта — лише наявні файли збірки. Маршрути /api, /docs і /health реєструються раніше й не перекриваються.
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        "font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; "
        "form-action 'self'"
    ),
}


class _Assets(StaticFiles):
    """Файли збірки Vite з хешем в імені: кешуються назавжди."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        response.headers.update(SECURITY_HEADERS)
        return response


def mount_frontend(app: FastAPI, dist: str) -> bool:
    """Підключає фронтенд, якщо в каталозі є index.html. Повертає True, якщо підключено."""
    root = Path(dist).resolve()
    index = root / "index.html"
    if not index.is_file():
        return False

    def page(cache: str) -> FileResponse:
        return FileResponse(index, media_type="text/html; charset=utf-8",
                            headers={"Cache-Control": cache, **SECURITY_HEADERS})

    if (root / "assets").is_dir():
        app.mount("/assets", _Assets(directory=root / "assets"), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    def frontend_index():
        return page("no-cache")

    # Одноразове посилання на анонімну анкету: та сама сторінка, без кешу (токен не лишається в кеші браузера).
    @app.get("/s/{token:path}", include_in_schema=False)
    def frontend_token(token: str):
        return page("no-store")

    # QR для зали /q/<код> (як location /q/ у nginx): сторінка сама робить POST /respond/qr/<код>.
    # Без цього маршруту в режимі одного процесу (run-local.sh) скан QR давав 404.
    @app.get("/q/{code:path}", include_in_schema=False)
    def frontend_qr(code: str):
        return page("no-store")

    @app.get("/{name}", include_in_schema=False)
    def frontend_file(name: str):
        # Лише файли з кореня збірки (favicon тощо); шляхи з / сюди не потрапляють
        candidate = (root / name).resolve()
        if candidate.parent != root or not candidate.is_file():
            raise HTTPException(status_code=404, detail="Сторінку не знайдено")
        return FileResponse(candidate, headers=SECURITY_HEADERS)

    return True
