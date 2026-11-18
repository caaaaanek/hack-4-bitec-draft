"""Демо-seed: повний склад підрозділів і історія з двох хвиль (--with-waves)."""

from datetime import timedelta

from sqlalchemy import func, select

from app.clock import today
from app.db import SessionLocal
from app.models import Campaign, CampaignStatus, Measure, MeasureStatus, RecommendationDecision, Unit, User
from app.seed import seed
from app.seed.waves import WAVE_GAP_MONTHS, seed_waves
from tests.conftest import PASSWORD, auth
from tests.helpers import API


def full_demo() -> list[str]:
    with SessionLocal() as db:
        units = seed.seed_units(db)
        seed.seed_users(db, units, PASSWORD, seed.DEMO_STAFF_SIZES)
        seed.seed_indicators(db, units, months=12 + WAVE_GAP_MONTHS)
        db.commit()
    return seed_waves()


def test_demo_staff_sizes(client):
    with SessionLocal() as db:
        units = seed.seed_units(db)
        seed.seed_users(db, units, PASSWORD, seed.DEMO_STAFF_SIZES)
        db.commit()
        for name, size in seed.DEMO_STAFF_SIZES.items():
            count = db.scalar(select(func.count()).select_from(User).join(Unit, User.unit_id == Unit.id)
                              .where(Unit.name == name, User.category == "staff"))
            assert count == size, name
        # Базові staff01…staff24 лишилися на своїх місцях.
        assert db.scalar(select(Unit.name).join(User, User.unit_id == Unit.id).where(User.login == "staff01")) == "Підрозділ А"


def test_seed_with_waves(client):
    lines = full_demo()
    assert any("Хвиля 2" in line for line in lines)

    with SessionLocal() as db:
        campaigns = db.scalars(select(Campaign).order_by(Campaign.closed_on)).all()
        assert [c.status for c in campaigns] == [CampaignStatus.CLOSED, CampaignStatus.CLOSED]
        first, second = campaigns
        assert second.closed_on == today()
        assert timedelta(days=170) < second.closed_on - first.closed_on < timedelta(days=200)

        decisions = {d.decision.value for d in db.scalars(select(RecommendationDecision))}
        assert "accepted" in decisions
        measures = db.scalars(select(Measure)).all()
        statuses = {m.status for m in measures}
        assert MeasureStatus.DONE in statuses and MeasureStatus.IN_PROGRESS in statuses
        assert all(m.campaign_id == first.id for m in measures)

    leader = auth(client, "leader")
    overdue = client.get(f"{API}/measures", params={"overdue": "true"}, headers=leader).json()
    assert overdue, "у демо має бути хоч один прострочений захід"

    dashboard = client.get(f"{API}/dashboard", headers=leader)
    assert dashboard.status_code == 200, dashboard.text

    admin = auth(client, "admin")
    root = next(u["id"] for u in client.get(f"{API}/admin/units", headers=admin).json() if u["parent_id"] is None)
    history = client.get(f"{API}/units/{root}/history", headers=admin).json()
    points = history["points"]
    assert len(points) == 2
    assert points[-1]["index"] > points[0]["index"], "у хвилі 2 індекс має бути вищим"
    assert points[-1]["measures_done"] == 2, "між хвилями виконано два заходи"


def test_seed_waves_is_idempotent(client):
    full_demo()
    assert seed_waves() == ["Хвилі вже є, демо-історію не додаю"]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Campaign)) == 2


def test_seed_demo_false_skips_demo_and_waves(client, monkeypatch):
    """SEED_DEMO=false: лише анкети з додатків Б і В і адміністратор; SEED_WITH_WAVES ігнорується."""
    from app.db import Base, engine
    from app.models import Indicator, Questionnaire, Role

    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    monkeypatch.setenv("SEED_DEMO", "false")
    monkeypatch.setenv("SEED_WITH_WAVES", "true")
    seed.main([])
    seed.main([])  # повторний запуск нічого не дублює
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Campaign)) == 0
        assert db.scalar(select(func.count()).select_from(Indicator)) == 0
        assert db.scalar(select(func.count()).select_from(Unit)) == 0
        assert db.scalars(select(User.login)).all() == ["admin"]
        assert db.scalar(select(User.role)) == Role.ADMIN
        assert db.scalar(select(func.count()).select_from(Questionnaire)) == len(seed.QUESTIONNAIRE_FILES)
    auth(client, "admin")  # адміністратор може увійти й завести підрозділи
    from app.services.recommendations import catalog

    assert catalog()  # каталог заходів (Додаток Д) читається з файлу, не залежить від seed
