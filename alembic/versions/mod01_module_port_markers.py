"""Allow point placement on existing ModuleBay definitions."""

import sqlalchemy as sa
from alembic import op

revision = "mod01_module_port_markers"
down_revision = "mod01_module_ports"

LOGICAL = "(kind = 'LOGICAL' AND x IS NULL AND y IS NULL AND width IS NULL AND height IS NULL)"
RECTANGLE = "(kind = 'PLACED' AND x IS NOT NULL AND y IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL)"
PLACED = "(kind = 'PLACED' AND x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND x IS NOT NULL AND y IS NOT NULL AND (width IS NULL) = (height IS NULL))"


def upgrade():
    op.drop_constraint(op.f("ck_module_bays_bay_representation"), "module_bays", type_="check")
    op.create_check_constraint(op.f("ck_module_bays_bay_representation"), "module_bays", f"{LOGICAL} OR {PLACED}")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM module_bays WHERE kind = 'PLACED' AND width IS NULL)")):
        raise RuntimeError("Downgrade would invalidate placed module-port markers")
    op.drop_constraint(op.f("ck_module_bays_bay_representation"), "module_bays", type_="check")
    op.create_check_constraint(op.f("ck_module_bays_bay_representation"), "module_bays", f"{LOGICAL} OR {RECTANGLE}")
