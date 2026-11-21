import copy
import json
import os
import subprocess
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa

from app.database import engine
from tests.test_hardware_configuration import base_payload, client, create_base, create_module, create_object, install


CATALOG = "/v1/module-port-types"
BAY_CATALOG = "/v1/module-bay-types"
PACKAGE = "/v1/workspace/package"
SEED = {
    "SFP", "SFP+", "SFP28", "SFP56", "QSFP+", "QSFP28", "QSFP56", "QSFP112",
    "QSFP-DD", "OSFP", "XFP",
}


@pytest.mark.parametrize("catalog,kind,field,entity", [
    (CATALOG, "MODULE_PORT", "module_port_type_id", "ModulePortType"),
    (BAY_CATALOG, "MODULE_BAY", "module_bay_type_id", "ModuleBayType"),
])
def test_catalog_rename_archive_installation_and_workspace_roundtrip(catalog, kind, field, entity):
    from app.module_geometry import initial_geometry

    response = client.post(catalog, json={"name": "Line card slot"})
    assert response.status_code == 201, response.text
    item = response.json()
    assert client.post(catalog, json={"name": "line card slot"}).status_code == 409
    item_url = f"{catalog}/{item['id']}"
    assert client.get(item_url).json() == item

    payload = base_payload()
    bay = payload["bays"][0]
    bay.pop("module_port_type_id")
    bay.update(mount_kind=kind, **{field: item["id"]})
    base, _ = create_base(payload)
    def module(type_id, mount_kind=kind, type_field=field):
        response = client.post("/v1/library/module-templates", json={
            "name": "Module", "geometry": initial_geometry([]), "endpoints": [],
            "mount_kind": mount_kind, type_field: type_id,
        })
        assert response.status_code == 201, response.text
        return response.json()

    compatible = module(item["id"])
    different = client.post(catalog, json={"name": "Similar line card slot"}).json()
    wrong = module(different["id"])
    # The UUID alone cannot authorize a cross-kind installation, even when present in both catalogs.
    from app.database import SessionLocal
    from app.models import ModuleBayType, ModulePortType
    cross_model, cross_kind, cross_field = (
        (ModuleBayType, "MODULE_BAY", "module_bay_type_id") if kind == "MODULE_PORT"
        else (ModulePortType, "MODULE_PORT", "module_port_type_id")
    )
    with SessionLocal.begin() as session:
        session.add(cross_model(id=UUID(item["id"]), name="Same UUID", is_active=True))
    cross = module(item["id"], cross_kind, cross_field)
    object_id = create_object(base)["physical_object_ref"]["entity_id"]
    renamed = client.put(item_url, json={"name": "Renamed line card slot"})
    assert renamed.json() == {**item, "name": "Renamed line card slot"}
    assert install(object_id, wrong["template_id"], bay["bay_key"]).status_code == 409
    assert install(object_id, cross["template_id"], bay["bay_key"]).status_code == 409
    installed = install(object_id, compatible["template_id"], bay["bay_key"])
    assert installed.status_code == 201, installed.text

    assert client.put(item_url, json={"name": "Renamed line card slot", "is_active": False}).status_code == 200
    assert client.delete(item_url).status_code == 409
    assert client.post("/v1/library/base-templates", json=payload).status_code == 422
    assert client.get(f"/v1/topology/physical-objects/{object_id}/configuration").json() == installed.json()
    draft_url = f"/v1/library/module-templates/{compatible['template_id']}/draft"
    draft = client.get(draft_url).json()
    saved = client.put(f"{draft_url}?expected_generation={draft['generation']}",
                       json={**draft["definition"], "name": "Edited module"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["definition"][field] == item["id"]

    packaged = client.get(PACKAGE).json()
    assert {"id": item["id"], "name": "Renamed line card slot", "is_active": False} in packaged["settings"][entity]
    assert client.delete("/v1/workspace/dataset").status_code == 204
    empty = client.get(PACKAGE).json()
    broken = copy.deepcopy(packaged)
    broken["authoring"]["ModuleTemplateDraft"][0]["definition"][field] = str(uuid4())
    assert client.post(PACKAGE, json=broken).status_code == 422
    wrong_mount = copy.deepcopy(packaged)
    wrong_mount["authoring"]["ModuleTemplateDraft"][0]["definition"].update(mount_kind=cross_kind)
    assert client.post(PACKAGE, json=wrong_mount).status_code == 422
    assert client.get(PACKAGE).json() == empty
    assert client.post(PACKAGE, json=packaged).status_code == 204
    assert client.get(PACKAGE).json() == packaged

    spare = client.post(catalog, json={"name": "Unused", "is_active": False}).json()
    assert client.delete(f"{catalog}/{spare['id']}").status_code == 204


def test_archived_type_in_frozen_candidate_is_protected():
    from tests.test_module_template_review import check, open_draft, save

    module = create_module()
    template_id = module["template_id"]
    item = client.post(CATALOG, json={"name": "Draft child slot"}).json()
    item_url = f"{CATALOG}/{item['id']}"
    draft = open_draft(template_id)
    definition = {
        **draft["definition"],
        "module_places": [{"key": "child", "display_name": "Child", "x": .3, "y": .4,
                          "mount_kind": "MODULE_PORT", "module_port_type_id": item["id"]}],
    }
    checked = check(template_id, save(template_id, draft, definition))
    assert client.put(item_url, json={"name": item["name"], "is_active": False}).status_code == 200
    save(template_id, checked, draft["definition"])

    assert client.delete(item_url).status_code == 409
    draft_url = f"/v1/library/module-templates/{template_id}/draft"
    current = open_draft(template_id)
    rejected = client.put(f"{draft_url}?expected_generation={current['generation']}", json=definition)
    assert rejected.status_code == 422
    assert open_draft(template_id)["definition"] == draft["definition"]


@pytest.fixture
def legacy_database():
    database = f"catd05_{uuid4().hex}"
    admin = sa.create_engine(engine.url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.exec_driver_sql(f"CREATE DATABASE {database}")
    url = engine.url.set(database=database)
    isolated = sa.create_engine(url)
    env = {**os.environ, "DATABASE_URL": url.render_as_string(hide_password=False)}

    def upgrade(target="head", mapping=None):
        migration_env = dict(env)
        migration_env.pop("NETMAP_CAT_D_05_MOUNT_KINDS", None)
        if mapping is not None:
            migration_env["NETMAP_CAT_D_05_MOUNT_KINDS"] = json.dumps(mapping)
        return subprocess.run(["alembic", "upgrade", target], env=migration_env, capture_output=True, text=True)

    try:
        initial = upgrade("mod01_module_port_markers")
        assert initial.returncode == 0, initial.stderr
        yield isolated, upgrade
    finally:
        isolated.dispose()
        with admin.connect() as connection:
            connection.exec_driver_sql(f"DROP DATABASE {database} WITH (FORCE)")
        admin.dispose()


def _legacy_installation(db, compatibility):
    with db.begin() as conn:
        metadata = sa.MetaData()
        metadata.reflect(conn)

        def add(table, **fields):
            item_id = uuid4()
            conn.execute(metadata.tables[table].insert().values(id=item_id, **fields))
            return item_id

        base = add("base_templates", name="Host")
        revision = add("base_template_revisions", template_id=base, name="Host",
                       version_number=1, body_kind="RECTANGLE", width=120, height=40)
        add("presentation_panels", base_revision_id=revision, panel_key="front", panel_number=1,
            display_name="Front", x=0, y=0, width=120, height=40)
        bay_fields = {"bay_key": "stable-bay", "display_name": "Socket", "panel_key": "front",
                      "kind": "PLACED", "x": .2, "y": .3, "compatibility": compatibility}
        bay = add("module_bays", base_revision_id=revision, **bay_fields)
        base_definition = {"name": "Host", "bays": [bay_fields]}
        add("base_template_drafts", template_id=base, source_revision_id=revision, generation=1, definition=base_definition)
        add("base_template_candidates", template_id=base, source_revision_id=revision, draft_generation=1,
            definition=base_definition, input_fingerprint="b" * 64,
            result={"changes": [{"section": "bays", "key": "stable-bay", "operation": "added",
                                 "after": bay_fields}], "objects": []})

        module = add("module_templates", name="Module")
        geometry = {"width": 240, "height": 80, "fill_color": "#64748b", "endpoints": {"stable-port": {"x": .5, "y": .5}}}
        module_rev = add("module_template_revisions", template_id=module, version_number=1,
                         name="Module", compatibility=compatibility, geometry=geometry)
        port_type = conn.scalar(sa.select(metadata.tables["port_types"].c.id).limit(1))
        endpoint = add("module_endpoint_definitions", module_revision_id=module_rev, definition_key="stable-port",
                       display_name="P1", kind="NETWORK_PORT", order_index=0, port_type_id=port_type)
        nested = {"key": "nested", "display_name": "Nested", "compatibility": "SFP+", "x": .3, "y": .4}
        nested_template = add("module_templates", name="Nested marker example")
        add("module_template_revisions", template_id=nested_template, version_number=1,
            name="Nested marker example", compatibility="SFP", geometry={**geometry, "endpoints": {}},
            module_ports=[nested])
        module_definition = {"name": "Module", "compatibility": compatibility, "geometry": geometry, "module_ports": [nested]}
        add("module_template_drafts", template_id=module, source_revision_id=module_rev, generation=1, definition=module_definition)
        add("module_template_candidates", template_id=module, source_revision_id=module_rev, draft_generation=1,
            definition=module_definition, input_fingerprint="a" * 64, result={
                "changes": [{"section": "properties", "key": "compatibility", "operation": "changed",
                             "before": compatibility, "after": "SFP"},
                            {"section": "module_ports", "key": "nested", "operation": "added", "after": nested}],
                "installations": [],
            })
        obj = add("physical_objects")
        other = add("physical_objects")
        config = add("object_configurations", physical_object_id=obj, base_revision_id=revision)
        installation = add("module_installations", configuration_id=config, module_revision_id=module_rev,
                           bay_key="stable-bay", orientation="HORIZONTAL", layout={"version": 1})
        point = add("connection_points", physical_object_id=obj, cardinality=1)
        other_point = add("connection_points", physical_object_id=other, cardinality=1)
        interface = add("network_interfaces")
        add("network_interface_physical_owners", interface_id=interface, physical_object_id=obj)
        add("interface_physical_bindings", interface_id=interface, point_id=point, point_member=1)
        mapping = add("module_endpoint_mappings", installation_id=installation, definition_id=endpoint,
                      connection_point_id=point, network_interface_id=interface)
        point_a, point_b = sorted((point, other_point))
        connection = add("connections", point_a_id=point_a, point_b_id=point_b, cardinality=1)
        add("connection_members", connection_id=connection, index=1, point_a_member=1, point_b_member=1)
        cable_type = conn.scalar(sa.select(metadata.tables["cable_types"].c.id).limit(1))
        cable = add("cables", connection_id=connection, cable_type_id=cable_type)
        return {"module_bays": bay, "base_template_revisions": revision, "module_template_revisions": module_rev,
                "module_installations": installation, "module_endpoint_mappings": mapping,
                "connection_points": point, "network_interfaces": interface, "cables": cable}


@pytest.mark.parametrize("previously_applied", [False, True])
def test_forward_migration_preserves_installation_and_seed(legacy_database, previously_applied):
    db, upgrade = legacy_database
    compatibility = " Vendor / custom " if previously_applied else "PCIe x16"
    ids = _legacy_installation(db, compatibility)
    mapping = None
    if previously_applied:
        old_upgrade = upgrade("catd05_module_port_types")
        assert old_upgrade.returncode == 0, old_upgrade.stderr
        with db.begin() as conn:
            custom = conn.scalar(sa.text("SELECT id FROM module_port_types WHERE name = :name"), {"name": compatibility})
            conn.execute(sa.text("UPDATE module_port_types SET is_active = false WHERE id = :id"), {"id": custom})
            renamed_seed = conn.scalar(sa.text("UPDATE module_port_types SET name = 'Renamed slot' WHERE name = 'PCIe x16' RETURNING id"))
        rejected = upgrade()
        assert rejected.returncode != 0 and str(custom) in rejected.stderr
        with db.connect() as conn:
            assert conn.scalar(sa.text("SELECT version_num FROM alembic_version")) == "catd05_module_port_types"
            assert conn.scalar(sa.text("SELECT module_port_type_id FROM module_bays")) == custom
        mapping = {str(custom): "MODULE_BAY"}
    stable_tables = ("module_installations", "module_endpoint_mappings", "connection_points",
                     "network_interfaces", "interface_physical_bindings", "connections", "connection_members", "cables")

    def snapshot():
        with db.connect() as conn:
            return {table: conn.execute(sa.text(f"SELECT * FROM {table} ORDER BY id")).all() for table in stable_tables}

    before = snapshot()
    result = upgrade(mapping=mapping)
    assert result.returncode == 0, result.stderr
    assert snapshot() == before
    with db.connect() as conn:
        names = dict(conn.execute(sa.text("SELECT name,id FROM module_port_types")).all())
        assert set(names) == SEED
        bays = dict(conn.execute(sa.text("SELECT name,id FROM module_bay_types")).all())
        expected = {"PCIe x1", "PCIe x4", "PCIe x8"}
        if previously_applied:
            expected |= {compatibility, "Renamed slot"}
            assert bays[compatibility] == custom
            assert bays["Renamed slot"] == renamed_seed
            assert conn.scalar(sa.text("SELECT is_active FROM module_bay_types WHERE id = :id"), {"id": custom}) is False
        else:
            expected.add("PCIe x16")
        assert set(bays) == expected
        for table, item_id in ids.items():
            assert conn.scalar(sa.text(f"SELECT id FROM {table} WHERE id = :id"), {"id": item_id}) == item_id
        for table in ("module_bays", "module_template_revisions"):
            assert conn.scalar(sa.text(f"SELECT module_bay_type_id FROM {table} WHERE id = :id"), {"id": ids[table]}) == bays[compatibility]
        assert conn.scalar(sa.text("SELECT definition->'bays'->0->>'module_bay_type_id' FROM base_template_drafts")) == str(bays[compatibility])
        assert conn.scalar(sa.text("SELECT result->'changes'->0->'after'->>'module_bay_type_id' FROM base_template_candidates")) == str(bays[compatibility])
        assert conn.scalar(sa.text("SELECT definition->'module_places'->0->>'module_port_type_id' FROM module_template_drafts")) == str(names["SFP+"])
        assert conn.scalar(sa.text("SELECT module_places->0->>'module_port_type_id' FROM module_template_revisions WHERE name = 'Nested marker example'")) == str(names["SFP+"])
        assert conn.scalar(sa.text("SELECT result->'changes'->0->>'key' FROM module_template_candidates")) == "mount"
    repeated = upgrade()
    assert repeated.returncode == 0, repeated.stderr
    with db.connect() as conn:
        assert dict(conn.execute(sa.text("SELECT name,id FROM module_port_types")).all()) == names
        assert dict(conn.execute(sa.text("SELECT name,id FROM module_bay_types")).all()) == bays


@pytest.mark.parametrize("value", ["sfp", "Legacy"])
def test_forward_migration_rolls_back_on_name_collision(legacy_database, value):
    db, upgrade = legacy_database
    ids = _legacy_installation(db, value)
    if value == "Legacy":
        with db.begin() as conn:
            conn.execute(sa.text("UPDATE module_template_revisions SET compatibility = 'legacy' WHERE name = 'Module'"))
    result = upgrade()
    assert result.returncode != 0
    assert "distinct compatibility names conflict" in result.stderr
    with db.connect() as conn:
        assert "module_port_types" not in sa.inspect(conn).get_table_names()
        assert conn.scalar(sa.text("SELECT version_num FROM alembic_version")) == "mod01_module_port_markers"
        assert conn.scalar(sa.text("SELECT compatibility FROM module_bays")) == value
        assert conn.scalar(sa.text("SELECT id FROM module_installations")) == ids["module_installations"]
        assert conn.scalar(sa.text("SELECT id FROM cables")) == ids["cables"]



def test_unclassified_legacy_name_rolls_back_both_steps(legacy_database):
    db, upgrade = legacy_database
    ids = _legacy_installation(db, "Custom kind")
    result = upgrade()
    assert result.returncode != 0 and "classify these UUIDs" in result.stderr
    with db.connect() as conn:
        assert conn.scalar(sa.text("SELECT version_num FROM alembic_version")) == "mod01_module_port_markers"
        assert conn.scalar(sa.text("SELECT compatibility FROM module_bays")) == "Custom kind"
        assert conn.scalar(sa.text("SELECT id FROM module_installations")) == ids["module_installations"]


def test_pcie_card_definition_with_sfp_ports_publishes_and_roundtrips():
    from app.module_geometry import initial_geometry
    from tests.test_module_template_review import check, open_draft, save

    pcie = client.post(BAY_CATALOG, json={"name": "PCIe x16"}).json()["id"]
    sfp = client.post(CATALOG, json={"name": "SFP+"}).json()["id"]
    mount = {"mount_kind": "MODULE_BAY", "module_bay_type_id": pcie}
    definition = {"name": "Network card", **mount, "geometry": initial_geometry([]), "endpoints": []}
    created = client.post("/v1/library/module-templates", json=definition)
    assert created.status_code == 201, created.text
    template = created.json()["template_id"]
    child = {"key": "sfp-1", "display_name": "SFP+ 1", "x": .25, "y": .5,
             "mount_kind": "MODULE_PORT", "module_port_type_id": sfp}
    draft = save(template, open_draft(template), {**definition, "module_places": [child]})
    reviewed = check(template, draft)["review"]
    assert reviewed["definition"]["module_places"] == [child]
    assert reviewed["result"]["changes"][0]["after"] == child
    published = client.post(f"/v1/library/module-templates/{template}/candidates/{reviewed['candidate_id']}/publish")
    assert published.status_code == 200, published.text
    payload = base_payload()
    bay = payload["bays"][0]
    bay.pop("module_port_type_id")
    bay.update(mount)
    base, _ = create_base(payload)
    obj = create_object(base)["physical_object_ref"]["entity_id"]
    rejected = install(obj, template, bay["bay_key"])
    assert rejected.status_code == 409
    assert rejected.json()["error"]["details"]["reason"] == "NESTED_MODULE_PORTS_UNSUPPORTED"
    package = client.get(PACKAGE).json()
    assert client.delete("/v1/workspace/dataset").status_code == 204
    assert client.post(PACKAGE, json=package).status_code == 204
    assert client.get(PACKAGE).json() == package
