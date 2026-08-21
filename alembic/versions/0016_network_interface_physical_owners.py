"""Add typed physical owners for NetworkInterface.

Revision ID: 0016_network_interface_physical_owners
Revises: 0015_packet_processing_plan_attachments
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0016_network_interface_physical_owners"
down_revision: str | None = "0015_packet_processing_plan_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "network_interface_physical_owners",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("interface_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("physical_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["interface_id"],
            ["network_interfaces.id"],
            name=op.f(
                "fk_network_interface_physical_owners_interface_id_network_interfaces"
            ),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["physical_object_id"],
            ["physical_objects.id"],
            name=op.f(
                "fk_network_interface_physical_owners_physical_object_id_physical_objects"
            ),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_network_interface_physical_owners")
        ),
        sa.UniqueConstraint(
            "interface_id", name="uq_network_interface_physical_owners_interface"
        ),
    )
    op.create_index(
        "ix_network_interface_physical_owners_physical_object_id",
        "network_interface_physical_owners",
        ["physical_object_id"],
    )


def downgrade() -> None:
    op.drop_table("network_interface_physical_owners")
