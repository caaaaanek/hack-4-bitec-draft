"""Результати оцінювання: Integrity Index, знімки хвиль, динаміка, екран учасника."""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.errors import ApiError
from app.models import Campaign, CampaignStatus, IndexSnapshot, Role, Unit, User
from app.schemas import UnitOut
from app.schemas_results import BreakdownOut, CampaignResultsOut, CompareOut, HistoryOut, ParticipantResultOut
from app.routers.respond import TOKEN_HEADER, token_throttle
from app.security import (RESULT_READERS, campaign_visible, client_ip, ensure_unit_access, get_current_user,
                          require_roles, zone_of)
from app.services import categories, fact_registry, methodology, results, tokens
from app.services.eligibility import frozen_of, is_eligible, participants_of
from app.services.units import subtree_ids

router = APIRouter(tags=["results"])
can_view = require_roles(*RESULT_READERS)


@router.get("/methodology")
def get_methodology(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> dict:
    """Методика розрахунку: ваги, пороги, рівні, правила, ухвалені рішення. Доступна всім, хто увійшов.

    `source_weights` — вбудовані джерела (вага методики); `category_weights` — категорії з довідника, яким
    адміністратор задав вагу (без ваги категорія лише для порівняння).
    """
    fact_registry.refresh(db)
    data = methodology.as_dict()
    extra = {k: v for k, v in categories.weights(db).items() if k not in methodology.SOURCE_WEIGHTS}
    data["category_weights"] = extra
    data["categories"] = [{"code": c.code, "title": c.title, "builtin": c.builtin, "active": c.active,
                           "weight": methodology.SOURCE_WEIGHTS.get(c.code) if c.builtin else c.weight}
                          for c in categories.all_defs(db)]
    db.commit()
    return data


def closed_campaign(db: Session, campaign_id: uuid.UUID) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    if campaign.status != CampaignStatus.CLOSED:
        raise HTTPException(status_code=409, detail="Результати доступні після закриття хвилі")
    return campaign


@router.get("/campaigns/{campaign_id}/results", response_model=CampaignResultsOut)
def campaign_results(
    campaign_id: uuid.UUID,
    unit_id: uuid.UUID | None = None,
    recalculate: bool = Query(default=False, description="Перерахувати за поточною методикою (знімок не змінюється)"),
    db: Session = Depends(get_db),
    user: User = Depends(can_view),
):
    """Результати хвилі для всього підрозділу хвилі або для дочірнього (unit_id).

    За замовчуванням береться незмінний знімок, зроблений при закритті хвилі.
    """
    campaign = closed_campaign(db, campaign_id)
    ensure_unit_access(db, user, unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    try:
        data = results.results_for(db, campaign, unit_id, recalculate)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    db.commit()
    # Звичайні перегляди не журналюються: кожен запис блокує голову ланцюжка (AuditHead FOR UPDATE), і паралельні
    # читання ставали б у чергу, а журнал засмічувався б переглядами. Перерахунок за поточною методикою — дія, її пишемо.
    if recalculate:
        log_action(db, user, "recalculate_results", "campaign", campaign.id, {"unit_id": data["unit_id"]})
        db.commit()
    return results.present_flags(data)


@router.get("/campaigns/{campaign_id}/breakdown", response_model=BreakdownOut)
def campaign_breakdown(
    campaign_id: uuid.UUID,
    unit_id: uuid.UUID | None = None,
    source: str | None = Query(default=None, description="Категорія респондентів (working_group, staff, expert…)"),
    component: str | None = Query(default=None, description="Компонент: culture, system, accountability"),
    db: Session = Depends(get_db),
    user: User = Depends(can_view),
):
    """Деталізація «джерело → його питання» для «Розкладу індексу».

    Береться зі знімка хвилі, нічого не перераховується. Питання, на яке відповіли менше k людей, не
    показується зовсім (лише лічильник `hidden_questions`); група, менша за k, — без жодного питання.
    Без `source` — лише перелік джерел із кількістю питань.
    """
    campaign = closed_campaign(db, campaign_id)
    ensure_unit_access(db, user, unit_id or campaign.unit_id, campaign_id=campaign.id, root_id=campaign.unit_id)
    if component is not None and component not in methodology.COMPONENTS:
        raise ApiError(422, f"Невідомий компонент «{component}»", code="unknown_component",
                       hint="Можливо: " + ", ".join(methodology.COMPONENTS))
    try:
        data = results.results_for(db, campaign, unit_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    titles = categories.titles(db)
    db.commit()

    per_source: dict[str, list[dict]] = {}
    for q in data.get("questions", []):
        if component is not None and q["component"] != component:
            continue
        for b in q["by_category"]:
            per_source.setdefault(b["category"], []).append(
                {"code": q["code"], "text": q["text"], "section": q["section"], "component": q["component"],
                 "n": b["n"], "score": b["score"],
                 "zone": methodology.zone(b["score"]) if b["score"] is not None else None,
                 "distribution": b["distribution"]})
    groups = {g["category"]: g for g in data.get("groups", [])}
    sources = [{"category": c, "title": titles.get(c, c), "sufficient": g["sufficient"],
                "questions": len(per_source.get(c, [])), "hidden_questions": g.get("hidden_questions", 0)}
               for c, g in groups.items()]
    out = {"campaign_id": campaign.id, "unit_id": data["unit_id"], "unit_name": data["unit_name"],
           "min_group_size": data["min_group_size"], "sources": sources, "component": component}
    if source is None:
        return out
    group = groups.get(source)
    if group is None:
        raise ApiError(422, f"Джерела «{source}» у цій хвилі немає", code="unknown_source",
                       hint="Можливо: " + (", ".join(groups) or "—"))
    note = None
    if not group["sufficient"]:
        note = f"Відповідей менше за k = {data['min_group_size']}: питання цього джерела не показуються."
    elif group.get("hidden_questions"):
        note = (f"Ще {group['hidden_questions']} питань мають менше k = {data['min_group_size']} відповідей "
                "і не показуються.")
    return {**out, "source": source, "sufficient": group["sufficient"],
            "hidden_questions": group.get("hidden_questions", 0), "note": note,
            "questions": per_source.get(source, []) if group["sufficient"] else []}


@router.get("/units", response_model=list[UnitOut])
def list_units(db: Session = Depends(get_db), user: User = Depends(can_view)):
    """Дерево підрозділів (id, name, parent_id) для вибору області перегляду.

    Керівник, прив'язаний до підрозділу, бачить лише своє піддерево (як і в результатах). Уповноважений і аудит —
    лише свою зону: з цього ж списку обирається підрозділ нової хвилі.
    """
    query = select(Unit).order_by(Unit.name)
    zone = zone_of(db, user)
    if user.role == Role.LEADER and user.unit_id is not None:
        query = query.where(Unit.id.in_(subtree_ids(db, user.unit_id)))
    elif zone is not None:
        query = query.where(Unit.id.in_(zone))
    elif user.role == Role.DEPARTMENT and user.unit_id is not None:
        # Департамент зі своєю зоною: лише своє піддерево, а не назви всіх підрозділів.
        query = query.where(Unit.id.in_(subtree_ids(db, user.unit_id)))
    return db.scalars(query).all()


def unit_or_404(db: Session, unit_id: uuid.UUID, user: User | None = None) -> Unit:
    unit = db.get(Unit, unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Підрозділ не знайдено")
    if user is not None:
        ensure_unit_access(db, user, unit_id)
    return unit


@router.get("/units/{unit_id}/history", response_model=HistoryOut)
def unit_history(unit_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(can_view)):
    """Динаміка підрозділу за всі хвилі: лише порівняння із самим собою."""
    unit = unit_or_404(db, unit_id, user)
    db.commit()
    points = []
    previous = None
    subtree = results.unit_subtree(db, unit_id)  # дерево один раз на всю історію, а не на кожну точку
    for campaign, snap in results.unit_snapshots(db, unit_id):
        payload = snap.payload
        d = results.delta(snap.index_score, previous.index_score) if previous else None
        sig = methodology.significance(d, [previous.reliability, snap.reliability]) if previous else None
        points.append({
            "campaign_id": campaign.id,
            "campaign_title": campaign.title,
            "closed_on": snap.closed_on,
            "methodology_version": snap.methodology_version,
            "index": snap.index_score,
            "index_self": snap.index_self,
            "reliability": snap.reliability,
            "components": {c["code"]: c["score"] for c in payload["components"]},
            "measures_done": results.measures_done_between(
                db, unit_id, previous.closed_on if previous else None, snap.closed_on, subtree),
            "delta": d,
            "significance": sig,
        })
        previous = snap
    return {"unit_id": unit.id, "unit_name": unit.name, "points": points}


@router.get("/units/{unit_id}/compare", response_model=CompareOut)
def compare_waves(
    unit_id: uuid.UUID,
    from_campaign: uuid.UUID,
    to_campaign: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(can_view),
):
    """Порівняння двох будь-яких хвиль одного підрозділу (картки з дельтами і радар 'було / стало')."""
    unit_or_404(db, unit_id, user)
    db.commit()
    # campaign_zone_guard перевіряє лише параметр campaign_id: хвилі з from_campaign/to_campaign поза зоною
    # користувача відповідають так само, як відсутні (раніше тут можна було прочитати знімок чужої хвилі).
    for cid in (from_campaign, to_campaign):
        c = db.get(Campaign, cid)
        if c is None or not campaign_visible(db, user, c):
            raise HTTPException(status_code=404, detail="Хвилю не знайдено")
    before = results.get_snapshot(db, from_campaign, unit_id)
    after = results.get_snapshot(db, to_campaign, unit_id)
    if before is None or after is None:
        raise HTTPException(status_code=404, detail="Для цього підрозділу немає знімка однієї з хвиль")
    data = results.compare_payloads(before.payload, after.payload)
    prev_c = {c["code"]: c["score"] for c in before.payload["components"]}
    return {
        **data,
        "current_campaign_id": after.payload["campaign_id"],
        "current_title": after.payload["campaign_title"],
        "current_index": after.index_score,
        "current_reliability": after.reliability,
        "radar": [{"code": c["code"], "title": c["title"], "before": prev_c.get(c["code"]), "after": c["score"]}
                  for c in after.payload["components"]],
    }


def brief(data: dict) -> dict:
    return {
        "unit_id": data["unit_id"],
        "unit_name": data["unit_name"],
        "sufficient": data["index"]["score"] is not None,
        "index": data["index"],
        "components": [{k: c[k] for k in ("code", "title", "score", "level", "zone")} for c in data["components"]],
    }


def participant_result(db: Session, campaign: Campaign, unit_id: uuid.UUID | None, units: set[uuid.UUID]) -> dict:
    """Узагальнені результати хвилі для учасника: заклад і (якщо інший) свій підрозділ, без деталей відповідей."""
    whole = results.results_for(db, campaign, None)
    my_unit = None
    if unit_id and unit_id != campaign.unit_id and unit_id in units:
        my_unit = brief(results.results_for(db, campaign, unit_id))
    dyn = whole["dynamics"]
    return {
        "campaign_id": campaign.id,
        "campaign_title": campaign.title,
        "closed_on": campaign.closed_on,
        "institution": brief(whole),
        "my_unit": my_unit,
        "index_delta": dyn["index_delta"] if dyn else None,
        "summary": whole["summary"][:2],
    }


@router.get("/me/results", response_model=list[ParticipantResultOut])
def my_results(db: Session = Depends(get_db), user: User = Depends(require_roles(Role.RESPONDENT))):
    """Екран учасника: узагальнені результати хвилі і свого підрозділу, без деталей відповідей."""
    out = []
    closed = db.scalars(select(Campaign).where(Campaign.status == CampaignStatus.CLOSED).order_by(Campaign.created_at.desc()))
    for campaign in closed:
        units = subtree_ids(db, campaign.unit_id)
        participants = participants_of(db, campaign)
        frozen = frozen_of(db, campaign)
        member = (any(user.id in members for members in frozen.values()) if frozen is not None else
                  any(is_eligible(user, link.questionnaire, units, participants) for link in campaign.questionnaire_links))
        if not member:
            continue
        out.append(participant_result(db, campaign, user.unit_id, units))
    return out


@router.get("/respond/results", response_model=ParticipantResultOut, tags=["respond"])
def token_results(request: Request, db: Session = Depends(get_db),
                  x_response_token: str | None = Header(default=None, alias=TOKEN_HEADER)):
    """Екран учасника анонімної хвилі: те саме, що /me/results, але за одноразовим посиланням (X-Response-Token).

    Доступно після закриття хвилі з тим самим посиланням (використаним чи ні): лише узагальнені
    результати закладу і групи посилання, з тими самими порогами k. Нічого не записується.
    """
    row = tokens.find(db, x_response_token or "")
    if row is None:
        key = ("token", client_ip(request))
        retry_after = token_throttle.blocked_for(key)
        if retry_after:
            raise ApiError(429, "Забагато спроб з невірним посиланням", hint=f"Спробуйте через {retry_after} с.",
                           headers={"Retry-After": str(retry_after)})
        token_throttle.fail(key)
        raise ApiError(404, "Посилання недійсне", code="token_invalid",
                       hint="Перевірте, що посилання скопійовано повністю.")
    campaign = db.get(Campaign, row.campaign_id)
    if campaign.status != CampaignStatus.CLOSED:
        raise ApiError(409, "Результати з'являться після закриття опитування", code="campaign_not_closed",
                       hint="Відкрийте це саме посилання після завершення опитування.")
    return participant_result(db, campaign, row.unit_id, subtree_ids(db, campaign.unit_id))


# ---------- Розподіл рівнів дочірніх підрозділів без назв ----------

# Менше стільки дочірніх підрозділів з даними — розподіл не показується: з двох рядків легко вгадати, хто де.
CHILDREN_LEVELS_MIN = 3


@router.get("/units/{unit_id}/children-levels")
def children_levels(unit_id: uuid.UUID, campaign_id: uuid.UUID | None = None, db: Session = Depends(get_db),
                    user: User = Depends(can_view)) -> dict:
    """Скільки дочірніх підрозділів (усіх рівнів вкладеності) на якому рівні зрілості — без назв і без індексів.

    Для вищого керівника замість карток кожного підрозділу: видно картину, але не видно, кого «карати».
    Підрозділи з недостатніми даними рахуються окремо. Якщо підрозділів з даними менше 3, розподіл
    приховано. Знімок хвилі: campaign_id або остання закрита хвиля, що охоплює підрозділ і має знімки дочірніх
    (раніше бралася просто остання, зокрема тестова без даних, і розподіл «ховався»).
    """
    unit = unit_or_404(db, unit_id, user)
    descendants = subtree_ids(db, unit_id) - {unit_id}
    query = select(Campaign).where(Campaign.status == CampaignStatus.CLOSED)
    if campaign_id is not None:
        query = query.where(Campaign.id == campaign_id)
    covering = [c for c in db.scalars(query.order_by(Campaign.closed_on.desc(), Campaign.created_at.desc()))
                if unit_id in subtree_ids(db, c.unit_id)]
    if not covering:
        raise HTTPException(status_code=404, detail="Немає закритої хвилі для цього підрозділу")
    campaign = covering[0]
    if campaign_id is None:
        # Перевага: хвиля з даними дочірніх; далі — хвиля, де індекс має сам підрозділ (її показує дашборд).
        def indexed(units: set[uuid.UUID]) -> set[uuid.UUID]:
            return set(db.scalars(select(IndexSnapshot.campaign_id).where(
                IndexSnapshot.campaign_id.in_([c.id for c in covering]), IndexSnapshot.unit_id.in_(units),
                IndexSnapshot.index_score.is_not(None)).distinct())) if units else set()

        for preferred in (indexed(descendants), indexed({unit_id})):
            found = next((c for c in covering if c.id in preferred), None)
            if found is not None:
                campaign = found
                break
    levels = {str(lvl["level"]): 0 for lvl in methodology.MATURITY_LEVELS}
    insufficient = 0
    with_data = 0
    for unit_child in descendants:
        snap = results.get_snapshot(db, campaign.id, unit_child)
        if snap is None:
            continue
        level = (snap.payload.get("index") or {}).get("level")
        if snap.index_score is None or not level:
            insufficient += 1
            continue
        levels[str(level["level"])] += 1
        with_data += 1
    shown = with_data >= CHILDREN_LEVELS_MIN
    return {
        "unit_id": str(unit.id),
        "campaign_id": str(campaign.id),
        "campaign_title": campaign.title,
        "children_total": len(descendants),
        # Скільки дочірніх мають дані (без рівнів): щоб пояснення «розподіл приховано» спиралося на це число,
        # а не на кількість підрозділів дерева.
        "with_data": with_data,
        "insufficient": insufficient,
        "levels": levels if shown else None,
        "hidden": not shown,
        "rule": (f"Лише кількість підрозділів на кожному рівні, без назв. Менше {CHILDREN_LEVELS_MIN} підрозділів з "
                 "даними: розподіл приховано. Деталі підрозділу бачить лише сам підрозділ."),
    }
