"""Variant-specific Location collapse state.

Revision ID: 0045_variant_location_states
Revises: 0044_remove_obsolete_spatial_presentation
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0045_variant_location_states"
down_revision = "0044_remove_obsolete_spatial_presentation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "map_location_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("variant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_presentation_variants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("collapsed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("visible_direct_elements", postgresql.JSONB(), nullable=False),
        sa.UniqueConstraint("variant_id", "location_id", name="uq_map_location_states_variant_location"),
    )


def downgrade() -> None:
    op.drop_table("map_location_states")
