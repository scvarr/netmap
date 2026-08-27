import uuid

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app.database import SessionLocal
from app.main import app


client = TestClient(app)


def _assert_composition_contract() -> None:
    inspector = inspect(SessionLocal.kw["bind"])
    assert "composition_kind" in {column["name"] for column in inspector.get_columns("object_blueprint_versions")}
    assert inspector.has_table("blueprint_port_block_instances")
    assert {column["name"] for column in inspector.get_columns("blueprint_port_block_instances")} >= {
        "id", "blueprint_version_id", "port_block_version_id", "instance_key", "face",
    }
    assert tuple(inspector.get_pk_constraint("blueprint_port_block_instances")["constrained_columns"]) == ("id",)
    foreign_keys = inspector.get_foreign_keys("blueprint_port_block_instances")
    assert any(key["constrained_columns"] == ["blueprint_version_id"] and key["referred_table"] == "object_blueprint_versions" for key in foreign_keys)
    assert any(key["constrained_columns"] == ["port_block_version_id"] and key["referred_table"] == "port_block_versions" for key in foreign_keys)
    assert any(constraint["column_names"] == ["blueprint_version_id", "instance_key"] for constraint in inspector.get_unique_constraints("blueprint_port_block_instances"))
    assert any("instance_key" in str(constraint["sqltext"]) for constraint in inspector.get_check_constraints("blueprint_port_block_instances"))
    assert any("face" in str(constraint["sqltext"]) and "FRONT" in str(constraint["sqltext"]) and "REAR" in str(constraint["sqltext"]) for constraint in inspector.get_check_constraints("blueprint_port_block_instances"))
    endpoint_columns = {column["name"] for column in inspector.get_columns("blueprint_endpoint_slots")}
    assert {"port_block_instance_id", "port_block_local_id"} <= endpoint_columns
    endpoint_foreign_keys = inspector.get_foreign_keys("blueprint_endpoint_slots")
    assert any(key["constrained_columns"] == ["port_block_instance_id"] and key["referred_table"] == "blueprint_port_block_instances" for key in endpoint_foreign_keys)
    assert any(constraint["column_names"] == ["port_block_instance_id", "port_block_local_id"] for constraint in inspector.get_unique_constraints("blueprint_endpoint_slots"))


def test_0029_repairs_a_drifted_0028_composition_schema_and_preserves_authoring():
    config = Config("alembic.ini")
    command.downgrade(config, "0028_blueprint_port_block_instance_face")
    with SessionLocal.begin() as session:
        session.execute(text("ALTER TABLE blueprint_endpoint_slots DROP CONSTRAINT fk_blueprint_slot_block_instance"))
        session.execute(text("ALTER TABLE blueprint_endpoint_slots DROP CONSTRAINT uq_blueprint_slot_block_local_id"))
        session.execute(text("ALTER TABLE blueprint_endpoint_slots DROP COLUMN port_block_instance_id"))
        session.execute(text("ALTER TABLE blueprint_endpoint_slots DROP COLUMN port_block_local_id"))
        session.execute(text("DROP TABLE blueprint_port_block_instances"))
        session.execute(text("ALTER TABLE object_blueprint_versions DROP COLUMN composition_kind"))

    command.upgrade(config, "head")
    _assert_composition_contract()

    empty = client.post("/v1/library/object-blueprints", json={
        "name": "Empty repaired composition",
        "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "composition": {"instances": []},
        "internal_links": [],
    })
    assert empty.status_code == 201, empty.text
    port_block = client.post("/v1/library/port-blocks", json={
        "name": "Repaired Panel",
        "ports": [{"local_id": "p1", "display_label": "P1", "kind": "CONNECTION_POINT", "row": 1, "column": 1, "layout_order": 1}],
    })
    assert port_block.status_code == 201, port_block.text
    port_block_version_id = port_block.json()["version_ref"]["entity_id"]
    composed = client.post("/v1/library/object-blueprints", json={
        "name": "Port block repaired composition",
        "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "composition": {"instances": [{
            "instance_key": "panel",
            "port_block_version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": port_block_version_id},
            "face": "FRONT",
        }]},
        "internal_links": [],
    })
    assert composed.status_code == 201, composed.text

    blueprint_id, version_id, slot_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with SessionLocal.begin() as session:
        session.execute(text("INSERT INTO object_blueprints (id, name) VALUES (:id, 'historical repaired blueprint')"), {"id": blueprint_id})
        session.execute(text("""INSERT INTO object_blueprint_versions
            (id, blueprint_id, version_number, body_kind, width, height)
            VALUES (:id, :blueprint_id, 1, 'RECTANGLE', 1, 1)"""), {"id": version_id, "blueprint_id": blueprint_id})
        session.execute(text("""INSERT INTO blueprint_endpoint_slots
            (id, blueprint_version_id, slot_key, display_name, kind, anchor_side, anchor_offset)
            VALUES (:id, :version_id, 'legacy', 'Legacy', 'CONNECTION_POINT', 'LEFT', .5)"""), {"id": slot_id, "version_id": version_id})
    historical = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}")
    assert historical.status_code == 200, historical.text
    assert historical.json()["composition"] is None


def test_0029_is_a_no_op_for_a_clean_0028_schema():
    config = Config("alembic.ini")
    command.downgrade(config, "0028_blueprint_port_block_instance_face")
    command.upgrade(config, "head")
    _assert_composition_contract()
