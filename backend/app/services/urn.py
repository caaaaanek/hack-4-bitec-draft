"""«Урна з трьома ключами»: ніхто сам не прочитає відповіді, навіть адміністратор БД і сервера.

1. Налаштування (чернетка): генерується пара ключів X25519 хвилі. Закритий ключ ділиться на 3 частини за
   схемою Шаміра «2 з 3» (поле за модулем простого 2^521 − 1) і стирається. Сервер зберігає лише
   відкритий ключ.
2. Кожен із трьох власників (уповноважений, внутрішній аудит, представник особового складу — Рекомендації
   включають «представників здобувачів освіти» до робочої групи) забирає свою частину один раз.
   Відкрити хвилю можна, лише коли всі три частини забрано: на сервері їх більше немає.
3. Відповіді в буфері шифруються відкритим ключем (ефемерний X25519 + HKDF-SHA256 + AES-GCM): розшифрувати
   їх без закритого ключа не може ніхто, навіть з ключем буфера POOL_ENCRYPTION_KEY і доступом до БД.
4. Закриття — «церемонія відкриття урни»: двоє з трьох власників надсилають свої частини, ключ
   відновлюється в пам'яті на час переносу буфера, після чого надіслані частини стираються.
   Автопілот хвилю з урною сам не закриє: лише кличе власників.

Ризик: якщо втрачено дві частини з трьох, відповіді хвилі не відновити (тому «2 з 3», а не «3 з 3»).
"""

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timezone

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.errors import ApiError
from app.models import Campaign, CampaignStatus, Notice, UrnShare, User

PRIME = 2 ** 521 - 1
THRESHOLD = 2
HOLDERS = 3
URN_FORMAT = 2
PREFIX = "urn1"


# ---------- Схема Шаміра ----------

def split(secret: int, n: int = HOLDERS, k: int = THRESHOLD) -> list[tuple[int, int]]:
    coeffs = [secret] + [secrets.randbelow(PRIME) for _ in range(k - 1)]
    return [(x, sum(c * pow(x, i, PRIME) for i, c in enumerate(coeffs)) % PRIME) for x in range(1, n + 1)]


def combine(shares: list[tuple[int, int]]) -> int:
    """Інтерполяція Лагранжа в точці 0."""
    total = 0
    for i, (xi, yi) in enumerate(shares):
        num, den = 1, 1
        for j, (xj, _) in enumerate(shares):
            if i != j:
                num = num * (-xj) % PRIME
                den = den * (xi - xj) % PRIME
        total = (total + yi * num * pow(den, -1, PRIME)) % PRIME
    return total


def fingerprint(public_b64: str) -> str:
    return hashlib.sha256(public_b64.encode()).hexdigest()[:12]


def encode_share(x: int, y: int, public_b64: str) -> str:
    return f"{PREFIX}:{fingerprint(public_b64)}:{x}:{y:x}"


def decode_share(text: str, public_b64: str) -> tuple[int, int]:
    try:
        prefix, fp, x, y = text.strip().split(":")
        if prefix != PREFIX:
            raise ValueError
        if fp != fingerprint(public_b64):
            raise ApiError(422, "Ця частина ключа належить іншій хвилі", code="urn_wrong_share")
        return int(x), int(y, 16)
    except ApiError:
        raise
    except (ValueError, TypeError):
        raise ApiError(422, "Частина ключа пошкоджена", code="urn_bad_share",
                       hint="Скопіюйте частину повністю, як вона була видана (urn1:…).")


# ---------- Шифрування відкритим ключем ----------

def _kdf(shared: bytes, ephemeral: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=ephemeral, info=b"integra-urn").derive(shared)


