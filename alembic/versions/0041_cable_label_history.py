"""Persist Cable label history and backfill current assignments.

Revision ID: 0041_cable_label_history
Revises: 0040_cable_label_naming
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0041_cable_label_history"
down_revision: str | None = "0040_cable_label_naming"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cable_label_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("cable_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cable_label_history_label", "cable_label_history", ["label"])
    op.create_index("ix_cable_label_history_cable_id", "cable_label_history", ["cable_id"])
    op.execute(
        """
        INSERT INTO cable_label_history (id, label, cable_id, assigned_at)
        SELECT id, label, id, now()
        FROM cables
        WHERE label IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_cable_label_history_cable_id", table_name="cable_label_history")
    op.drop_index("ix_cable_label_history_label", table_name="cable_label_history")
    op.drop_table("cable_label_history")
