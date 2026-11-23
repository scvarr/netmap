"""Keep L1 compatibility on physical ending types."""

from uuid import UUID, uuid5

from alembic import op
import sqlalchemy as sa

revision = "catd_end_types_01"
down_revision = "catd_simplify_01"
branch_labels = None
depends_on = None

SEED_NAMESPACE = UUID("254ba0f1-5200-4810-896b-3453756cf890")


def upgrade():
    op.execute("LOCK TABLE cables, cable_types, port_types IN ACCESS EXCLUSIVE MODE")
    connection = op.get_bind()
    seeded = {
        uuid5(SEED_NAMESPACE, f"cable_types/{name}"): (name, medium, construction, mode)
        for name, medium, construction, mode in (
            ("Витая пара", "COPPER", "TWISTED_PAIR", None),
            ("Одномодовая оптика", "FIBER", "SINGLE_MODE", "SM"),
            ("Многомодовая оптика", "FIBER", "MULTI_MODE", "MM"),
        )
    }
    has_cables = connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM cables)"))
    has_port_modes = connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM port_types WHERE fiber_mode IS NOT NULL)"))
    types = connection.execute(sa.text(
        "SELECT id, name, medium, construction, fiber_mode, color, is_active, description FROM cable_types"
    ))
    if has_cables or has_port_modes or any(
        (*seeded.get(row.id, ()), "#64748B", True, None) != tuple(row)[1:] for row in types
    ):
        raise RuntimeError("CAT-D: existing cable or optical catalog data found. Start with a clean test database.")
    op.drop_column("port_types", "fiber_mode")
    op.drop_column("cables", "cable_type_id")
    op.drop_table("cable_types")


def downgrade():
    raise NotImplementedError("Start with a clean database for the previous CAT-D schema.")
