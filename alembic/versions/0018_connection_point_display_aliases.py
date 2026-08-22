"""Add display aliases for connection points.

Revision ID: 0018_connection_point_display_aliases
Revises: 0017_entity_display_aliases
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0018_connection_point_display_aliases"
down_revision: str | None = "0017_entity_display_aliases"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "entity_metadata",
        sa.Column("connection_point_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_entity_metadata_connection_point_id_connection_points"),
        "entity_metadata",
        "connection_points",
        ["connection_point_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint(
        op.f("ck_entity_metadata_exactly_one_entity"),
        "entity_metadata",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_entity_metadata_exactly_one_entity"),
        "entity_metadata",
        "num_nonnulls(physical_object_id, network_interface_id, connection_point_id) = 1",
    )
    op.create_unique_constraint(
        "uq_entity_metadata_connection_point_key",
        "entity_metadata",
        ["connection_point_id", "key"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_entity_metadata_connection_point_key",
        "entity_metadata",
        type_="unique",
    )
    op.drop_constraint(
        op.f("ck_entity_metadata_exactly_one_entity"),
        "entity_metadata",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_entity_metadata_exactly_one_entity"),
        "entity_metadata",
        "(physical_object_id IS NOT NULL) <> (network_interface_id IS NOT NULL)",
    )
    op.drop_constraint(
        op.f("fk_entity_metadata_connection_point_id_connection_points"),
        "entity_metadata",
        type_="foreignkey",
    )
    op.drop_column("entity_metadata", "connection_point_id")
