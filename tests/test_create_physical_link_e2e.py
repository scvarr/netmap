from fastapi.testclient import TestClient

from app.main import app
from tests.l1_builders import create_device, interface_id


client = TestClient(app)


def test_create_physical_link_materializes_a_canonical_cable_and_reachable_l1_path():
    source, target = create_device(client, "CORE"), create_device(client, "FW")

    response = client.post(
        "/v1/topology/physical-links",
        json={"source_interface_id": interface_id(source), "target_interface_id": interface_id(target)},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["cable_ref"]["entity_type"] == "Cable"
    assert body["connection_ref"]["entity_type"] == "Connection"
    trace = client.post(
        "/v1/traces/interfaces/physical",
        json={"from_interface_id": interface_id(source), "to_interface_id": interface_id(target)},
    )
    assert trace.json()["verdict"] == "REACHABLE"
