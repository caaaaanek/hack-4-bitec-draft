"""autopilot, notices, generated reports, training completions

- campaigns: план автопілота (дати відкриття й закриття, поріг участі, нагадування);
- autopilot_events: журнал кроків автопілота й агента-чергового;
- notices: сповіщення для аудиторії (учасники хвилі, керівники, адміністратори), не для конкретної людини;
- generated_reports: звіти, підготовлені автопілотом при закритті хвилі;
- training_completions: пройдені колоди флешкарток (джерело показника training_coverage).

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-18 18:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("autopilot", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("campaigns", sa.Column("planned_open_on", sa.Date(), nullable=True))
    op.add_column("campaigns", sa.Column("planned_close_on", sa.Date(), nullable=True))
    op.add_column("campaigns", sa.Column("close_at_percent", sa.Float(), nullable=True))
    op.add_column("campaigns", sa.Column("remind_every_days", sa.Integer(), nullable=True))
    op.add_column("campaigns", sa.Column("last_reminder_on", sa.Date(), nullable=True))

    op.create_table(
        "autopilot_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("step", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_autopilot_events_campaign_at", "autopilot_events", ["campaign_id", "at"])

    op.create_table(
        "notices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=True),
        sa.Column("audience", sa.String(length=16), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notices_created_at", "notices", ["created_at"])

    op.create_table(
        "generated_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("format", sa.String(length=8), nullable=False),
        sa.Column("filename", sa.String(length=200), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_generated_reports_campaign_id", "generated_reports", ["campaign_id"])

    op.create_table(
        "training_completions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("deck", sa.String(length=32), nullable=False),
        sa.Column("completed_on", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "deck", "completed_on"),
    )
    op.create_index("ix_training_completions_deck_on", "training_completions", ["deck", "completed_on"])


def downgrade() -> None:
    op.drop_index("ix_training_completions_deck_on", table_name="training_completions")
    op.drop_table("training_completions")
    op.drop_index("ix_generated_reports_campaign_id", table_name="generated_reports")
    op.drop_table("generated_reports")
    op.drop_index("ix_notices_created_at", table_name="notices")
    op.drop_table("notices")
    op.drop_index("ix_autopilot_events_campaign_at", table_name="autopilot_events")
    op.drop_table("autopilot_events")
    for column in ("last_reminder_on", "remind_every_days", "close_at_percent", "planned_close_on",
                   "planned_open_on", "autopilot"):
        op.drop_column("campaigns", column)
