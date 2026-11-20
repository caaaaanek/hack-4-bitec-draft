"""Реєстр корупційних ризиків закладу. Це документ закладу, а не система: його імпортують таблицею (CSV),
кожен ризик прив'язується до компонента індексу і до заходу трекера.

CSV (UTF-8, «,» або «;»): code,title,component[,likelihood,impact,measure,owner,status]
- component: culture | system | accountability;
- likelihood, impact: 1-5 (необов'язково);
- measure: назва заходу трекера цього підрозділу (зв'язок за назвою) або текст заходу;
- owner: посада, не ПІБ; status: open | mitigated | accepted.
Імпорт «усе або нічого», повторний імпорт оновлює ризики за code.
"""

import csv
import io
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.errors import ApiError
from app.models import Measure, RiskRegisterItem, Role, Unit, User
from app.routers.measures import PERSON_NAME
from app.security import RESULT_READERS, ensure_unit_access, record_view, require_roles, visible_unit_filter
from app.services import methodology as m
from app.services.units import subtree_ids

router = APIRouter(tags=["risks"])
MAX_BYTES = 512 * 1024
STATUSES = ("open", "mitigated", "accepted")


def to_out(r: RiskRegisterItem) -> dict:
    return {"id": str(r.id), "code": r.code, "title": r.title, "component": r.component,
            "component_title": m.COMPONENTS.get(r.component, {}).get("title"), "likelihood": r.likelihood,
            "impact": r.impact, "score": (r.likelihood or 0) * (r.impact or 0) or None,
            "measure_id": str(r.measure_id) if r.measure_id else None, "measure_title": r.measure_title,
            "owner": r.owner, "status": r.status}


@router.get("/units/{unit_id}/risk-register")
def list_risks(unit_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_roles(*RESULT_READERS))):
    """Ризики підрозділу, від найвищого балу (ймовірність × вплив). Зведення по компонентах.

    Департамент — лише читання реєстрів своїх закладів (заклад і його підрозділи), хоча результати він бачить
    лише на рівні закладу. Імпорт — як і раніше, лише уповноважений.
    """
    if db.get(Unit, unit_id) is None:
        raise HTTPException(status_code=404, detail="Підрозділ не знайдено")
    if user.role == Role.DEPARTMENT:
        visible = visible_unit_filter(db, user)
        if visible is not None and unit_id not in visible:
            raise HTTPException(status_code=403, detail="Заклад поза зоною Департаменту")
        record_view(db, user, unit_id, None, None)
    else:
        ensure_unit_access(db, user, unit_id)
    rows = [to_out(r) for r in db.scalars(select(RiskRegisterItem).where(RiskRegisterItem.unit_id == unit_id))]
    rows.sort(key=lambda r: (-(r["score"] or 0), r["code"]))
    by_component = {c: {"total": 0, "open": 0, "without_measure": 0} for c in m.COMPONENTS}
    for r in rows:
        if r["component"] in by_component:
            item = by_component[r["component"]]
            item["total"] += 1
            item["open"] += r["status"] == "open"
            item["without_measure"] += not (r["measure_id"] or r["measure_title"])
    return {"unit_id": str(unit_id), "items": rows, "by_component": by_component}


def _int(value: str, n: int, field: str, issues: list) -> int | None:
    if not value:
        return None
    try:
        x = int(value)
    except ValueError:
        x = 0
    if not 1 <= x <= 5:
        issues.append({"path": f"line {n}", "message": f"{field}: ціле від 1 до 5"})
        return None
    return x


@router.post("/units/{unit_id}/risk-register/import")
def import_risks(unit_id: uuid.UUID, file: UploadFile = File(...), db: Session = Depends(get_db),
                 user: User = Depends(require_roles(Role.ADMIN))) -> dict:
    if db.get(Unit, unit_id) is None:
        raise HTTPException(status_code=404, detail="Підрозділ не знайдено")
    # Уповноважений зі своєю зоною імпортує ризики лише своїх підрозділів.
    ensure_unit_access(db, user, unit_id, "manage")
    raw = file.file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ApiError(413, "Файл завеликий (до 512 КБ)")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ApiError(422, "Файл має бути в кодуванні UTF-8", code="bad_encoding")
    try:
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    header = {(h or "").strip().lower() for h in reader.fieldnames or []}
    if not {"code", "title", "component"} <= header:
        raise ApiError(422, "Потрібні стовпці code, title, component", code="bad_header")
    measures = {mm.title.strip().lower(): mm for mm in db.scalars(
        select(Measure).where(Measure.unit_id.in_(subtree_ids(db, unit_id))))}
    issues, parsed = [], []
    for n, row in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if k}
        code, title, component = row.get("code", ""), row.get("title", ""), row.get("component", "")
        if not code or not title:
            issues.append({"path": f"line {n}", "message": "code і title обов'язкові"})
            continue
        if component not in m.COMPONENTS:
            issues.append({"path": f"line {n}", "message": f"component: {', '.join(m.COMPONENTS)}"})
            continue
        status = row.get("status") or "open"
        if status not in STATUSES:
            issues.append({"path": f"line {n}", "message": f"status: {', '.join(STATUSES)}"})
            continue
        owner = row.get("owner", "")
        if owner and PERSON_NAME.search(owner):
            issues.append({"path": f"line {n}", "message": "owner: посада, а не ПІБ"})
            continue
        likelihood = _int(row.get("likelihood", ""), n, "likelihood", issues)
        impact = _int(row.get("impact", ""), n, "impact", issues)
        measure_text = row.get("measure", "")
        parsed.append((code[:64], title, component, likelihood, impact, measures.get(measure_text.lower()),
                       measure_text, owner[:200], status))
    if issues:
        raise ApiError(422, issues, code="import_failed", hint="Нічого не змінено.")
    existing = {r.code: r for r in db.scalars(select(RiskRegisterItem).where(RiskRegisterItem.unit_id == unit_id))}
    created = updated = linked = 0
    for code, title, component, likelihood, impact, measure, measure_text, owner, status in parsed:
        row = existing.get(code)
        if row is None:
            row = RiskRegisterItem(unit_id=unit_id, code=code)
            db.add(row)
            existing[code] = row  # повтор коду у файлі оновлює той самий ризик, а не створює дубль
            created += 1
        else:
            updated += 1
        row.title, row.component, row.likelihood, row.impact = title, component, likelihood, impact
        row.measure_id = measure.id if measure else None
        row.measure_title = measure.title if measure else measure_text
        row.owner, row.status = owner, status
        linked += measure is not None
    log_action(db, user, "import_risks", "unit", unit_id, {"created": created, "updated": updated, "linked": linked})
    db.commit()
    return {"created": created, "updated": updated, "linked_to_measures": linked, "rows": len(parsed)}
