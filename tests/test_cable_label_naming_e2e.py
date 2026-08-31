from tests.l1_builders import create_object_with_point, create_endpoint_cable
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_cable_labels_templates_generation_and_display():
    _, left = create_object_with_point(client, "left")
    _, right = create_object_with_point(client, "right")
    first = create_endpoint_cable(client, left, right)["cable_ref"]["entity_id"]
    assert client.put(f"/v1/cables/{first}/label", json={"label": "  FC0001  "}).status_code == 204
    catalog = client.get("/v1/catalog/inventory").json()
    assert next(item for item in catalog["cables"] if item["cable_ref"]["entity_id"] == first)["label"] == "FC0001"
    template = client.post("/v1/cable-label-templates", json={"name": "FC", "description": "fiber", "pattern": "FC####", "start_at": 1})
    assert template.status_code == 201
    assert client.post("/v1/cable-label-templates", json={"name": "bad", "pattern": "literal", "start_at": 0}).status_code == 422
    assert client.put("/v1/cable-label-settings", json={"unique_labels": True}).status_code == 200
    assert client.put(f"/v1/cables/{first}/label", json={"label": "   "}).status_code == 422
    assert client.put(f"/v1/cables/{first}/label", json={"label": None}).status_code == 204
    fallback = next(item for item in client.get("/v1/catalog/inventory").json()["cables"] if item["cable_ref"]["entity_id"] == first)
    assert fallback["label_source"] == "TECHNICAL_FALLBACK"


def test_sequence_value_contract():
    from app.cable_labels import sequence_value
    assert [sequence_value("@@##", value) for value in (0, 1, 99, 100)] == ["AA00", "AA01", "AA99", "AB00"]
    assert sequence_value("@", 26) is None
