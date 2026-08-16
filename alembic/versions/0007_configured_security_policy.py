"""Add configured SecurityPolicy and ordered SecurityRule.

Revision ID: 0007_configured_security_policy
Revises: 0006_interface_addresses
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_configured_security_policy"
down_revision: str | None = "0006_interface_addresses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "security_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("default_action", sa.String(length=6), nullable=False),
        sa.Column("configured_completeness", sa.String(length=8), nullable=False),
        sa.CheckConstraint(
            "default_action IN ('PERMIT', 'DROP', 'REJECT')",
            name=op.f("ck_security_policies_default_action_valid"),
        ),
        sa.CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name=op.f("ck_security_policies_configured_completeness_valid"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_security_policies")),
    )
    op.create_table(
        "security_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_key", sa.Integer(), nullable=False),
        sa.Column("predicate", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("action", sa.String(length=6), nullable=False),
        sa.CheckConstraint(
            "action IN ('PERMIT', 'DROP', 'REJECT')",
            name=op.f("ck_security_rules_action_valid"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(predicate) = 'object'",
            name=op.f("ck_security_rules_predicate_object"),
        ),
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["security_policies.id"],
            name=op.f("fk_security_rules_policy_id_security_policies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_security_rules")),
        sa.UniqueConstraint(
            "policy_id",
            "order_key",
            name=op.f("uq_security_rules_policy_order"),
        ),
    )
    op.create_index(
        "ix_security_rules_policy_id", "security_rules", ["policy_id"]
    )


def downgrade() -> None:
    op.drop_table("security_rules")
    op.drop_table("security_policies")
