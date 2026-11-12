"""Variant-owned opt-in automatic Location layout."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = "autoloc01_layout"
down_revision = "cux1001_manual_bounds"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("map_presentation_variants", sa.Column("automatic_layout", JSONB(), nullable=True))

def downgrade():
    op.drop_column("map_presentation_variants", "automatic_layout")
