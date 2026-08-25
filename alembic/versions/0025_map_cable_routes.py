"""Add SavedMap-owned Physical/L1 cable route geometry.

Revision ID: 0025_map_cable_routes
Revises: 0024_map_view_position_locks
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0025_map_cable_routes"
down_revision: str | None = "0024_map_view_position_locks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "map_cable_routes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("map_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cable_physical_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("view_key", sa.String(length=32), nullable=False),
        sa.Column("waypoints", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.CheckConstraint("view_key = 'L1/PHYSICAL_OBJECT'", name="map_cable_routes_view_key_physical_only"),
        sa.ForeignKeyConstraint(["map_id"], ["saved_maps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cable_physical_object_id"], ["physical_objects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("map_id", "cable_physical_object_id", "view_key", name="uq_map_cable_routes_map_cable_view"),
    )
    op.create_index("ix_map_cable_routes_cable_physical_object_id", "map_cable_routes", ["cable_physical_object_id"])


def downgrade() -> None:
    op.drop_index("ix_map_cable_routes_cable_physical_object_id", table_name="map_cable_routes")
    op.drop_table("map_cable_routes")
