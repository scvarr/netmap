from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import MapPlacement, MapPresentationVariant, MapTextAnnotation, MapViewPosition
from tests.l1_builders import create_map, create_object_with_point


client = TestClient(app)


def test_variant_catalog_remains_complete_for_every_selected_variant():
    map_id = create_map(client, "Variant catalog")
    primary = client.get(f"/v1/maps/{map_id}").json()
    primary_id = primary["active_variant_ref"]["entity_id"]
    assert [item["name"] for item in primary["variants"]] == ["Основной"]
    ids = {"Основной": primary_id}
    for name in ("A", "B"):
        response = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": name, "source_variant_id": primary_id})
        assert response.status_code == 201, response.text
        ids[name] = response.json()["variant_ref"]["entity_id"]
        current = client.get(f"/v1/maps/{map_id}?variant_id={primary_id}").json()
        assert {item["name"] for item in current["variants"]} == set(ids)
    with SessionLocal() as session:
        assert {(str(item.id), str(item.map_id), item.name) for item in session.scalars(select(MapPresentationVariant).where(MapPresentationVariant.map_id == map_id))} == {
            (variant_id, map_id, name) for name, variant_id in ids.items()
        }
    for name, variant_id in ids.items():
        current = client.get(f"/v1/maps/{map_id}?variant_id={variant_id}").json()
        assert current["active_variant_ref"]["entity_id"] == variant_id
        assert {item["name"] for item in current["variants"]} == set(ids)
    duplicate = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "A", "source_variant_id": primary_id})
    assert duplicate.status_code == 409
    assert client.delete(f"/v1/maps/{map_id}/presentation-variants/{ids['B']}").status_code == 204
    remaining = client.get(f"/v1/maps/{map_id}?variant_id={primary_id}").json()
    assert {item["name"] for item in remaining["variants"]} == {"Основной", "A"}


def test_creating_a_layout_copy_clones_only_variant_specific_presentation_state():
    map_id = create_map(client, "Layout source")
    source_id = client.get(f"/v1/maps/{map_id}").json()["active_variant_ref"]["entity_id"]
    left_id, _ = create_object_with_point(client, "Left")
    right_id, _ = create_object_with_point(client, "Right")
    for object_id, x, y, width in ((left_id, 10, 20, 320), (right_id, 30, 40, None)):
        body = {"physical_object_id": object_id, "x": x, "y": y}
        if width is not None:
            body["display_width"] = width
        assert client.post(f"/v1/maps/{map_id}/placements?variant_id={source_id}", json=body).status_code == 201
    assert client.put(f"/v1/maps/{map_id}/placements/{left_id}/positions/logical?variant_id={source_id}", json={"x": 50, "y": 60}).status_code == 200
    assert client.put(f"/v1/maps/{map_id}/placements/{left_id}/locks/physical?variant_id={source_id}", json={"locked": True}).status_code == 200
    copied = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Copy", "source_variant_id": source_id})
    assert copied.status_code == 201, copied.text
    created_variant = copied.json()
    assert created_variant["name"] == "Copy"
    copy_id = created_variant["variant_ref"]["entity_id"]
    detail = client.get(f"/v1/maps/{map_id}?variant_id={copy_id}").json()
    copied_positions = next(item["positions"] for item in detail["placements"] if item["physical_object_ref"]["entity_id"] == left_id)
    assert copied_positions == {"L1/PHYSICAL_OBJECT": {"x": 10, "y": 20, "locked": True, "display_width": 320}, "L2/DEVICE": {"x": 50, "y": 60, "locked": False}}
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapPlacement)) == 2

    assert client.put(f"/v1/maps/{map_id}/placements/{left_id}/locks/physical?variant_id={copy_id}", json={"locked": False}).status_code == 200
    assert client.put(f"/v1/maps/{map_id}/placements/{left_id}/positions/physical?variant_id={copy_id}", json={"x": 99, "y": 98, "display_width": 444}).status_code == 200
    source = client.get(f"/v1/maps/{map_id}?variant_id={source_id}").json()
    source_positions = next(item["positions"] for item in source["placements"] if item["physical_object_ref"]["entity_id"] == left_id)
    assert source_positions["L1/PHYSICAL_OBJECT"] == {"x": 10, "y": 20, "locked": True, "display_width": 320}


