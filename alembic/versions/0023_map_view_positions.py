"""Split SavedMap membership from per-view presentation positions.

Revision ID: 0023_map_view_positions
Revises: 0022_saved_maps
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0023_map_view_positions"
down_revision: str | None = "0022_saved_maps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PHYSICAL_VIEW_KEY = "L1/PHYSICAL_OBJECT"


def upgrade() -> None:
    op.create_table(
        "map_view_positions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("placement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("view_key", sa.String(length=32), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.CheckConstraint(
            "view_key IN ('L1/PHYSICAL_OBJECT', 'L2/DEVICE')",
            name="map_view_positions_view_key_valid",
        ),
        sa.ForeignKeyConstraint(["placement_id"], ["map_placements.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("placement_id", "view_key", name="uq_map_view_positions_placement_view"),
    )
    bind = op.get_bind()
    legacy = sa.table(
        "map_placements",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("x", sa.Float()),
        sa.column("y", sa.Float()),
    )
    positions = sa.table(
        "map_view_positions",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("placement_id", postgresql.UUID(as_uuid=True)),
        sa.column("view_key", sa.String()),
        sa.column("x", sa.Float()),
        sa.column("y", sa.Float()),
    )
    rows = bind.execute(sa.select(legacy.c.id, legacy.c.x, legacy.c.y)).mappings()
    backfill = [
        {"id": uuid.uuid4(), "placement_id": row["id"], "view_key": PHYSICAL_VIEW_KEY, "x": row["x"], "y": row["y"]}
        for row in rows
    ]
    if backfill:
        bind.execute(positions.insert(), backfill)
    op.drop_column("map_placements", "y")
    op.drop_column("map_placements", "x")


def downgrade() -> None:
    op.add_column("map_placements", sa.Column("x", sa.Float(), nullable=True))
    op.add_column("map_placements", sa.Column("y", sa.Float(), nullable=True))
    op.execute(
        "UPDATE map_placements AS placement SET x = position.x, y = position.y "
        "FROM map_view_positions AS position "
        f"WHERE position.placement_id = placement.id AND position.view_key = '{PHYSICAL_VIEW_KEY}'"
    )
    op.execute("UPDATE map_placements SET x = 0, y = 0 WHERE x IS NULL OR y IS NULL")
    op.alter_column("map_placements", "x", nullable=False)
    op.alter_column("map_placements", "y", nullable=False)
    op.drop_table("map_view_positions")
