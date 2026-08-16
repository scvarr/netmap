"""Add scoped InterfaceAddress assignments.

Revision ID: 0006_interface_addresses
Revises: 0005_selected_table_l3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_interface_addresses"
down_revision: str | None = "0005_selected_table_l3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "interface_addresses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("l3_binding_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("address", postgresql.INET(), nullable=False),
        sa.Column("prefix_length", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "(family(address) = 4 AND prefix_length BETWEEN 0 AND 32) OR "
            "(family(address) = 6 AND prefix_length BETWEEN 0 AND 128)",
            name=op.f("ck_interface_addresses_prefix_length_matches_family"),
        ),
        sa.ForeignKeyConstraint(
            ["l3_binding_id"],
            ["l3_bindings.id"],
            name=op.f("fk_interface_addresses_l3_binding_id_l3_bindings"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_interface_addresses")),
    )
    op.create_index(
        "ix_interface_addresses_l3_binding_id",
        "interface_addresses",
        ["l3_binding_id"],
    )
    op.create_index(
        "ix_interface_addresses_address", "interface_addresses", ["address"]
    )


def downgrade() -> None:
    op.drop_table("interface_addresses")
