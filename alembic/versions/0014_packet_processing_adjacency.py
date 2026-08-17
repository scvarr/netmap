"""Widen processing transition outcomes for adjacency handoff.

Revision ID: 0014_packet_processing_adjacency
Revises: 0013_packet_processing_plans
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0014_packet_processing_adjacency"
down_revision: str | None = "0013_packet_processing_plans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "processing_transitions",
        "outcome",
        existing_type=sa.String(length=23),
        type_=sa.String(length=32),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "processing_transitions",
        "outcome",
        existing_type=sa.String(length=32),
        type_=sa.String(length=23),
        existing_nullable=False,
    )
