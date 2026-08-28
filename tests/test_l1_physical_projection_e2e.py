import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.test_object_blueprints_e2e import create_blueprint, instantiate, slot


client = TestClient(app)


def projection_query(object_ids: list[str] | None = None, include_cable_continuations: bool = False) -> dict:
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
        **({"include_cable_continuations": True} if include_cable_continuations else {}),
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


def physical_object_id_for_node(node: dict) -> str:
    return next(ref["entity_id"] for ref in node["source_refs"] if ref["entity_type"] == "PhysicalObject")


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
        "connection_points": [],
        "owned_interface_count": 0,
        "internal_l1_links": [],
    }


def test_manual_same_object_members_are_node_internal_links_with_canonical_evidence():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        panel = repository.add_physical_object()
        remote = repository.add_physical_object()
        front = repository.add_connection_point(panel.id, 4)
        rear = repository.add_connection_point(panel.id, 4)
        remote_point = repository.add_connection_point(remote.id, 1)
        internal_connection, internal_members = repository.add_connection(
            front.id,
            rear.id,
            2,
            [
                ConnectionMemberInput(index=7, point_a_member=3, point_b_member=2),
                ConnectionMemberInput(index=9, point_a_member=4, point_b_member=1),
            ],
        )
        external_connection, external_members = repository.add_connection(
            front.id,
            remote_point.id,
            1,
            [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )

    body = client.post("/v1/topology/projection", json=projection_query()).json()
    panel_node = node_by_object(body, str(panel.id))
    links = panel_node["attributes"]["internal_l1_links"]
    expected_by_member_id = {
        str(internal_members[0].id): (str(front.id), 3, str(rear.id), 2),
        str(internal_members[1].id): (str(front.id), 4, str(rear.id), 1),
    }
    assert [(link["connection_id"], link["connection_member_id"]) for link in links] == sorted(
        (link["connection_id"], link["connection_member_id"]) for link in links
    )
    assert len(links) == 2
    for link in links:
        member_id = link["connection_member_id"]
        assert (
            link["from_connection_point_id"],
            link["from_member_index"],
            link["to_connection_point_id"],
            link["to_member_index"],
        ) == expected_by_member_id[member_id]
        assert link["connection_id"] == str(internal_connection.id)
        assert {(ref["entity_type"], ref["entity_id"]) for ref in link["source_refs"]} == {
            ("PhysicalObject", str(panel.id)),
            ("ConnectionPoint", str(front.id)),
            ("ConnectionPoint", str(rear.id)),
            ("Connection", str(internal_connection.id)),
            ("ConnectionMember", member_id),
        }
    assert all(edge["from_node_id"] != edge["to_node_id"] for edge in body["edges"])
    assert all(str(internal_connection.id) not in str(edge) for edge in body["edges"])
    assert any(str(external_connection.id) in str(edge) for edge in body["edges"])
    assert all(str(external_members[0].id) not in str(link) for link in links)

    scoped = client.post(
        "/v1/topology/projection", json=projection_query([str(panel.id)])
    ).json()
    assert scoped["edges"] == []
    assert node_by_object(scoped, str(panel.id))["attributes"]["internal_l1_links"] == links


def test_internal_links_keep_all_branched_members_and_respect_object_scope():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        panel = repository.add_physical_object()
        other = repository.add_physical_object()
        point_a = repository.add_connection_point(panel.id, 1)
        point_b = repository.add_connection_point(panel.id, 1)
        point_c = repository.add_connection_point(panel.id, 1)
        other_a = repository.add_connection_point(other.id, 1)
        other_b = repository.add_connection_point(other.id, 1)
        first, first_members = repository.add_connection(point_a.id, point_b.id, 1, [ConnectionMemberInput(1, 1, 1)])
        second, second_members = repository.add_connection(point_a.id, point_c.id, 1, [ConnectionMemberInput(1, 1, 1)])
        foreign, _ = repository.add_connection(other_a.id, other_b.id, 1, [ConnectionMemberInput(1, 1, 1)])

    scoped = client.post(
        "/v1/topology/projection", json=projection_query([str(panel.id)])
    ).json()
    links = node_by_object(scoped, str(panel.id))["attributes"]["internal_l1_links"]
    assert {(link["connection_id"], link["connection_member_id"]) for link in links} == {
        (str(first.id), str(first_members[0].id)),
        (str(second.id), str(second_members[0].id)),
    }
    assert [(link["connection_id"], link["connection_member_id"]) for link in links] == sorted(
        (link["connection_id"], link["connection_member_id"]) for link in links
    )
    assert str(foreign.id) not in str(scoped)


def test_blueprint_instance_projection_keeps_exact_v1_presentation_after_v2():
    blueprint_id, version_id = create_blueprint([slot("Front01"), slot("Rear01")], [{"from_slot_key": "Front01", "to_slot_key": "Rear01"}], name="Panel", body={"kind": "RECTANGLE", "width": 480, "height": 70, "fill_color": "#123456"})
    instance = instantiate(blueprint_id, version_id, "PP1")
    exact_ref = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}").json()["composition"]["instances"][0]["port_block_version_ref"]
    assert client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={"body": {"kind": "RECTANGLE", "width": 10, "height": 10}, "composition": {"instances": [{"instance_key": "instance", "port_block_version_ref": exact_ref, "face": "FRONT", "placement": {"x": .1, "y": .1, "width": .3, "height": .2}}]}, "internal_links": []}).status_code == 201
    node = node_by_object(client.post("/v1/topology/projection", json=projection_query()).json(), instance["physical_object_ref"]["entity_id"])
    presentation = node["attributes"]["blueprint_presentation"]
    assert presentation["version_ref"]["entity_id"] == version_id
    assert presentation["body"] == {"kind": "RECTANGLE", "width": 480.0, "height": 70.0, "fill_color": "#123456"}
    assert all("anchor" not in slot for slot in presentation["slots"])
    assert all(0 <= slot["rendered_position"][axis] <= 1 for slot in presentation["slots"] for axis in ("x", "y"))
    assert all(slot["external_attachment"]["side"] in {"LEFT", "RIGHT", "TOP", "BOTTOM"} for slot in presentation["slots"])
    assert {slot["connection_point_id"] for slot in presentation["slots"]} == {slot["connection_point_ref"]["entity_id"] for slot in instance["slots"]}
    assert all(ref["ref_type"] == "CANONICAL_FACT" for ref in node["source_refs"])
    internal = node["attributes"]["internal_l1_links"]
    assert len(internal) == 1
    assert {internal[0]["from_connection_point_id"], internal[0]["to_connection_point_id"]} == {
        slot["connection_point_ref"]["entity_id"] for slot in instance["slots"]
    }
    assert {ref["entity_type"] for ref in internal[0]["source_refs"]} == {
        "PhysicalObject", "ConnectionPoint", "Connection", "ConnectionMember"
    }


