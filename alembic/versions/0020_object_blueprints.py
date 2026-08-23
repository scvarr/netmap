"""Add immutable object blueprint authoring and materialization provenance.

Revision ID: 0020_object_blueprints
Revises: 0019_physical_object_class_metadata
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0020_object_blueprints"
down_revision: str | None = "0019_physical_object_class_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "object_blueprints",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name=op.f("ck_object_blueprints_name_not_blank")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_object_blueprints")),
    )
    op.create_table(
        "object_blueprint_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("blueprint_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("default_physical_object_class", sa.String(length=255), nullable=True),
        sa.Column("body_kind", sa.String(length=32), nullable=False),
        sa.Column("width", sa.Float(), nullable=False),
        sa.Column("height", sa.Float(), nullable=False),
        sa.Column("fill_color", sa.String(length=7), nullable=True),
        sa.CheckConstraint("version_number >= 1", name=op.f("ck_object_blueprint_versions_version_number_positive")),
        sa.CheckConstraint("body_kind = 'RECTANGLE'", name=op.f("ck_object_blueprint_versions_rectangle_only")),
        sa.CheckConstraint("width > 0", name=op.f("ck_object_blueprint_versions_width_positive")),
        sa.CheckConstraint("height > 0", name=op.f("ck_object_blueprint_versions_height_positive")),
        sa.CheckConstraint("fill_color IS NULL OR fill_color ~ '^#[0-9A-Fa-f]{6}$'", name=op.f("ck_object_blueprint_versions_fill_color_hex")),
        sa.ForeignKeyConstraint(["blueprint_id"], ["object_blueprints.id"], name=op.f("fk_object_blueprint_versions_blueprint_id_object_blueprints"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_object_blueprint_versions")),
        sa.UniqueConstraint("blueprint_id", "version_number", name="uq_object_blueprint_versions_number"),
    )
    op.create_table(
        "blueprint_endpoint_slots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("blueprint_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slot_key", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("anchor_side", sa.String(length=16), nullable=False),
        sa.Column("anchor_offset", sa.Float(), nullable=False),
        sa.CheckConstraint("char_length(btrim(slot_key)) > 0", name=op.f("ck_blueprint_endpoint_slots_slot_key_not_blank")),
        sa.CheckConstraint("char_length(btrim(display_name)) > 0", name=op.f("ck_blueprint_endpoint_slots_display_name_not_blank")),
        sa.CheckConstraint("kind IN ('CONNECTION_POINT', 'NETWORK_PORT')", name=op.f("ck_blueprint_endpoint_slots_kind_supported")),
        sa.CheckConstraint("anchor_side IN ('LEFT', 'RIGHT', 'TOP', 'BOTTOM')", name=op.f("ck_blueprint_endpoint_slots_anchor_side_supported")),
        sa.CheckConstraint("anchor_offset >= 0 AND anchor_offset <= 1", name=op.f("ck_blueprint_endpoint_slots_anchor_offset_range")),
        sa.ForeignKeyConstraint(["blueprint_version_id"], ["object_blueprint_versions.id"], name=op.f("fk_blueprint_endpoint_slots_blueprint_version_id_object_blueprint_versions"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_blueprint_endpoint_slots")),
        sa.UniqueConstraint("blueprint_version_id", "slot_key", name="uq_blueprint_endpoint_slots_key"),
    )
    op.create_table(
        "blueprint_internal_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("blueprint_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slot_a_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slot_b_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.CheckConstraint("slot_a_id <> slot_b_id", name=op.f("ck_blueprint_internal_links_distinct_slots")),
        sa.ForeignKeyConstraint(["blueprint_version_id"], ["object_blueprint_versions.id"], name=op.f("fk_blueprint_internal_links_blueprint_version_id_object_blueprint_versions"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["slot_a_id"], ["blueprint_endpoint_slots.id"], name=op.f("fk_blueprint_internal_links_slot_a_id_blueprint_endpoint_slots"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["slot_b_id"], ["blueprint_endpoint_slots.id"], name=op.f("fk_blueprint_internal_links_slot_b_id_blueprint_endpoint_slots"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_blueprint_internal_links")),
        sa.UniqueConstraint("blueprint_version_id", "slot_a_id", "slot_b_id", name="uq_blueprint_internal_links_unordered"),
    )
    op.create_table(
        "blueprint_instances",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("blueprint_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("physical_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["blueprint_version_id"], ["object_blueprint_versions.id"], name=op.f("fk_blueprint_instances_blueprint_version_id_object_blueprint_versions"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["physical_object_id"], ["physical_objects.id"], name=op.f("fk_blueprint_instances_physical_object_id_physical_objects"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_blueprint_instances")),
        sa.UniqueConstraint("physical_object_id", name="uq_blueprint_instances_physical_object"),
    )
    op.create_table(
        "blueprint_instance_slots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("blueprint_instance_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("blueprint_slot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_point_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("network_interface_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["blueprint_instance_id"], ["blueprint_instances.id"], name=op.f("fk_blueprint_instance_slots_blueprint_instance_id_blueprint_instances"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["blueprint_slot_id"], ["blueprint_endpoint_slots.id"], name=op.f("fk_blueprint_instance_slots_blueprint_slot_id_blueprint_endpoint_slots"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["connection_point_id"], ["connection_points.id"], name=op.f("fk_blueprint_instance_slots_connection_point_id_connection_points"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["network_interface_id"], ["network_interfaces.id"], name=op.f("fk_blueprint_instance_slots_network_interface_id_network_interfaces"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_blueprint_instance_slots")),
        sa.UniqueConstraint("blueprint_instance_id", "blueprint_slot_id", name="uq_blueprint_instance_slots_slot"),
        sa.UniqueConstraint("connection_point_id", name="uq_blueprint_instance_slots_connection_point"),
        sa.UniqueConstraint("network_interface_id", name="uq_blueprint_instance_slots_network_interface"),
    )


def downgrade() -> None:
    op.drop_table("blueprint_instance_slots")
    op.drop_table("blueprint_instances")
    op.drop_table("blueprint_internal_links")
    op.drop_table("blueprint_endpoint_slots")
    op.drop_table("object_blueprint_versions")
    op.drop_table("object_blueprints")
