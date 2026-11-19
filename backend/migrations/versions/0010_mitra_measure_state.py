"""measures: стан заходу в Mitra (тема 2)

- external_state: стан у Mitra (linked, rejected, in_progress, on_review, returned, done, partial, not_done);
- external_url: посилання на захід у Mitra;
- external_note: коментар координатора Mitra (причина відхилення чи невиконання);
- external_evidence: опис результату і документи (назва, sha256, посилання на перевірку /verify);
- external_updated_at: час події в Mitra, щоб старі вебхуки не перезаписували новіші.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-19 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("measures", sa.Column("external_state", sa.String(length=32), nullable=True))
    op.add_column("measures", sa.Column("external_url", sa.String(length=1000), nullable=True))
    op.add_column("measures", sa.Column("external_note", sa.Text(), server_default="", nullable=False))
    op.add_column("measures", sa.Column("external_evidence", sa.JSON(), nullable=True))
    op.add_column("measures", sa.Column("external_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_measures_external_id", "measures", ["external_id"])


def downgrade() -> None:
    op.drop_index("ix_measures_external_id", table_name="measures")
    for column in ("external_updated_at", "external_evidence", "external_note", "external_url", "external_state"):
        op.drop_column("measures", column)
