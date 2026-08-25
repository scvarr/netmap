import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.database import SessionLocal


def test_upgrade_backfills_legacy_physical_positions_without_changing_membership():
    config = Config("alembic.ini")
    command.downgrade(config, "0022_saved_maps")
    placement_id, map_id, object_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with SessionLocal.begin() as session:
        session.execute(text("INSERT INTO saved_maps (id, name) VALUES (:id, 'migration sentinel')"), {"id": map_id})
        session.execute(text("INSERT INTO physical_objects (id) VALUES (:id)"), {"id": object_id})
        session.execute(text("INSERT INTO map_placements (id, map_id, physical_object_id, x, y) VALUES (:id, :map_id, :object_id, 12, 34)"), {"id": placement_id, "map_id": map_id, "object_id": object_id})

    command.upgrade(config, "head")

    with SessionLocal() as session:
        membership = session.execute(text("SELECT map_id, physical_object_id FROM map_placements WHERE id = :id"), {"id": placement_id}).one()
        position = session.execute(text("SELECT view_key, x, y, locked FROM map_view_positions WHERE placement_id = :id"), {"id": placement_id}).one()
    assert membership == (map_id, object_id)
    assert position == ("L1/PHYSICAL_OBJECT", 12.0, 34.0, False)
