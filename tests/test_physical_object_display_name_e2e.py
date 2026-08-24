import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.device_catalog import DISPLAY_ALIAS_KEY, PHYSICAL_OBJECT_CLASS_KEY
from app.main import app
from app.models import Connection, ConnectionPoint, EntityMetadata, MapPlacement, SavedMap
from app.repository import CanonicalRepository, ConnectionMemberInput


client = TestClient(app)


def create_object(display_name: str, class_value: str | None = None) -> str:
    response = client.post(
        "/v1/topology/physical-objects",
        json={
            "display_name": display_name,
            "initial_connection_point": {"display_name": "A01"},
            **({"class": class_value} if class_value is not None else {}),
        },
    )
    assert response.status_code == 201
    return response.json()["physical_object"]["source_ref"]["entity_id"]


def test_display_name_updates_alias_metadata_without_changing_topology_identity():
    object_id = uuid.UUID(create_object("OLD", "switch"))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        primary_point = session.scalar(
            select(ConnectionPoint).where(ConnectionPoint.physical_object_id == object_id)
        )
        assert primary_point is not None
        remote = repository.add_physical_object()
        remote_point = repository.add_connection_point(remote.id, cardinality=1)
        connection, _ = repository.add_connection(
            primary_point.id,
            remote_point.id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        saved_map = SavedMap(name="Inventory")
        session.add(saved_map)
        session.flush()
        placement = MapPlacement(map_id=saved_map.id, physical_object_id=object_id)
        session.add(placement)
        session.flush()
        alias = session.scalar(
            select(EntityMetadata).where(
                EntityMetadata.physical_object_id == object_id,
                EntityMetadata.key == DISPLAY_ALIAS_KEY,
            )
        )
        object_class = session.scalar(
            select(EntityMetadata).where(
                EntityMetadata.physical_object_id == object_id,
                EntityMetadata.key == PHYSICAL_OBJECT_CLASS_KEY,
            )
        )
        assert alias is not None
        assert object_class is not None
        before = {
            "alias_id": alias.id,
            "class_id": object_class.id,
            "class_value": object_class.value,
            "point_id": primary_point.id,
            "connection_id": connection.id,
            "placement_id": placement.id,
        }

    renamed = client.put(
        f"/v1/topology/physical-objects/{object_id}/display-name",
        json={"display_name": "  NEW  "},
    )
    assert renamed.status_code == 200
    body = renamed.json()
    assert body["physical_object"]["source_ref"]["entity_id"] == str(object_id)
    assert body["physical_object"]["label"] == "NEW"
    assert "label_source" not in body["physical_object"]

    renamed_again = client.put(
        f"/v1/topology/physical-objects/{object_id}/display-name",
        json={"display_name": "NEWER"},
    )
    assert renamed_again.status_code == 200
    with SessionLocal() as session:
        aliases = tuple(
            session.scalars(
                select(EntityMetadata).where(
                    EntityMetadata.physical_object_id == object_id,
                    EntityMetadata.key == DISPLAY_ALIAS_KEY,
                )
            )
        )
        assert len(aliases) == 1
        assert aliases[0].id == before["alias_id"]
        assert aliases[0].value == "NEWER"
        object_class = session.get(EntityMetadata, before["class_id"])
        assert object_class is not None
        assert object_class.value == before["class_value"]
        assert session.get(ConnectionPoint, before["point_id"]) is not None
        assert session.get(Connection, before["connection_id"]) is not None
        assert session.get(MapPlacement, before["placement_id"]) is not None


def test_display_name_creates_missing_alias_and_stops_technical_fallback():
    with SessionLocal.begin() as session:
        object_ = CanonicalRepository(session).add_physical_object()

    response = client.put(
        f"/v1/topology/physical-objects/{object_.id}/display-name",
        json={"display_name": "Named later"},
    )
    assert response.status_code == 200
    assert response.json()["physical_object"] == {
        "source_ref": {
            "ref_type": "CANONICAL_FACT",
            "entity_type": "PhysicalObject",
            "entity_id": str(object_.id),
        },
        "label": "Named later",
    }
    with SessionLocal() as session:
        aliases = tuple(session.scalars(select(EntityMetadata).where(
            EntityMetadata.physical_object_id == object_.id,
            EntityMetadata.key == DISPLAY_ALIAS_KEY,
        )))
        assert len(aliases) == 1


def test_display_name_rejects_blank_and_missing_object():
    missing_id = "00000000-0000-0000-0000-000000000101"
    blank = client.put(
        f"/v1/topology/physical-objects/{missing_id}/display-name",
        json={"display_name": "   "},
    )
    missing = client.put(
        f"/v1/topology/physical-objects/{missing_id}/display-name",
        json={"display_name": "Missing"},
    )

    assert blank.status_code == 422
    assert missing.status_code == 422
    with SessionLocal() as session:
        assert tuple(session.scalars(select(EntityMetadata))) == ()
