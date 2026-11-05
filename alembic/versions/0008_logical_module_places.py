"""Logical and placed module bays; preserve identities and saved layouts."""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("module_bays", sa.Column("kind", sa.String(16), nullable=False, server_default="PLACED"))
    for field in ("x", "y", "width", "height"):
        op.alter_column("module_bays", field, nullable=True)
    op.create_check_constraint("bay_representation", "module_bays", "(kind = 'LOGICAL' AND x IS NULL AND y IS NULL AND width IS NULL AND height IS NULL) OR (kind = 'PLACED' AND x IS NOT NULL AND y IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL)")


def downgrade():
    raise RuntimeError("Cannot discard logical module places")
