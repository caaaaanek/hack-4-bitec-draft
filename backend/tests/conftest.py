import os
import tempfile

# Налаштування тестового середовища мають бути задані до імпорту застосунку.
_tmp_db = os.path.join(tempfile.gettempdir(), "imd_test.sqlite3")
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp_db}")
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789"
os.environ["DEMO_PASSWORD"] = "demo-pass-123"
os.environ["BCRYPT_ROUNDS"] = "4"
os.environ["INTEGRATION_API_KEY"] = "test-integration-key"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.security import login_throttle  # noqa: E402
from app.seed import seed  # noqa: E402

PASSWORD = os.environ["DEMO_PASSWORD"]


@pytest.fixture()
def client():
    login_throttle.reset()
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
