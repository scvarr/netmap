"""Add mutable Cable labels and the application template library.

Revision ID: 0040_cable_label_naming
Revises: 0039_map_region_location_association
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0040_cable_label_naming"
down_revision: str | None = "0039_map_region_location_association"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cables", sa.Column("label", sa.String(length=255), nullable=True))
    op.create_table(
        "cable_label_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("unique_labels", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint("id = 1", name="cable_label_settings_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("INSERT INTO cable_label_settings (id, unique_labels) VALUES (1, false)")
    op.create_table(
        "cable_label_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("pattern", sa.String(length=255), nullable=False),
        sa.Column("start_at", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="cable_label_template_name_not_blank"),
        sa.CheckConstraint("char_length(btrim(pattern)) > 0", name="cable_label_template_pattern_not_blank"),
        sa.CheckConstraint("start_at >= 0", name="cable_label_template_start_at_nonnegative"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("cable_label_templates")
    op.drop_table("cable_label_settings")
    op.drop_column("cables", "label")
