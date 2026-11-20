"""Якір журналу назовні: голова ланцюжка хешів регулярно виходить за межі БД (аудит 20.11, «Журнал без зовнішнього якоря»).

Хто має доступ до БД, може переписати весь ланцюжок разом із таблицею audit_anchors, і перевірка цього не помітить.
Тому раз на день (щоденний крок автопілота) або на вимогу (POST /admin/audit-log/export-anchor):

1. Ланцюжок перевіряється; пошкоджений не експортується, а повідомляє про проблему.
2. Голова (seq, hash, час) пишеться окремим JSON-файлом у AUDIT_ANCHOR_DIR: окремий том, змонтований лише на
   дописування (WORM, об'єктне сховище з блокуванням), під іншою людиною, ніж БД.
3. Якщо задано AUDIT_ANCHOR_TSA_URL, сервіс міток часу RFC 3161 підписує хеш голови: квитанція (.tsr) лягає поруч.
   Підробити її без ключа TSA неможливо, тож вона доводить, що журнал мав саме цю голову на цей момент.
4. Запис про експорт лягає в audit_anchors (accepted_by порожній — це автоматичний якір) і в журнал дій.

Без AUDIT_ANCHOR_DIR і AUDIT_ANCHOR_TSA_URL автоматичний експорт вимкнено; працює ручний якір аудитора, як і раніше.
"""

import json
import logging
import secrets
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlalchemy.orm import Session

from app.audit import log_action, verify_chain
from app.config import get_settings
from app.models import AuditAnchor

log = logging.getLogger("app.audit_anchor")

# OID sha256: 2.16.840.1.101.3.4.2.1
_SHA256_ALGORITHM = bytes.fromhex("300d06096086480165030402010500")
TSA_CONTENT_TYPE = "application/timestamp-query"


class AnchorError(Exception):
    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


def enabled() -> bool:
    s = get_settings()
    return bool(s.audit_anchor_dir or s.audit_anchor_tsa_url)


# ---------- RFC 3161: мінімальний DER без сторонніх бібліотек ----------

def _der(tag: int, body: bytes) -> bytes:
    n = len(body)
    if n < 0x80:
        length = bytes([n])
    else:
        raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
        length = bytes([0x80 | len(raw)]) + raw
    return bytes([tag]) + length + body


def _der_int(value: int) -> bytes:
    raw = value.to_bytes(max(1, (value.bit_length() + 8) // 8), "big")  # +8: старший біт 0, число додатне
    return _der(0x02, raw)


def timestamp_request(digest: bytes, nonce: int) -> bytes:
    """TimeStampReq (RFC 3161, 2.4.1): version 1, messageImprint (sha256, digest), nonce, certReq TRUE."""
    if len(digest) != 32:
        raise ValueError("Потрібен sha256-дайджест (32 байти)")
    imprint = _der(0x30, _SHA256_ALGORITHM + _der(0x04, digest))
    return _der(0x30, _der_int(1) + imprint + _der_int(nonce) + _der(0x01, b"\xff"))


def _read(data: bytes, pos: int) -> tuple[int, int, int]:
    """(тег, початок тіла, кінець тіла) елемента DER з позиції pos."""
    tag = data[pos]
    length = data[pos + 1]
    start = pos + 2
    if length & 0x80:
        count = length & 0x7F
        length = int.from_bytes(data[start:start + count], "big")
        start += count
    if start + length > len(data):
        raise ValueError("Обрізана відповідь DER")
    return tag, start, start + length


def response_status(data: bytes) -> int:
    """PKIStatus з TimeStampResp: 0 — granted, 1 — grantedWithMods, решта — відмова."""
    tag, start, _ = _read(data, 0)          # TimeStampResp ::= SEQUENCE
    if tag != 0x30:
        raise ValueError("Відповідь TSA не є SEQUENCE")
    tag, start, _ = _read(data, start)      # PKIStatusInfo ::= SEQUENCE
    if tag != 0x30:
        raise ValueError("Немає PKIStatusInfo")
    tag, start, end = _read(data, start)    # status INTEGER
    if tag != 0x02:
        raise ValueError("Немає PKIStatus")
    return int.from_bytes(data[start:end], "big")


def request_timestamp(url: str, digest: bytes, timeout: float = 10.0) -> bytes:
    nonce = secrets.randbits(63)
    r = httpx.post(url, content=timestamp_request(digest, nonce), headers={"Content-Type": TSA_CONTENT_TYPE},
                   timeout=timeout)
    if r.status_code != 200:
        raise AnchorError(f"TSA відповів {r.status_code}", "tsa_failed")
    try:
        status = response_status(r.content)
    except (ValueError, IndexError) as e:
        raise AnchorError(f"Незрозуміла відповідь TSA: {e}", "tsa_failed") from e
    if status not in (0, 1):
        raise AnchorError(f"TSA відмовив (PKIStatus {status})", "tsa_rejected")
    return r.content


# ---------- Експорт ----------

def export_head(db: Session, actor=None, reason: str = "auto") -> AuditAnchor:
    """Експортує голову ланцюжка у файл і/або в TSA. Комітить той, хто викликав."""
    s = get_settings()
    if not enabled():
        raise AnchorError("Автоматичний якір вимкнено: задайте AUDIT_ANCHOR_DIR і/або AUDIT_ANCHOR_TSA_URL",
                          "anchor_disabled")
    chain = verify_chain(db)
    if not chain["ok"]:
        raise AnchorError("Журнал пошкоджено: " + (chain["reason"] or ""), "chain_broken")
    seq, head = chain["checked"], chain["head_hash"] or "0" * 64
    at = datetime.now(timezone.utc)
    record = {"seq": seq, "hash": head, "at": at.isoformat(), "reason": reason}
    stamp = f"{at:%Y%m%dT%H%M%SZ}-{seq:08d}"
    places = []
    if s.audit_anchor_dir:
        folder = Path(s.audit_anchor_dir)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"anchor-{stamp}.json"
        # «x»: файл не перезаписується; на томі лише для дописування інакше й не можна.
        with path.open("x", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False)
        places.append(f"file:{path.name}")
    if s.audit_anchor_tsa_url:
        token = request_timestamp(s.audit_anchor_tsa_url, bytes.fromhex(head))
        if s.audit_anchor_dir:
            (Path(s.audit_anchor_dir) / f"anchor-{stamp}.tsr").write_bytes(token)
        places.append(f"tsa:{len(token)}B")
    kind = "вручну" if reason == "manual" else "щоденний"
    anchor = AuditAnchor(seq=seq, hash=head, accepted_by_id=None,
                         note=f"Якір назовні ({kind}): " + ", ".join(places))
    db.add(anchor)
    db.flush()
    log_action(db, actor, "export_anchor", "audit_log", None, {"seq": seq, "hash": head, "to": places})
    return anchor


def daily_export(db: Session) -> str | None:
    """Щоденний крок автопілота. Помилку повертає текстом, щоб вона потрапила в підсумок, але не ламала крок."""
    if not enabled():
        return None
    try:
        anchor = export_head(db)
        return f"якір журналу №{anchor.seq} експортовано"
    except (AnchorError, OSError, httpx.HTTPError) as e:
        log.exception("audit anchor: експорт")
        return f"якір журналу не експортовано: {e}"
