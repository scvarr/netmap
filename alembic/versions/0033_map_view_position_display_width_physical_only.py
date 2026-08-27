"""Restrict Saved Map display width to the physical L1 view.

Revision ID: 0033_map_view_position_display_width_physical_only
Revises: 0032_map_view_position_display_width
"""
from collections.abc import Sequence

from alembic import op


revision: str = "0033_map_view_position_display_width_physical_only"
down_revision: str | None = "0032_map_view_position_display_width"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("map_view_positions_display_width_positive", "map_view_positions", type_="check")
    op.create_check_constraint(
        "map_view_positions_display_width_physical_positive",
        "map_view_positions",
        "display_width IS NULL OR (view_key = 'L1/PHYSICAL_OBJECT' AND display_width > 0)",
    )


def downgrade() -> None:
    op.drop_constraint("map_view_positions_display_width_physical_positive", "map_view_positions", type_="check")
    op.create_check_constraint(
        "map_view_positions_display_width_positive",
        "map_view_positions",
        "display_width IS NULL OR display_width > 0",
    )
