"""Демо-факти, які рахує сама система, а не намальований мок.

- Декларації вчасно, конфлікти інтересів, підозрілі закупівлі: синтетичні записи проходять через модуль
  «Перевірки» (ті самі правила, що й для справжнього файлу чи API), уповноважений «розглядає» частину знахідок,
  а показники публікуються як у POST /checks/publish. Записи підібрано так, щоб X з Y збігалися з
  попередніми демо-числами: індекс демо-хвиль не змінюється.
- Охоплення навчанням: історія проходження флешкарток людьми (раз на рік, з поновленням), показник
  рахує services/learning.py на кінець кожного місяця.

Повідомлення й призначення з перевіркою лишаються від зовнішніх реєстрів (канал повідомлень, кадри) —
їх у нашій системі немає, тож вони приходять через POST /indicators (у демо — seed з джерелом reports/atestat).
"""

import hashlib
import json
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CheckFinding, CheckRun, TrainingCompletion, Unit, User, utcnow
from app.services import checks, learning
from app.services.declarations_check import evaluate_declarations
from app.services.facts import months_back, window
from app.services.procurement_flags import evaluate_records

SYSTEM_FACTS = ("declarations_on_time", "coi_reviewed", "procurement_flags_reviewed", "training_coverage")
SOURCE = "seed"

# Частка людей, які пройшли навчання, за зсувом у місяцях від початку періоду фактів поточної хвилі.
# Ступінчасто зростає: ~59% у періоді хвилі 1 (рівень 2) і ~72% у періоді хвилі 2 (рівень 3), як і раніше.
TRAINING_SHARE = [(-9, 0.40), (-6, 0.48), (-3, 0.55), (0, 0.62), (3, 0.70), (6, 0.76), (9, 0.82)]


def _coi_templates() -> list[dict]:
    """Декларації з даними, на які спрацьовують правила конфлікту інтересів (з демо-набору модуля)."""
    items = json.loads(checks.DECLARATIONS_MOCK.read_text(encoding="utf-8"))
    out = []
    for item in items:
        if not isinstance(item.get("data"), dict):
            continue
        flags = evaluate_declarations([{**item, "declaration_type": 4}], year=2025)[0]["flags"]
        if any(f["rule_id"] not in checks.NOT_COI for f in flags):
            out.append(item["data"])
    return out


def _review(db: Session, run: CheckRun, how_many: int, reviewer: User | None, only=None) -> None:
    findings = sorted(db.scalars(select(CheckFinding).where(CheckFinding.run_id == run.id)), key=lambda f: f.record_ref)
    if only is not None:
        findings = [f for f in findings if only(f)]
    for f in findings[:how_many]:
        f.status = "reviewed"
        f.comment = "Розглянуто (синтетичні демо-дані)"
        f.reviewed_by_id = reviewer.id if reviewer else None
        f.reviewed_at = utcnow()


def declarations_run(db: Session, unit: Unit, u_index: int, period: str, decl: tuple[int, int],
                     coi: tuple[int, int], templates: list[dict], reviewer: User | None) -> None:
    year = checks.default_year(period)
    on_time, total = decl
    tag = f"{u_index}-{period}"
    items = [{"declaration_id": f"seed-{tag}-a{i:02d}", "declaration_type": 1, "declaration_year": year,
              "date": date(year + 1, 3, 10).isoformat() if i < on_time else date(year + 1, 4, 15).isoformat(),
              "data": None} for i in range(total)]
    reviewed, found = coi
    if found > len(templates):
        raise ValueError("Замало шаблонів декларацій з конфліктом інтересів")
    # Тип 4 (декларація кандидата) не має строку подання: такі записи не впливають на частку «вчасно».
    items += [{"declaration_id": f"seed-{tag}-c{i}", "declaration_type": 4, "declaration_year": year,
               "date": f"{year + 1}-02-01", "data": templates[i]} for i in range(found)]
    run = checks.run_declarations(db, None, unit.id, period, SOURCE, items, year)
    coi_refs = {"d-" + hashlib.sha256(f"seed-{tag}-c{i}".encode()).hexdigest()[:12] for i in range(found)}
    _review(db, run, reviewed, reviewer, only=lambda f: f.record_ref in coi_refs)
    # Запізнення з поданням уповноважений теж опрацював; на частки це не впливає.
    _review(db, run, total, reviewer, only=lambda f: f.record_ref not in coi_refs)


