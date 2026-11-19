"""Роздача зібраного фронтенду самим API (FRONTEND_DIST)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.frontend import mount_frontend


def make(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (tmp_path / "assets" / "app-1a2b.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "icon.svg").write_text("<svg/>", encoding="utf-8")
    (tmp_path.parent / "secret.txt").write_text("x", encoding="utf-8")
    app = FastAPI()

    @app.get("/api/v1/ping")
    def ping():
        return {"ok": True}

    assert mount_frontend(app, str(tmp_path))
    return TestClient(app)


def test_pages_assets_and_api(tmp_path):
    c = make(tmp_path)
    r = c.get("/")
    assert r.status_code == 200 and "id=root" in r.text
    assert r.headers["cache-control"] == "no-cache"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    r = c.get("/s/abc123")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    r = c.get("/q/QRCODE42")  # скан QR для зали в режимі одного процесу
    assert r.status_code == 200 and "id=root" in r.text and r.headers["cache-control"] == "no-store"
    r = c.get("/assets/app-1a2b.js")
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]
    assert c.get("/icon.svg").status_code == 200
    assert c.get("/api/v1/ping").json() == {"ok": True}


def test_no_traversal_or_unknown(tmp_path):
    c = make(tmp_path)
    assert c.get("/nope.js").status_code == 404
    assert c.get("/..%2Fsecret.txt").status_code == 404
    assert c.get("/assets/../../secret.txt").status_code == 404


def test_missing_dist(tmp_path):
    assert mount_frontend(FastAPI(), str(tmp_path / "missing")) is False
