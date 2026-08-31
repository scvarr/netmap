from fastapi.testclient import TestClient
from app.main import app
from app.cable_labels import sequence_value
from tests.l1_builders import create_object_with_point

client = TestClient(app)

def cable_pair(name: str, **naming):
    left_object, left = create_object_with_point(client, f"{name}-left")
    _, right = create_object_with_point(client, f"{name}-right")
    response = client.post("/v1/topology/physical-connections", json={"source": {"kind": "CONNECTION_POINT", "connection_point_id": left, "member_index": 1}, "target": {"kind": "CONNECTION_POINT", "connection_point_id": right, "member_index": 1}, **naming})
    return response, left_object

def catalog_cable(cable_id: str):
    return next(item for item in client.get("/v1/catalog/inventory").json()["cables"] if item["cable_ref"]["entity_id"] == cable_id)

def create_template(pattern="FC####", start_at=1):
    response = client.post("/v1/cable-label-templates", json={"name": "FC", "description": "fiber", "pattern": pattern, "start_at": start_at})
    assert response.status_code == 201
    return response.json()["id"]

def test_manual_label_uniqueness_policy_and_nulls():
    assert client.put("/v1/cable-label-settings", json={"unique_labels": False}).status_code == 200
    first, _ = cable_pair("manual-1", cable_label="same")
    second, _ = cable_pair("manual-2", cable_label="same")
    assert first.status_code == second.status_code == 201
    assert client.put("/v1/cable-label-settings", json={"unique_labels": True}).status_code == 422
    assert client.put(f"/v1/cables/{second.json()['cable_ref']['entity_id']}/label", json={"label": "other"}).status_code == 204
    assert client.put("/v1/cable-label-settings", json={"unique_labels": True}).status_code == 200
    assert cable_pair("manual-3", cable_label="same")[0].status_code == 422
    assert cable_pair("null-1")[0].status_code == cable_pair("null-2")[0].status_code == 201

def test_generated_create_sequence_and_gap_reuse():
    template_id = create_template()
    first, _ = cable_pair("generated-1", cable_label_template_id=template_id, generate_cable_label=True)
    second, _ = cable_pair("generated-2", cable_label_template_id=template_id, generate_cable_label=True)
    assert first.status_code == second.status_code == 201
    assert catalog_cable(first.json()["cable_ref"]["entity_id"])["label"] == "FC0001"
    assert catalog_cable(second.json()["cable_ref"]["entity_id"])["label"] == "FC0002"
    assert client.delete(f"/v1/cables/{first.json()['cable_ref']['entity_id']}").status_code == 204
    reused, _ = cable_pair("generated-3", cable_label_template_id=template_id, generate_cable_label=True)
    assert catalog_cable(reused.json()["cable_ref"]["entity_id"])["label"] == "FC0001"

def test_generated_assignment_to_existing_cable_reuses_gaps_without_changing_topology():
    template_id = create_template("#####", 1)
    first, _ = cable_pair("existing-generated-first")
    second, _ = cable_pair("existing-generated-second")
    first_id = first.json()["cable_ref"]["entity_id"]
    second_id = second.json()["cable_ref"]["entity_id"]
    first_before = catalog_cable(first_id)
    connection_id = first.json()["connection_ref"]["entity_id"]

    assert client.post(f"/v1/cables/{first_id}/generated-label", json={"template_id": template_id}).status_code == 204
    assert catalog_cable(first_id)["label"] == "00001"
    # The cable's own current value is not a conflict when generating again.
    assert client.post(f"/v1/cables/{first_id}/generated-label", json={"template_id": template_id}).status_code == 204
    assert catalog_cable(first_id)["label"] == "00001"
    assert client.post(f"/v1/cables/{second_id}/generated-label", json={"template_id": template_id}).status_code == 204
    assert catalog_cable(second_id)["label"] == "00002"

    assert client.put(f"/v1/cables/{first_id}/label", json={"label": None}).status_code == 204
    assert client.post(f"/v1/cables/{second_id}/generated-label", json={"template_id": template_id}).status_code == 204
    assert catalog_cable(second_id)["label"] == "00001"
    first_after = catalog_cable(first_id)
    assert first_after["cable_ref"] == first_before["cable_ref"]
    assert first_after["connection_ref"] == first_before["connection_ref"] == {"ref_type": "CANONICAL_FACT", "entity_type": "Connection", "entity_id": connection_id}
    assert first_after["endpoint_a"] == first_before["endpoint_a"]
    assert first_after["endpoint_b"] == first_before["endpoint_b"]

