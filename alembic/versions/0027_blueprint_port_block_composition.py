"""Persist Object Blueprint Port Block composition provenance.

Revision ID: 0027_blueprint_port_block_composition
Revises: 0026_port_blocks
"""
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0027_blueprint_port_block_composition"
down_revision: str | None = "0026_port_blocks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    op.create_table(
        "blueprint_port_block_instances",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("blueprint_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("port_block_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("instance_key", sa.String(length=255), nullable=False),
        sa.CheckConstraint("char_length(btrim(instance_key)) > 0", name="instance_key_not_blank"),
        sa.ForeignKeyConstraint(["blueprint_version_id"], ["object_blueprint_versions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["port_block_version_id"], ["port_block_versions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("blueprint_version_id", "instance_key", name="uq_blueprint_block_instance_key"),
    )
    op.add_column("blueprint_endpoint_slots", sa.Column("port_block_instance_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("blueprint_endpoint_slots", sa.Column("port_block_local_id", sa.String(length=255), nullable=True))
    op.create_foreign_key("fk_blueprint_slot_block_instance", "blueprint_endpoint_slots", "blueprint_port_block_instances", ["port_block_instance_id"], ["id"], ondelete="RESTRICT")
    op.create_unique_constraint("uq_blueprint_slot_block_local_id", "blueprint_endpoint_slots", ["port_block_instance_id", "port_block_local_id"])

def downgrade() -> None:
    op.drop_constraint("uq_blueprint_slot_block_local_id", "blueprint_endpoint_slots", type_="unique")
    op.drop_constraint("fk_blueprint_slot_block_instance", "blueprint_endpoint_slots", type_="foreignkey")
    op.drop_column("blueprint_endpoint_slots", "port_block_local_id")
    op.drop_column("blueprint_endpoint_slots", "port_block_instance_id")
    op.drop_table("blueprint_port_block_instances")
