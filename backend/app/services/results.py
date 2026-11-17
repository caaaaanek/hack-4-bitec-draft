"""Збирає дані хвилі з БД, рахує (scoring.py) і зберігає незмінні знімки."""

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.clock import today
from app.models import (
    Campaign,
    CampaignStatus,
    ChecklistEntry,
    ChecklistStatus,
    IndexSnapshot,
    Indicator,
    Measure,
    MeasureStatus,
    Participation,
    QuestionnaireKind,
    RespondentCategory,
    Response,
    Role,
    Unit,
    User,
)
from app.services import facts as facts_service
from app.services import methodology as m
from app.services import scoring
from app.services.anonymity import suppressed_nodes
from app.services.eligibility import is_eligible
from app.services.units import Children, subtree_from, unit_tree


@dataclass
class WaveData:
    """Усі дані хвилі, завантажені один раз: розрахунок для кожного підрозділу йде в пам'яті."""

    campaign: Campaign
    children: Children
    campaign_units: set[uuid.UUID]
    users: list[User]
    responses: list[Response]
    participations: list[Participation]
    checklist_entries: dict[uuid.UUID, ChecklistEntry]
    periods: list[str]
    indicator_rows: list[Indicator]
    # questionnaire_id -> підрозділи, де групу приховано вторинним приховуванням
    hidden_groups: dict[uuid.UUID, set[uuid.UUID]] = field(default_factory=dict)
    unit_names: dict[uuid.UUID, str] = field(default_factory=dict)

    def subtree(self, unit_id: uuid.UUID) -> set[uuid.UUID]:
        return subtree_from(self.children, unit_id)


def load_wave(db: Session, campaign: Campaign) -> WaveData:
    children, _ = unit_tree(db)
    campaign_units = subtree_from(children, campaign.unit_id)
    end = campaign.closed_on or today()
    periods = facts_service.months_back(end, m.FACTS_WINDOW_MONTHS)
    wave = WaveData(
        campaign=campaign,
        children=children,
        campaign_units=campaign_units,
        users=list(db.scalars(select(User).where(User.role == Role.RESPONDENT))),
        responses=list(db.scalars(
            select(Response).where(Response.campaign_id == campaign.id).options(selectinload(Response.answers))
        )),
        participations=list(db.scalars(select(Participation).where(Participation.campaign_id == campaign.id))),
        checklist_entries={e.question_id: e for e in db.scalars(
            select(ChecklistEntry).where(ChecklistEntry.campaign_id == campaign.id))},
        periods=periods,
        indicator_rows=facts_service.load_rows(db, campaign_units, periods),
        unit_names={u.id: u.name for u in db.scalars(select(Unit).where(Unit.id.in_(campaign_units)))},
    )
    k = campaign.min_group_size
    for link in campaign.questionnaire_links:
        q = link.questionnaire
        if q.kind == QuestionnaireKind.CHECKLIST or q.target_category == RespondentCategory.EXPERT:
            continue
        direct: dict[uuid.UUID, int] = {}
        for r in wave.responses:
            if r.questionnaire_id == q.id and r.unit_id is not None:
                direct[r.unit_id] = direct.get(r.unit_id, 0) + 1
        wave.hidden_groups[q.id] = suppressed_nodes(children, direct, campaign.unit_id, k)
    return wave


def scope_units(db: Session, campaign: Campaign, unit_id: uuid.UUID | None, wave: WaveData | None = None) -> tuple[uuid.UUID, set[uuid.UUID]]:
    if wave is None:
        children, _ = unit_tree(db)
        campaign_units = subtree_from(children, campaign.unit_id)
    else:
        children, campaign_units = wave.children, wave.campaign_units
    scope = unit_id or campaign.unit_id
    if scope not in campaign_units:
        raise ValueError("Підрозділ не входить у хвилю")
    return scope, subtree_from(children, scope)


