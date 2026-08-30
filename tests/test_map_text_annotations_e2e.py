from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import MapTextAnnotation
from tests.l1_builders import create_map, create_object_with_point


client = TestClient(app)


def payload(text: str = "  Line one\nLine two  ") -> dict:
    return {"text": text, "position": {"x": 12.5, "y": -8}, "text_color": "#123456", "font_size": 18}


def test_text_annotation_is_saved_map_owned_presentation_with_create_read_replace_and_delete():
    map_id = create_map(client, "Text annotation")
    object_id, _ = create_object_with_point(client, "Unchanged placement")
    assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": object_id, "x": 4, "y": 8}).status_code == 201

    created = client.post(f"/v1/maps/{map_id}/text-annotations", json=payload())
    assert created.status_code == 201, created.text
    annotation_id = created.json()["annotation_ref"]["entity_id"]
    saved = client.get(f"/v1/maps/{map_id}").json()
    assert saved["text_annotations"] == [{"annotation_ref": {"entity_type": "MapTextAnnotation", "entity_id": annotation_id}, **payload("Line one\nLine two")}]
    assert saved["regions"] == []
    assert saved["placements"][0]["physical_object_ref"]["entity_id"] == object_id

    replacement = {**payload("Replacement"), "position": {"x": 99, "y": 4}, "text_color": "#abcdef", "font_size": 24}
    updated = client.put(f"/v1/maps/{map_id}/text-annotations/{annotation_id}", json=replacement)
    assert updated.status_code == 200, updated.text
    assert updated.json()["annotation_ref"]["entity_id"] == annotation_id
    assert client.get(f"/v1/maps/{map_id}").json()["text_annotations"][0] == {"annotation_ref": {"entity_type": "MapTextAnnotation", "entity_id": annotation_id}, **replacement}

    assert client.delete(f"/v1/maps/{map_id}/text-annotations/{annotation_id}").status_code == 204
    final = client.get(f"/v1/maps/{map_id}").json()
    assert final["text_annotations"] == []
    assert final["placements"][0]["physical_object_ref"]["entity_id"] == object_id


def test_text_annotation_rejects_blank_text_and_invalid_presentation_values():
    map_id = create_map(client, "Text validation")
    for invalid in ({**payload(" \n \t ")}, {**payload(), "position": {"x": "bad", "y": 0}}, {**payload(), "text_color": "blue"}, {**payload(), "font_size": 0}):
        assert client.post(f"/v1/maps/{map_id}/text-annotations", json=invalid).status_code == 422


def test_saved_map_delete_cascades_text_annotations():
    map_id = create_map(client, "Text cascade")
    assert client.post(f"/v1/maps/{map_id}/text-annotations", json=payload()).status_code == 201
    assert client.delete(f"/v1/maps/{map_id}").status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapTextAnnotation)) == 0
