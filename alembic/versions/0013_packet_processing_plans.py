"""Add canonical PacketProcessingPlan graphs.

Revision ID: 0013_packet_processing_plans
Revises: 0012_configured_routing_policy
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_packet_processing_plans"
down_revision: str | None = "0012_configured_routing_policy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "packet_processing_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("configured_completeness", sa.String(length=8), nullable=False),
        sa.CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name=op.f("ck_packet_processing_plans_configured_completeness_valid"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_packet_processing_plans")),
    )
    op.create_table(
        "processing_stages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object'",
            name=op.f("ck_processing_stages_payload_object"),
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["packet_processing_plans.id"],
            name=op.f("fk_processing_stages_plan_id_packet_processing_plans"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_processing_stages")),
    )
    op.create_index(
        "ix_processing_stages_plan_id", "processing_stages", ["plan_id"]
    )
    op.create_table(
        "processing_transitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_stage_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("outcome", sa.String(length=23), nullable=False),
        sa.Column("to_stage_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["packet_processing_plans.id"],
            name=op.f("fk_processing_transitions_plan_id_packet_processing_plans"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["from_stage_id"],
            ["processing_stages.id"],
            name=op.f("fk_processing_transitions_from_stage_id_processing_stages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["to_stage_id"],
            ["processing_stages.id"],
            name=op.f("fk_processing_transitions_to_stage_id_processing_stages"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_processing_transitions")),
        sa.UniqueConstraint(
            "from_stage_id",
            "outcome",
            name=op.f("uq_processing_transitions_stage_outcome"),
        ),
    )
    op.create_index(
        "ix_processing_transitions_plan_id",
        "processing_transitions",
        ["plan_id"],
    )
    op.create_index(
        "ix_processing_transitions_from_stage_id",
        "processing_transitions",
        ["from_stage_id"],
    )
    op.create_index(
        "ix_processing_transitions_to_stage_id",
        "processing_transitions",
        ["to_stage_id"],
    )
    op.create_table(
        "processing_entry_points",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("traffic_class", sa.String(length=12), nullable=False),
        sa.Column("stage_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["packet_processing_plans.id"],
            name=op.f("fk_processing_entry_points_plan_id_packet_processing_plans"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["stage_id"],
            ["processing_stages.id"],
            name=op.f("fk_processing_entry_points_stage_id_processing_stages"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_processing_entry_points")),
        sa.UniqueConstraint(
            "plan_id",
            "traffic_class",
            name=op.f("uq_processing_entry_points_plan_traffic_class"),
        ),
    )
    op.create_index(
        "ix_processing_entry_points_plan_id",
        "processing_entry_points",
        ["plan_id"],
    )
    op.create_index(
        "ix_processing_entry_points_stage_id",
        "processing_entry_points",
        ["stage_id"],
    )


def downgrade() -> None:
    op.drop_table("processing_entry_points")
    op.drop_table("processing_transitions")
    op.drop_table("processing_stages")
    op.drop_table("packet_processing_plans")
