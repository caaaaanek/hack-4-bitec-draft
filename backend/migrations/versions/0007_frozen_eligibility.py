"""frozen eligibility at wave opening

- campaign_eligible: склад учасників хвилі за обліковими записами, зафіксований при відкритті
  (хто мав пройти анкету і в якому підрозділі був). Знаменник участі рахується від нього;
- campaigns.eligible_frozen: чи зафіксовано склад (хвилі, відкриті до цієї міграції, рахуються за правилом).

Буфер відповідей (response_pool.answers) з цієї версії шифрується застосунком; схема не змінюється,
старі незашифровані рядки читаються як раніше.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-18 16:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("eligible_frozen", sa.Boolean(), server_default="false", nullable=False))
    op.create_table(
        "campaign_eligible",
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("questionnaire_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.Column("category", sa.Enum("working_group", "staff", "expert", name="respondentcategory",
                                      native_enum=False, length=32), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["questionnaire_id"], ["questionnaires.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("campaign_id", "questionnaire_id", "user_id"),
    )
    op.create_index("ix_campaign_eligible_user_id", "campaign_eligible", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_campaign_eligible_user_id", table_name="campaign_eligible")
    op.drop_table("campaign_eligible")
    op.drop_column("campaigns", "eligible_frozen")