def test_generated_assignment_requires_an_existing_template():
    cable, _ = cable_pair("existing-generated-missing-template")
    assert client.post(f"/v1/cables/{cable.json()['cable_ref']['entity_id']}/generated-label", json={"template_id": "00000000-0000-4000-8000-000000000000"}).status_code == 422

def test_manual_unlabelled_create_generation_errors_and_templates():
    template_id = create_template("FC####")
    manual, _ = cable_pair("manual-pattern", cable_label="not-a-template-value", cable_label_template_id=template_id, generate_cable_label=False)
    assert manual.status_code == 201 and catalog_cable(manual.json()["cable_ref"]["entity_id"])["label"] == "not-a-template-value"
    empty, _ = cable_pair("no-label")
    item = catalog_cable(empty.json()["cable_ref"]["entity_id"])
    assert item["label_source"] == "TECHNICAL_FALLBACK" and item["label"] == f"Cable {empty.json()['cable_ref']['entity_id'][:8]}"
    assert cable_pair("missing-template", generate_cable_label=True)[0].status_code == 422
    updated = client.put(f"/v1/cable-label-templates/{template_id}", json={"name": "updated", "description": "updated description", "pattern": "@@", "start_at": 3})
    assert updated.status_code == 200 and updated.json()["name"] == "updated" and updated.json()["pattern"] == "@@"
    assert client.post("/v1/cable-label-templates", json={"name": "bad", "pattern": "literal", "start_at": 0}).status_code == 422
    assert client.delete(f"/v1/cable-label-templates/{template_id}").status_code == 204
    assert template_id not in {item["id"] for item in client.get("/v1/cable-label-templates").json()["templates"]}

def test_exhaustion_and_display_consistency():
    template_id = create_template("#", 0)
    for ordinal in range(10):
        assert cable_pair(f"small-{ordinal}", cable_label_template_id=template_id, generate_cable_label=True)[0].status_code == 201
    assert cable_pair("small-overflow", cable_label_template_id=template_id, generate_cable_label=True)[0].status_code == 422
    response, left = cable_pair("display", cable_label="DISPLAY-01")
    cable_id = response.json()["cable_ref"]["entity_id"]
    assert catalog_cable(cable_id)["label"] == "DISPLAY-01" and catalog_cable(cable_id).get("label_source") is None
    query = {"layer": "L1", "detail_level": "PHYSICAL_OBJECT", "scope": {"include_location_subtrees": [], "include_entities": []}}
    projected = client.post("/v1/topology/projection", json=query).json()
    assert next(pair for edge in projected["edges"] for pair in edge["attributes"]["endpoint_pairs"] if pair.get("cable_ref", {}).get("entity_id") == cable_id)["cable_display_name"] == "DISPLAY-01"
    continuation_query = {**query, "scope": {"include_location_subtrees": [], "include_entities": [{"ref_type": "CANONICAL_FACT", "entity_type": "PhysicalObject", "entity_id": left}]}, "include_cable_continuations": True}
    assert next(item for item in client.post("/v1/topology/projection", json=continuation_query).json()["l1_off_map_continuations"] if item["cable_ref"]["entity_id"] == cable_id)["cable_display_name"] == "DISPLAY-01"

def test_sequence_value_contract():
    assert [sequence_value("@@##", value) for value in (0, 1, 99, 100)] == ["AA00", "AA01", "AA99", "AB00"]
    assert sequence_value("@", 26) is None