def load_groups(wave: WaveData, scope: uuid.UUID, units: set[uuid.UUID]) -> list[scoring.GroupInput]:
    campaign = wave.campaign
    at_root = scope == campaign.unit_id
    users_by_id = {u.id: u for u in wave.users}

    def in_scope(category: RespondentCategory, unit: uuid.UUID | None) -> bool:
        if category == RespondentCategory.EXPERT:
            return at_root
        return unit in units

    groups = []
    for link in campaign.questionnaire_links:
        questionnaire = link.questionnaire
        if questionnaire.kind == QuestionnaireKind.CHECKLIST:
            continue
        # Експерти зовнішні: їхня оцінка стосується лише рівня всієї хвилі.
        if questionnaire.target_category == RespondentCategory.EXPERT and not at_root:
            continue
        eligible = sum(1 for u in wave.users
                       if is_eligible(u, questionnaire, wave.campaign_units) and in_scope(u.category, u.unit_id))
        submitted = sum(
            1 for p in wave.participations
            if p.questionnaire_id == questionnaire.id
            and (u := users_by_id.get(p.user_id)) is not None
            and in_scope(u.category, u.unit_id)
        )
        data = []
        for r in wave.responses:
            if r.questionnaire_id != questionnaire.id or not in_scope(r.category, r.unit_id):
                continue
            item = scoring.ResponseData()
            for a in r.answers:
                if a.option_id is not None:
                    item.options.setdefault(a.question_id, []).append(a.option_id)
                elif a.value is not None:
                    item.values[a.question_id] = a.value
            data.append(item)
        # Вторинне приховування: група сама не менша за k, але її показ дозволив би
        # обчислити різницею меншу сусідню групу.
        suppressed = (not at_root and scope in wave.hidden_groups.get(questionnaire.id, set())
                      and len(data) >= campaign.min_group_size)
        groups.append(scoring.GroupInput(questionnaire=questionnaire, responses=[] if suppressed else data,
                                         eligible=eligible, submitted=submitted, suppressed=suppressed))
    return groups


def load_checklist(wave: WaveData, at_root: bool) -> list[scoring.ChecklistItem] | None:
    """Чек-лист оцінює заклад загалом, тому враховується лише на рівні всієї хвилі."""
    if not at_root:
        return None
    questionnaire = next(
        (link.questionnaire for link in wave.campaign.questionnaire_links
         if link.questionnaire.kind == QuestionnaireKind.CHECKLIST),
        None,
    )
    if questionnaire is None:
        return None
    items = []
    for section in questionnaire.sections:
        for q in section.questions:
            number = m.checklist_item_number(q.code) or q.code
            e = wave.checklist_entries.get(q.id)
            score = None
            if e is not None:
                score = m.CHECKLIST_STATUS_SCORES[e.status.value]
                if e.status == ChecklistStatus.FULL and e.confirmed_by_id is None:
                    score = m.UNCONFIRMED_FULL_SCORE
            items.append(scoring.ChecklistItem(code=q.code, number=number, component=m.checklist_component(number),
                                               score=score, confirmed=bool(e and e.confirmed_by_id),
                                               text=q.text, status=e.status.value if e else None))
    return items


def compute_for(db: Session, campaign: Campaign, unit_id: uuid.UUID | None, wave: WaveData | None = None) -> dict:
    """Розрахунок за поточною методикою (без збереження)."""
    wave = wave or load_wave(db, campaign)
    scope, units = scope_units(db, campaign, unit_id, wave)
    at_root = scope == campaign.unit_id
    groups = load_groups(wave, scope, units)
    checklist = load_checklist(wave, at_root)
    k = campaign.min_group_size
    hidden = facts_service.hidden_indicators(wave.indicator_rows, wave.children, campaign.unit_id, scope, k)
    facts = facts_service.aggregate_rows([r for r in wave.indicator_rows if r.unit_id in units], wave.periods, k, hidden)
    result = scoring.compute(groups, checklist, facts, k)
    return {
        "campaign_id": str(campaign.id),
        "campaign_title": campaign.title,
        "unit_id": str(scope),
        "unit_name": wave.unit_names.get(scope, ""),
        "closed_on": (campaign.closed_on or today()).isoformat(),
        "min_group_size": k,
        "facts_period": f"з {wave.periods[0]} по {wave.periods[-1]}",
        **result,
    }


def jsonable(value):
    """UUID у рядки, щоб знімок можна було зберегти як JSON."""
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [jsonable(v) for v in value]
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def create_snapshots(db: Session, campaign: Campaign) -> int:
    """Знімки для підрозділу хвилі і всіх його дочірніх. Викликається при закритті.

    Дані хвилі завантажуються один раз, далі розрахунок для кожного підрозділу йде в пам'яті.
    """
    count = 0
    wave = load_wave(db, campaign)
    for unit_id in sorted(wave.campaign_units, key=str):
        payload = jsonable(compute_for(db, campaign, unit_id, wave))
        db.add(
            IndexSnapshot(
                campaign_id=campaign.id,
                unit_id=unit_id,
                methodology_version=payload["methodology_version"],
                closed_on=campaign.closed_on,
                index_score=payload["index"]["score"],
                index_self=payload["index"]["self_score"],
                reliability=payload["index"]["reliability"],
                payload=payload,
            )
        )
        count += 1
    return count


