from fastapi.testclient import TestClient


def create_device(client: TestClient, name: str) -> dict:
    response = client.post(
        "/v1/topology/devices",
        json={"display_name": name, "initial_interface": {"display_name": "eth0"}},
    )
    assert response.status_code == 201, response.text
    return response.json()


def interface_id(device: dict) -> str:
    return device["interfaces"][0]["interface_ref"]["entity_id"]


def create_object_with_point(client: TestClient, name: str) -> tuple[str, str]:
    response = client.post(
        "/v1/topology/physical-objects",
        json={"display_name": name, "initial_connection_point": {"display_name": "p1"}},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return (
        body["physical_object"]["source_ref"]["entity_id"],
        body["connection_points"][0]["connection_point_ref"]["entity_id"],
    )


def point_endpoint(point_id: str) -> dict[str, str | int]:
    return {"kind": "CONNECTION_POINT", "connection_point_id": point_id, "member_index": 1}


def interface_endpoint(interface_id: str) -> dict[str, str]:
    return {"kind": "NETWORK_INTERFACE", "network_interface_id": interface_id}


def create_endpoint_cable(client: TestClient, source_point_id: str, target_point_id: str) -> dict:
    response = client.post(
        "/v1/topology/physical-connections",
        json={"source": point_endpoint(source_point_id), "target": point_endpoint(target_point_id)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_interface_cable(client: TestClient, source_name: str = "A", target_name: str = "B") -> dict:
    source = create_device(client, source_name)
    target = create_device(client, target_name)
    response = client.post(
        "/v1/topology/physical-links",
        json={"source_interface_id": interface_id(source), "target_interface_id": interface_id(target)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_map(client: TestClient, name: str) -> str:
    response = client.post("/v1/maps", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["map_ref"]["entity_id"]


def put_cable_route(client: TestClient, map_id: str, cable_id: str, waypoints: list[dict]) -> dict:
    response = client.put(
        f"/v1/maps/{map_id}/cable-routes/{cable_id}",
        json={"view": "physical", "waypoints": waypoints},
    )
    assert response.status_code == 200, response.text
    return response.json()
