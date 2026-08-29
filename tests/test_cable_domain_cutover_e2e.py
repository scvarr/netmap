from fastapi.testclient import TestClient

from app.main import app
from tests.l1_builders import create_endpoint_cable, create_object_with_point


client = TestClient(app)


def test_canonical_cable_identity_drives_catalog_details_and_l1_projection():
    left_object, left = create_object_with_point(client, "left")
    right_object, right = create_object_with_point(client, "right")
    created = create_endpoint_cable(client, left, right)
    cable_id = created["cable_ref"]["entity_id"]

    catalog = client.get("/v1/catalog/inventory").json()
    cable = next(value for value in catalog["cables"] if value["cable_ref"]["entity_id"] == cable_id)
    assert cable["cable_ref"]["entity_type"] == "Cable"
    assert cable["connection_ref"] == created["connection_ref"]
    assert {item["remote_physical_object_ref"]["entity_id"] for item in (cable["endpoint_a"], cable["endpoint_b"])} == {left_object, right_object}

    details = client.get(f"/v1/topology/physical-objects/{left_object}").json()
    attachment = details["connection_points"][0]["external_physical_attachments"][0]
    assert attachment["kind"] == "CABLE"
    assert attachment["cable_ref"] == created["cable_ref"]

    projection = client.post(
        "/v1/topology/projection",
        json={"layer": "L1", "detail_level": "PHYSICAL_OBJECT", "scope": {"include_location_subtrees": [], "include_entities": []}},
    ).json()
    assert all(node["id"] != f"l1-physical-object:{cable_id}" for node in projection["nodes"])
    assert any(
        pair.get("cable_ref", {}).get("entity_id") == cable_id
        for edge in projection["edges"]
        for pair in edge["attributes"]["endpoint_pairs"]
    )
