"""довідники, відповідальні за пункти, безпека облікових записів, детектор відвертості, урна, квитанції

- respondent_categories, positions, fact_definitions: довідники замість зашитих у код списків;
- checklist_assignments: хто вносить і хто підтверджує конкретний пункт чек-листа;
- user_invites: пароль ставить сама людина за одноразовим запрошенням;
- approval_requests: принцип двох осіб (FOUR_EYES_ENABLED);
- audit_anchors: голова ланцюжка журналу, прийнята аудитом;
- result_views: хто дивився результати дочірніх підрозділів (захист від колективного покарання);
- urn_shares, campaigns.urn_*: «урна з трьома ключами» (Шамір 2 з 3);
- blind_keys, spent_ballots: жетони зі сліпим підписом і квитанції;
- risk_register: реєстр корупційних ризиків закладу;
- questions.params, answers.variant: непрямі питання («скільки з переліку») і «дзеркало».

Склад учасників хвиль за обліковими записами тепер фіксується з моменту створення (campaign_eligible),
для чернеток, створених раніше, — при відкритті, як і було.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-20 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BUILTIN_CATEGORIES = [("working_group", "Робоча група", 0.25), ("staff", "Особовий склад", 0.35),
                      ("expert", "Експерти", 0.20)]


def upgrade() -> None:
    op.add_column("questions", sa.Column("params", sa.JSON(), server_default="{}", nullable=False))
    op.add_column("answers", sa.Column("variant", sa.String(length=1), nullable=True))
    op.add_column("campaigns", sa.Column("urn_enabled", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("campaigns", sa.Column("urn_public_key", sa.String(length=64), nullable=True))
    op.add_column("campaigns", sa.Column("urn_close_requested", sa.Boolean(), server_default="false", nullable=False))

    categories = op.create_table(
        "respondent_categories",
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("weight", sa.Float(), nullable=True),
        sa.Column("builtin", sa.Boolean(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("code"),
    )
    op.bulk_insert(categories, [{"code": c, "title": t, "weight": w, "builtin": True, "active": True}
                                for c, t, w in BUILTIN_CATEGORIES])

    op.create_table(
        "positions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("title"),
    )
    op.create_table(
        "fact_definitions",
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("component", sa.String(length=32), nullable=False),
        sa.Column("thresholds", sa.JSON(), nullable=False),
        sa.Column("numerator", sa.String(length=100), nullable=False),
        sa.Column("denominator", sa.String(length=100), nullable=False),
        sa.Column("rest", sa.String(length=100), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_table(
        "checklist_assignments",
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("enterer_id", sa.Uuid(), nullable=True),
        sa.Column("confirmer_id", sa.Uuid(), nullable=True),
        sa.Column("assigned_by_id", sa.Uuid(), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.ForeignKeyConstraint(["enterer_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["confirmer_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["assigned_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("campaign_id", "question_id"),
    )
    op.create_table(
        "user_invites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_user_invites_user_id", "user_invites", ["user_id"])
    op.create_table(
        "approval_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("requested_by_id", sa.Uuid(), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_by_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_approval_requests_status", "approval_requests", ["status"])
    op.create_table(
        "audit_anchors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("hash", sa.String(length=64), nullable=False),
        sa.Column("accepted_by_id", sa.Uuid(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["accepted_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "result_views",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=True),
        sa.Column("endpoint", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_result_views_at", "result_views", ["at"])
    op.create_table(
        "urn_shares",
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("holder_id", sa.Uuid(), nullable=False),
        sa.Column("x", sa.Integer(), nullable=False),
        sa.Column("share", sa.Text(), nullable=True),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["holder_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("campaign_id", "holder_id"),
    )
    op.create_table(
        "blind_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("questionnaire_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.Column("n", sa.Text(), nullable=False),
        sa.Column("e", sa.Integer(), nullable=False),
        sa.Column("sealed_d", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["questionnaire_id"], ["questionnaires.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "questionnaire_id", "unit_id"),
    )
    op.create_index("ix_blind_keys_campaign_id", "blind_keys", ["campaign_id"])
    op.create_table(
        "spent_ballots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("questionnaire_id", sa.Uuid(), nullable=False),
        sa.Column("receipt", sa.String(length=64), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["questionnaire_id"], ["questionnaires.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "questionnaire_id", "receipt"),
    )
    op.create_index("ix_spent_ballots_campaign_id", "spent_ballots", ["campaign_id"])
    op.create_table(
        "risk_register",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("component", sa.String(length=32), nullable=True),
        sa.Column("likelihood", sa.Integer(), nullable=True),
        sa.Column("impact", sa.Integer(), nullable=True),
        sa.Column("measure_id", sa.Uuid(), nullable=True),
        sa.Column("measure_title", sa.Text(), nullable=False),
        sa.Column("owner", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.ForeignKeyConstraint(["measure_id"], ["measures.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_risk_register_unit", "risk_register", ["unit_id"])


def downgrade() -> None:
    for index, table in (("ix_risk_register_unit", "risk_register"), ("ix_spent_ballots_campaign_id", "spent_ballots"),
                         ("ix_blind_keys_campaign_id", "blind_keys"), ("ix_result_views_at", "result_views"),
                         ("ix_approval_requests_status", "approval_requests"),
                         ("ix_user_invites_user_id", "user_invites")):
        op.drop_index(index, table_name=table)
    for table in ("risk_register", "spent_ballots", "blind_keys", "urn_shares", "result_views", "audit_anchors",
                  "approval_requests", "user_invites", "checklist_assignments", "fact_definitions", "positions",
                  "respondent_categories"):
        op.drop_table(table)
    for column in ("urn_close_requested", "urn_public_key", "urn_enabled"):
        op.drop_column("campaigns", column)
    op.drop_column("answers", "variant")
    op.drop_column("questions", "params")
