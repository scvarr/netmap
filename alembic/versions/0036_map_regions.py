"""Add SavedMap-owned Physical/L1 presentation regions.

Revision ID: 0036_map_regions
Revises: 0035_canonical_cables
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0036_map_regions"
down_revision: str | None = "0035_canonical_cables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "map_regions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("map_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("points", postgresql.JSONB(), nullable=False),
        sa.Column("label_position", postgresql.JSONB(), nullable=True),
        sa.Column("fill_color", sa.String(length=7), nullable=False),
        sa.Column("fill_opacity", sa.Float(), nullable=False),
        sa.Column("stroke_color", sa.String(length=7), nullable=False),
        sa.Column("stroke_width", sa.Float(), nullable=False),
        sa.Column("stroke_style", sa.String(length=16), nullable=False),
        sa.Column("label_color", sa.String(length=7), nullable=True),
        sa.Column("z_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("char_length(btrim(label)) > 0", name="label_not_blank"),
        sa.CheckConstraint("fill_color ~ '^#[0-9A-Fa-f]{6}$'", name="fill_color_hex"),
        sa.CheckConstraint("fill_opacity >= 0 AND fill_opacity <= 1", name="fill_opacity_range"),
        sa.CheckConstraint("stroke_color ~ '^#[0-9A-Fa-f]{6}$'", name="stroke_color_hex"),
        sa.CheckConstraint("stroke_width >= 0", name="stroke_width_nonnegative"),
        sa.CheckConstraint("stroke_style IN ('solid', 'dashed', 'dotted')", name="stroke_style_valid"),
        sa.CheckConstraint("label_color IS NULL OR label_color ~ '^#[0-9A-Fa-f]{6}$'", name="label_color_hex"),
        sa.ForeignKeyConstraint(["map_id"], ["saved_maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_map_regions_map_z_order", "map_regions", ["map_id", "z_order"])


def downgrade() -> None:
    op.drop_index("ix_map_regions_map_z_order", table_name="map_regions")
    op.drop_table("map_regions")
