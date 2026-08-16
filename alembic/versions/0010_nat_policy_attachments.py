"""Add configured NATPolicyAttachment scope selectors.

Revision ID: 0010_nat_policy_attachments
Revises: 0009_configured_nat_policy
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_nat_policy_attachments"
down_revision: str | None = "0009_configured_nat_policy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "nat_policy_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("local_stage_order", sa.Integer(), nullable=False),
        sa.Column("scope", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(scope) = 'object'",
            name=op.f("ck_nat_policy_attachments_scope_object"),
        ),
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["nat_policies.id"],
            name=op.f("fk_nat_policy_attachments_policy_id_nat_policies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_nat_policy_attachments")),
    )
    op.create_index(
        "ix_nat_policy_attachments_policy_id",
        "nat_policy_attachments",
        ["policy_id"],
    )
    op.create_index(
        "ix_nat_policy_attachments_local_stage_order",
        "nat_policy_attachments",
        ["local_stage_order"],
    )


def downgrade() -> None:
    op.drop_table("nat_policy_attachments")
