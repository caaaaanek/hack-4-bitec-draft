import os
import tempfile

# Налаштування тестового середовища мають бути задані до імпорту застосунку.
_tmp_db = os.path.join(tempfile.gettempdir(), "imd_test.sqlite3")
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp_db}")
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789"
os.environ["DEMO_PASSWORD"] = "demo-pass-123"
os.environ["BCRYPT_ROUNDS"] = "4"
os.environ["INTEGRATION_API_KEY"] = "test-integration-key"
os.environ["EVIDENCE_DIR"] = tempfile.mkdtemp(prefix="imd_evidence_")
os.environ["EVIDENCE_MAX_BYTES"] = str(64 * 1024)
os.environ["EVIDENCE_MAX_FILES_PER_ITEM"] = "3"
# Принцип двох осіб за замовчуванням увімкнено; тести, що його перевіряють, вмикають явно (fixture setting).
os.environ["FOUR_EYES_ENABLED"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.routers.respond import token_throttle  # noqa: E402
from app.security import login_throttle  # noqa: E402
from app.seed import seed  # noqa: E402

PASSWORD = os.environ["DEMO_PASSWORD"]


@pytest.fixture()
def client():
    login_throttle.reset()
    token_throttle.reset()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        units = seed.seed_units(db)
        seed.seed_users(db, units, PASSWORD)
        seed.seed_questionnaires(db)
        db.commit()
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(engine)


def auth(client: TestClient, login: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", data={"username": login, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture()
def setting(monkeypatch):
    """setting(four_eyes_enabled=True, ...) — змінити налаштування на час тесту."""
    from app.config import get_settings

    def apply(**values):
        for key, value in values.items():
            monkeypatch.setattr(get_settings(), key, value)
    return apply


def user_ids(client: TestClient) -> dict[str, str]:
    """login -> id (людей бачить лише технічний адміністратор)."""
    users = client.get("/api/v1/admin/users", headers=auth(client, "coordinator")).json()
    return {u["login"]: u["id"] for u in users}


def create_person(client: TestClient, login: str, role: str = "respondent", category: str | None = "staff",
                  unit_id: str | None = None, password: str = PASSWORD) -> str:
    """Технічний адміністратор заводить людину, людина ставить пароль за запрошенням. Повертає id."""
    body = {"login": login, "display_name": login, "role": role, "category": category, "unit_id": unit_id}
    r = client.post("/api/v1/admin/users", json=body, headers=auth(client, "coordinator"))
    assert r.status_code == 201, r.text
    token = r.json()["invite_link"].rsplit("/", 1)[-1]
    assert client.post("/api/v1/auth/invite", json={"token": token, "password": password}).status_code == 204
    return r.json()["id"]
