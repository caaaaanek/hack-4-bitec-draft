"""власники фактів: fact_definitions.owner_sources

Хто має право передавати факт (аудит 20.11, В7). Для вбудованих фактів власники задані в коді
(fact_registry.BUILTIN_OWNERS), для фактів довідника — у цьому стовпці; FACT_OWNERS перекриває обидва.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-20 18:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("fact_definitions", sa.Column("owner_sources", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("fact_definitions", "owner_sources")