def get_snapshot(db: Session, campaign_id: uuid.UUID, unit_id: uuid.UUID) -> IndexSnapshot | None:
    return db.scalar(select(IndexSnapshot).where(IndexSnapshot.campaign_id == campaign_id, IndexSnapshot.unit_id == unit_id))


def unit_snapshots(db: Session, unit_id: uuid.UUID) -> list[tuple[Campaign, IndexSnapshot]]:
    rows = db.execute(
        select(Campaign, IndexSnapshot)
        .join(IndexSnapshot, IndexSnapshot.campaign_id == Campaign.id)
        .where(IndexSnapshot.unit_id == unit_id, Campaign.status == CampaignStatus.CLOSED)
        .order_by(IndexSnapshot.closed_on, Campaign.created_at)
    ).all()
    return [(c, s) for c, s in rows]


def delta(a, b):
    return None if a is None or b is None else round(a - b, 1)


def compare_payloads(before: dict, after: dict) -> dict:
    """Порівняння двох знімків одного підрозділу з правилом значущості."""
    rel = [before["index"]["reliability"], after["index"]["reliability"]]
    index_delta = delta(after["index"]["score"], before["index"]["score"])
    prev_c = {c["code"]: c for c in before["components"]}
    components = []
    for c in after["components"]:
        p = prev_c.get(c["code"], {})
        d = delta(c["score"], p.get("score"))
        components.append({
            "code": c["code"], "title": c["title"], "previous": p.get("score"), "current": c["score"], "delta": d,
            "significance": m.significance(d, [p.get("reliability"), c["reliability"]]),
        })
    prev_q = {q["code"]: q["score"] for q in before.get("questions", [])}
    return {
        "previous_campaign_id": before["campaign_id"],
        "previous_title": before["campaign_title"],
        "previous_closed_on": before["closed_on"],
        "previous_index": before["index"]["score"],
        "previous_reliability": before["index"]["reliability"],
        "index_delta": index_delta,
        "index_self_delta": delta(after["index"]["self_score"], before["index"]["self_score"]),
        "index_significance": m.significance(index_delta, rel),
        "components": components,
        "questions": [
            {"code": q["code"], "previous": prev_q[q["code"]], "current": q["score"], "delta": delta(q["score"], prev_q[q["code"]])}
            for q in after.get("questions", []) if q["code"] in prev_q
        ],
        "methodology_versions": [before["methodology_version"], after["methodology_version"]],
        "rule": f"Зміна менша за {m.SIGNIFICANT_DELTA:g} балів: в межах похибки. Якщо одна з хвиль має достовірність C: перевірити дані. Питання зіставляються за кодом.",
    }


def results_for(db: Session, campaign: Campaign, unit_id: uuid.UUID | None, recalculate: bool = False) -> dict:
    """Результати хвилі: зі знімка або, на вимогу, перераховані за поточною методикою."""
    scope, _ = scope_units(db, campaign, unit_id)
    snapshot = None if recalculate else get_snapshot(db, campaign.id, scope)
    if snapshot is not None:
        payload = dict(snapshot.payload)
        source = "snapshot"
    else:
        payload = jsonable(compute_for(db, campaign, scope))
        source = "recalculated" if recalculate else "live"

    history = unit_snapshots(db, scope)
    previous = None
    for c, s in history:
        if c.id == campaign.id:
            break
        previous = s
    dyn = compare_payloads(previous.payload, payload) if previous is not None else None
    return {**payload, "source": source, "dynamics": dyn, "summary": scoring.management_summary(payload, dyn)}


def measures_done_between(db: Session, unit_id: uuid.UUID, after: date | None, until: date) -> int:
    """Скільки заходів підрозділу (з дочірніми) виконано між двома хвилями."""
    children, _ = unit_tree(db)
    units = subtree_from(children, unit_id)
    query = select(Measure).where(Measure.unit_id.in_(units), Measure.status == MeasureStatus.DONE,
                                  Measure.done_on.is_not(None), Measure.done_on <= until)
    if after is not None:
        query = query.where(Measure.done_on > after)
    return len(db.scalars(query).all())
