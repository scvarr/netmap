"""Add configured deterministic NAT policies and rules.

Revision ID: 0009_configured_nat_policy
Revises: 0008_security_policy_attachments
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_configured_nat_policy"
down_revision: str | None = "0008_security_policy_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "nat_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "default_transform",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("configured_completeness", sa.String(length=8), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(default_transform) = 'object'",
            name=op.f("ck_nat_policies_default_transform_object"),
        ),
        sa.CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name=op.f("ck_nat_policies_configured_completeness_valid"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_nat_policies")),
    )
    op.create_table(
        "nat_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_key", sa.Integer(), nullable=False),
        sa.Column("predicate", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("transform", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(predicate) = 'object'",
            name=op.f("ck_nat_rules_predicate_object"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(transform) = 'object'",
            name=op.f("ck_nat_rules_transform_object"),
        ),
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["nat_policies.id"],
            name=op.f("fk_nat_rules_policy_id_nat_policies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_nat_rules")),
        sa.UniqueConstraint(
            "policy_id", "order_key", name=op.f("uq_nat_rules_policy_order")
        ),
    )
    op.create_index("ix_nat_rules_policy_id", "nat_rules", ["policy_id"])


def downgrade() -> None:
    op.drop_table("nat_rules")
    op.drop_table("nat_policies")
