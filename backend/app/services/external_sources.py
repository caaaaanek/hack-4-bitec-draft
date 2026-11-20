"""Живі вибірки з відкритих API (Prozorro, НАЗК) для модуля «Перевірки».

Лише читання й нормалізація до формату контракту, без запису файлів. Мережа зібрана в одній
функції `get_json`, щоб її можна було підмінити в тестах. З відповіді НАЗК беруться тільки
id, тип, рік і дата декларації: ПІБ та інше відкидаються одразу.
"""

import re
from datetime import datetime, timezone

import httpx

PROZORRO_API = "https://public-api.prozorro.gov.ua/api/2.5"
NAZK_API = "https://public-api.nazk.gov.ua/v2"
TIMEOUT_SECONDS = 10.0
MAX_LIMIT = 50
SCHEMA_VERSION = "1.2"

# Процедури без конкуренції: bids немає, учасник = постачальник з award.
LIMITED_TYPES = {"reporting", "negotiation", "negotiation.quick"}
AWARD_PRIORITY = {"active": 4, "unsuccessful": 3, "pending": 2, "cancelled": 1}


class ExternalSourceError(Exception):
    """Зовнішнє джерело недоступне або віддало нерозбірливу відповідь."""


def get_json(url: str, params: dict | None = None) -> dict:
    try:
        r = httpx.get(url, params=params, timeout=TIMEOUT_SECONDS, headers={"User-Agent": "imd-checks/1.0"})
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise ExternalSourceError(f"Зовнішнє джерело не відповіло ({type(e).__name__})") from e
    if not isinstance(data, dict):
        raise ExternalSourceError("Зовнішнє джерело віддало неочікувану відповідь")
    return data


# ---------- Prozorro ----------

def _amount(value) -> float | None:
    if not isinstance(value, dict) or value.get("amount") is None:
        return None
    try:
        return float(value["amount"])
    except (TypeError, ValueError):
        return None


def _parse_date(s):
    try:
        dt = datetime.fromisoformat(s) if isinstance(s, str) and s else None
    except ValueError:
        return None
    # Дата з поясом і без нього не віднімаються (TypeError): наївну вважаємо UTC.
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def _days_between(start, end):
    a, b = _parse_date(start), _parse_date(end)
    return round((b - a).total_seconds() / 86400) if a and b else None


def _normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10 and digits.startswith("0"):
        digits = "38" + digits
    return "+" + digits if len(digits) == 12 and digits.startswith("380") else (raw.strip() or None)


def _org_to_bidder(org) -> dict:
    org = org or {}
    addr = org.get("address") or {}
    cp = org.get("contactPoint") or {}
    phones = []
    for chunk in re.split(r"[,;]", cp.get("telephone") or ""):
        phone = _normalize_phone(chunk) if chunk.strip() else None
        if phone and phone not in phones:
            phones.append(phone)
    return {
        "name": org.get("name") or (org.get("identifier") or {}).get("legalName"),
        "edrpou": str((org.get("identifier") or {}).get("id") or "") or None,
        "address": {"street": addr.get("streetAddress"), "locality": addr.get("locality"),
                    "region": addr.get("region"), "postal_code": addr.get("postalCode")},
        "phone": phones[0] if phones else None,
        "phones": phones,
        "email": cp["email"].strip().lower() if cp.get("email") else None,
    }


