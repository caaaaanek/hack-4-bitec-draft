"""Модуль «Перевірки»: закупівлі, декларації, конфлікти інтересів (контракт docs/contracts/checks.md).

У журнал дій потрапляють лише кількості й період, жодних даних записів.
"""

import re
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.db import get_db
from app.models import CheckFinding, CheckRun, Role, Unit, User
from app.routers.indicators import IntegrationActor, check_unit, integration_or_admin
from app.schemas_checks import (
    DeclarationsBody,
    DeclarationsRunIn,
    FetchIn,
    FindingOut,
    NazkFetchIn,
    ProcurementBody,
    ProcurementRunIn,
    PublishIn,
    PublishOut,
    ReviewIn,
    RunOut,
)
from app.security import require_roles, zone_of
from app.services import checks as svc
from app.services import counterparty
from app.services import external_sources as ext

router = APIRouter(prefix="/checks", tags=["checks"])
SOURCE = "checks"
FETCH_DISABLED = "Живі запити вимкнено: закритий контур"


def run_out(run: CheckRun) -> RunOut:
    return RunOut(run_id=run.id, kind=run.kind, unit_id=run.unit_id, period=run.period, source=run.source,
                  total=run.total, flagged=run.flagged, by_risk=run.by_risk, extra=run.extra,
                  created_at=run.created_at)


def runner(actor: IntegrationActor = Depends(integration_or_admin)) -> IntegrationActor:
    """Запуск може зробити адмін або система з ключем для джерела «checks»."""
    if not actor.any_source and actor.source != SOURCE:
        raise HTTPException(status_code=403, detail=f"Цей ключ дозволяє передавати лише джерело «{actor.source}»")
    return actor


def log_run(db: Session, actor: IntegrationActor, run: CheckRun, action: str = "run") -> None:
    log_action(db, actor.user, action, "check_run", run.id,
               {"kind": run.kind, "period": run.period, "source": run.source, "total": run.total,
                "flagged": run.flagged})


def require_fetch_enabled() -> None:
    if not get_settings().external_fetch_enabled:
        raise HTTPException(status_code=409, detail=FETCH_DISABLED)


def ensure_unit(db: Session, unit_id: uuid.UUID, actor: IntegrationActor) -> None:
    if actor.user:
        check_unit(db, unit_id, actor.user)
    elif db.get(Unit, unit_id) is None:
        raise HTTPException(status_code=422, detail="Підрозділ не знайдено")


@router.post("/procurement", response_model=RunOut, status_code=201)
def post_procurement(data: ProcurementRunIn, db: Session = Depends(get_db),
                     actor: IntegrationActor = Depends(runner)):
    """Приймає масив закупівель, рахує правила, зберігає знахідки."""
    ensure_unit(db, data.unit_id, actor)
    records = [r.model_dump(exclude_unset=True) for r in data.records]
    run = svc.run_procurement(db, actor.user, data.unit_id, data.period, data.source, records)
    log_run(db, actor, run)
    db.commit()
    return run_out(run)


@router.post("/declarations", response_model=RunOut, status_code=201)
def post_declarations(data: DeclarationsRunIn, db: Session = Depends(get_db),
                      actor: IntegrationActor = Depends(runner)):
    """Приймає масив декларацій, перевіряє строк і правила конфлікту інтересів."""
    ensure_unit(db, data.unit_id, actor)
    items = [i.model_dump() for i in data.items]
    run = svc.run_declarations(db, actor.user, data.unit_id, data.period, data.source, items, data.year)
    log_run(db, actor, run)
    db.commit()
    return run_out(run)


@router.get("/runs", response_model=list[RunOut])
def get_runs(unit_id: uuid.UUID | None = None, kind: Literal["procurement", "declarations"] | None = None,
             period: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
             limit: int = Query(default=100, ge=1, le=500),
             db: Session = Depends(get_db), user: User = Depends(require_roles(Role.ADMIN))):
    """Журнал запусків (уповноважений зі своєю зоною — лише підрозділи зони)."""
    if unit_id is not None:
        check_unit(db, unit_id, user)
    return [run_out(r) for r in svc.list_runs(db, unit_id, kind, period, limit, zone_of(db, user))]


@router.get("/findings", response_model=list[FindingOut])
def get_findings(run_id: uuid.UUID | None = None, unit_id: uuid.UUID | None = None,
                 kind: Literal["procurement", "declarations"] | None = None,
                 status: Literal["new", "reviewed", "dismissed"] | None = None,
                 risk_level: Literal["low", "medium", "high"] | None = None,
                 period: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
                 limit: int = Query(default=200, ge=1, le=1000), offset: int = Query(default=0, ge=0, le=10_000_000),
                 db: Session = Depends(get_db), user: User = Depends(require_roles(Role.ADMIN))):
    """Знахідки з фільтрами (уповноважений зі своєю зоною — лише підрозділи зони)."""
    if unit_id is not None:
        check_unit(db, unit_id, user)
    return svc.list_findings(db, run_id, kind, status, risk_level, unit_id, period, limit, offset, zone_of(db, user))


