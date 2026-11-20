"""Модуль «Перевірки»: запуск правил, знахідки, розгляд, публікація показників.

У БД потрапляють лише підсумки й знахідки (публічний ідентифікатор, прапорці). Самі записи
закупівель і декларацій, а також імена, телефони й адреси не зберігаються.
"""

import hashlib
import json
import random
import uuid
from collections import Counter
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CheckFinding, CheckRun, Indicator, User, utcnow
from app.services import fact_registry
from app.services.declarations_check import evaluate_declarations
from app.services.procurement_flags import evaluate_records

DECLARATIONS_MOCK = Path(__file__).resolve().parents[1] / "seed" / "data" / "declarations_mock.json"
FLAG_KEYS = ("rule_id", "severity", "title", "law_refs")
# Прапорець строку подання не є конфліктом інтересів.
NOT_COI = {"declaration_late"}


def _clean_flags(flags: list[dict]) -> list[dict]:
    return [{k: f[k] for k in FLAG_KEYS if k in f} for f in flags]


def _save_run(db: Session, user: User | None, kind: str, unit_id, period, source, rows: list[dict], extra: dict) -> CheckRun:
    """rows: {ref, risk_level, flags, flagged}. Знахідка створюється для кожного рядка з flagged."""
    findings = [r for r in rows if r["flagged"]]
    run = CheckRun(
        kind=kind, unit_id=unit_id, period=period, source=source, total=len(rows), flagged=len(findings),
        by_risk=dict(Counter(r["risk_level"] for r in findings)), extra=extra,
        created_by_id=user.id if user else None,
    )
    db.add(run)
    db.flush()
    for r in findings:
        db.add(CheckFinding(run_id=run.id, kind=kind, unit_id=unit_id, period=period, record_ref=r["ref"],
                            risk_level=r["risk_level"], flags=_clean_flags(r["flags"])))
    db.flush()
    return run


def run_procurement(db: Session, user: User | None, unit_id: uuid.UUID, period: str, source: str,
                    records: list[dict]) -> CheckRun:
    results = evaluate_records(records)
    rows = [{"ref": r["record_id"], "risk_level": r["risk_level"], "flags": r["flags"],
             "flagged": r["risk_level"] != "none"} for r in results]
    return _save_run(db, user, "procurement", unit_id, period, source, rows, {})


def default_year(period: str) -> int:
    return int(period[:4]) - 1


def run_declarations(db: Session, user: User | None, unit_id: uuid.UUID, period: str, source: str,
                     items: list[dict], year: int | None = None) -> CheckRun:
    results = evaluate_declarations(items, year=year or default_year(period))
    rows = [{"ref": r["record_ref"], "risk_level": r["risk_level"], "flags": r["flags"],
             "flagged": r["risk_level"] != "none" or any(f["rule_id"] == "declaration_late" for f in r["flags"]),
             "on_time": r["on_time"]} for r in results]
    extra = {"on_time": sum(r["on_time"] is True for r in rows), "late": sum(r["on_time"] is False for r in rows),
             "unknown": sum(r["on_time"] is None for r in rows)}
    return _save_run(db, user, "declarations", unit_id, period, source, rows, extra)


def list_runs(db: Session, unit_id=None, kind=None, period=None, limit: int = 100, units=None) -> list[CheckRun]:
    """units — зона користувача (None — без обмеження)."""
    q = select(CheckRun).order_by(CheckRun.created_at.desc()).limit(limit)
    if units is not None:
        q = q.where(CheckRun.unit_id.in_(units))
    for column, value in ((CheckRun.unit_id, unit_id), (CheckRun.kind, kind), (CheckRun.period, period)):
        if value is not None:
            q = q.where(column == value)
    return list(db.scalars(q))


