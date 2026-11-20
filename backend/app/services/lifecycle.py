"""Відкриття й закриття хвилі. Спільне для кнопок адміністратора і автопілота (services/autopilot.py),
щоб обидва шляхи робили рівно те саме: фіксували склад, переносили буфер, знімали знімки, писали журнал.
"""

from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import today
from app.errors import ApiError
from app.models import AccessMode, Campaign, CampaignStatus, QuestionnaireKind, User
from app.services import approvals
from app.services import tokens as token_service
from app.services.anonymity import flush_all
from app.services.eligibility import freeze, frozen_of, participants_of
from app.services.results import create_snapshots


def group_sizes(db: Session, campaign: Campaign) -> dict:
    """Скільки людей має пройти кожну анкету (без чек-листа). None — кількість ще невідома
    (хвиля за посиланнями, посилань ще не видано)."""
    sizes: dict = {}
    frozen = frozen_of(db, campaign) if campaign.access_mode == AccessMode.LOGIN else None
    tokens = token_service.load(db, campaign.id) if campaign.access_mode == AccessMode.TOKEN else []
    qr = token_service.load_qr_links(db, campaign.id) if campaign.access_mode == AccessMode.TOKEN else []
    for link in campaign.questionnaire_links:
        q = link.questionnaire
        if q.kind == QuestionnaireKind.CHECKLIST:
            continue
        if frozen is not None:
            sizes[q] = len(frozen.get(q.id, {}))
        else:
            eligible, _ = token_service.counts(tokens, q.id, qr_links=qr)
            sizes[q] = eligible or None
    return sizes


def check_group_sizes(db: Session, campaign: Campaign) -> None:
    """Анкету, на яку загалом може відповісти менше k людей, не відкриваємо: її результати однаково будуть
    приховані, а з малою групою зростає ризик упізнати людину (docs/anonymity.md, залишкові ризики)."""
    small = [f"«{q.title}»: {n}" for q, n in group_sizes(db, campaign).items()
             if n is not None and n < campaign.min_group_size]
    if small:
        raise ApiError(409, f"У анкет менше k = {campaign.min_group_size} учасників: " + "; ".join(small),
                       code="group_too_small",
                       hint="Розширте область хвилі, додайте учасників або приберіть анкету з хвилі.")


def open_wave(db: Session, campaign: Campaign, actor: User | None, via: str = "manual") -> dict:
    """actor None — система (автопілот). Не комітить."""
    if campaign.status != CampaignStatus.DRAFT:
        raise ApiError(409, "Відкрити можна лише хвилю в статусі чернетки")
    if campaign.explicit_participants and not participants_of(db, campaign):
        raise ApiError(409, "У хвилі явний склад учасників, але він порожній", code="no_participants",
                       hint="Додайте учасників або поверніться до складу за категорією й підрозділом.")
    if campaign.urn_enabled:
        from app.services import urn

        urn.check_ready(db, campaign)
    if approvals.enabled() and via != "four_eyes" and not approvals.open_approved(db, campaign):
        raise ApiError(409, "Відкриття хвилі підтверджує друга людина", code="approval_required",
                       hint="Натисніть «Попросити відкрити хвилю»: відкриє її друга людина в «Запитах другій людині».")
    details: dict = {"via": via} if via != "manual" else {}
    if campaign.access_mode == AccessMode.LOGIN:
        # Склад фіксується (зазвичай уже при створенні): від нього рахується участь, і його не змінить
        # блокування чи перенесення людей. Для чернеток, створених до 0011, — тут.
        details["eligible_frozen"] = freeze(db, campaign)
    check_group_sizes(db, campaign)
    campaign.status = CampaignStatus.OPEN
    campaign.opened_on = today()
    log_action(db, actor, "open", "campaign", campaign.id, details)
    return details


def close_wave(db: Session, campaign: Campaign, actor: User | None, via: str = "manual",
               urn_key: bytes | None = None) -> dict:
    """actor None — система (автопілот). Не комітить.

    urn_key: закритий ключ «урни», відновлений з двох частин (services/urn.py). Без нього хвилю з урною
    закрити не можна: сервер ключа не має.
    """
    if campaign.status != CampaignStatus.OPEN:
        raise ApiError(409, "Закрити можна лише відкриту хвилю")
    if campaign.urn_enabled and urn_key is None:
        raise ApiError(409, "Відповіді в урні: потрібні частини ключа двох власників", code="urn_pending",
                       hint="Закриття чекає двох частин ключа. Власники вводять їх на екрані «Урна».")
    campaign.status = CampaignStatus.CLOSED
    campaign.closed_on = today()
    # Зашифрований буфер переноситься в Response (перемішано, з узагальненими підрозділами) до розрахунку знімків.
    moved = flush_all(db, campaign, urn_key)
    db.flush()
    # Знімок результатів фіксується в момент закриття і більше не змінюється.
    snapshots = create_snapshots(db, campaign)
    details = {"snapshots": snapshots, "responses_moved": moved}
    if via != "manual":
        details["via"] = via
    log_action(db, actor, "close", "campaign", campaign.id, details)
    return details
