"""Move endpoint naming provenance from Port Blocks to Blueprint instances.

Revision ID: 0046_blueprint_instance_endpoint_naming
Revises: 0045_variant_location_states
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0046_blueprint_instance_endpoint_naming"
down_revision: str | None = "0045_variant_location_states"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("blueprint_port_block_instances", sa.Column("naming_prefix", sa.String(255), nullable=True))
    op.add_column("blueprint_port_block_instances", sa.Column("naming_starting_number", sa.Integer(), nullable=True))
    op.add_column("blueprint_port_block_instances", sa.Column("naming_mode", sa.String(16), nullable=True))
    op.add_column("blueprint_port_block_instances", sa.Column("naming_overrides", postgresql.JSONB(), nullable=True))
    op.create_check_constraint("naming_start_nonnegative", "blueprint_port_block_instances", "naming_starting_number >= 0")
    op.create_check_constraint("naming_mode_supported", "blueprint_port_block_instances", "naming_mode IN ('SINGLE', 'SEQUENTIAL', 'ODD_EVEN', 'EVEN_ODD')")
    op.drop_constraint("display_label_not_blank", "port_block_ports", type_="check")
    op.drop_column("port_block_ports", "display_label")


def downgrade() -> None:
    op.add_column("port_block_ports", sa.Column("display_label", sa.String(255), nullable=True))
    op.execute("UPDATE port_block_ports SET display_label = 'P' || layout_order")
    op.alter_column("port_block_ports", "display_label", nullable=False)
    op.create_check_constraint("display_label_not_blank", "port_block_ports", "char_length(btrim(display_label)) > 0")
    op.drop_constraint("naming_mode_supported", "blueprint_port_block_instances", type_="check")
    op.drop_constraint("naming_start_nonnegative", "blueprint_port_block_instances", type_="check")
    op.drop_column("blueprint_port_block_instances", "naming_overrides")
    op.drop_column("blueprint_port_block_instances", "naming_mode")
    op.drop_column("blueprint_port_block_instances", "naming_starting_number")
    op.drop_column("blueprint_port_block_instances", "naming_prefix")
