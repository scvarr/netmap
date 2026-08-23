"""Add presentation-only SavedMap and MapPlacement storage.

Revision ID: 0022_saved_maps
Revises: 0021_blueprint_authoring_recipe
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0022_saved_maps"
down_revision: str | None = "0021_blueprint_authoring_recipe"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_maps",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_saved_maps_name"),
    )
    op.create_table(
        "map_placements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("map_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("physical_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["map_id"], ["saved_maps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["physical_object_id"], ["physical_objects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("map_id", "physical_object_id", name="uq_map_placements_map_object"),
    )
    op.create_index("ix_map_placements_physical_object_id", "map_placements", ["physical_object_id"])


def downgrade() -> None:
    op.drop_index("ix_map_placements_physical_object_id", table_name="map_placements")
    op.drop_table("map_placements")
    op.drop_table("saved_maps")
