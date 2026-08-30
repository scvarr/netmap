"""Add SavedMap-owned Physical/L1 text annotations.

Revision ID: 0037_map_text_annotations
Revises: 0036_map_regions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0037_map_text_annotations"
down_revision: str | None = "0036_map_regions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "map_text_annotations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("map_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("text", sa.String(length=2000), nullable=False),
        sa.Column("position", postgresql.JSONB(), nullable=False),
        sa.Column("text_color", sa.String(length=7), nullable=False),
        sa.Column("font_size", sa.Float(), nullable=False),
        sa.CheckConstraint("char_length(btrim(text)) > 0", name="text_not_blank"),
        sa.CheckConstraint("text_color ~ '^#[0-9A-Fa-f]{6}$'", name="text_color_hex"),
        sa.CheckConstraint("font_size > 0", name="font_size_positive"),
        sa.ForeignKeyConstraint(["map_id"], ["saved_maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_map_text_annotations_map_id", "map_text_annotations", ["map_id"])


def downgrade() -> None:
    op.drop_index("ix_map_text_annotations_map_id", table_name="map_text_annotations")
    op.drop_table("map_text_annotations")