def raw_public(key: X25519PublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def seal(payload: dict, public_b64: str) -> dict:
    eph = X25519PrivateKey.generate()
    eph_pub = raw_public(eph.public_key())
    key = _kdf(eph.exchange(X25519PublicKey.from_public_bytes(base64.b64decode(public_b64))), eph_pub)
    nonce = os.urandom(12)
    data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    ct = AESGCM(key).encrypt(nonce, data, b"urn")
    return {"v": URN_FORMAT, "e": base64.b64encode(eph_pub).decode(), "n": base64.b64encode(nonce).decode(),
            "c": base64.b64encode(ct).decode()}


def unseal(box: dict, private_raw: bytes) -> dict:
    eph_pub = base64.b64decode(box["e"])
    priv = X25519PrivateKey.from_private_bytes(private_raw)
    key = _kdf(priv.exchange(X25519PublicKey.from_public_bytes(eph_pub)), eph_pub)
    return json.loads(AESGCM(key).decrypt(base64.b64decode(box["n"]), base64.b64decode(box["c"]), b"urn"))


# ---------- Життєвий цикл ----------

def shares_of(db: Session, campaign: Campaign) -> list[UrnShare]:
    return list(db.scalars(select(UrnShare).where(UrnShare.campaign_id == campaign.id).order_by(UrnShare.x)))


def setup(db: Session, campaign: Campaign, holders: list[User], actor: User) -> None:
    if campaign.status != CampaignStatus.DRAFT:
        raise ApiError(409, "Урну налаштовують лише в чернетці", code="not_draft")
    if len({h.id for h in holders}) != HOLDERS or any(not h.is_active for h in holders):
        raise ApiError(422, f"Потрібно {HOLDERS} різні активні власники частин ключа", code="urn_holders")
    for row in shares_of(db, campaign):
        db.delete(row)
    db.flush()
    private = X25519PrivateKey.generate()
    private_raw = private.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                        serialization.NoEncryption())
    public_b64 = base64.b64encode(raw_public(private.public_key())).decode()
    for holder, (x, y) in zip(holders, split(int.from_bytes(private_raw, "big"))):
        db.add(UrnShare(campaign_id=campaign.id, holder_id=holder.id, x=x, share=encode_share(x, y, public_b64)))
    del private, private_raw  # закритий ключ ніде не зберігається
    campaign.urn_enabled = True
    campaign.urn_public_key = public_b64
    campaign.urn_close_requested = False
    log_action(db, actor, "urn_setup", "campaign", campaign.id,
               {"holders": [str(h.id) for h in holders], "fingerprint": fingerprint(public_b64)})


def disable(db: Session, campaign: Campaign, actor: User) -> None:
    if campaign.status != CampaignStatus.DRAFT:
        raise ApiError(409, "Вимкнути урну можна лише в чернетці", code="not_draft")
    for row in shares_of(db, campaign):
        db.delete(row)
    campaign.urn_enabled = False
    campaign.urn_public_key = None
    log_action(db, actor, "urn_disable", "campaign", campaign.id, {})


def take_share(db: Session, campaign: Campaign, user: User) -> str:
    row = db.get(UrnShare, (campaign.id, user.id), with_for_update=True)
    if row is None:
        raise ApiError(403, "Ви не власник частини ключа цієї хвилі", code="urn_not_holder")
    if row.share is None:
        raise ApiError(409, "Частину вже видано. Повторно її не отримати", code="urn_taken",
                       hint="Якщо частину втрачено до відкриття, адміністратор налаштовує урну наново.")
    share = row.share
    row.share = None
    row.taken_at = datetime.now(timezone.utc)
    log_action(db, user, "urn_take_share", "campaign", campaign.id, {"x": row.x})
    return share


def check_ready(db: Session, campaign: Campaign) -> None:
    rows = shares_of(db, campaign)
    waiting = [r for r in rows if r.share is not None]
    if len(rows) != HOLDERS or waiting:
        raise ApiError(409, f"Урна не готова: частин ключа не забрали {len(waiting)} з {HOLDERS} власників",
                       code="urn_not_ready",
                       hint="Кожен власник забирає свою частину на екрані «Урна». Доки частина "
                            "на сервері, сервер міг би відновити ключ.")


