"""Require Blueprint Port Block placement rectangles to be all-null or complete.

Revision ID: 0031_blueprint_port_block_placement_completeness
Revises: 0030_blueprint_port_block_instance_placement
"""
from collections.abc import Sequence

from alembic import op


revision: str = "0031_blueprint_port_block_placement_completeness"
down_revision: str | None = "0030_blueprint_port_block_instance_placement"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_blueprint_block_placement_complete_or_null",
        "blueprint_port_block_instances",
        "num_nonnulls(placement_x, placement_y, placement_width, placement_height) IN (0, 4)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_blueprint_block_placement_complete_or_null", "blueprint_port_block_instances", type_="check")
