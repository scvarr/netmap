"""Separate user-resized Location area from automatic content bounds."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = "cux1001_manual_bounds"
down_revision = "cux1001_location_geometry"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("map_location_states", sa.Column("manual_bounds", JSONB(), nullable=True))

def downgrade():
    op.drop_column("map_location_states", "manual_bounds")