def test_layout_copy_rejects_a_source_variant_from_another_saved_map():
    first, second = create_map(client, "First"), create_map(client, "Second")
    foreign_variant = client.get(f"/v1/maps/{second}").json()["active_variant_ref"]["entity_id"]
    response = client.post(f"/v1/maps/{first}/presentation-variants", json={"name": "Invalid", "source_variant_id": foreign_variant})
    assert response.status_code == 422


def test_deleting_a_non_primary_layout_removes_only_its_presentation_state():
    map_id = create_map(client, "Layout deletion")
    primary_id = client.get(f"/v1/maps/{map_id}").json()["active_variant_ref"]["entity_id"]
    object_id, _ = create_object_with_point(client, "Placed")
    second_object_id, _ = create_object_with_point(client, "Placed second")
    assert client.post(f"/v1/maps/{map_id}/placements?variant_id={primary_id}", json={"physical_object_id": object_id, "x": 10, "y": 20, "display_width": 320}).status_code == 201
    assert client.post(f"/v1/maps/{map_id}/placements?variant_id={primary_id}", json={"physical_object_id": second_object_id, "x": 30, "y": 40}).status_code == 201
    assert client.post(f"/v1/maps/{map_id}/text-annotations", json={"text": "Keep", "position": {"x": 5, "y": 6}, "text_color": "#123456", "font_size": 12}).status_code == 201
    copy_id = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Copy", "source_variant_id": primary_id}).json()["variant_ref"]["entity_id"]
    other_id = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Keep", "source_variant_id": primary_id}).json()["variant_ref"]["entity_id"]
    primary_before = client.get(f"/v1/maps/{map_id}?variant_id={primary_id}").json()
    other_before = client.get(f"/v1/maps/{map_id}?variant_id={other_id}").json()
    assert client.put(f"/v1/maps/{map_id}/placements/{object_id}/positions/physical?variant_id={copy_id}", json={"x": 90, "y": 80, "display_width": 440}).status_code == 200

    assert client.delete(f"/v1/maps/{map_id}/presentation-variants/{copy_id}").status_code == 204
    assert client.get(f"/v1/maps/{map_id}?variant_id={copy_id}").status_code == 422
    for variant_id, before in ((primary_id, primary_before), (other_id, other_before)):
        after = client.get(f"/v1/maps/{map_id}?variant_id={variant_id}").json()
        assert after == {**before, "variants": [item for item in before["variants"] if item["variant_ref"]["entity_id"] != copy_id]}

    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapViewPosition)) == 4
        assert session.scalar(select(func.count()).select_from(MapPlacement)) == 2
        assert session.scalar(select(func.count()).select_from(MapTextAnnotation)) == 1
    primary = client.get(f"/v1/maps/{map_id}?variant_id={primary_id}").json()
    assert primary["active_variant_ref"]["entity_id"] == primary_id
    assert primary["placements"] and primary["text_annotations"]
    assert "composites" not in primary and "regions" not in primary


def test_deleting_primary_or_foreign_layout_is_rejected():
    first, second = create_map(client, "First"), create_map(client, "Second")
    primary_id = client.get(f"/v1/maps/{first}").json()["active_variant_ref"]["entity_id"]
    foreign_id = client.get(f"/v1/maps/{second}").json()["active_variant_ref"]["entity_id"]
    assert client.delete(f"/v1/maps/{first}/presentation-variants/{primary_id}").status_code == 422
    assert client.delete(f"/v1/maps/{first}/presentation-variants/{foreign_id}").status_code == 422


