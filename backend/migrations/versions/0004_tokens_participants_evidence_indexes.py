"""anonymous tokens, explicit participants, evidence files, indexes

- access_tokens: одноразові посилання (лише sha256, без користувача й часу використання);
- campaigns.access_mode (login | token), campaigns.explicit_participants, campaign_participants;
- evidence_files: файли-докази до пунктів чек-листа (sha256, розмір, хто додав, м'яке видалення);
- індекси під часті запити: дерево підрозділів, респонденти, хвилі за статусом, відповіді хвилі,
  відповіді анкети, знімки підрозділу, журнал за сутністю, черга outbox.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-17 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("access_mode", sa.Enum("login", "token", name="accessmode", native_enum=False,
                                                                length=32), server_default="login", nullable=False))
    op.add_column("campaigns", sa.Column("explicit_participants", sa.Boolean(), server_default=sa.false(),
                                         nullable=False))

    op.create_table(
        "access_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("questionnaire_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["questionnaire_id"], ["questionnaires.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_access_tokens_campaign_id"), "access_tokens", ["campaign_id"], unique=False)

    op.create_table(
        "campaign_participants",
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("campaign_id", "user_id"),
    )

    op.create_table(
        "evidence_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("uploaded_by_id", sa.Uuid(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deleted_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_evidence_files_item", "evidence_files", ["campaign_id", "question_id"], unique=False)
    op.create_index(op.f("ix_evidence_files_sha256"), "evidence_files", ["sha256"], unique=False)

    op.create_index(op.f("ix_units_parent_id"), "units", ["parent_id"], unique=False)
    op.create_index(op.f("ix_users_role"), "users", ["role"], unique=False)
    op.create_index(op.f("ix_users_unit_id"), "users", ["unit_id"], unique=False)
    op.create_index(op.f("ix_campaigns_status"), "campaigns", ["status"], unique=False)
    op.create_index(op.f("ix_responses_campaign_id"), "responses", ["campaign_id"], unique=False)
    op.create_index(op.f("ix_answers_response_id"), "answers", ["response_id"], unique=False)
    op.create_index(op.f("ix_index_snapshots_unit_id"), "index_snapshots", ["unit_id"], unique=False)
    op.create_index(op.f("ix_measures_campaign_id"), "measures", ["campaign_id"], unique=False)
    op.create_index("ix_audit_log_entity", "audit_log", ["entity", "entity_id"], unique=False)
    op.create_index(op.f("ix_outbox_sent_at"), "outbox", ["sent_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_outbox_sent_at"), table_name="outbox")
    op.drop_index("ix_audit_log_entity", table_name="audit_log")
    op.drop_index(op.f("ix_measures_campaign_id"), table_name="measures")
    op.drop_index(op.f("ix_index_snapshots_unit_id"), table_name="index_snapshots")
    op.drop_index(op.f("ix_answers_response_id"), table_name="answers")
    op.drop_index(op.f("ix_responses_campaign_id"), table_name="responses")
    op.drop_index(op.f("ix_campaigns_status"), table_name="campaigns")
    op.drop_index(op.f("ix_users_unit_id"), table_name="users")
    op.drop_index(op.f("ix_users_role"), table_name="users")
    op.drop_index(op.f("ix_units_parent_id"), table_name="units")
    op.drop_index(op.f("ix_evidence_files_sha256"), table_name="evidence_files")
    op.drop_index("ix_evidence_files_item", table_name="evidence_files")
    op.drop_table("evidence_files")
    op.drop_table("campaign_participants")
    op.drop_index(op.f("ix_access_tokens_campaign_id"), table_name="access_tokens")
    op.drop_table("access_tokens")
    op.drop_column("campaigns", "explicit_participants")
    op.drop_column("campaigns", "access_mode")
