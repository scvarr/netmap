"""Add canonical PacketProcessingPlan attachment coverage.

Revision ID: 0015_packet_processing_plan_attachments
Revises: 0014_packet_processing_adjacency
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0015_packet_processing_plan_attachments"
down_revision: str | None = "0014_packet_processing_adjacency"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=32),
        type_=sa.String(length=64),
        existing_nullable=False,
    )
    op.create_table(
        "packet_processing_plan_attachment_sets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("routing_context_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("traffic_class", sa.String(length=12), nullable=False),
        sa.Column("configured_completeness", sa.String(length=8), nullable=False),
        sa.CheckConstraint(
            "traffic_class IN ('TRANSIT', 'LOCAL_INPUT', 'LOCAL_OUTPUT')",
            name=op.f("ck_packet_processing_plan_attachment_sets_traffic_class_valid"),
        ),
        sa.CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name=op.f("ck_packet_processing_plan_attachment_sets_configured_completeness_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["routing_context_id"], ["routing_contexts.id"],
            name=op.f("fk_packet_processing_plan_attachment_sets_routing_context_id_routing_contexts"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_packet_processing_plan_attachment_sets")),
        sa.UniqueConstraint(
            "routing_context_id", "traffic_class",
            name=op.f("uq_plan_attachment_sets_context_traffic_class"),
        ),
    )
    op.create_index(
        "ix_plan_attachment_sets_routing_context_id",
        "packet_processing_plan_attachment_sets", ["routing_context_id"],
    )
    op.create_table(
        "packet_processing_plan_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("attachment_set_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scope", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(scope) = 'object'",
            name=op.f("ck_packet_processing_plan_attachments_scope_object"),
        ),
        sa.ForeignKeyConstraint(
            ["attachment_set_id"], ["packet_processing_plan_attachment_sets.id"],
            name=op.f("fk_packet_processing_plan_attachments_attachment_set_id_packet_processing_plan_attachment_sets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"], ["packet_processing_plans.id"],
            name=op.f("fk_packet_processing_plan_attachments_plan_id_packet_processing_plans"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_packet_processing_plan_attachments")),
    )
    op.create_index("ix_plan_attachments_attachment_set_id", "packet_processing_plan_attachments", ["attachment_set_id"])
    op.create_index("ix_plan_attachments_plan_id", "packet_processing_plan_attachments", ["plan_id"])


def downgrade() -> None:
    op.drop_table("packet_processing_plan_attachments")
    op.drop_table("packet_processing_plan_attachment_sets")
