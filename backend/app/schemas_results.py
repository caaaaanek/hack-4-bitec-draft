"""Формати відповідей модуля результатів (методика v2)."""

import uuid
from datetime import date

from pydantic import BaseModel


class Level(BaseModel):
    level: int
    title: str


class Zone(BaseModel):
    code: str  # critical / attention / moderate / strong
    title: str


class Flag(BaseModel):
    code: str
    severity: str  # serious / minor / info
    title: str


class Significance(BaseModel):
    code: str  # within_error / check_data / improved / worsened / no_data
    title: str


class IndexOut(BaseModel):
    score: float | None
    self_score: float | None  # лише самооцінка, без перевірки фактами
    complete: bool
    level: Level | None
    level_uncapped: Level | None
    weak_link_applied: bool
    zone: Zone | None
    reliability: str  # A / B / C / insufficient_data
    reliability_reasons: list[str]
    rule: str


class SourceOut(BaseModel):
    source: str  # staff / working_group / expert / checklist
    title: str
    weight: float
    effective_weight: float
    score: float | None


class FactOut(BaseModel):
    indicator: str
    title: str
    component: str
    periods: str
    sources: list[str]
    status: str  # ok / too_few_people / no_denominator
    numerator: int | None
    denominator: int | None
    percent: float | None
    level: int | None
    score: float | None
    extra_counts: dict
    label: str
    rule: str


class ComponentOut(BaseModel):
    code: str
    title: str
    weight: float
    self_score: float | None
    self_rule: str
    sources: list[SourceOut]
    facts_score: float | None
    facts: list[FactOut]
    score: float | None
    level: Level | None
    level_value: float | None
    zone: Zone | None
    cut_by_facts: bool
    flags: list[Flag]
    reliability: str
    rule: str


class GroupOut(BaseModel):
    questionnaire_id: uuid.UUID
    title: str
    category: str
    eligible: int | None
    submitted: int | None
    participation_percent: float | None
    n: int | None
    sufficient: bool
    spread: float | None
    perfect_share: float | None
    declared_level: int | None
    computed_level: int | None
    flags: list[str]
    suppressed: bool = False  # приховано вторинним приховуванням (див. docs/backend.md)


class ChecklistComponent(BaseModel):
    score: float | None
    filled: int
    total: int
    confirmed: int


class ChecklistItemSummary(BaseModel):
    code: str
    number: str
    component: str | None
    text: str = ""
    status: str | None
    score: float | None
    confirmed: bool


class ChecklistSummary(BaseModel):
    total: int
    filled: int
    confirmed: int
    confirmed_share: float
    by_component: dict[str, ChecklistComponent]
    items: list[ChecklistItemSummary] = []


class DistributionItem(BaseModel):
    option_text: str
    option_score: float
    count: int
    percent: float


class QuestionCategory(BaseModel):
    category: str
    questionnaire_id: uuid.UUID
    n: int
    score: float | None
    distribution: list[DistributionItem]


class QuestionOut(BaseModel):
    code: str
    text: str
    section: str
    component: str
    score: float | None
    zone: Zone | None
    by_category: list[QuestionCategory]


class Highlight(BaseModel):
    code: str
    title: str
    score: float | None


class WeakQuestion(BaseModel):
    code: str
    text: str
    score: float | None


class Discrepancy(BaseModel):
    type: str
    subject: str
    description: str
    values: dict
    rule: str


class ComponentDelta(BaseModel):
    code: str
    title: str
    previous: float | None
    current: float | None
    delta: float | None
    significance: Significance


class QuestionDelta(BaseModel):
    code: str
    previous: float | None
    current: float | None
    delta: float | None


class DynamicsOut(BaseModel):
    previous_campaign_id: uuid.UUID
    previous_title: str
    previous_closed_on: date | None
    previous_index: float | None
    previous_reliability: str
    index_delta: float | None
    index_self_delta: float | None
    index_significance: Significance
    components: list[ComponentDelta]
    questions: list[QuestionDelta]
    methodology_versions: list[str]
    rule: str


class CampaignResultsOut(BaseModel):
    campaign_id: uuid.UUID
    campaign_title: str
    unit_id: uuid.UUID
    unit_name: str
    closed_on: date | None
    min_group_size: int
    facts_period: str
    methodology_version: str
    source: str  # snapshot / live / recalculated
    index: IndexOut
    components: list[ComponentOut]
    groups: list[GroupOut]
    checklist: ChecklistSummary | None
    facts: list[FactOut]
    questions: list[QuestionOut]
    strengths: list[Highlight]
    problems: list[Highlight]
    weakest_questions: list[WeakQuestion]
    discrepancies: list[Discrepancy]
    dynamics: DynamicsOut | None
    summary: list[str]


# ---------- Динаміка підрозділу ----------

class HistoryPoint(BaseModel):
    campaign_id: uuid.UUID
    campaign_title: str
    closed_on: date
    methodology_version: str
    index: float | None
    index_self: float | None
    reliability: str
    components: dict[str, float | None]
    measures_done: int | None  # заходи підрозділу (з дочірніми), виконані між попередньою і цією хвилею
    delta: float | None
    significance: Significance | None


class HistoryOut(BaseModel):
    unit_id: uuid.UUID
    unit_name: str
    points: list[HistoryPoint]


class RadarPoint(BaseModel):
    code: str
    title: str
    before: float | None
    after: float | None


class CompareOut(DynamicsOut):
    current_campaign_id: uuid.UUID
    current_title: str
    current_index: float | None
    current_reliability: str
    radar: list[RadarPoint]


# ---------- Екран учасника ----------

class ComponentBrief(BaseModel):
    code: str
    title: str
    score: float | None
    level: Level | None
    zone: Zone | None


class ScopeBrief(BaseModel):
    unit_id: uuid.UUID
    unit_name: str
    sufficient: bool
    index: IndexOut
    components: list[ComponentBrief]


class ParticipantResultOut(BaseModel):
    campaign_id: uuid.UUID
    campaign_title: str
    closed_on: date | None
    institution: ScopeBrief
    my_unit: ScopeBrief | None
    index_delta: float | None
    summary: list[str]
