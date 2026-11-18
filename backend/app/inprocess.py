"""Синхронний клієнт до API в тому ж процесі (без мережі й без starlette TestClient).

Для демо-seed і генерації документації: запити проходять через справжні маршрути, перевірки й журнал,
але сервер запускати не треба. Працює на httpx.ASGITransport в одному циклі подій на весь клієнт.
"""
import asyncio
import contextvars

import httpx
from fastapi import FastAPI


class InProcessClient:
    def __init__(self, app: FastAPI, base_url: str = "http://in-process") -> None:
        self._runner = asyncio.Runner()
        self._client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=base_url, timeout=None)

    def _run(self, coro):
        # Кожен виклик — у копії поточного контексту, щоб бачити contextvars, задані між викликами
        return self._runner.run(coro, context=contextvars.copy_context())

    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        return self._run(self._client.request(method, url, **kwargs))

    def get(self, url: str, **kwargs) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> httpx.Response:
        return self.request("POST", url, **kwargs)

    def close(self) -> None:
        try:
            self._run(self._client.aclose())
        finally:
            self._runner.close()

    def __enter__(self) -> "InProcessClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