def list_findings(db: Session, run_id=None, kind=None, status=None, risk_level=None, unit_id=None, period=None,
                  limit: int = 200, offset: int = 0, units=None) -> list[CheckFinding]:
    """units — зона користувача (None — без обмеження)."""
    q = select(CheckFinding).order_by(CheckFinding.period.desc(), CheckFinding.record_ref).limit(limit).offset(offset)
    if units is not None:
        q = q.where(CheckFinding.unit_id.in_(units))
    for column, value in ((CheckFinding.run_id, run_id), (CheckFinding.kind, kind), (CheckFinding.status, status),
                          (CheckFinding.risk_level, risk_level), (CheckFinding.unit_id, unit_id),
                          (CheckFinding.period, period)):
        if value is not None:
            q = q.where(column == value)
    return list(db.scalars(q))


def review_finding(db: Session, finding: CheckFinding, user: User, status: str, comment: str) -> CheckFinding:
    finding.status = status
    finding.comment = comment
    finding.reviewed_by_id = user.id if status != "new" else None
    finding.reviewed_at = utcnow() if status != "new" else None
    db.flush()
    return finding


def _latest_findings(db: Session, unit_id, period, kind) -> list[CheckFinding]:
    """Знахідки періоду без дублів: якщо запис перевіряли кілька разів, береться остання знахідка."""
    rows = db.execute(
        select(CheckFinding).join(CheckRun, CheckRun.id == CheckFinding.run_id)
        .where(CheckFinding.unit_id == unit_id, CheckFinding.period == period, CheckFinding.kind == kind)
        .order_by(CheckRun.created_at, CheckRun.id)
    ).scalars()
    return list({f.record_ref: f for f in rows}.values())


def _upsert(db: Session, unit_id, period, indicator: str, numerator: int, denominator: int, why: str,
            extra_counts: dict) -> None:
    row = db.scalar(select(Indicator).where(Indicator.unit_id == unit_id, Indicator.period == period,
                                            Indicator.indicator == indicator))
    if row is None:
        row = Indicator(unit_id=unit_id, period=period, indicator=indicator)
        db.add(row)
    row.numerator, row.denominator, row.source, row.why, row.extra_counts = (
        numerator, denominator, "checks", why, extra_counts)


def publish(db: Session, unit_id: uuid.UUID, period: str) -> list[dict]:
    """Рахує X з Y за знахідками періоду й записує показники (Y = 0 не записується)."""
    done = ("reviewed", "dismissed")
    procurement = _latest_findings(db, unit_id, period, "procurement")
    coi = [f for f in _latest_findings(db, unit_id, period, "declarations")
           if any(fl.get("rule_id") not in NOT_COI for fl in f.flags)]
    last = db.scalar(select(CheckRun).where(CheckRun.unit_id == unit_id, CheckRun.period == period,
                                            CheckRun.kind == "declarations")
                     .order_by(CheckRun.created_at.desc(), CheckRun.id.desc()))
    values = {
        "procurement_flags_reviewed": (sum(f.status in done for f in procurement), len(procurement),
                                       {"dismissed": sum(f.status == "dismissed" for f in procurement)}),
        "coi_reviewed": (sum(f.status in done for f in coi), len(coi),
                         {"dismissed": sum(f.status == "dismissed" for f in coi)}),
        "declarations_on_time": (
            last.extra.get("on_time", 0) if last else 0,
            last.extra.get("on_time", 0) + last.extra.get("late", 0) if last else 0,
            {"unknown": last.extra.get("unknown", 0)} if last else {}),
    }
    out = []
    for indicator, (num, den, extra_counts) in values.items():
        # Якщо власником факту в цьому розгортанні призначено іншу систему (FACT_OWNERS), модуль його не пише.
        owner = fact_registry.may_write(indicator, "checks")
        if den > 0 and owner:
            _upsert(db, unit_id, period, indicator, num, den, "Модуль «Перевірки»", extra_counts)
        out.append({"indicator": indicator, "numerator": num, "denominator": den, "written": den > 0 and owner,
                    **({} if owner else {"skipped": "not_fact_owner"})})
    db.flush()
    return out


# ---------- Синтетичні набори для демо ----------

def _seed(unit_id: uuid.UUID, period: str) -> random.Random:
    return random.Random(int(hashlib.sha256(f"{unit_id}:{period}".encode()).hexdigest()[:16], 16))


