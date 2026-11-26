"""Store the explicitly documented fiber type of each external Cable."""
import sqlalchemy as sa
from alembic import op

revision = "l1_optical_01a"
down_revision = "ccap_mod01_internal_links"


def upgrade():
    op.add_column("cables", sa.Column("fiber_type", sa.String(2), nullable=True))
    op.create_check_constraint(op.f("ck_cables_fiber_type"), "cables", "fiber_type IN ('SM', 'MM')")


def downgrade():
    op.drop_constraint(op.f("ck_cables_fiber_type"), "cables", type_="check")
    op.drop_column("cables", "fiber_type")
