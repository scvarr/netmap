"""Add configured NAT pools used by SELECT_FROM transforms.

Revision ID: 0011_nat_pools_select_from
Revises: 0010_nat_policy_attachments
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_nat_pools_select_from"
down_revision: str | None = "0010_nat_policy_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "nat_pools",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "address_ranges",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "port_ranges",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.CheckConstraint(
            "jsonb_typeof(address_ranges) = 'array'",
            name=op.f("ck_nat_pools_address_ranges_array"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(port_ranges) = 'array'",
            name=op.f("ck_nat_pools_port_ranges_array"),
        ),
        sa.CheckConstraint(
            "jsonb_array_length(address_ranges) + jsonb_array_length(port_ranges) > 0",
            name=op.f("ck_nat_pools_ranges_not_empty"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_nat_pools")),
    )


def downgrade() -> None:
    op.drop_table("nat_pools")
