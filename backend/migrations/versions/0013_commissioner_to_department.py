"""ролі: commissioner поглинає department

Роль commissioner (укладач анкет) прибрано: анкети веде Департамент, пункти чек-листа підтверджує
внутрішній аудит. Обліковим записам commissioner ставимо department; у незавершених запитах принципу
двох осіб — те саме; призначення підтверджувача чек-листа, яке вказувало на колишнього commissioner,
знімаємо (підтверджувати тепер може лише CHECKLIST_CONFIRMERS, за замовчуванням auditor).

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-20 20:00:00
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    former = [row[0] for row in bind.execute(sa.text("SELECT id FROM users WHERE role = 'commissioner'"))]
    if former:
        assignments = sa.table("checklist_assignments", sa.column("confirmer_id"))
        op.execute(assignments.update().where(assignments.c.confirmer_id.in_(former)).values(confirmer_id=None))
    op.execute("UPDATE users SET role = 'department' WHERE role = 'commissioner'")

    approvals = sa.table("approval_requests", sa.column("id"), sa.column("payload", sa.JSON))
    for row_id, payload in bind.execute(sa.text("SELECT id, payload FROM approval_requests")):
        data = json.loads(payload) if isinstance(payload, str) else (payload or {})
        changes = data.get("changes") or {}
        if changes.get("role") == "commissioner":
            changes["role"] = "department"
            bind.execute(approvals.update().where(approvals.c.id == row_id).values(payload=data))


def downgrade() -> None:
    # Хто був commissioner до міграції, не збережено: зворотної зміни ролей немає.
    pass
