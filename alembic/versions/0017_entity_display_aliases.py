"""Add bounded display aliases for devices and network interfaces.

Revision ID: 0017_entity_display_aliases
Revises: 0016_network_interface_physical_owners
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0017_entity_display_aliases"
down_revision: str | None = "0016_network_interface_physical_owners"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "entity_metadata",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("physical_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("network_interface_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.CheckConstraint(
            "(physical_object_id IS NOT NULL) <> (network_interface_id IS NOT NULL)",
            name=op.f("ck_entity_metadata_exactly_one_entity"),
        ),
        sa.CheckConstraint(
            "key = 'alias.display'",
            name=op.f("ck_entity_metadata_display_alias_only"),
        ),
        sa.CheckConstraint(
            "char_length(btrim(value)) > 0",
            name=op.f("ck_entity_metadata_value_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["network_interface_id"],
            ["network_interfaces.id"],
            name=op.f("fk_entity_metadata_network_interface_id_network_interfaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["physical_object_id"],
            ["physical_objects.id"],
            name=op.f("fk_entity_metadata_physical_object_id_physical_objects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_entity_metadata")),
        sa.UniqueConstraint(
            "network_interface_id",
            "key",
            name="uq_entity_metadata_network_interface_key",
        ),
        sa.UniqueConstraint(
            "physical_object_id",
            "key",
            name="uq_entity_metadata_physical_object_key",
        ),
    )


def downgrade() -> None:
    op.drop_table("entity_metadata")