def request_close(db: Session, campaign: Campaign, actor: User | None) -> None:
    if not campaign.urn_close_requested:
        campaign.urn_close_requested = True
        db.add(Notice(campaign_id=campaign.id, audience="admins", kind="urn_close",
                      title=f"Хвиля «{campaign.title}»: потрібні частини ключа урни",
                      body="Двоє з трьох власників вводять свої частини ключа на екрані «Урна», "
                           "і хвиля закривається."))
        log_action(db, actor, "urn_close_requested", "campaign", campaign.id, {})


def submit_share(db: Session, campaign: Campaign, user: User, text: str) -> dict:
    from app.services import lifecycle

    if campaign.status != CampaignStatus.OPEN or not campaign.urn_enabled:
        raise ApiError(409, "Хвиля не очікує частин ключа", code="urn_not_waiting")
    row = db.get(UrnShare, (campaign.id, user.id), with_for_update=True)
    if row is None:
        raise ApiError(403, "Ви не власник частини ключа цієї хвилі", code="urn_not_holder")
    x, y = decode_share(text, campaign.urn_public_key)
    if x != row.x:
        raise ApiError(422, "Це не ваша частина ключа", code="urn_wrong_share")
    row.submitted = f"{x}:{y:x}"
    row.submitted_at = datetime.now(timezone.utc)
    campaign.urn_close_requested = True
    log_action(db, user, "urn_submit_share", "campaign", campaign.id, {"x": x})
    submitted = [r for r in shares_of(db, campaign) if r.submitted]
    if len(submitted) < THRESHOLD:
        return {"status": "waiting", "submitted": len(submitted), "needed": THRESHOLD}
    points = [tuple(int(v, 16) if i else int(v) for i, v in enumerate(r.submitted.split(":"))) for r in submitted]
    secret = combine(points[:THRESHOLD])
    private_raw = secret.to_bytes(32, "big") if secret < 2 ** 256 else b""
    try:
        priv = X25519PrivateKey.from_private_bytes(private_raw)
        ok = base64.b64encode(raw_public(priv.public_key())).decode() == campaign.urn_public_key
    except ValueError:
        ok = False
    if not ok:
        for r in submitted:
            r.submitted = None
        raise ApiError(422, "Частини не відновили ключ хвилі", code="urn_mismatch",
                       hint="Хтось надіслав чужу чи змінену частину. Надішліть частини ще раз.")
    details = lifecycle.close_wave(db, campaign, user, via="urn", urn_key=private_raw)
    from app.services import autopilot  # уникаємо циклічного імпорту

    autopilot.after_close(db, campaign)
    for r in shares_of(db, campaign):
        r.submitted = None
        r.share = None
    del private_raw, secret
    return {"status": "closed", "submitted": len(submitted), "needed": THRESHOLD, **details}


def status_of(db: Session, campaign: Campaign) -> dict:
    rows = shares_of(db, campaign)
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_([r.holder_id for r in rows])))} if rows else {}
    return {
        # Назва й статус хвилі: власник-респондент не має доступу до GET /campaigns/{id} і не знав, для чого ключ.
        "campaign_title": campaign.title,
        "campaign_status": campaign.status.value,
        "submitted": sum(1 for r in rows if r.submitted),
        "enabled": campaign.urn_enabled,
        "fingerprint": fingerprint(campaign.urn_public_key) if campaign.urn_public_key else None,
        "threshold": THRESHOLD,
        "close_requested": campaign.urn_close_requested,
        "holders": [{"holder_id": str(r.holder_id), "display_name": users[r.holder_id].display_name
                     if r.holder_id in users else None, "x": r.x, "taken": r.share is None and r.taken_at is not None,
                     "submitted": bool(r.submitted)} for r in rows],
        "ready": len(rows) == HOLDERS and all(r.share is None for r in rows),
    }
