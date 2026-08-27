"""Add immutable face-local presentation rectangles to Blueprint Port Block instances.

Revision ID: 0030_blueprint_port_block_instance_placement
Revises: 0029_repair_blueprint_composition_schema
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0030_blueprint_port_block_instance_placement"
down_revision: str | None = "0029_repair_blueprint_composition_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for name in ("placement_x", "placement_y", "placement_width", "placement_height"):
        op.add_column("blueprint_port_block_instances", sa.Column(name, sa.Float(), nullable=True))
    op.create_check_constraint("ck_blueprint_block_placement_x", "blueprint_port_block_instances", "placement_x IS NULL OR (placement_x >= 0 AND placement_x <= 1)")
    op.create_check_constraint("ck_blueprint_block_placement_y", "blueprint_port_block_instances", "placement_y IS NULL OR (placement_y >= 0 AND placement_y <= 1)")
    op.create_check_constraint("ck_blueprint_block_placement_width", "blueprint_port_block_instances", "placement_width IS NULL OR (placement_width > 0 AND placement_width <= 1)")
    op.create_check_constraint("ck_blueprint_block_placement_height", "blueprint_port_block_instances", "placement_height IS NULL OR (placement_height > 0 AND placement_height <= 1)")
    op.create_check_constraint("ck_blueprint_block_placement_bounds", "blueprint_port_block_instances", "(placement_x IS NULL AND placement_y IS NULL AND placement_width IS NULL AND placement_height IS NULL) OR (placement_x + placement_width <= 1 AND placement_y + placement_height <= 1)")


def downgrade() -> None:
    for name in ("ck_blueprint_block_placement_bounds", "ck_blueprint_block_placement_height", "ck_blueprint_block_placement_width", "ck_blueprint_block_placement_y", "ck_blueprint_block_placement_x"):
        op.drop_constraint(name, "blueprint_port_block_instances", type_="check")
    for name in ("placement_height", "placement_width", "placement_y", "placement_x"):
        op.drop_column("blueprint_port_block_instances", name)
