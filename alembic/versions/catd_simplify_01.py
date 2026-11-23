"""Model physical endings and line characteristics on a clean CAT-D catalog."""

from uuid import UUID, uuid5

from alembic import op
import sqlalchemy as sa

revision = "catd_simplify_01"
down_revision = "mod03a1_parent_interfaces"
branch_labels = None
depends_on = None

SEED_NAMESPACE = UUID("254ba0f1-5200-4810-896b-3453756cf890")


def seed_id(table, name):
    return uuid5(SEED_NAMESPACE, f"{table}/{name}")


def require_seed_rows(connection, table, names):
    expected = {seed_id(table, name) for name in names}
    if any(item_id not in expected for item_id in connection.scalars(sa.text(f"SELECT id FROM {table}"))):
        raise RuntimeError(f"CAT-D-SIMPLIFY-01: {table} contains user rows. Use a clean test database.")


def upgrade():
    connection = op.get_bind()
    op.execute("LOCK TABLE cables, port_types, cable_types, connector_types IN ACCESS EXCLUSIVE MODE")
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM cables)")):
        raise RuntimeError("CAT-D-SIMPLIFY-01: cables exist. Use a clean test database.")

    line_seeds = (
        ("Витая пара", "COPPER", "TWISTED_PAIR", None),
        ("Одномодовая оптика", "FIBER", "SINGLE_MODE", "SM"),
        ("Многомодовая оптика", "FIBER", "MULTI_MODE", "MM"),
    )
    require_seed_rows(connection, "cable_types", [name for name, *_ in line_seeds])
    require_seed_rows(connection, "connector_types", [
        f"{profile} {ending}" for profile in ("RJ45", "LC", "SC") for ending in ("Plug", "Socket")
    ])
    require_seed_rows(connection, "port_types", ("RJ45", "LC Simplex", "LC Duplex", "Оптическое окончание 12"))
    for name, medium, construction, _ in line_seeds:
        row = connection.execute(sa.text("SELECT medium, construction FROM cable_types WHERE id = :id"),
                                 {"id": seed_id("cable_types", name)}).first()
        if row is not None and row != (medium, construction):
            raise RuntimeError("CAT-D-SIMPLIFY-01: cable type seed structure changed. Use a clean test database.")

    op.drop_column("cables", "connector_a_type_id")
    op.drop_column("cables", "connector_b_type_id")
    op.drop_column("port_types", "connector_type_id")
    op.drop_table("connector_types")

    op.add_column("cable_types", sa.Column("fiber_mode", sa.String(2)))
    for name, _, _, mode in line_seeds:
        connection.execute(sa.text("UPDATE cable_types SET fiber_mode = :mode WHERE id = :id"),
                           {"mode": mode, "id": seed_id("cable_types", name)})
    op.create_check_constraint("fiber_mode", "cable_types", """
        (medium = 'COPPER' AND fiber_mode IS NULL) OR
        (medium = 'FIBER' AND fiber_mode IS NOT NULL AND fiber_mode IN ('SM', 'MM'))
    """)

    op.add_column("port_types", sa.Column("fiber_mode", sa.String(2)))
    op.add_column("port_types", sa.Column("compatibility_mode", sa.String(9), nullable=False,
                                        server_default="UNDEFINED"))
    op.alter_column("port_types", "compatibility_mode", server_default=None)
    op.create_check_constraint("fiber_mode", "port_types",
                               "fiber_mode IS NULL OR (medium = 'FIBER' AND fiber_mode IN ('SM', 'MM'))")
    op.create_check_constraint("compatibility_mode", "port_types",
                               "compatibility_mode IN ('SAME_TYPE', 'MATRIX', 'UNDEFINED')")
    for name in ("RJ45", "LC Simplex", "LC Duplex"):
        connection.execute(sa.text("UPDATE port_types SET compatibility_mode = 'SAME_TYPE' WHERE id = :id"),
                           {"id": seed_id("port_types", name)})
    connection.execute(sa.text("""
        INSERT INTO port_types (id, name, color, is_active, medium, members, compatibility_mode)
        VALUES (:id, 'SC', '#64748B', true, 'FIBER', '["1"]'::jsonb, 'SAME_TYPE')
    """), {"id": seed_id("port_types", "SC")})

    op.create_table(
        "port_type_compatibilities",
        sa.Column("port_type_a_id", sa.UUID(), sa.ForeignKey("port_types.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("port_type_b_id", sa.UUID(), sa.ForeignKey("port_types.id", ondelete="CASCADE"), primary_key=True),
        sa.CheckConstraint("port_type_a_id <= port_type_b_id", name="ordered_pair"),
    )
    op.create_index(op.f("ix_port_type_compatibilities_port_type_b_id"), "port_type_compatibilities",
                    ["port_type_b_id"])


def downgrade():
    raise NotImplementedError("CAT-D-SIMPLIFY-01 requires a clean database for the previous schema.")
