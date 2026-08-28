"""Cut over Cable from PhysicalObject aggregate to Connection identity.

Revision ID: 0035_canonical_cables
Revises: 0034_remove_blueprint_endpoint_slot_anchor

This is intentionally destructive for development-stage cable aggregates.  No
legacy Cable data or SavedMap route identity is converted.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0035_canonical_cables"
down_revision: str | None = "0034_remove_blueprint_endpoint_slot_anchor"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("map_cable_routes")

    # Remove the obsolete Cable-as-PhysicalObject aggregates rather than
    # translating their three Connections into the new one-Connection model.
    op.execute(
        """
        CREATE TEMP TABLE cable_1_legacy_objects ON COMMIT DROP AS
        SELECT physical_object_id AS id
        FROM entity_metadata
        WHERE key = 'class' AND value = 'cable' AND physical_object_id IS NOT NULL;

        CREATE TEMP TABLE cable_1_legacy_points ON COMMIT DROP AS
        SELECT id FROM connection_points
        WHERE physical_object_id IN (SELECT id FROM cable_1_legacy_objects);

        CREATE TEMP TABLE cable_1_legacy_connections ON COMMIT DROP AS
        SELECT id FROM connections
        WHERE point_a_id IN (SELECT id FROM cable_1_legacy_points)
           OR point_b_id IN (SELECT id FROM cable_1_legacy_points);

        CREATE TEMP TABLE cable_1_legacy_instances ON COMMIT DROP AS
        SELECT id FROM blueprint_instances
        WHERE physical_object_id IN (SELECT id FROM cable_1_legacy_objects);

        DELETE FROM connection_members
        WHERE connection_id IN (SELECT id FROM cable_1_legacy_connections);
        DELETE FROM connections
        WHERE id IN (SELECT id FROM cable_1_legacy_connections);
        DELETE FROM blueprint_instance_slots
        WHERE blueprint_instance_id IN (SELECT id FROM cable_1_legacy_instances);
        DELETE FROM blueprint_instances
        WHERE id IN (SELECT id FROM cable_1_legacy_instances);
        DELETE FROM interface_physical_bindings
        WHERE point_id IN (SELECT id FROM cable_1_legacy_points);
        DELETE FROM map_placements
        WHERE physical_object_id IN (SELECT id FROM cable_1_legacy_objects);
        DELETE FROM entity_metadata
        WHERE physical_object_id IN (SELECT id FROM cable_1_legacy_objects)
           OR connection_point_id IN (SELECT id FROM cable_1_legacy_points);
        DELETE FROM connection_points
        WHERE id IN (SELECT id FROM cable_1_legacy_points);
        DELETE FROM physical_objects
        WHERE id IN (SELECT id FROM cable_1_legacy_objects);
        """
    )

    op.create_table(
        "cables",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["connection_id"], ["connections.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("connection_id", name="uq_cables_connection"),
    )
    op.create_index("ix_cables_connection_id", "cables", ["connection_id"])

    op.create_table(
        "map_cable_routes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("map_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cable_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("view_key", sa.String(length=32), nullable=False),
        sa.Column(
            "waypoints",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.CheckConstraint(
            "view_key = 'L1/PHYSICAL_OBJECT'",
            name="map_cable_routes_view_key_physical_only",
        ),
        sa.ForeignKeyConstraint(["map_id"], ["saved_maps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cable_id"], ["cables.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "map_id", "cable_id", "view_key", name="uq_map_cable_routes_map_cable_view"
        ),
    )
    op.create_index("ix_map_cable_routes_cable_id", "map_cable_routes", ["cable_id"])


def downgrade() -> None:
    op.drop_table("map_cable_routes")
    op.drop_index("ix_cables_connection_id", table_name="cables")
    op.drop_table("cables")
    op.create_table(
        "map_cable_routes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("map_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cable_physical_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("view_key", sa.String(length=32), nullable=False),
        sa.Column(
            "waypoints",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.CheckConstraint(
            "view_key = 'L1/PHYSICAL_OBJECT'",
            name="map_cable_routes_view_key_physical_only",
        ),
        sa.ForeignKeyConstraint(["map_id"], ["saved_maps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["cable_physical_object_id"], ["physical_objects.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "map_id",
            "cable_physical_object_id",
            "view_key",
            name="uq_map_cable_routes_map_cable_view",
        ),
    )
    op.create_index(
        "ix_map_cable_routes_cable_physical_object_id",
        "map_cable_routes",
        ["cable_physical_object_id"],
    )
