"""Add physical catalogs and require verified structure for existing port types."""

import json
import os
from uuid import UUID, uuid5

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "catd01_physical_catalogs"
down_revision = "faceview01_faces"
branch_labels = None
depends_on = None

NAMESPACE = UUID("254ba0f1-5200-4810-896b-3453756cf890")


def create_catalog(table, *structure):
    op.create_table(
        table,
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.CheckConstraint("name <> ''", name="nonempty_name"),
        sa.CheckConstraint("color ~ '^#[0-9A-F]{6}$'", name="hex_color"),
        *structure,
    )
    op.create_index(f"uq_{table}_normalized_name", table, [sa.text("lower(name)")], unique=True)


def seed(table, name, **structure):
    columns = ("id", "name", "color", "is_active", *structure)
    typed = [sa.bindparam("members", type_=postgresql.JSONB())] if "members" in structure else []
    statement = sa.text(
        f"INSERT INTO {table} ({', '.join(columns)}) "
        f"VALUES ({', '.join(':' + column for column in columns)}) ON CONFLICT DO NOTHING"
    ).bindparams(*typed)
    item_id = uuid5(NAMESPACE, f"{table}/{name}")
    op.get_bind().execute(statement, dict(id=item_id, name=name, color="#64748B", is_active=True, **structure))
    return item_id


def backfill(connection):
    rows = connection.execute(sa.text("SELECT id, name FROM port_types ORDER BY name, id")).all()
    definitions = json.loads(os.environ.get("NETMAP_CAT_D_01_PORT_STRUCTURES", "{}"))
    if not isinstance(definitions, dict):
        raise ValueError("NETMAP_CAT_D_01_PORT_STRUCTURES must be a JSON object keyed by port type UUID")
    missing = [f"{row.id} ({row.name})" for row in rows if str(row.id) not in definitions]
    if missing:
        raise ValueError("CAT-D-01 requires verified port structures for: " + ", ".join(missing))
    update = sa.text(
        "UPDATE port_types SET medium = :medium, members = :members, connector_type_id = :connector WHERE id = :id"
    ).bindparams(sa.bindparam("members", type_=postgresql.JSONB()))
    for row in rows:
        structure = definitions[str(row.id)]
        if not isinstance(structure, dict) or set(structure) - {"medium", "members", "connector_type_id"}:
            raise ValueError(f"CAT-D-01: invalid structure fields for {row.id} ({row.name})")
        medium, members = structure.get("medium"), structure.get("members")
        if (medium not in ("COPPER", "FIBER") or not isinstance(members, list) or not members
                or any(not isinstance(member, str) or not member or member != member.strip()
                       or len(member) > 255 or any(char in member for char in "\x00\r\n") for member in members)
                or len({member.casefold() for member in members}) != len(members)):
            raise ValueError(f"CAT-D-01: invalid medium or member designations for {row.id} ({row.name})")
        connector = structure.get("connector_type_id")
        connection.execute(update, dict(id=row.id, medium=medium, members=members, connector=UUID(connector) if connector else None))


def check_existing_definitions(connection):
    definitions = [
        "SELECT 'built_in_endpoint_definitions' AS source, id, port_type_id, cardinality, kind FROM built_in_endpoint_definitions",
        "SELECT 'module_endpoint_definitions', id, port_type_id, 1, kind FROM module_endpoint_definitions",
        """SELECT 'built_in_endpoint_mappings', m.id, d.port_type_id, p.cardinality, d.kind
           FROM built_in_endpoint_mappings m JOIN built_in_endpoint_definitions d ON d.id = m.definition_id
           JOIN connection_points p ON p.id = m.connection_point_id""",
        """SELECT 'module_endpoint_mappings', m.id, d.port_type_id, p.cardinality, d.kind
           FROM module_endpoint_mappings m JOIN module_endpoint_definitions d ON d.id = m.definition_id
           JOIN connection_points p ON p.id = m.connection_point_id""",
    ]
    for prefix, section in (("base", "slots"), ("module", "endpoints")):
        # Pre-C-CAP snapshots had an implicit single member. Interpret the
        # historical definition without rewriting its JSON or fingerprint.
        cardinality = (
            "CASE WHEN endpoint ? 'cardinality' THEN (endpoint->>'cardinality')::integer ELSE 1 END"
            if prefix == "base" else "1"
        )
        for state in ("drafts", "candidates"):
            table = f"{prefix}_template_{state}"
            definitions.append(f"""
                SELECT '{table}', id, (endpoint->>'port_type_id')::uuid,
                       {cardinality}, endpoint->>'kind'
                FROM {table}, jsonb_array_elements(definition->'{section}') AS endpoint
            """)
    conflicts = connection.execute(sa.text(f"""
        SELECT d.source, d.id, d.port_type_id, d.cardinality, jsonb_array_length(p.members) AS type_cardinality
        FROM ({' UNION ALL '.join(definitions)}) AS d
        LEFT JOIN port_types p ON p.id = d.port_type_id
        WHERE p.id IS NULL OR d.cardinality IS DISTINCT FROM jsonb_array_length(p.members)
           OR (d.kind = 'NETWORK_PORT' AND d.cardinality <> 1)
        ORDER BY d.source, d.id, d.port_type_id
        LIMIT 20
    """)).all()
    if conflicts:
        raise ValueError(f"CAT-D-01: existing endpoint definitions contradict supplied structures: {conflicts}")


