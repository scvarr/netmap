"""Replace Port Block composition with direct Blueprint endpoint slots.

Revision ID: 0046_direct_blueprint_slots
Revises: 0045_variant_location_states
"""
from alembic import op
import sqlalchemy as sa


revision = "0046_direct_blueprint_slots"
down_revision = "0045_variant_location_states"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Development-stage authoring records are intentionally discarded. Canonical
    # topology is independent and is not deleted by this change.
    op.execute("DELETE FROM blueprint_instance_slots")
    op.execute("DELETE FROM blueprint_instances")
    op.execute("DELETE FROM blueprint_internal_links")
    op.execute("DELETE FROM blueprint_endpoint_slots")
    op.execute("DELETE FROM blueprint_port_block_instances")
    op.execute("DELETE FROM object_blueprint_versions")
    op.execute("DELETE FROM object_blueprints")

    op.drop_constraint("uq_blueprint_slot_block_local_id", "blueprint_endpoint_slots", type_="unique")
    op.drop_column("blueprint_endpoint_slots", "port_block_instance_id")
    op.drop_column("blueprint_endpoint_slots", "port_block_local_id")
    op.add_column("blueprint_endpoint_slots", sa.Column("face", sa.String(8), nullable=False))
    op.add_column("blueprint_endpoint_slots", sa.Column("position_x", sa.Float(), nullable=False))
    op.add_column("blueprint_endpoint_slots", sa.Column("position_y", sa.Float(), nullable=False))
    op.create_check_constraint("ck_blueprint_endpoint_slots_face_supported", "blueprint_endpoint_slots", "face IN ('FRONT', 'REAR')")
    op.create_check_constraint("ck_blueprint_endpoint_slots_position_bounds", "blueprint_endpoint_slots", "position_x >= 0 AND position_x <= 1 AND position_y >= 0 AND position_y <= 1")

    op.drop_table("blueprint_port_block_instances")
    op.drop_table("port_block_ports")
    op.drop_table("port_block_versions")
    op.drop_table("port_blocks")
    op.drop_column("object_blueprint_versions", "composition_kind")
    op.drop_column("object_blueprint_versions", "authoring_recipe")


def downgrade() -> None:
    raise RuntimeError("Destructive direct endpoint cutover cannot restore development Port Block records")