@router.post("/findings/{finding_id}/review", response_model=FindingOut)
def review(finding_id: uuid.UUID, data: ReviewIn, db: Session = Depends(get_db),
           user: User = Depends(require_roles(Role.ADMIN))):
    """Статус reviewed, dismissed або new плюс коментар."""
    finding = db.get(CheckFinding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Знахідку не знайдено")
    check_unit(db, finding.unit_id, user)
    svc.review_finding(db, finding, user, data.status, data.comment)
    log_action(db, user, "review", "check_finding", finding.id,
               {"kind": finding.kind, "period": finding.period, "status": data.status})
    db.commit()
    return finding


@router.post("/publish", response_model=PublishOut)
def publish(data: PublishIn, db: Session = Depends(get_db), user: User = Depends(require_roles(Role.ADMIN))):
    """Рахує X з Y і записує показники (source = checks). Повторний виклик перезаписує."""
    check_unit(db, data.unit_id, user)
    indicators = svc.publish(db, data.unit_id, data.period)
    log_action(db, user, "publish", "indicator", None,
               {"period": data.period, "unit_id": str(data.unit_id),
                "written": [i["indicator"] for i in indicators if i["written"]]})
    db.commit()
    return PublishOut(unit_id=data.unit_id, period=data.period, indicators=indicators)


@router.get("/mock/{kind}", response_model=ProcurementBody | DeclarationsBody)
def mock(kind: Literal["procurement", "declarations"], unit_id: uuid.UUID,
         period: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
         db: Session = Depends(get_db), user: User = Depends(require_roles(Role.ADMIN))):
    """Синтетичний набір для демо (детермінований за unit_id і period), придатний як тіло POST."""
    check_unit(db, unit_id, user)
    head = {"unit_id": unit_id, "period": period, "source": "mock"}
    if kind == "procurement":
        return {**head, "records": svc.mock_procurement(unit_id, period)}
    return {**head, "year": svc.default_year(period), "items": svc.mock_declarations(unit_id, period)}


@router.post("/fetch/prozorro", response_model=RunOut, status_code=201)
def fetch_prozorro(data: FetchIn, db: Session = Depends(get_db), user: User = Depends(require_roles(Role.ADMIN)),
                   _: None = Depends(require_fetch_enabled)):
    """Бере останні завершені тендери з відкритого API Prozorro й одразу запускає перевірку.

    Відповідь це RunOut, а не записи: назви й контакти учасників не повертаються.
    """
    check_unit(db, data.unit_id, user)
    try:
        records = ext.fetch_prozorro(data.limit)
    except ext.ExternalSourceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    run = svc.run_procurement(db, user, data.unit_id, data.period, "prozorro", records)
    log_action(db, user, "fetch", "check_run", run.id,
               {"source": "prozorro", "period": data.period, "limit": data.limit, "fetched": len(records)})
    db.commit()
    return run_out(run)


@router.post("/fetch/nazk", response_model=DeclarationsBody)
def fetch_nazk(data: NazkFetchIn, db: Session = Depends(get_db), user: User = Depends(require_roles(Role.ADMIN)),
               _: None = Depends(require_fetch_enabled)):
    """Бере список декларацій НАЗК (без ПІБ і повного тексту) як тіло для POST /checks/declarations."""
    check_unit(db, data.unit_id, user)
    year = data.year or svc.default_year(data.period)
    try:
        items = ext.fetch_nazk(data.limit, year, data.declaration_type)
    except ext.ExternalSourceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    log_action(db, user, "fetch", "check_run", None,
               {"source": "nazk", "period": data.period, "limit": data.limit, "fetched": len(items)})
    db.commit()
    return {"unit_id": data.unit_id, "period": data.period, "source": "nazk", "year": year, "items": items}


# ---------- Контрагенти (пункт 4.5.1 чек-листа) ----------

class CounterpartyIn(BaseModel):
    unit_id: uuid.UUID
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    edrpou: list[str] = Field(min_length=1, max_length=200, description="Коди ЄДРПОУ (8 цифр)")


@router.post("/counterparty", response_model=RunOut, status_code=201)
def check_counterparties(data: CounterpartyIn, db: Session = Depends(get_db),
                         user: User = Depends(require_roles(Role.ADMIN))):
    """Перевірити контрагентів: санкції, банкрутство, податковий борг, суди, «молода» компанія.

    Живий режим — COUNTERPARTY_API_URL/KEY і EXTERNAL_FETCH_ENABLED=true (Youcontrol чи аналог), інакше мок.
    Знахідки з ризиком потрапляють у GET /checks/findings і розглядаються як інші.
    """
    bad = [c for c in data.edrpou if not re.fullmatch(r"[0-9]{8}", c)]
    if bad:
        raise HTTPException(status_code=422, detail=f"ЄДРПОУ — 8 цифр: {', '.join(bad[:5])}")
    check_unit(db, data.unit_id, user)
    try:
        source, rows = counterparty.check(data.edrpou)
    except counterparty.CounterpartyError as e:
        raise HTTPException(status_code=502, detail=str(e))
    flagged = [r for r in rows if r["flags"]]
    by_risk: dict[str, int] = {}
    for r in flagged:
        by_risk[r["risk_level"]] = by_risk.get(r["risk_level"], 0) + 1
    run = CheckRun(kind="counterparty", unit_id=data.unit_id, period=data.period, source=source, total=len(rows),
                   flagged=len(flagged), by_risk=by_risk, extra={}, created_by_id=user.id)
    db.add(run)
    db.flush()
    for r in flagged:
        db.add(CheckFinding(run_id=run.id, kind="counterparty", unit_id=data.unit_id, period=data.period,
                            record_ref=f"ЄДРПОУ {r['edrpou']}", risk_level=r["risk_level"],
                            flags=[{"rule_id": f"counterparty.{f}", "severity": "high" if f in counterparty.HIGH
                                    else "medium", "title": counterparty.FLAG_TITLES[f],
                                    "law_refs": ["Рекомендації НУОУ, пункт 4.5.1 чек-листа"]} for f in r["flags"]]))
    log_run(db, IntegrationActor(user=user, any_source=True), run)
    db.commit()
    return run_out(run)