def _bid(n: int, amount: float, phone: str | None = None, email: str | None = None, street: str | None = None,
         status: str = "active") -> dict:
    return {"bid_id": f"b{n}", "amount": round(amount, 2), "award_status": status,
            "bidder": {"edrpou": f"3{n:07d}", "name": ("ТОВ «Сонячний шлях»", "ТОВ «Нова вежа»", "ТОВ «Східний вітер»")[(n - 1) % 3],
                       "phone": phone or f"+38050000{n:04d}",
                       "email": email or f"office{n}@mail{n}.example.test",
                       "address": {"street": street or f"вул. Демо, {n}", "locality": "Київ"}}}


def mock_procurement(unit_id: uuid.UUID, period: str) -> list[dict]:
    rnd = _seed(unit_id, period)
    year, month = int(period[:4]), int(period[5:])
    kinds = ["clean", "single", "short", "phone", "near", "complaints", "changes", "limited", "not_cheapest",
             "clean", "email", "address", "clean", "split", "split", "split", "single", "clean"]
    rnd.shuffle(kinds)
    records = []
    for i, kind in enumerate(kinds[: rnd.randint(12, len(kinds))], 1):
        expected = float(rnd.choice([450_000, 900_000, 1_500_000, 3_000_000, 9_000_000]))
        day = rnd.randint(1, 27)
        if kind == "split":
            expected = float(rnd.randint(180_000, 195_000))
            day = 10 + i % 3
        start = date(year, month, day)
        days = 2 if kind == "short" else rnd.randint(16, 22)
        low = round(expected * rnd.uniform(0.85, 0.95), 2)
        bids = [_bid(1, low), _bid(2, low * 1.04), _bid(3, low * 1.08)]
        winner = bids[0]
        if kind == "single":
            bids, expected = bids[:1], max(expected, 3_000_000.0)
        elif kind == "phone":
            bids[1]["bidder"]["phone"] = bids[0]["bidder"]["phone"]
        elif kind == "email":
            bids[1]["bidder"]["email"] = bids[0]["bidder"]["email"]
        elif kind == "address":
            bids[1]["bidder"]["address"] = dict(bids[0]["bidder"]["address"])
        elif kind == "near":
            bids = bids[:2]
            bids[0]["amount"] = round(expected * 0.999, 2)
        elif kind == "not_cheapest":
            winner = bids[1]
            bids[0]["award_status"] = "unsuccessful"
        records.append({
            "record_id": f"UA-{year}-{month:02d}-{day:02d}-{i:06d}-a-L1",
            "procurement_method": "limited" if kind == "limited" else "open",
            "procurement_method_type": "negotiation" if kind == "limited" else "aboveThresholdUA",
            "category": "goods", "expected_value": expected, "currency": "UAH", "cpv": "30190000-7",
            "dates": {"created_at": start.isoformat(), "tender_start": start.isoformat(),
                      "tender_period_days": days},
            "buyer": {"edrpou": "00000001", "kind": "general"},
            "bids": bids,
            "winner": {"edrpou": winner["bidder"]["edrpou"], "amount": winner["amount"]},
            "contract": {"changes_count": 5 if kind == "changes" else 0},
            "complaints_count": 2 if kind == "complaints" else 0,
            "beneficiaries": [],
        })
    return records


def mock_declarations(unit_id: uuid.UUID, period: str) -> list[dict]:
    if DECLARATIONS_MOCK.exists():
        return json.loads(DECLARATIONS_MOCK.read_text(encoding="utf-8"))
    rnd = _seed(unit_id, period)
    year = default_year(period)
    return [{"declaration_id": f"mock_decl_{i:03d}", "declaration_type": 1, "declaration_year": year,
             "date": date(year + 1, 3, 1).replace(day=rnd.randint(1, 28)).isoformat() if rnd.random() < 0.8
             else date(year + 1, 4, rnd.randint(1, 28)).isoformat(), "data": None} for i in range(1, 11)]
