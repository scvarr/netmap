import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.repository import CanonicalRepository, ConnectionMemberInput


client = TestClient(app)


def projection_query(object_ids: list[str] | None = None) -> dict:
    return {
        "layer": "L1",
        "detail_level": "PHYSICAL_OBJECT",
        "scope": {
            "include_location_subtrees": [],
            "include_entities": [
                {
                    "ref_type": "CANONICAL_FACT",
                    "entity_type": "PhysicalObject",
                    "entity_id": object_id,
                }
                for object_id in (object_ids or [])
            ],
        },
    }


def create_device(name: str) -> dict:
    response = client.post(
        "/v1/topology/devices",
        json={
            "display_name": name,
            "initial_interface": {"display_name": "eth0"},
        },
    )
    assert response.status_code == 201
    return response.json()


def physical_object_id(document: dict) -> str:
    return document["device"]["source_ref"]["entity_id"]


def interface_id(document: dict) -> str:
    return document["interfaces"][0]["interface_ref"]["entity_id"]


def create_w3_link() -> tuple[dict, dict, dict]:
    core = create_device("CORE")
    firewall = create_device("FW")
    response = client.post(
        "/v1/topology/physical-links",
        json={
            "source_interface_id": interface_id(core),
            "target_interface_id": interface_id(firewall),
            "cable_display_name": "CORE-FW-01",
        },
    )
    assert response.status_code == 201
    return core, firewall, response.json()


def node_by_object(document: dict, object_id: str) -> dict:
    return next(
        node
        for node in document["nodes"]
        if any(
            ref["entity_type"] == "PhysicalObject" and ref["entity_id"] == object_id
            for ref in node["source_refs"]
        )
    )


def edge_object_pair(edge: dict) -> frozenset[str]:
    return frozenset(
        ref["entity_id"]
        for ref in edge["source_refs"]
        if ref["entity_type"] == "PhysicalObject"
    )


def test_w3_link_projects_core_cable_firewall_with_canonical_evidence():
    core, firewall, link = create_w3_link()
    cable_id = link["cable_ref"]["entity_id"]

    response = client.post("/v1/topology/projection", json=projection_query())
    body = response.json()

    assert response.status_code == 200
    assert body["layer"] == "L1"
    assert body["detail_level"] == "PHYSICAL_OBJECT"
    assert len(body["nodes"]) == 3
    assert {node["kind"] for node in body["nodes"]} == {"PHYSICAL_OBJECT"}
    assert {node["label"] for node in body["nodes"]} == {"CORE", "CORE-FW-01", "FW"}
    assert len(body["edges"]) == 2
    expected_pairs = {
        frozenset((physical_object_id(core), cable_id)),
        frozenset((cable_id, physical_object_id(firewall))),
    }
    assert {edge_object_pair(edge) for edge in body["edges"]} == expected_pairs
    assert all(edge["from_node_id"] != edge["to_node_id"] for edge in body["edges"])
    assert all(edge["kind"] == "L1_PHYSICAL_LINK" for edge in body["edges"])
    assert all(edge["aggregate"] is True for edge in body["edges"])
    assert all(edge["attributes"]["supporting_connection_count"] == 1 for edge in body["edges"])
    assert all(edge["attributes"]["supporting_member_pair_count"] == 1 for edge in body["edges"])
    points_by_node = {node["id"]: {ref["entity_id"] for ref in node["source_refs"] if ref["entity_type"] == "ConnectionPoint"} for node in body["nodes"]}
    for edge in body["edges"]:
        assert {ref["entity_type"] for ref in edge["source_refs"]} == {
            "PhysicalObject",
            "ConnectionPoint",
            "Connection",
            "ConnectionMember",
        }
        assert len(edge["attributes"]["endpoint_pairs"]) == 1
        endpoint = edge["attributes"]["endpoint_pairs"][0]
        assert endpoint["from_connection_point_id"] in points_by_node[edge["from_node_id"]]
        assert endpoint["to_connection_point_id"] in points_by_node[edge["to_node_id"]]

    core_node = node_by_object(body, physical_object_id(core))
    cable_node = node_by_object(body, cable_id)
    assert core_node["attributes"]["connection_point_count"] == 1
    assert core_node["attributes"]["owned_interface_count"] == 1
    assert cable_node["attributes"]["connection_point_count"] == 2
    assert cable_node["attributes"]["owned_interface_count"] == 0


def test_passive_and_fallback_physical_objects_are_valid_isolated_nodes():
    with SessionLocal.begin() as session:
        passive = CanonicalRepository(session).add_physical_object()

    body = client.post("/v1/topology/projection", json=projection_query()).json()
    node = node_by_object(body, str(passive.id))

    assert len(body["nodes"]) == 1
    assert body["edges"] == []
    assert node["label"] == f"PhysicalObject {str(passive.id)[:8]}"
    assert node["attributes"] == {
        "label_source": "TECHNICAL_FALLBACK",
        "connection_point_count": 0,
        "owned_interface_count": 0,
    }


