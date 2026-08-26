import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.database import SessionLocal


def test_0027_preserves_historical_blueprint_snapshot_when_upgrading_from_0026():
    config = Config("alembic.ini")
    command.downgrade(config, "0026_port_blocks")
    blueprint_id, version_id, first_slot_id, second_slot_id, link_id = (uuid.uuid4() for _ in range(5))
    with SessionLocal.begin() as session:
        session.execute(text("INSERT INTO object_blueprints (id, name) VALUES (:id, 'historical blueprint')"), {"id": blueprint_id})
        session.execute(text("""INSERT INTO object_blueprint_versions
            (id, blueprint_id, version_number, body_kind, width, height, fill_color, authoring_recipe)
            VALUES (:id, :blueprint_id, 1, 'RECTANGLE', 120, 40, '#123456', CAST(:recipe AS jsonb))"""), {"id": version_id, "blueprint_id": blueprint_id, "recipe": '{"endpoint_groups": []}'})
        for slot_id, key, offset in ((first_slot_id, "legacy-a", 0.25), (second_slot_id, "legacy-b", 0.75)):
            session.execute(text("""INSERT INTO blueprint_endpoint_slots
                (id, blueprint_version_id, slot_key, display_name, kind, anchor_side, anchor_offset)
                VALUES (:id, :version_id, :key, :key, 'CONNECTION_POINT', 'LEFT', :offset)"""), {"id": slot_id, "version_id": version_id, "key": key, "offset": offset})
        session.execute(text("""INSERT INTO blueprint_internal_links (id, blueprint_version_id, slot_a_id, slot_b_id)
            VALUES (:id, :version_id, :first_slot_id, :second_slot_id)"""), {"id": link_id, "version_id": version_id, "first_slot_id": first_slot_id, "second_slot_id": second_slot_id})

    command.upgrade(config, "head")

    with SessionLocal() as session:
        slots = session.execute(text("SELECT slot_key, port_block_instance_id, port_block_local_id FROM blueprint_endpoint_slots WHERE blueprint_version_id = :version_id ORDER BY slot_key"), {"version_id": version_id}).all()
        link = session.execute(text("SELECT slot_a_id, slot_b_id FROM blueprint_internal_links WHERE id = :id"), {"id": link_id}).one()
        composition_count = session.execute(text("SELECT count(*) FROM blueprint_port_block_instances WHERE blueprint_version_id = :version_id"), {"version_id": version_id}).scalar_one()
    assert slots == [("legacy-a", None, None), ("legacy-b", None, None)]
    assert set(link) == {first_slot_id, second_slot_id}
    assert composition_count == 0
