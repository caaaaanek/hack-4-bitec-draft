"""qr links: одне посилання для зали, токени створюються скануванням

- qr_links: код, очікувана кількість учасників, анкета й підрозділ;
- access_tokens.qr_link_id: токен, виданий скануванням (у знаменник участі не входить).

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-18 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "qr_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("questionnaire_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("expected", sa.Integer(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["questionnaire_id"], ["questionnaires.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index(op.f("ix_qr_links_campaign_id"), "qr_links", ["campaign_id"], unique=False)
    with op.batch_alter_table("access_tokens") as batch:
        batch.add_column(sa.Column("qr_link_id", sa.Uuid(), nullable=True))
        batch.create_index(op.f("ix_access_tokens_qr_link_id"), ["qr_link_id"], unique=False)
        batch.create_foreign_key("fk_access_tokens_qr_link_id", "qr_links", ["qr_link_id"], ["id"],
                                 ondelete="CASCADE")


def downgrade() -> None:
    with op.batch_alter_table("access_tokens") as batch:
        batch.drop_constraint("fk_access_tokens_qr_link_id", type_="foreignkey")
        batch.drop_index(op.f("ix_access_tokens_qr_link_id"))
        batch.drop_column("qr_link_id")
    op.drop_index(op.f("ix_qr_links_campaign_id"), table_name="qr_links")
    op.drop_table("qr_links")
