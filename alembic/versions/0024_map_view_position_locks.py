"""Add per-view placement locks to presentation positions.

Revision ID: 0024_map_view_position_locks
Revises: 0023_map_view_positions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0024_map_view_position_locks"
down_revision: str | None = "0023_map_view_positions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "map_view_positions",
        sa.Column("locked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("map_view_positions", "locked")
