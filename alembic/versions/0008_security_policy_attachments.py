"""Add configured SecurityPolicyAttachment scope selectors.

Revision ID: 0008_security_policy_attachments
Revises: 0007_configured_security_policy
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_security_policy_attachments"
down_revision: str | None = "0007_configured_security_policy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "security_policy_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("stage_order", sa.Integer(), nullable=False),
        sa.Column("scope", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(scope) = 'object'",
            name=op.f("ck_security_policy_attachments_scope_object"),
        ),
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["security_policies.id"],
            name=op.f(
                "fk_security_policy_attachments_policy_id_security_policies"
            ),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_security_policy_attachments")
        ),
    )
    op.create_index(
        "ix_security_policy_attachments_policy_id",
        "security_policy_attachments",
        ["policy_id"],
    )
    op.create_index(
        "ix_security_policy_attachments_stage_order",
        "security_policy_attachments",
        ["stage_order"],
    )


def downgrade() -> None:
    op.drop_table("security_policy_attachments")
