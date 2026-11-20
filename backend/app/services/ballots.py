"""«Анонімність, яку можна перевірити»: вхід за логіном → жетон зі сліпим підписом → відповідь без сесії →
квитанція.

1. Учасник входить і отримує відкритий ключ групи (GET .../ballot-key): RSA-ключ хвилі, анкети й підрозділу.
2. Браузер генерує випадковий nonce, рахує m = H(nonce) і «засліплює» його: m' = m · rᵉ mod n.
   Сервер бачить лише m' і підписує його (POST .../ballot): s' = m'ᵈ. У цей момент записується участь
   (хто) — щоб не видати другий жетон. Що підписано, сервер не знає.
3. Браузер знімає засліплення: s = s' · r⁻¹ = mᵈ. Тепер (nonce, s) — дійсний жетон, який сервер ніколи
   не бачив і не може пов'язати з людиною.
4. Відповідь надсилається без входу (POST /respond/ballot) з жетоном. Сервер перевіряє sᵉ = H(nonce),
   записує квитанцію sha256(nonce) як використану й кладе відповідь у буфер — без користувача й часу.
5. Після закриття хвилі учасник за квитанцією перевіряє, що його відповідь урахована
   (GET /respond/receipts/{квитанція}), а список усіх квитанцій хвилі публікується.

Для анонімності самого факту участі, як і раніше, — QR чи одноразові посилання; жетон закриває інше:
навіть адміністратор БД з ключем буфера не зіставить відповідь з участю, бо між ними немає нічого спільного.
"""

import base64
import hashlib
import json
import os
import uuid

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import BlindKey, Campaign, Questionnaire, SpentBallot
from app.services.anonymity import _key

KEY_BITS = 2048
DOMAIN = b"integra-ballot-v1"


def message_int(nonce: bytes, n: int) -> int:
    """Full-domain hash: SHA-512 з лічильником, доки не набереться довжина модуля."""
    size = (n.bit_length() + 7) // 8
    out = b""
    counter = 0
    while len(out) < size:
        out += hashlib.sha512(DOMAIN + counter.to_bytes(4, "big") + nonce).digest()
        counter += 1
    return int.from_bytes(out[:size], "big") % n


def receipt_of(nonce: bytes) -> str:
    return hashlib.sha256(DOMAIN + nonce).hexdigest()


def _seal_d(d: int) -> dict:
    nonce = os.urandom(12)
    ct = AESGCM(_key()).encrypt(nonce, json.dumps({"d": format(d, "x")}).encode(), b"blind_key")
    return {"n": base64.b64encode(nonce).decode(), "c": base64.b64encode(ct).decode()}


def _unseal_d(box: dict) -> int:
    data = AESGCM(_key()).decrypt(base64.b64decode(box["n"]), base64.b64decode(box["c"]), b"blind_key")
    return int(json.loads(data)["d"], 16)


def _group(campaign_id: uuid.UUID, questionnaire_id: uuid.UUID, unit_id: uuid.UUID | None):
    return (BlindKey.campaign_id == campaign_id, BlindKey.questionnaire_id == questionnaire_id,
            BlindKey.unit_id.is_(None) if unit_id is None else BlindKey.unit_id == unit_id)


def key_for(db: Session, campaign: Campaign, questionnaire: Questionnaire, unit_id: uuid.UUID | None) -> BlindKey:
    # Два перші звернення групи одночасно: для підрозділу друге впирається в унікальність (раніше — 409
    # «запит двічі»), тож беремо вже створений ключ. Для групи без підрозділу (експерти) NULL унікальність
    # не перевіряє, і ключів може стати два: порядок сталий, а підписують ключем, який назвав клієнт (group_key).
    query = select(BlindKey).where(*_group(campaign.id, questionnaire.id, unit_id)).order_by(BlindKey.id)
    row = db.scalars(query).first()
    if row is not None:
        return row
    private = rsa.generate_private_key(public_exponent=65537, key_size=KEY_BITS)
    numbers = private.private_numbers()
    row = BlindKey(campaign_id=campaign.id, questionnaire_id=questionnaire.id, unit_id=unit_id,
                   n=format(numbers.public_numbers.n, "x"), e=numbers.public_numbers.e, sealed_d=_seal_d(numbers.d))
    try:
        with db.begin_nested():
            db.add(row)
    except IntegrityError:
        existing = db.scalars(query).first()
        if existing is None:
            raise
        return existing
    return row


def group_key(db: Session, key_id: uuid.UUID, campaign: Campaign, questionnaire: Questionnaire,
              unit_id: uuid.UUID | None) -> BlindKey | None:
    """Ключ key_id, лише якщо він належить групі учасника (хвиля, анкета, підрозділ)."""
    return db.scalar(select(BlindKey).where(BlindKey.id == key_id, *_group(campaign.id, questionnaire.id, unit_id)))


def sign_blinded(key: BlindKey, blinded_hex: str) -> str:
    n = int(key.n, 16)
    blinded = int(blinded_hex, 16)
    if not 1 < blinded < n:
        raise ValueError("Засліплене повідомлення поза межами модуля")
    return format(pow(blinded, _unseal_d(key.sealed_d), n), "x")


def verify(key: BlindKey, nonce: bytes, signature_hex: str) -> bool:
    n = int(key.n, 16)
    try:
        s = int(signature_hex, 16)
    except ValueError:
        return False
    return 0 < s < n and pow(s, key.e, n) == message_int(nonce, n)


def spend(db: Session, key: BlindKey, nonce: bytes) -> str | None:
    """Записує квитанцію як використану. None — цей жетон уже використано."""
    receipt = receipt_of(nonce)
    exists = db.scalar(select(SpentBallot.id).where(SpentBallot.campaign_id == key.campaign_id,
                                                    SpentBallot.questionnaire_id == key.questionnaire_id,
                                                    SpentBallot.receipt == receipt))
    if exists is not None:
        return None
    db.add(SpentBallot(campaign_id=key.campaign_id, questionnaire_id=key.questionnaire_id, receipt=receipt,
                       unit_id=key.unit_id))
    return receipt


# ---------- Клієнтська частина (для тестів і скриптів; у браузері те саме робить фронтенд) ----------

def client_blind(n: int, e: int, nonce: bytes) -> tuple[int, int]:
    """(засліплене повідомлення, r)."""
    import secrets
    from math import gcd

    m = message_int(nonce, n)
    while True:
        r = secrets.randbelow(n - 2) + 2
        if gcd(r, n) == 1:
            return (m * pow(r, e, n)) % n, r


def client_unblind(n: int, blinded_signature: int, r: int) -> int:
    return (blinded_signature * pow(r, -1, n)) % n