def test_parallel_connections_aggregate_counts_and_scope_is_induced():
    core, firewall, link = create_w3_link()
    core_id = uuid.UUID(physical_object_id(core))
    cable_id = uuid.UUID(link["cable_ref"]["entity_id"])
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        core_point = repository.add_connection_point(core_id, 1)
        cable_point = repository.add_connection_point(cable_id, 1)
        repository.add_connection(
            core_point.id,
            cable_point.id,
            1,
            [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )

    unbounded = client.post("/v1/topology/projection", json=projection_query()).json()
    core_cable = next(
        edge
        for edge in unbounded["edges"]
        if edge_object_pair(edge) == frozenset((str(core_id), str(cable_id)))
    )
    assert core_cable["attributes"]["supporting_connection_count"] == 2
    assert core_cable["attributes"]["supporting_member_pair_count"] == 2
    assert len(core_cable["attributes"]["endpoint_pairs"]) == 2
    assert core_cable["attributes"]["endpoint_pairs"] == sorted(core_cable["attributes"]["endpoint_pairs"], key=lambda pair: (pair["connection_id"], pair["connection_member_id"]))

    scoped = client.post(
        "/v1/topology/projection",
        json=projection_query([str(core_id), str(cable_id)]),
    ).json()
    assert len(scoped["nodes"]) == 2
    assert len(scoped["edges"]) == 1
    assert edge_object_pair(scoped["edges"][0]) == frozenset((str(core_id), str(cable_id)))
    assert physical_object_id(firewall) not in str(scoped)


def test_blueprint_instance_projection_keeps_exact_v1_presentation_after_v2():
    slots = [
        {"key": "front01", "display_name": "Front01", "kind": "CONNECTION_POINT", "anchor": {"side": "LEFT", "offset": .25}},
        {"key": "rear01", "display_name": "Rear01", "kind": "CONNECTION_POINT", "anchor": {"side": "RIGHT", "offset": .75}},
    ]
    created = client.post("/v1/library/object-blueprints", json={"name": "Panel", "body": {"kind": "RECTANGLE", "width": 480, "height": 70, "fill_color": "#123456"}, "slots": slots, "internal_links": [{"from_slot_key": "front01", "to_slot_key": "rear01"}]}).json()
    instance = client.post(f"/v1/library/object-blueprints/{created['blueprint_ref']['entity_id']}/versions/{created['version_ref']['entity_id']}/instantiate", json={"display_name": "PP1"}).json()
    assert client.post(f"/v1/library/object-blueprints/{created['blueprint_ref']['entity_id']}/versions", json={"body": {"kind": "RECTANGLE", "width": 10, "height": 10}, "slots": slots, "internal_links": [{"from_slot_key": "front01", "to_slot_key": "rear01"}]}).status_code == 201
    node = node_by_object(client.post("/v1/topology/projection", json=projection_query()).json(), instance["physical_object_ref"]["entity_id"])
    presentation = node["attributes"]["blueprint_presentation"]
    assert presentation["version_ref"]["entity_id"] == created["version_ref"]["entity_id"]
    assert presentation["body"] == {"kind": "RECTANGLE", "width": 480.0, "height": 70.0, "fill_color": "#123456"}
    assert [(slot["slot_key"], slot["anchor"]["side"], slot["anchor"]["offset"]) for slot in presentation["slots"]] == [("front01", "LEFT", .25), ("rear01", "RIGHT", .75)]
    assert {slot["connection_point_id"] for slot in presentation["slots"]} == {slot["connection_point_ref"]["entity_id"] for slot in instance["slots"]}
    assert all(ref["ref_type"] == "CANONICAL_FACT" for ref in node["source_refs"])


def test_switch_blueprint_exposes_network_port_mapping_without_self_edge():
    slots = [
        {"key": "eth01", "display_name": "eth01", "kind": "NETWORK_PORT", "anchor": {"side": "BOTTOM", "offset": .25}},
        {"key": "eth02", "display_name": "eth02", "kind": "NETWORK_PORT", "anchor": {"side": "BOTTOM", "offset": .75}},
    ]
    created = client.post("/v1/library/object-blueprints", json={"name": "Switch", "body": {"kind": "RECTANGLE", "width": 400, "height": 100}, "slots": slots, "internal_links": []}).json()
    instance = client.post(f"/v1/library/object-blueprints/{created['blueprint_ref']['entity_id']}/versions/{created['version_ref']['entity_id']}/instantiate", json={"display_name": "SW1"}).json()
    document = client.post("/v1/topology/projection", json=projection_query()).json()
    node = node_by_object(document, instance["physical_object_ref"]["entity_id"])
    mapped = node["attributes"]["blueprint_presentation"]["slots"]
    assert all(slot["network_interface_id"] is not None for slot in mapped)
    assert not any(instance["physical_object_ref"]["entity_id"] in edge_object_pair(edge) and edge["from_node_id"] == edge["to_node_id"] for edge in document["edges"])
