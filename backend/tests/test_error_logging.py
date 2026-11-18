"""Помилки 500: request_id у відповіді й у журналі сервера разом із методом і шляхом, без рядка запиту."""
import logging

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import errors


def make_app() -> TestClient:
    app = FastAPI()
    errors.install(app)

    @app.get("/boom")
    def boom():
        raise RuntimeError("щось зламалось")

    @app.get("/upstream")
    def upstream():
        raise HTTPException(status_code=502, detail="Тема 2 не відповідає")

    return TestClient(app, raise_server_exceptions=False)


def test_unhandled_error_logged_with_request_id(caplog):
    client = make_app()
    with caplog.at_level(logging.ERROR, logger="app.errors"):
        r = client.get("/boom?secret=abc", headers={"X-Request-ID": "trace-123"})
    assert r.status_code == 500
    assert r.json()["request_id"] == "trace-123" and r.headers["X-Request-ID"] == "trace-123"
    text = caplog.text
    assert "trace-123" in text and "GET /boom" in text and "RuntimeError" in text
    assert "secret=abc" not in text
    assert any(rec.exc_info for rec in caplog.records)  # трасування стеку є


def test_http_5xx_logged(caplog):
    client = make_app()
    with caplog.at_level(logging.ERROR, logger="app.errors"):
        r = client.get("/upstream")
    assert r.status_code == 502
    assert r.json()["request_id"] in caplog.text and "GET /upstream" in caplog.text
