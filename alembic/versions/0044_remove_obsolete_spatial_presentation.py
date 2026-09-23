"""Remove development-stage composite and region persistence.

Revision ID: 0044_remove_obsolete_spatial_presentation
Revises: 0043_map_composite_visible_placements
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0044_remove_obsolete_spatial_presentation"
down_revision = "0043_map_composite_visible_placements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("map_composite_visible_placements")
    op.drop_table("map_composite_presentations")
    op.drop_table("map_composite_members")
    op.drop_table("map_composites")
    op.drop_table("map_regions")


def downgrade() -> None:
    # Schema-only downgrade. Obsolete development rows are intentionally lost.
    op.create_table(
        "map_regions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("map_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("saved_maps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("locations.id", ondelete="SET NULL", name="fk_map_regions_location_id_locations")),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("points", postgresql.JSONB(), nullable=False),
        sa.Column("label_position", postgresql.JSONB()),
        sa.Column("fill_color", sa.String(7), nullable=False),
        sa.Column("fill_opacity", sa.Float(), nullable=False),
        sa.Column("stroke_color", sa.String(7), nullable=False),
        sa.Column("stroke_width", sa.Float(), nullable=False),
        sa.Column("stroke_style", sa.String(16), nullable=False),
        sa.Column("label_color", sa.String(7)),
        sa.Column("z_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("char_length(btrim(label)) > 0", name="label_not_blank"),
        sa.CheckConstraint("fill_color ~ '^#[0-9A-Fa-f]{6}$'", name="fill_color_hex"),
        sa.CheckConstraint("fill_opacity >= 0 AND fill_opacity <= 1", name="fill_opacity_range"),
        sa.CheckConstraint("stroke_color ~ '^#[0-9A-Fa-f]{6}$'", name="stroke_color_hex"),
        sa.CheckConstraint("stroke_width >= 0", name="stroke_width_nonnegative"),
        sa.CheckConstraint("stroke_style IN ('solid', 'dashed', 'dotted')", name="stroke_style_valid"),
        sa.CheckConstraint("label_color IS NULL OR label_color ~ '^#[0-9A-Fa-f]{6}$'", name="label_color_hex"),
    )
    op.create_index("ix_map_regions_map_z_order", "map_regions", ["map_id", "z_order"])
    op.create_index("ix_map_regions_location_id", "map_regions", ["location_id"])
    op.create_table(
        "map_composites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("map_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("saved_maps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
    )
    op.create_table(
        "map_composite_members",
        sa.Column("composite_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_composites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("placement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_placements.id", ondelete="CASCADE"), primary_key=True),
        sa.UniqueConstraint("placement_id", name="uq_map_composite_members_placement"),
    )
    op.create_table(
        "map_composite_presentations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("composite_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_composites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("variant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_presentation_variants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("collapsed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("x", sa.Float(), nullable=False, server_default="0"),
        sa.Column("y", sa.Float(), nullable=False, server_default="0"),
        sa.Column("width", sa.Float(), nullable=False, server_default="280"),
        sa.Column("height", sa.Float(), nullable=False, server_default="180"),
        sa.CheckConstraint("width > 0 AND height > 0", name="dimensions_positive"),
        sa.UniqueConstraint("composite_id", "variant_id", name="uq_map_composite_presentations_composite_variant"),
    )
    op.create_table(
        "map_composite_visible_placements",
        sa.Column("composite_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_composites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("placement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_placements.id", ondelete="CASCADE"), primary_key=True),
    )
