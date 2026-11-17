"""anonymity pool, audit hash chain, recommendations, measures, outbox

- responses: прибрано submitted_on; наявні відповіді переписуються в перемішаному порядку
  однією транзакцією, щоб їхній xmin більше не збігався з xmin записів участі;
- response_pool: буфер анонімних відповідей;
- audit_log: seq, prev_hash, hash (ланцюжок хешів, заповнюється для наявних записів), audit_head;
- recommendation_decisions, measures, outbox.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-17 10:30:00
"""
import random
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GENESIS_HASH = "0" * 64


def _category():
    return sa.Enum("working_group", "staff", "expert", name="respondentcategory", native_enum=False, length=32)


def reshuffle_responses(bind) -> None:
    """Переписує наявні відповіді в новому випадковому порядку з новими ID."""
    responses = sa.table("responses", sa.column("id", sa.Uuid()), sa.column("campaign_id", sa.Uuid()),
                         sa.column("questionnaire_id", sa.Uuid()), sa.column("category", sa.String()),
                         sa.column("unit_id", sa.Uuid()))
    answers = sa.table("answers", sa.column("response_id", sa.Uuid()))
    rows = list(bind.execute(sa.select(responses)).mappings())
    random.SystemRandom().shuffle(rows)
    for row in rows:
        new_id = uuid.uuid4()
        bind.execute(responses.insert().values(id=new_id, campaign_id=row["campaign_id"],
                                               questionnaire_id=row["questionnaire_id"], category=row["category"],
                                               unit_id=row["unit_id"]))
        bind.execute(answers.update().where(answers.c.response_id == row["id"]).values(response_id=new_id))
        bind.execute(responses.delete().where(responses.c.id == row["id"]))


def backfill_audit_chain(bind) -> None:
    from app.audit import entry_hash  # та сама функція, що й у застосунку

    log = sa.table("audit_log", sa.column("id", sa.Uuid()), sa.column("seq", sa.Integer()),
                   sa.column("prev_hash", sa.String()), sa.column("hash", sa.String()),
                   sa.column("at", sa.DateTime(timezone=True)), sa.column("actor_id", sa.Uuid()),
                   sa.column("action", sa.String()), sa.column("entity", sa.String()),
                   sa.column("entity_id", sa.String()), sa.column("details", sa.JSON()))
    prev, seq = GENESIS_HASH, 0
    for row in list(bind.execute(sa.select(log).order_by(log.c.at, log.c.id)).mappings()):
        seq += 1
        digest = entry_hash(prev, seq, row["at"], row["actor_id"], row["action"], row["entity"],
                            row["entity_id"], row["details"] or {})
        bind.execute(log.update().where(log.c.id == row["id"]).values(seq=seq, prev_hash=prev, hash=digest))
        prev = digest
    head = sa.table("audit_head", sa.column("id", sa.Integer()), sa.column("seq", sa.Integer()), sa.column("hash", sa.String()))
    bind.execute(head.insert().values(id=1, seq=seq, hash=prev))


def upgrade() -> None:
    bind = op.get_bind()

    # --- Анонімність ---
    with op.batch_alter_table("responses") as batch:
        batch.drop_column("submitted_on")
    reshuffle_responses(bind)

    op.create_table(
        "response_pool",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("questionnaire_id", sa.Uuid(), nullable=False),
        sa.Column("category", _category(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.Column("answers", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["questionnaire_id"], ["questionnaires.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_response_pool_campaign_id"), "response_pool", ["campaign_id"], unique=False)

    # --- Журнал: ланцюжок хешів ---
    with op.batch_alter_table("audit_log") as batch:
        batch.add_column(sa.Column("seq", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("prev_hash", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("hash", sa.String(length=64), nullable=True))
    op.create_table(
        "audit_head",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("hash", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    backfill_audit_chain(bind)
    with op.batch_alter_table("audit_log") as batch:
        batch.alter_column("seq", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("prev_hash", existing_type=sa.String(length=64), nullable=False)
        batch.alter_column("hash", existing_type=sa.String(length=64), nullable=False)
        batch.create_unique_constraint("uq_audit_log_seq", ["seq"])

    # --- Рекомендації, заходи, вихідна черга ---
    op.create_table(
        "recommendation_decisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("recommendation_code", sa.String(length=128), nullable=False),
        sa.Column("decision", sa.Enum("accepted", "clarify", "rejected", name="recommendationdecisiontype",
                                      native_enum=False, length=32), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("decided_by_id", sa.Uuid(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "unit_id", "recommendation_code"),
    )
    op.create_table(
        "measures",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=True),
        sa.Column("recommendation_code", sa.String(length=128), nullable=True),
        sa.Column("component", sa.String(length=32), nullable=True),
        sa.Column("catalog_number", sa.String(length=16), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("owner", sa.String(length=200), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("status", sa.Enum("planned", "in_progress", "done", "cancelled", name="measurestatus",
                                    native_enum=False, length=32), nullable=False),
        sa.Column("done_on", sa.Date(), nullable=True),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("external_id", sa.String(length=128), nullable=True),
        sa.Column("external_source", sa.String(length=64), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_measures_unit_id"), "measures", ["unit_id"], unique=False)
    op.create_table(
        "outbox",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target", sa.String(length=32), nullable=False),
        sa.Column("topic", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("outbox")
    op.drop_index(op.f("ix_measures_unit_id"), table_name="measures")
    op.drop_table("measures")
    op.drop_table("recommendation_decisions")
    op.drop_table("audit_head")
    with op.batch_alter_table("audit_log") as batch:
        batch.drop_constraint("uq_audit_log_seq", type_="unique")
        batch.drop_column("hash")
        batch.drop_column("prev_hash")
        batch.drop_column("seq")
    op.drop_index(op.f("ix_response_pool_campaign_id"), table_name="response_pool")
    op.drop_table("response_pool")
    with op.batch_alter_table("responses") as batch:
        batch.add_column(sa.Column("submitted_on", sa.Date(), nullable=True))