def test_face_settings_copy_and_reload_without_materializing_inheritance():
    from tests.test_map_location_states_e2e import assign, detail, location, write

    map_id = create_map(client, "Faces")
    source = detail(map_id)["active_variant_ref"]["entity_id"]
    room = location("Room")
    rack = location("Rack", room)
    other = location("Other")
    object_id, _ = create_object_with_point(client, "Equipment")
    assign(object_id, rack)
    assert client.post(f"/v1/maps/{map_id}/placements", json={
        "physical_object_id": object_id, "x": 10, "y": 20,
    }).status_code == 201

    def face(variant, value, target=""):
        return client.put(f"/v1/maps/{map_id}/presentation-variants/{variant}/face{target}", json={"face": value})

    def settings(variant):
        data = detail(map_id, variant)
        selected = next(item for item in data["variants"] if item["variant_ref"]["entity_id"] == variant)
        positions = data["placements"][0]["positions"]
        return (selected["default_face"],
                {state["location_ref"]["entity_id"]: state.get("face_override") for state in data["location_states"]},
                positions["L1/PHYSICAL_OBJECT"].get("face_override"))

    assert face(source, "INHERIT").status_code == 422
    assert face(source, "REAR").status_code == 200
    assert face(source, "FRONT", f"/locations/{room}").status_code == 200
    assert face(source, "REAR", f"/objects/{object_id}").status_code == 200
    assert write(map_id, source, rack, collapsed=True).status_code == 200
    assert write(map_id, source, rack, collapsed=False).status_code == 200

    response = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Copy", "source_variant_id": source})
    assert response.status_code == 201, response.text
    copied = response.json()["variant_ref"]["entity_id"]
    expected = ("REAR", {room: "FRONT", rack: None, other: None}, "REAR")
    assert settings(copied) == settings(source) == expected

    assert face(copied, "FRONT").status_code == 200
    assert face(copied, "INHERIT", f"/locations/{room}").status_code == 200
    assert face(copied, "INHERIT", f"/objects/{object_id}").status_code == 200
    assert client.put(f"/v1/locations/{rack}/parent", json={"parent_location_id": other}).status_code == 200
    assign(object_id, room)
    assert settings(copied) == ("FRONT", {room: None, rack: None, other: None}, None)
    assert settings(source) == expected
    assert detail(map_id, copied)["placements"][0]["location_ref"]["entity_id"] == room


def test_manual_variant_footprint_uses_active_face_without_moving_the_object():
    from uuid import UUID, uuid4

    from app.saved_map_catalog import SavedMapCatalog
    from tests.test_hardware_configuration import base_payload, create_base, create_object
    from tests.test_map_location_states_e2e import assign, detail, location

    payload = base_payload()
    panel = payload["panels"][0]
    panel["face"] = "FRONT"
    payload["panels"].append({**panel, "panel_key": str(uuid4()), "panel_number": 2,
                              "y": 60, "height": 30, "face": "REAR"})
    template_id, _ = create_base(payload)
    object_id = create_object(template_id)["physical_object_ref"]["entity_id"]
    room = location("Face geometry")
    assign(object_id, room)
    map_id = create_map(client, "Face geometry")
    variant = detail(map_id)["active_variant_ref"]["entity_id"]
    assert client.post(f"/v1/maps/{map_id}/placements", json={
        "physical_object_id": object_id, "x": 100, "y": 100, "display_width": 240,
    }).status_code == 201

    def footprint():
        with SessionLocal.begin() as session:
            _, footprints = SavedMapCatalog(session)._physical_geometry(UUID(map_id), UUID(variant))
            return footprints[UUID(object_id)]

    before = footprint()
    assert (before["width"], before["height"]) == (332, 90)
    assert client.put(f"/v1/maps/{map_id}/presentation-variants/{variant}/face/locations/{room}",
                      json={"face": "REAR"}).status_code == 200
    assert footprint() == {**before, "height": 45}
    assert detail(map_id)["placements"][0]["positions"]["L1/PHYSICAL_OBJECT"]["display_width"] == 240
