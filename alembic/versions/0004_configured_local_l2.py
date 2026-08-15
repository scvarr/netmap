"""configured local L2 canonical slice

Revision ID: 0004_configured_local_l2
Revises: 0003_interface_realization
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_configured_local_l2"
down_revision: str | None = "0003_interface_realization"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "l2_forwarding_contexts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_l2_forwarding_contexts")),
    )
    op.create_table(
        "l2_bindings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("interface_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("forwarding_context_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["interface_id"], ["network_interfaces.id"],
            name=op.f("fk_l2_bindings_interface_id_network_interfaces"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["forwarding_context_id"], ["l2_forwarding_contexts.id"],
            name=op.f("fk_l2_bindings_forwarding_context_id_l2_forwarding_contexts"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_l2_bindings")),
        sa.UniqueConstraint(
            "interface_id", "forwarding_context_id", name="uq_l2_bindings_interface_context"
        ),
    )
    op.create_index("ix_l2_bindings_interface_id", "l2_bindings", ["interface_id"])
    op.create_index("ix_l2_bindings_context_id", "l2_bindings", ["forwarding_context_id"])
    op.create_table(
        "l2_ingress_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("binding_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("exact_stack", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint("jsonb_typeof(exact_stack) = 'array'", name="ck_l2_ingress_rules_exact_stack_array"),
        sa.ForeignKeyConstraint(
            ["binding_id"], ["l2_bindings.id"],
            name=op.f("fk_l2_ingress_rules_binding_id_l2_bindings"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_l2_ingress_rules")),
    )
    op.create_index("ix_l2_ingress_rules_binding_id", "l2_ingress_rules", ["binding_id"])
    op.create_index(
        "ix_l2_ingress_rules_exact_stack", "l2_ingress_rules", ["exact_stack"],
        postgresql_using="hash"
    )
    op.create_table(
        "l2_egress_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("binding_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("emit_stack", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint("jsonb_typeof(emit_stack) = 'array'", name="ck_l2_egress_rules_emit_stack_array"),
        sa.ForeignKeyConstraint(
            ["binding_id"], ["l2_bindings.id"],
            name=op.f("fk_l2_egress_rules_binding_id_l2_bindings"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_l2_egress_rules")),
        sa.UniqueConstraint("binding_id", name="uq_l2_egress_rules_binding"),
    )


def downgrade() -> None:
    op.drop_table("l2_egress_rules")
    op.drop_index("ix_l2_ingress_rules_exact_stack", table_name="l2_ingress_rules", postgresql_using="hash")
    op.drop_index("ix_l2_ingress_rules_binding_id", table_name="l2_ingress_rules")
    op.drop_table("l2_ingress_rules")
    op.drop_index("ix_l2_bindings_context_id", table_name="l2_bindings")
    op.drop_index("ix_l2_bindings_interface_id", table_name="l2_bindings")
    op.drop_table("l2_bindings")
    op.drop_table("l2_forwarding_contexts")
