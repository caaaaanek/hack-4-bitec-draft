"""Відкриття й закриття хвилі. Спільне для кнопок адміністратора і автопілота (services/autopilot.py),
щоб обидва шляхи робили рівно те саме: фіксували склад, переносили буфер, знімали знімки, писали журнал.
"""

from sqlalchemy.orm import Session

from app.audit import log_action
from app.clock import today
from app.errors import ApiError
from app.models import AccessMode, Campaign, CampaignStatus, User
from app.services.anonymity import flush_all
from app.services.eligibility import freeze, participants_of
from app.services.results import create_snapshots


def open_wave(db: Session, campaign: Campaign, actor: User | None, via: str = "manual") -> dict:
    """actor None — система (автопілот). Не комітить."""
    if campaign.status != CampaignStatus.DRAFT:
        raise ApiError(409, "Відкрити можна лише хвилю в статусі чернетки")
    if campaign.explicit_participants and not participants_of(db, campaign):
        raise ApiError(409, "У хвилі явний склад учасників, але він порожній", code="no_participants",
                       hint="Додайте учасників або поверніться до складу за категорією й підрозділом.")
    campaign.status = CampaignStatus.OPEN
    campaign.opened_on = today()
    details: dict = {"via": via} if via != "manual" else {}
    if campaign.access_mode == AccessMode.LOGIN:
        # Склад фіксується: від нього рахується участь, і його не змінить блокування чи перенесення людей.
        details["eligible_frozen"] = freeze(db, campaign)
    log_action(db, actor, "open", "campaign", campaign.id, details)
    return details


def close_wave(db: Session, campaign: Campaign, actor: User | None, via: str = "manual") -> dict:
    """actor None — система (автопілот). Не комітить."""
    if campaign.status != CampaignStatus.OPEN:
        raise ApiError(409, "Закрити можна лише відкриту хвилю")
    campaign.status = CampaignStatus.CLOSED
    campaign.closed_on = today()
    # Зашифрований буфер переноситься в Response (перемішано, з узагальненими підрозділами) до розрахунку знімків.
    moved = flush_all(db, campaign)
    db.flush()
    # Знімок результатів фіксується в момент закриття і більше не змінюється.
    snapshots = create_snapshots(db, campaign)
    details = {"snapshots": snapshots, "responses_moved": moved}
    if via != "manual":
        details["via"] = via
    log_action(db, actor, "close", "campaign", campaign.id, details)
    return details
