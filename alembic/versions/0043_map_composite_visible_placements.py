"""explicit collapsed composite visibility

Revision ID: 0043_map_composite_visible_placements
Revises: 0042_map_composites_presentation_variants
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0043_map_composite_visible_placements"
down_revision = "0042_map_composites_presentation_variants"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "map_composite_visible_placements",
        sa.Column("composite_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_composites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("placement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_placements.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade():
    op.drop_table("map_composite_visible_placements")
