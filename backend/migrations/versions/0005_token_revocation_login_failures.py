"""token revocation, login failures in DB

- users.token_version: зростає при зміні пароля чи блокуванні — усі раніше видані JWT стають недійсними;
- revoked_tokens: відкликані при виході JWT (jti) до закінчення строку дії;
- login_failures: невдалі спроби входу й анонімних посилань (спільні для всіх процесів), ключ — sha256.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-18 13:30:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("token_version", sa.Integer(), server_default="0", nullable=False))

    op.create_table(
        "revoked_tokens",
        sa.Column("jti", sa.String(length=64), primary_key=True),
        sa.Column("expires_at", sa.Float(), nullable=False),
    )
    op.create_index("ix_revoked_tokens_expires_at", "revoked_tokens", ["expires_at"])

    op.create_table(
        "login_failures",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("at", sa.Float(), nullable=False),
    )
    op.create_index("ix_login_failures_scope", "login_failures", ["scope"])
    op.create_index("ix_login_failures_key", "login_failures", ["key"])
    op.create_index("ix_login_failures_at", "login_failures", ["at"])


def downgrade() -> None:
    op.drop_index("ix_login_failures_at", table_name="login_failures")
    op.drop_index("ix_login_failures_key", table_name="login_failures")
    op.drop_index("ix_login_failures_scope", table_name="login_failures")
    op.drop_table("login_failures")
    op.drop_index("ix_revoked_tokens_expires_at", table_name="revoked_tokens")
    op.drop_table("revoked_tokens")
    op.drop_column("users", "token_version")
