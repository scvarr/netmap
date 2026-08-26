"""Add library-owned immutable Port Block snapshots.

Revision ID: 0026_port_blocks
Revises: 0025_map_cable_routes
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0026_port_blocks"
down_revision: str | None = "0025_map_cable_routes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "port_blocks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "port_block_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("port_block_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.CheckConstraint("version_number >= 1", name="version_number_positive"),
        sa.ForeignKeyConstraint(["port_block_id"], ["port_blocks.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("port_block_id", "version_number", name="uq_port_block_versions_number"),
    )
    op.create_table(
        "port_block_ports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("port_block_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("local_id", sa.String(length=255), nullable=False),
        sa.Column("display_label", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("row", sa.Integer(), nullable=False),
        sa.Column("layout_column", sa.Integer(), nullable=False),
        sa.Column("layout_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("char_length(btrim(local_id)) > 0", name="local_id_not_blank"),
        sa.CheckConstraint("char_length(btrim(display_label)) > 0", name="display_label_not_blank"),
        sa.CheckConstraint("kind IN ('CONNECTION_POINT', 'NETWORK_PORT')", name="kind_supported"),
        sa.CheckConstraint("row >= 1 AND row <= 2", name="row_supported"),
        sa.CheckConstraint("layout_column >= 1", name="column_positive"),
        sa.CheckConstraint("layout_order >= 1", name="layout_order_positive"),
        sa.ForeignKeyConstraint(["port_block_version_id"], ["port_block_versions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("port_block_version_id", "local_id", name="uq_port_block_ports_local_id"),
        sa.UniqueConstraint("port_block_version_id", "row", "layout_column", name="uq_port_block_ports_position"),
        sa.UniqueConstraint("port_block_version_id", "layout_order", name="uq_port_block_ports_layout_order"),
    )


def downgrade() -> None:
    op.drop_table("port_block_ports")
    op.drop_table("port_block_versions")
    op.drop_table("port_blocks")