def normalize_tender(tender: dict) -> list[dict]:
    """Один тендер Prozorro -> записи за контрактом (1 запис = 1 лот)."""
    t = tender
    pe = t.get("procuringEntity") or {}
    lots = [lot for lot in (t.get("lots") or []) if lot.get("status") != "cancelled"] or [None]
    period = t.get("tenderPeriod") or {}
    records = []
    for lot in lots:
        lot_id = lot["id"] if lot else None
        awards = [a for a in (t.get("awards") or []) if not lot_id or a.get("lotID") == lot_id]
        award_by_bid: dict = {}
        for a in awards:
            bid_id = a.get("bid_id")
            if bid_id and AWARD_PRIORITY.get(a.get("status"), 0) > AWARD_PRIORITY.get(award_by_bid.get(bid_id), -1):
                award_by_bid[bid_id] = a.get("status")
        active = next((a for a in awards if a.get("status") == "active"), None)
        winner = None
        if active:
            supplier = (active.get("suppliers") or [{}])[0]
            winner = {"edrpou": str((supplier.get("identifier") or {}).get("id") or "") or None,
                      "amount": _amount(active.get("value"))}
        bids = []
        for b in t.get("bids") or []:
            if b.get("status") not in (None, "active"):
                continue
            if lot_id:
                lv = next((v for v in (b.get("lotValues") or []) if v.get("relatedLot") == lot_id), None)
                if not lv:
                    continue
                amount = _amount(lv.get("value"))
            else:
                amount = _amount(b.get("value"))
            bids.append({"bid_id": b.get("id"), "bidder": _org_to_bidder((b.get("tenderers") or [{}])[0]),
                         "amount": amount, "award_status": award_by_bid.get(b.get("id"))})
        if not bids and active and t.get("procurementMethodType") in LIMITED_TYPES:
            bids.append({"bid_id": f"award-{active.get('id')}",
                         "bidder": _org_to_bidder((active.get("suppliers") or [{}])[0]),
                         "amount": _amount(active.get("value")), "award_status": "active"})
        contract = None
        if active:
            c = next((c for c in (t.get("contracts") or [])
                      if c.get("awardID") == active.get("id") and c.get("status") in ("active", "terminated")), None)
            if c:
                # Додаткові угоди є лише в API контрактів: тут не тягнемо, тож changes_count невідомий.
                contract = {"amount": _amount(c.get("value")), "signed_at": None, "changes_count": None}
        expected = _amount(lot.get("value")) if lot else None
        if expected is None:
            expected = _amount(t.get("value"))
        cpv = next(((it.get("classification") or {}).get("id") for it in t.get("items") or []
                    if (not lot_id or it.get("relatedLot") == lot_id) and (it.get("classification") or {}).get("id")), None)
        records.append({
            "schema_version": SCHEMA_VERSION,
            "source": "prozorro",
            "record_id": f"{t.get('id')}:{lot_id}" if lot_id else f"{t.get('id')}",
            "tender_id": t.get("tenderID"),
            "category": t.get("mainProcurementCategory"),
            "cpv": cpv,
            "procurement_method": t.get("procurementMethod"),
            "procurement_method_type": t.get("procurementMethodType"),
            "buyer": {"name": pe.get("name"), "edrpou": str((pe.get("identifier") or {}).get("id") or "") or None,
                      "region": (pe.get("address") or {}).get("region"), "kind": pe.get("kind")},
            "expected_value": expected,
            "currency": ((lot or {}).get("value") or t.get("value") or {}).get("currency"),
            "dates": {"created_at": t.get("dateCreated") or t.get("date"), "tender_start": period.get("startDate"),
                      "tender_end": period.get("endDate"),
                      "tender_period_days": _days_between(period.get("startDate"), period.get("endDate"))},
            "bids": bids,
            "winner": winner,
            "contract": contract,
            "complaints_count": len(t.get("complaints") or []),
            "beneficiaries": None,
        })
    return records


def fetch_prozorro(limit: int) -> list[dict]:
    """Останні завершені тендери (до limit штук) у форматі контракту. Окремий збійний тендер пропускається."""
    limit = max(1, min(limit, MAX_LIMIT))
    feed = get_json(f"{PROZORRO_API}/tenders",
                    {"descending": 1, "limit": min(limit * 2, 100), "opt_fields": "status,procurementMethodType"})
    ids = [i["id"] for i in feed.get("data") or []
           if isinstance(i, dict) and i.get("id") and i.get("status") == "complete"
           and i.get("procurementMethodType") not in LIMITED_TYPES][:limit]
    records: list[dict] = []
    for tender_id in ids:
        try:
            tender = get_json(f"{PROZORRO_API}/tenders/{tender_id}").get("data")
        except ExternalSourceError:
            continue
        if isinstance(tender, dict):
            try:
                records.extend(normalize_tender(tender))
            except (AttributeError, KeyError, TypeError, ValueError, IndexError):
                continue  # нерозбірлива структура одного тендера не має валити весь запуск (502/500)
    return records


# ---------- НАЗК ----------

def fetch_nazk(limit: int, year: int | None = None, declaration_type: int | None = None) -> list[dict]:
    """Список декларацій НАЗК у форматі контракту. Береться лише id, тип, рік і дата (ПІБ відкидається одразу)."""
    limit = max(1, min(limit, MAX_LIMIT))
    params: dict = {"page": 1}
    if year:
        params["declaration_year"] = year
    if declaration_type:
        params["declaration_type"] = declaration_type
    payload = get_json(f"{NAZK_API}/documents/list", params)
    rows = payload.get("data") or payload.get("items") or []
    items = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not row.get("id") or row.get("declaration_type") not in (1, 2, 3, 4):
            continue
        items.append({"declaration_id": str(row["id"]), "declaration_type": row["declaration_type"],
                      "declaration_year": row.get("declaration_year"), "date": (row.get("date") or "")[:10] or None,
                      "data": None})
        if len(items) == limit:
            break
    return items
