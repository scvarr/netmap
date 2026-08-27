"""Add optional per-map L1 Blueprint display width.

Revision ID: 0032_map_view_position_display_width
Revises: 0031_blueprint_port_block_placement_completeness
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0032_map_view_position_display_width"
down_revision: str | None = "0031_blueprint_port_block_placement_completeness"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("map_view_positions", sa.Column("display_width", sa.Float(), nullable=True))
    op.create_check_constraint(
        "map_view_positions_display_width_positive",
        "map_view_positions",
        "display_width IS NULL OR display_width > 0",
    )


def downgrade() -> None:
    op.drop_constraint("map_view_positions_display_width_positive", "map_view_positions", type_="check")
    op.drop_column("map_view_positions", "display_width")