MOCK_ATTEMPTS = 20


def procurement_run(db: Session, unit: Unit, period: str, proc: tuple[int, int], reviewer: User | None) -> None:
    reviewed, found = proc
    # Набір залежить від випадкового UUID підрозділу; зрідка (~0,03% пар «підрозділ + місяць») у ньому
    # замало записів, підозрілих самі по собі. Тоді беремо запасний набір: детермінований від того самого id.
    for attempt in range(MOCK_ATTEMPTS):
        seed_id = unit.id if attempt == 0 else uuid.uuid5(unit.id, f"procurement-retry-{attempt}")
        records = checks.mock_procurement(seed_id, period)
        # Деякі правила (поділ закупівлі) спрацьовують лише на групі записів, тож беремо записи,
        # підозрілі самі по собі, і прибираємо «чисті», які разом стають підозрілими.
        alone = {r["record_id"]: evaluate_records([r])[0]["risk_level"] != "none" for r in records}
        if sum(alone.values()) >= found:
            break
    flagged = [r for r in records if alone[r["record_id"]]][:found]
    clean = [r for r in records if not alone[r["record_id"]]]
    while True:
        risky = {x["record_id"] for x in evaluate_records(flagged + clean) if x["risk_level"] != "none"}
        extra = [r for r in clean if r["record_id"] in risky]
        if not extra:
            break
        clean = [r for r in clean if r["record_id"] not in risky]
    if len(flagged) < found:
        raise ValueError(f"Замало підозрілих закупівель у синтетичному наборі для {period}")
    run = checks.run_procurement(db, None, unit.id, period, SOURCE, flagged + clean)
    _review(db, run, reviewed, reviewer)


def _fraction(login: str) -> float:
    return int(hashlib.sha256(login.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def seed_training(db: Session, current: date, periods: list[str]) -> int:
    """Історія флешкарток: людина починає навчання в місяць зі ступеня TRAINING_SHARE і поновлює щороку."""
    start_period = window(current, 12)[0]
    all_months = months_back(current, 40)
    base = all_months.index(start_period)
    added = 0
    for user in learning.learners(db):
        p = _fraction(user.login)
        offset = next((o for o, share in TRAINING_SHARE if p <= share), None)
        if offset is None:
            continue
        idx = base + offset
        while 0 <= idx < len(all_months):
            y, mth = int(all_months[idx][:4]), int(all_months[idx][5:])
            on = date(y, mth, 10)
            if on > current:
                break
            for code in learning.required():
                exists = db.scalar(select(TrainingCompletion.id).where(
                    TrainingCompletion.user_id == user.id, TrainingCompletion.deck == code,
                    TrainingCompletion.completed_on == on))
                if not exists:
                    db.add(TrainingCompletion(user_id=user.id, deck=code, completed_on=on))
                    added += 1
            idx += 12
    db.flush()
    for period in periods:
        learning.publish(db, period)
    return added


def seed_system_facts(db: Session, units: dict[str, Unit], root_name: str, periods: list[str], early: int,
                      demo: dict, demo_early: dict, current: date) -> int:
    reviewer = db.scalar(select(User).where(User.login == "admin"))
    templates = _coi_templates()
    runs = 0
    for u_index, (name, unit) in enumerate(units.items()):
        if name == root_name:
            continue
        for p_index, period in enumerate(periods):
            if db.scalar(select(CheckRun.id).where(CheckRun.unit_id == unit.id, CheckRun.period == period).limit(1)):
                continue
            patterns = demo_early if p_index < early else demo
            pick = lambda code: patterns[code][(u_index + p_index - early) % len(patterns[code])]  # noqa: E731
            declarations_run(db, unit, u_index, period, pick("declarations_on_time"), pick("coi_reviewed"),
                             templates, reviewer)
            procurement_run(db, unit, period, pick("procurement_flags_reviewed"), reviewer)
            db.flush()
            checks.publish(db, unit.id, period)
            runs += 2
    seed_training(db, current, periods)
    return runs