def upgrade():
    create_catalog(
        "connector_types",
        sa.Column("mating_profile", sa.String(255), nullable=False),
        sa.Column("termination", sa.String(6), nullable=False),
        sa.CheckConstraint("mating_profile <> ''", name="nonempty_profile"),
        sa.CheckConstraint("termination IN ('PLUG', 'SOCKET')", name="termination"),
    )
    create_catalog(
        "cable_types",
        sa.Column("medium", sa.String(6), nullable=False),
        sa.Column("construction", sa.String(255), nullable=False),
        sa.CheckConstraint("medium IN ('COPPER', 'FIBER')", name="medium"),
        sa.CheckConstraint("construction <> ''", name="nonempty_construction"),
    )
    op.add_column("port_types", sa.Column("medium", sa.String(6)))
    op.add_column("port_types", sa.Column("members", postgresql.JSONB()))
    op.add_column("port_types", sa.Column("connector_type_id", sa.UUID()))
    op.create_foreign_key(op.f("fk_port_types_connector_type_id_connector_types"), "port_types", "connector_types",
                          ["connector_type_id"], ["id"], ondelete="RESTRICT")
    op.create_index(op.f("ix_port_types_connector_type_id"), "port_types", ["connector_type_id"])

    sockets = {}
    for profile in ("RJ45", "LC", "SC"):
        seed("connector_types", f"{profile} Plug", mating_profile=profile, termination="PLUG")
        sockets[profile] = seed("connector_types", f"{profile} Socket", mating_profile=profile, termination="SOCKET")
    connection = op.get_bind()
    backfill(connection)
    check_existing_definitions(connection)
    op.alter_column("port_types", "medium", nullable=False)
    op.alter_column("port_types", "members", nullable=False)
    op.create_check_constraint("medium", "port_types", "medium IN ('COPPER', 'FIBER')")
    op.create_check_constraint("nonempty_members", "port_types", "jsonb_array_length(members) >= 1")

    seed("port_types", "RJ45", medium="COPPER", members=["1"], connector_type_id=sockets["RJ45"])
    seed("port_types", "LC Simplex", medium="FIBER", members=["1"], connector_type_id=sockets["LC"])
    seed("port_types", "LC Duplex", medium="FIBER", members=["A", "B"], connector_type_id=sockets["LC"])
    seed("port_types", "Оптическое окончание 12", medium="FIBER", members=[str(n) for n in range(1, 13)], connector_type_id=None)
    for name, medium, construction in (
        ("Витая пара", "COPPER", "TWISTED_PAIR"),
        ("Одномодовая оптика", "FIBER", "SINGLE_MODE"),
        ("Многомодовая оптика", "FIBER", "MULTI_MODE"),
    ):
        seed("cable_types", name, medium=medium, construction=construction)


def downgrade():
    op.drop_constraint("nonempty_members", "port_types", type_="check")
    op.drop_constraint("medium", "port_types", type_="check")
    op.drop_column("port_types", "connector_type_id")
    op.drop_column("port_types", "members")
    op.drop_column("port_types", "medium")
    op.drop_table("cable_types")
    op.drop_table("connector_types")
