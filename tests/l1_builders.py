from fastapi.testclient import TestClient
from tests.cable_type_fixtures import copper_cable_fields
from app.database import SessionLocal
from app.device_catalog import DeviceCatalog


def create_device(client: TestClient, name: str, interface_name: str = "eth0") -> dict:
    with SessionLocal.begin() as session:
        created = DeviceCatalog(session).create_network_device(name, interface_name)
        object_id = created.physical_object_id
    return client.get(f"/v1/topology/devices/{object_id}").json()


def interface_id(device: dict) -> str:
    return device["interfaces"][0]["interface_ref"]["entity_id"]


def create_object_with_point(client: TestClient, name: str) -> tuple[str, str]:
    document = create_object_details(client, name)
    return document["physical_object"]["source_ref"]["entity_id"], document["connection_points"][0]["connection_point_ref"]["entity_id"]


def point_endpoint(point_id: str) -> dict[str, str | int]:
    return {"kind": "CONNECTION_POINT", "connection_point_id": point_id, "member_index": 1}


def interface_endpoint(interface_id: str) -> dict[str, str]:
    return {"kind": "NETWORK_INTERFACE", "network_interface_id": interface_id}


def confirmed_payload(result: dict, payload: dict) -> dict:
    return {**payload, "compatibility": {"token": result["token"], "accept_unknown": result["verdict"] == "UNKNOWN"}}


def post_confirmed_physical(client, url, *, json):
    preview_url = f"{url}/compatibility-preview" if url.endswith("/reconnect") else f"{url}?preview=true"
    preview = client.post(preview_url, json=json)
    if preview.status_code == 200 and preview.json()["token"] is not None:
        json = confirmed_payload(preview.json(), json)
    return client.post(url, json=json)


def create_endpoint_cable(client: TestClient, source_point_id: str, target_point_id: str) -> dict:
    response = post_confirmed_physical(client,
        "/v1/topology/physical-connections",
        json={**copper_cable_fields(), "source": point_endpoint(source_point_id), "target": point_endpoint(target_point_id)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_interface_cable(client: TestClient, source_name: str = "A", target_name: str = "B") -> dict:
    source = create_device(client, source_name)
    target = create_device(client, target_name)
    response = post_confirmed_physical(client,
        "/v1/topology/physical-links",
        json={**copper_cable_fields(), "source_interface_id": interface_id(source), "target_interface_id": interface_id(target)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_map(client: TestClient, name: str) -> str:
    response = client.post("/v1/maps", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["map_ref"]["entity_id"]


def create_object_details(client, name, point_name="p1", class_=None):
    # Low-level canonical fixtures remain allowed; product creation is tested separately.
    with SessionLocal.begin() as session:
        created = DeviceCatalog(session).create_physical_object(name, point_name, class_)
        object_id = created.physical_object_id
    return client.get(f"/v1/topology/physical-objects/{object_id}").json()
