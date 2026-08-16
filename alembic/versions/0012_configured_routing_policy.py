"""Add configured RoutingPolicy table-selection rules.

Revision ID: 0012_configured_routing_policy
Revises: 0011_nat_pools_select_from
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_configured_routing_policy"
down_revision: str | None = "0011_nat_pools_select_from"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "routing_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "default_selection",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("configured_completeness", sa.String(length=8), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(default_selection) = 'object'",
            name=op.f("ck_routing_policies_default_selection_object"),
        ),
        sa.CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name=op.f("ck_routing_policies_configured_completeness_valid"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routing_policies")),
    )
    op.create_table(
        "routing_policy_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_key", sa.Integer(), nullable=False),
        sa.Column("predicate", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("action", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(predicate) = 'object'",
            name=op.f("ck_routing_policy_rules_predicate_object"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(action) = 'object'",
            name=op.f("ck_routing_policy_rules_action_object"),
        ),
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["routing_policies.id"],
            name=op.f("fk_routing_policy_rules_policy_id_routing_policies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routing_policy_rules")),
        sa.UniqueConstraint(
            "policy_id",
            "order_key",
            name=op.f("uq_routing_policy_rules_policy_order"),
        ),
    )
    op.create_index(
        "ix_routing_policy_rules_policy_id",
        "routing_policy_rules",
        ["policy_id"],
    )


def downgrade() -> None:
    op.drop_table("routing_policy_rules")
    op.drop_table("routing_policies")
