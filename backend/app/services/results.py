"""Збирає дані хвилі з БД, рахує (scoring.py) і зберігає незмінні знімки."""

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.clock import today
from app.models import (
    AccessMode,
    AccessToken,
    QrLink,
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
from app.services import categories, fact_registry, goodhart
from app.services import facts as facts_service
from app.services import methodology as m
from app.services import scoring
from app.services.anonymity import suppressed_nodes
from app.services import tokens as token_service
from app.services.eligibility import frozen_of, is_eligible, participants_of
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
    # Явний склад учасників (None — за правилом) і посилання для хвилі access_mode = token.
    participants: set[uuid.UUID] | None = None
    tokens: list[AccessToken] = field(default_factory=list)
    qr_links: list[QrLink] = field(default_factory=list)
    # Склад, зафіксований при відкритті: questionnaire_id -> {user_id: (unit_id, category)}. None — за правилом.
    frozen: dict | None = None
    # Кеш вторинного приховування фактів: показник -> підрозділи, де його приховано.
    fact_hidden: dict | None = None

    def subtree(self, unit_id: uuid.UUID) -> set[uuid.UUID]:
        return subtree_from(self.children, unit_id)


def load_wave(db: Session, campaign: Campaign) -> WaveData:
    fact_registry.refresh(db)  # факти довідника, які додали в іншому процесі API
    children, _ = unit_tree(db)
    campaign_units = subtree_from(children, campaign.unit_id)
    end = campaign.closed_on or today()
    periods = facts_service.window(end, m.FACTS_WINDOW_MONTHS)
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
        participants=participants_of(db, campaign),
        tokens=token_service.load(db, campaign.id) if campaign.access_mode == AccessMode.TOKEN else [],
        qr_links=token_service.load_qr_links(db, campaign.id) if campaign.access_mode == AccessMode.TOKEN else [],
        frozen=frozen_of(db, campaign),
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
        if campaign.access_mode == AccessMode.TOKEN:
            # Анонімна хвиля: «мали пройти» = видані посилання, «пройшли» = використані.
            eligible, submitted = token_service.counts(
                wave.tokens, questionnaire.id, lambda unit: in_scope(questionnaire.target_category, unit),
                wave.qr_links)
        elif wave.frozen is not None:
            # Склад зафіксовано при відкритті: «мали пройти» і підрозділ — на той момент.
            members = wave.frozen.get(questionnaire.id, {})
            eligible = sum(1 for unit, category in members.values() if in_scope(category, unit))
            submitted = sum(
                1 for p in wave.participations
                if p.questionnaire_id == questionnaire.id
                and (m := members.get(p.user_id)) is not None
                and in_scope(m[1], m[0])
            )
        else:
            eligible = sum(1 for u in wave.users
                           if is_eligible(u, questionnaire, wave.campaign_units, wave.participants)
                           and in_scope(u.category, u.unit_id))
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
                if a.variant:
                    item.variants[a.question_id] = a.variant
            data.append(item)
        # Вторинне приховування: група сама не менша за k, але її показ дозволив би обчислити різницею
        # меншу сусідню групу (або її відповіді при зберіганні узагальнено до вищого підрозділу разом з такою).
        suppressed = (not at_root and scope in wave.hidden_groups.get(questionnaire.id, set())
                      and (len(data) >= campaign.min_group_size or submitted >= campaign.min_group_size))
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
            items.append(scoring.ChecklistItem(code=q.code, number=number,
                                               component=m.item_component(q.code, section.component),
                                               score=score, confirmed=bool(e and e.confirmed_by_id),
                                               text=q.text, status=e.status.value if e else None))
    return items


@dataclass
class Inputs:
    """Вхідні дані scoring.compute для підрозділу хвилі (без збереження). Використовує й сценарій «що, якщо»."""

    wave: WaveData
    scope: uuid.UUID
    units: set[uuid.UUID]
    groups: list[scoring.GroupInput]
    checklist: list[scoring.ChecklistItem] | None
    facts: list[dict]
    k: int
    # Ваги й назви джерел самооцінки: методика + категорії довідника з вагою.
    weights: dict[str, float] = field(default_factory=lambda: dict(m.SOURCE_WEIGHTS))
    titles: dict[str, str] = field(default_factory=dict)
    goodhart: dict | None = None
    _surveys: tuple | None = field(default=None, repr=False, compare=False)

    def compute(self, checklist=None, facts=None, reuse_surveys: bool = False) -> dict:
        """reuse_surveys: анкети порахувати один раз і перевикористати (змінюються лише чек-лист і факти).
        «Шлях до наступного рівня» робить сотні перерахунків, і 90 % часу йшло на ті самі анкети."""
        surveys = None
        if reuse_surveys:
            if self._surveys is None:
                self._surveys = scoring.score_surveys(self.groups, self.k)
            surveys = self._surveys
        result = scoring.compute(self.groups, self.checklist if checklist is None else checklist,
                                 self.facts if facts is None else facts, self.k, self.weights, self.titles,
                                 (self.goodhart or {}).get("flags"), surveys=surveys)
        result["goodhart"] = self.goodhart
        return result


def load_inputs(db: Session, campaign: Campaign, unit_id: uuid.UUID | None, wave: WaveData | None = None) -> Inputs:
    wave = wave or load_wave(db, campaign)
    scope, units = scope_units(db, campaign, unit_id, wave)
    at_root = scope == campaign.unit_id
    k = campaign.min_group_size
    if wave.fact_hidden is None:  # один раз на хвилю: при закритті рахуються знімки всіх підрозділів
        wave.fact_hidden = facts_service.hidden_map(wave.indicator_rows, wave.children, campaign.unit_id, k)
    hidden = facts_service.hidden_indicators(wave.indicator_rows, wave.children, campaign.unit_id, scope, k,
                                             wave.fact_hidden)
    facts = facts_service.aggregate_rows([r for r in wave.indicator_rows if r.unit_id in units], wave.periods, k, hidden)
    groups = load_groups(wave, scope, units)
    return Inputs(wave=wave, scope=scope, units=units, groups=groups,
                  checklist=load_checklist(wave, at_root), facts=facts, k=k,
                  weights=categories.weights(db), titles=categories.titles(db),
                  goodhart=goodhart.analyze(db, wave, scope, units, groups, at_root))


def compute_for(db: Session, campaign: Campaign, unit_id: uuid.UUID | None, wave: WaveData | None = None) -> dict:
    """Розрахунок за поточною методикою (без збереження)."""
    inputs = load_inputs(db, campaign, unit_id, wave)
    wave, scope, k = inputs.wave, inputs.scope, inputs.k
    result = inputs.compute()
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


def previous_indexed(history: list[tuple[Campaign, IndexSnapshot]], campaign_id: uuid.UUID) -> IndexSnapshot | None:
    """Попередній знімок з індексом: хвиля без індексу (одна анкета, мало відповідей) не база для порівняння."""
    previous = None
    for c, s in history:
        if c.id == campaign_id:
            break
        if s.index_score is not None:
            previous = s
    return previous


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

    previous = previous_indexed(unit_snapshots(db, scope), campaign.id)
    dyn = compare_payloads(previous.payload, payload) if previous is not None else None
    return {**payload, "source": source, "dynamics": dyn, "summary": scoring.management_summary(payload, dyn)}


def unit_subtree(db: Session, unit_id: uuid.UUID) -> set[uuid.UUID]:
    """Підрозділ з усіма дочірніми (одним запитом до дерева)."""
    children, _ = unit_tree(db)
    return subtree_from(children, unit_id)


def measures_done_between(db: Session, unit_id: uuid.UUID, after: date | None, until: date,
                          units: set[uuid.UUID] | None = None) -> int:
    """Скільки заходів підрозділу (з дочірніми) виконано між двома хвилями.

    units — заздалегідь пораховане піддерево: для історії з кількох точок дерево будується один раз.
    """
    if units is None:
        units = unit_subtree(db, unit_id)
    query = select(func.count()).select_from(Measure).where(
        Measure.unit_id.in_(units), Measure.status == MeasureStatus.DONE,
        Measure.done_on.is_not(None), Measure.done_on <= until)
    if after is not None:
        query = query.where(Measure.done_on > after)
    return db.scalar(query) or 0


# ---------- Прапорці достовірності для відповіді API ----------

# Прапорець, що стосується саме компонента: лишається в components[].flags. Решта показується один раз на хвилю.
COMPONENT_FLAGS = ("self_not_confirmed",)
_SEVERITY_ORDER = {"serious": 0, "minor": 1, "info": 2}


def present_flags(data: dict) -> dict:
    """Копія результатів для API: прапорці хвилі один раз (reliability_flags зі списком компонентів),
    у компонентах — лише self_not_confirmed.

    Розрахунок і знімок не змінюються: достовірність компонентів і reliability_reasons рахуються за повним
    набором прапорців, як і раніше. Раніше той самий прапорець групи (непряма оцінка, «про себе / про колег»,
    підгонка) приходив окремо на кожен компонент.
    """
    merged: dict[str, dict] = {}
    components = []
    for c in data.get("components", []):
        own = []
        for f in c.get("flags") or []:
            if f["code"] in COMPONENT_FLAGS:
                own.append(f)
                continue
            item = merged.setdefault(f["code"], {**f, "components": []})
            item["components"].append(c["code"])
        components.append({**c, "flags": own})
    flags = sorted(merged.values(), key=lambda f: (_SEVERITY_ORDER.get(f["severity"], 3), f["code"]))
    return {**data, "components": components, "reliability_flags": flags}
