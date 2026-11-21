"""Separate module bay type identities from transceiver port types."""

import json
import os
from uuid import UUID, uuid5

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "catd05_split_mount_types"
down_revision = "catd05_module_port_types"

ENV_MAPPING = "NETMAP_CAT_D_05_MOUNT_KINDS"
PORTS = ("SFP", "SFP+", "SFP28", "SFP56", "QSFP+", "QSFP28", "QSFP56", "QSFP112", "QSFP-DD", "OSFP", "XFP")
BAYS = ("PCIe x1", "PCIe x4", "PCIe x8", "PCIe x16")
NAMESPACE = UUID("236cd140-8b33-4fa7-bd72-ec21d6c56c0a")
PORT_FIELD = "module_port_type_id"
BAY_FIELD = "module_bay_type_id"
RELATIONS = ("module_bays", "module_template_revisions")


def classify(catalog):
    known = {uuid5(NAMESPACE, name): kind for kind, names in (("MODULE_PORT", PORTS), ("MODULE_BAY", BAYS))
             for name in names}

    def unique_object(pairs):
        values = dict(pairs)
        if len(values) != len(pairs):
            raise ValueError("duplicate mapping key")
        return values

    try:
        raw = json.loads(os.environ.get(ENV_MAPPING, "{}"), object_pairs_hook=unique_object)
        if not isinstance(raw, dict):
            raise ValueError("expected a JSON object")
        explicit = {}
        for key, kind in raw.items():
            item_id = UUID(key)
            if str(item_id) != key or kind not in ("MODULE_PORT", "MODULE_BAY"):
                raise ValueError(f"invalid UUID or mount kind: {key!r} {kind!r}")
            explicit[item_id] = kind
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"CAT-D-05 invalid {ENV_MAPPING}: {error}") from error
    ids = {row["id"] for row in catalog}
    if explicit.keys() - ids or any(known.get(key, kind) != kind for key, kind in explicit.items()):
        raise RuntimeError(f"CAT-D-05 {ENV_MAPPING} includes an unknown UUID or contradicts a seed UUID")
    kinds = {**known, **explicit}
    missing = [f"{row['id']} ({row['name']!r})" for row in catalog if row["id"] not in kinds]
    if missing:
        raise RuntimeError(f"CAT-D-05 classify these UUIDs in {ENV_MAPPING}: {', '.join(sorted(missing))}")
    return {item_id: kinds[item_id] for item_id in ids}


def upgrade():
    conn = op.get_bind()
    old = sa.table("module_port_types", sa.column("id", sa.Uuid), sa.column("name", sa.String),
                   sa.column("is_active", sa.Boolean))
    tables = {
        name: sa.table(name, sa.column("id", sa.Uuid), *(sa.column(field, datatype) for field, datatype in columns))
        for name, columns in (
            ("module_bays", [(PORT_FIELD, sa.Uuid)]),
            ("module_template_revisions", [(PORT_FIELD, sa.Uuid), ("module_ports", JSONB)]),
            ("base_template_drafts", [("definition", JSONB)]),
            ("base_template_candidates", [("definition", JSONB), ("result", JSONB)]),
            ("module_template_drafts", [("definition", JSONB)]),
            ("module_template_candidates", [("definition", JSONB), ("result", JSONB)]),
        )
    }
    conn.execute(sa.text(f"LOCK TABLE {old.name}, {', '.join(tables)} IN ACCESS EXCLUSIVE MODE"))
    catalog = [dict(row) for row in conn.execute(sa.select(old)).mappings()]
    kinds = classify(catalog)

    def mount(value):
        item_id = UUID(str(value))
        if item_id not in kinds:
            raise RuntimeError(f"CAT-D-05 missing catalog entry for {item_id}")
        kind = kinds[item_id]
        return {"mount_kind": kind, PORT_FIELD if kind == "MODULE_PORT" else BAY_FIELD: str(item_id)}

    def convert_place(place):
        place.update(mount(place.pop(PORT_FIELD)))

    def convert_collection(definition):
        if "module_ports" in definition:
            places = definition.pop("module_ports")
            for place in places:
                convert_place(place)
            definition["module_places"] = places

    def convert_result(result, impacts):
        for entry in (result, *result[impacts]):
            for change in entry["changes"]:
                section = change["section"]
                if section in ("bays", "module_ports"):
                    for side in ("before", "after"):
                        if change.get(side) is not None:
                            convert_place(change[side])
                    if section == "module_ports":
                        change["section"] = "module_places"
                elif section == "properties" and change["key"] == PORT_FIELD:
                    change.update(key="mount", before=mount(change["before"]), after=mount(change["after"]))
            for reason in entry.get("reasons", ()):
                type_id = reason.pop(PORT_FIELD, None)
                if type_id is not None:
                    reason["mount"] = mount(type_id)

    new_catalog = op.create_table(
        "module_bay_types",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="nonempty_name"),
    )
    op.create_index("uq_module_bay_types_normalized_name", new_catalog.name, [sa.text("lower(name)")], unique=True)
    moved = [row for row in catalog if kinds[row["id"]] == "MODULE_BAY"]
    if moved:
        conn.execute(new_catalog.insert(), moved)

    for name in RELATIONS:
        op.add_column(name, sa.Column("mount_kind", sa.String(11)))
        op.add_column(name, sa.Column(BAY_FIELD, sa.Uuid))
        op.alter_column(name, PORT_FIELD, nullable=True)

    for name, table in tables.items():
        for row in conn.execute(sa.select(table)).mappings().all():
            values = {}
            if name in RELATIONS:
                fields = mount(row[PORT_FIELD])
                values.update(mount_kind=fields["mount_kind"],
                              module_port_type_id=row[PORT_FIELD] if PORT_FIELD in fields else None,
                              module_bay_type_id=row[PORT_FIELD] if BAY_FIELD in fields else None)
            if "module_ports" in row:
                places = {"module_ports": row["module_ports"]}
                convert_collection(places)
                values["module_ports"] = places["module_places"]
            if "definition" in row:
                definition = row["definition"]
                if name.startswith("base_"):
                    for place in definition.get("bays", ()):
                        convert_place(place)
                else:
                    convert_place(definition)
                    convert_collection(definition)
                values["definition"] = definition
            if "result" in row:
                result = row["result"]
                convert_result(result, "objects" if name.startswith("base_") else "installations")
                values["result"] = result
            write_table = table
            if name in RELATIONS:
                write_table = sa.table(name, *[sa.column(c.name, c.type) for c in table.c],
                                       sa.column("mount_kind", sa.String), sa.column(BAY_FIELD, sa.Uuid))
            conn.execute(write_table.update().where(write_table.c.id == row["id"]).values(**values))

    if moved:
        conn.execute(old.delete().where(old.c.id.in_([row["id"] for row in moved])))
    op.alter_column("module_template_revisions", "module_ports", new_column_name="module_places")
    for name in RELATIONS:
        op.alter_column(name, "mount_kind", nullable=False)
        op.create_foreign_key(None, name, new_catalog.name, [BAY_FIELD], ["id"], ondelete="RESTRICT")
        op.create_index(f"ix_{name}_{BAY_FIELD}", name, [BAY_FIELD])
        op.create_check_constraint(
            "mount_type", name,
            "(mount_kind = 'MODULE_PORT' AND module_port_type_id IS NOT NULL AND module_bay_type_id IS NULL) OR "
            "(mount_kind = 'MODULE_BAY' AND module_bay_type_id IS NOT NULL AND module_port_type_id IS NULL)",
        )


def downgrade():
    raise RuntimeError("Catalog mount kinds cannot be safely collapsed into one catalog")
