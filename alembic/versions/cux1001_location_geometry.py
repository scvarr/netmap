"""Independent Location frame presentation."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = "cux1001_location_geometry"
down_revision = "ccap0101_multichannel"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("map_location_states", sa.Column("geometry", JSONB(), nullable=True))

def downgrade():
    op.drop_column("map_location_states", "geometry")
