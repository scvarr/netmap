"""Replace exact module compatibility strings with catalog UUID references."""

from uuid import UUID, uuid5

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, insert

revision = "catd05_module_port_types"
down_revision = "mod01_module_port_markers"

SEED_NAMES = (
    "SFP", "SFP+", "SFP28", "SFP56", "QSFP+", "QSFP28", "QSFP56", "QSFP112",
    "QSFP-DD", "OSFP", "XFP", "PCIe x1", "PCIe x4", "PCIe x8", "PCIe x16",
)
NAMESPACE = UUID("236cd140-8b33-4fa7-bd72-ec21d6c56c0a")
COLUMN = "module_port_type_id"


def _references(records, field):
    """Yield the dictionaries and keys that contain exact compatibility values."""
    for table, rows in records.items():
        for row in rows:
            if table in ("module_bays", "module_template_revisions"):
                yield row, field
            if table == "module_template_revisions":
                yield from ((port, field) for port in row["module_ports"])
            if "definition" in row:
                definition = row["definition"]
                if table.startswith("base_"):
                    yield from ((bay, field) for bay in definition.get("bays", []))
                else:
                    yield definition, field
                    yield from ((port, field) for port in definition.get("module_ports", []))
            if "result" in row:
                result = row["result"]
                impacts = result["objects" if table.startswith("base_") else "installations"]
                for entry in (result, *impacts):
                    for change in entry["changes"]:
                        for side in ("before", "after"):
                            snapshot = change.get(side)
                            if change["section"] in ("bays", "module_ports") and snapshot is not None:
                                yield snapshot, field
                            elif change["section"] == "properties" and change["key"] == field:
                                yield change, side
                        if change["section"] == "properties" and change["key"] == field:
                            yield change, "key"
                    for reason in entry.get("reasons", []):
                        if reason.get(field) is not None:
                            yield reason, field


def _tables(field, field_type):
    return {
        name: sa.table(name, sa.column("id", sa.Uuid), *columns)
        for name, columns in (
            ("module_bays", [sa.column(field, field_type)]),
            ("module_template_revisions", [sa.column(field, field_type), sa.column("module_ports", JSONB)]),
            ("base_template_drafts", [sa.column("definition", JSONB)]),
            ("base_template_candidates", [sa.column("definition", JSONB), sa.column("result", JSONB)]),
            ("module_template_drafts", [sa.column("definition", JSONB)]),
            ("module_template_candidates", [sa.column("definition", JSONB), sa.column("result", JSONB)]),
        )
    }


def upgrade():
    connection = op.get_bind()
    tables = _tables("compatibility", sa.String)
    connection.execute(sa.text(f"LOCK TABLE {', '.join(tables)} IN ACCESS EXCLUSIVE MODE"))
    records = {name: [dict(row) for row in connection.execute(sa.select(table)).mappings()]
               for name, table in tables.items()}
    references = list(_references(records, "compatibility"))
    names = set(SEED_NAMES)
    for record, key in references:
        if key == "key":
            continue
        value = record.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > 255 or "\x00" in value:
            raise RuntimeError(f"CAT-D-05 invalid legacy compatibility: {value!r}")
        names.add(value)

    # Use the same case-insensitive uniqueness rule as the new PostgreSQL index.
    normalized = {}
    for name in sorted(names):
        lower = connection.scalar(sa.select(sa.func.lower(name)))
        if lower in normalized:
            raise RuntimeError(f"CAT-D-05 distinct compatibility names conflict: {normalized[lower]!r}, {name!r}")
        normalized[lower] = name
    ids = {name: uuid5(NAMESPACE, name) for name in names}

    catalog = op.create_table(
        "module_port_types",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="nonempty_name"),
    )
    op.create_index("uq_module_port_types_normalized_name", catalog.name, [sa.text("lower(name)")], unique=True)
    connection.execute(insert(catalog).on_conflict_do_nothing(index_elements=["id"]), [
        {"id": item_id, "name": name, "is_active": True} for name, item_id in ids.items()
    ])

    for table in ("module_bays", "module_template_revisions"):
        op.add_column(table, sa.Column(COLUMN, sa.Uuid()))
    for record, key in references:
        if key == "key":
            record[key] = COLUMN
        elif key == "compatibility":
            record[COLUMN] = str(ids[record.pop(key)])
        else:
            record[key] = str(ids[record[key]])

    for name, table in _tables(COLUMN, sa.Uuid).items():
        statement = table.update().where(table.c.id == sa.bindparam("row_id"))
        for row in records[name]:
            values = {key: value for key, value in row.items() if key != "id"}
            if COLUMN in values:
                values[COLUMN] = UUID(values[COLUMN])
            connection.execute(statement, {"row_id": row["id"], **values})

    for table, constraint, condition in (
        ("module_bays", "bay_strings_not_blank", "char_length(btrim(bay_key)) > 0 AND char_length(btrim(display_name)) > 0"),
        ("module_template_revisions", "revision_valid", "version_number > 0"),
    ):
        op.drop_constraint(op.f(f"ck_{table}_{constraint}"), table, type_="check")
        op.create_check_constraint(constraint, table, condition)
        op.alter_column(table, COLUMN, nullable=False)
        op.create_foreign_key(None, table,
                              "module_port_types", [COLUMN], ["id"], ondelete="RESTRICT")
        op.create_index(f"ix_{table}_{COLUMN}", table, [COLUMN])
        op.drop_column(table, "compatibility")


def downgrade():
    raise RuntimeError("Catalog UUID identity cannot be safely converted to legacy compatibility strings")