def test_switch_blueprint_exposes_network_port_mapping_without_self_edge():
    blueprint_id, version_id = create_blueprint([slot("eth01", "NETWORK_PORT"), slot("eth02", "NETWORK_PORT")], name="Switch", body={"kind": "RECTANGLE", "width": 400, "height": 100})
    instance = instantiate(blueprint_id, version_id, "SW1")
    document = client.post("/v1/topology/projection", json=projection_query()).json()
    node = node_by_object(document, instance["physical_object_ref"]["entity_id"])
    mapped = node["attributes"]["blueprint_presentation"]["slots"]
    assert all(slot["network_interface_id"] is not None for slot in mapped)
    assert not any(instance["physical_object_ref"]["entity_id"] in edge_object_pair(edge) and edge["from_node_id"] == edge["to_node_id"] for edge in document["edges"])

def test_cable_backed_direct_connection_projects_between_physical_objects():
    core, firewall = create_device("CORE"), create_device("FW")
    created = client.post("/v1/topology/physical-links", json={"source_interface_id": core["interfaces"][0]["interface_ref"]["entity_id"], "target_interface_id": firewall["interfaces"][0]["interface_ref"]["entity_id"]})
    assert created.status_code == 201
    cable_id = created.json()["cable_ref"]["entity_id"]
    projected = client.post("/v1/topology/projection", json=projection_query()).json()
    assert len(projected["nodes"]) == 2
    pair = projected["edges"][0]["attributes"]["endpoint_pairs"][0]
    assert pair["cable_ref"] == {"ref_type": "CANONICAL_FACT", "entity_type": "Cable", "entity_id": cable_id}