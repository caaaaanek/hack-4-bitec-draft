"""checks: запуски перевірок і знахідки

- check_runs: запуски перевірки закупівель і декларацій (підсумки, без записів);
- check_findings: знахідки (публічний ідентифікатор запису, прапорці, статус розгляду).

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-17 20:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "check_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("flagged", sa.Integer(), nullable=False),
        sa.Column("by_risk", sa.JSON(), nullable=False),
        sa.Column("extra", sa.JSON(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_check_runs_unit_period_kind", "check_runs", ["unit_id", "period", "kind"])

    op.create_table(
        "check_findings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("record_ref", sa.String(length=200), nullable=False),
        sa.Column("risk_level", sa.String(length=8), nullable=False),
        sa.Column("flags", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("reviewed_by_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["check_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_check_findings_run_id", "check_findings", ["run_id"])
    op.create_index("ix_check_findings_unit_period_kind", "check_findings", ["unit_id", "period", "kind"])


def downgrade() -> None:
    op.drop_table("check_findings")
    op.drop_table("check_runs")
