"""Схеми модуля «Перевірки» (контракт docs/contracts/checks.md)."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_RECORDS = 5000
PERIOD = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="Місяць у форматі YYYY-MM")
Source = Literal["file", "api", "mock", "prozorro", "nazk"]


class ProcurementRecord(BaseModel):
    """Закупівля (один лот) у форматі «контракт даних v1.2». Обов'язкове лише record_id."""

    model_config = ConfigDict(extra="allow")

    record_id: str = Field(min_length=1, max_length=200)
    procurement_method: str | None = None
    procurement_method_type: str | None = None
    category: str | None = None
    expected_value: float | None = None
    currency: str | None = None
    cpv: str | None = None
    dates: dict[str, Any] | None = None
    buyer: dict[str, Any] | None = None
    bids: list[dict[str, Any]] | None = None
    winner: dict[str, Any] | None = None
    contract: dict[str, Any] | None = None
    complaints_count: int | None = None
    beneficiaries: list[Any] | None = None


class DeclarationItem(BaseModel):
    """Декларація НАЗК: тип, рік, дата подання, необов'язково повний JSON (step_1..step_16)."""

    declaration_id: str = Field(min_length=1, max_length=200)
    declaration_type: int = Field(ge=1, le=4, description="1 щорічна, 2 перед звільненням, 3 після, 4 кандидата")
    declaration_year: int | None = None
    date: str | None = Field(default=None, description="Дата подання, YYYY-MM-DD")
    data: dict[str, Any] | None = None


class ProcurementRunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    period: str = PERIOD
    source: Source = "file"
    records: list[ProcurementRecord] = Field(max_length=MAX_RECORDS)


class DeclarationsRunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    period: str = PERIOD
    source: Source = "file"
    items: list[DeclarationItem] = Field(max_length=MAX_RECORDS)
    year: int | None = Field(default=None, ge=2000, le=2100, description="Звітний рік, за замовчуванням рік періоду - 1")


class FlagOut(BaseModel):
    rule_id: str
    severity: str
    title: str
    law_refs: list[str]


class RunOut(BaseModel):
    run_id: uuid.UUID
    kind: str
    unit_id: uuid.UUID
    period: str
    source: str
    total: int
    flagged: int
    by_risk: dict[str, int]
    extra: dict[str, int]
    created_at: datetime


class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    run_id: uuid.UUID
    kind: str
    unit_id: uuid.UUID
    period: str
    record_ref: str
    risk_level: str
    flags: list[FlagOut]
    status: str
    comment: str
    reviewed_at: datetime | None


class ReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["new", "reviewed", "dismissed"]
    comment: str = Field(default="", max_length=1000)


class PublishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    period: str = PERIOD


class PublishedIndicator(BaseModel):
    indicator: str
    numerator: int
    denominator: int
    written: bool = Field(description="false, якщо знаменник 0 і показник не записано")


class PublishOut(BaseModel):
    unit_id: uuid.UUID
    period: str
    indicators: list[PublishedIndicator]


class FetchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    period: str = PERIOD
    limit: int = Field(default=20, ge=1, le=50)


class NazkFetchIn(FetchIn):
    year: int | None = Field(default=None, ge=2000, le=2100, description="Звітний рік, за замовчуванням рік періоду - 1")
    declaration_type: int | None = Field(default=1, ge=1, le=4)


class DeclarationsBody(BaseModel):
    """Тіло, придатне для POST /checks/declarations."""

    unit_id: uuid.UUID
    period: str
    source: Source
    year: int
    items: list[DeclarationItem]


class ProcurementBody(BaseModel):
    """Тіло, придатне для POST /checks/procurement."""

    unit_id: uuid.UUID
    period: str
    source: Source
    records: list[ProcurementRecord]
