import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.test_object_blueprints_e2e import create_blueprint, instantiate, slot


client = TestClient(app)


def projection_query(object_ids: list[str] | None = None, include_interstitial_cables: bool = False) -> dict:
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
        **({"include_interstitial_cables": True} if include_interstitial_cables else {}),
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
    assert core_node["attributes"]["connection_points"] == [{
        "connection_point_id": next(iter(points_by_node[core_node["id"]])),
        "display_name": core_node["attributes"]["connection_points"][0]["display_name"],
        "cardinality": 1,
        "external_connection_count": 1,
    }]
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


def test_scoped_projection_includes_only_a_simple_cable_between_two_selected_endpoints():
    core, firewall, link = create_w3_link()
    unrelated_left, unrelated_right, unrelated_link = create_w3_link()
    core_id, firewall_id, cable_id = physical_object_id(core), physical_object_id(firewall), link["cable_ref"]["entity_id"]

    expanded = client.post(
        "/v1/topology/projection",
        json=projection_query([core_id, firewall_id], include_interstitial_cables=True),
    ).json()
    assert {physical_object_id_for_node(node) for node in expanded["nodes"]} == {core_id, firewall_id, cable_id}
    assert len(expanded["edges"]) == 2
    assert expanded["l1_off_map_continuations"] == []
    assert node_by_object(expanded, cable_id)["attributes"]["class"] == "cable"
    assert unrelated_link["cable_ref"]["entity_id"] not in str(expanded)
    assert physical_object_id(unrelated_left) not in str(expanded)
    assert physical_object_id(unrelated_right) not in str(expanded)

    saved_map = client.post("/v1/maps", json={"name": "Cable scope"}).json()
    saved_map_id = saved_map["map_ref"]["entity_id"]
    for object_id in (core_id, firewall_id):
        assert client.post(f"/v1/maps/{saved_map_id}/placements", json={"physical_object_id": object_id, "x": 1, "y": 2}).status_code == 201
    placement_ids = {node["physical_object_ref"]["entity_id"] for node in client.get(f"/v1/maps/{saved_map_id}").json()["placements"]}
    assert placement_ids == {core_id, firewall_id}
    assert cable_id not in placement_ids

    one_endpoint = client.post(
        "/v1/topology/projection",
        json=projection_query([core_id], include_interstitial_cables=True),
    ).json()
    assert [physical_object_id_for_node(node) for node in one_endpoint["nodes"]] == [core_id]
    assert one_endpoint["edges"] == []
    assert len(one_endpoint["l1_off_map_continuations"]) == 1
    continuation = one_endpoint["l1_off_map_continuations"][0]
    assert continuation["local_node_id"] == node_by_object(one_endpoint, core_id)["id"]
    assert continuation["local_physical_object_ref"]["entity_id"] == core_id
    assert continuation["cable_ref"]["entity_id"] == cable_id
    assert continuation["remote_physical_object_ref"]["entity_id"] == firewall_id
    assert continuation["local_connection_point_ref"]["entity_type"] == "ConnectionPoint"
    assert continuation["remote_connection_point_ref"]["entity_type"] == "ConnectionPoint"
    assert {ref["entity_type"] for ref in continuation["source_refs"]} == {
        "PhysicalObject", "ConnectionPoint", "Connection", "ConnectionMember"
    }
    assert cable_id not in {physical_object_id_for_node(node) for node in one_endpoint["nodes"]}
    assert firewall_id not in {physical_object_id_for_node(node) for node in one_endpoint["nodes"]}


def test_blueprint_instance_projection_keeps_exact_v1_presentation_after_v2():
    blueprint_id, version_id = create_blueprint([slot("Front01"), slot("Rear01")], [{"from_slot_key": "Front01", "to_slot_key": "Rear01"}], name="Panel", body={"kind": "RECTANGLE", "width": 480, "height": 70, "fill_color": "#123456"})
    instance = instantiate(blueprint_id, version_id, "PP1")
    exact_ref = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}").json()["composition"]["instances"][0]["port_block_version_ref"]
    assert client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={"body": {"kind": "RECTANGLE", "width": 10, "height": 10}, "composition": {"instances": [{"instance_key": "instance", "port_block_version_ref": exact_ref, "face": "FRONT"}]}, "internal_links": []}).status_code == 201
    node = node_by_object(client.post("/v1/topology/projection", json=projection_query()).json(), instance["physical_object_ref"]["entity_id"])
    presentation = node["attributes"]["blueprint_presentation"]
    assert presentation["version_ref"]["entity_id"] == version_id
    assert presentation["body"] == {"kind": "RECTANGLE", "width": 480.0, "height": 70.0, "fill_color": "#123456"}
    assert [(slot["anchor"]["side"], slot["anchor"]["offset"]) for slot in presentation["slots"]] == [("RIGHT", .25), ("RIGHT", .75)]
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
