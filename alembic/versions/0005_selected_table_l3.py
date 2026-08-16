"""Add the configured selected-table L3 routing slice.

Revision ID: 0005_selected_table_l3
Revises: 0004_configured_local_l2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_selected_table_l3"
down_revision: str | None = "0004_configured_local_l2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "routing_contexts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routing_contexts")),
    )
    op.create_table(
        "l3_bindings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("interface_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("routing_context_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["interface_id"],
            ["network_interfaces.id"],
            name=op.f("fk_l3_bindings_interface_id_network_interfaces"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["routing_context_id"],
            ["routing_contexts.id"],
            name=op.f("fk_l3_bindings_routing_context_id_routing_contexts"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_l3_bindings")),
        sa.UniqueConstraint(
            "interface_id",
            "routing_context_id",
            name="uq_l3_bindings_interface_context",
        ),
    )
    op.create_index("ix_l3_bindings_interface_id", "l3_bindings", ["interface_id"])
    op.create_index("ix_l3_bindings_context_id", "l3_bindings", ["routing_context_id"])
    op.create_table(
        "routing_tables",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("routing_context_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("address_family", sa.String(length=4), nullable=False),
        sa.Column("configured_completeness", sa.String(length=8), nullable=False),
        sa.CheckConstraint(
            "address_family IN ('IPv4', 'IPv6')",
            name=op.f("ck_routing_tables_address_family_valid"),
        ),
        sa.CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name=op.f("ck_routing_tables_configured_completeness_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["routing_context_id"],
            ["routing_contexts.id"],
            name=op.f("fk_routing_tables_routing_context_id_routing_contexts"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routing_tables")),
    )
    op.create_index("ix_routing_tables_context_id", "routing_tables", ["routing_context_id"])
    op.create_index(
        "ix_routing_tables_context_family",
        "routing_tables",
        ["routing_context_id", "address_family"],
    )
    op.create_table(
        "routes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("routing_table_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("destination_prefix", postgresql.CIDR(), nullable=False),
        sa.Column("disposition", sa.String(length=7), nullable=False),
        sa.CheckConstraint(
            "disposition IN ('FORWARD', 'LOCAL', 'DISCARD')",
            name=op.f("ck_routes_disposition_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["routing_table_id"],
            ["routing_tables.id"],
            name=op.f("fk_routes_routing_table_id_routing_tables"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routes")),
    )
    op.create_index("ix_routes_table_id", "routes", ["routing_table_id"])
    op.create_index("ix_routes_destination_prefix", "routes", ["destination_prefix"])
    op.create_table(
        "route_next_hops",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("route_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("gateway_address", postgresql.INET(), nullable=True),
        sa.Column("egress_l3_binding_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "gateway_address IS NOT NULL OR egress_l3_binding_id IS NOT NULL",
            name=op.f("ck_route_next_hops_gateway_or_egress_required"),
        ),
        sa.ForeignKeyConstraint(
            ["egress_l3_binding_id"],
            ["l3_bindings.id"],
            name=op.f("fk_route_next_hops_egress_l3_binding_id_l3_bindings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["route_id"],
            ["routes.id"],
            name=op.f("fk_route_next_hops_route_id_routes"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_route_next_hops")),
    )
    op.create_index("ix_route_next_hops_route_id", "route_next_hops", ["route_id"])
    op.create_index(
        "ix_route_next_hops_egress_binding_id",
        "route_next_hops",
        ["egress_l3_binding_id"],
    )


def downgrade() -> None:
    op.drop_table("route_next_hops")
    op.drop_table("routes")
    op.drop_table("routing_tables")
    op.drop_table("l3_bindings")
    op.drop_table("routing_contexts")
