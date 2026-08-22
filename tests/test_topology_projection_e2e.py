import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.repository import CanonicalRepository, ConnectionMemberInput


client = TestClient(app)


def projection_query(
    object_ids: list[uuid.UUID] | None = None,
    **overrides,
) -> dict:
    query = {
        "layer": "L2",
        "detail_level": "DEVICE",
        "scope": {
            "include_location_subtrees": [],
            "include_entities": [
                {
                    "ref_type": "CANONICAL_FACT",
                    "entity_type": "PhysicalObject",
                    "entity_id": str(object_id),
                }
                for object_id in (object_ids or [])
            ],
        },
    }
    query.update(overrides)
    return query


def add_owned_endpoint(
    repository: CanonicalRepository,
    device_id: uuid.UUID,
    *,
    point_object_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    interface = repository.add_network_interface()
    repository.add_network_interface_physical_owner(interface.id, device_id)
    point = repository.add_connection_point(point_object_id or device_id, 1)
    repository.add_interface_physical_binding(interface.id, point.id, 1)
    return interface.id, point.id


def connect_points(
    repository: CanonicalRepository, point_a_id: uuid.UUID, point_b_id: uuid.UUID
) -> None:
    repository.add_connection(
        point_a_id,
        point_b_id,
        1,
        [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
    )


def add_device_link(
    repository: CanonicalRepository,
    device_a_id: uuid.UUID,
    device_b_id: uuid.UUID,
    *,
    passive: bool = False,
) -> None:
    _, point_a_id = add_owned_endpoint(repository, device_a_id)
    _, point_b_id = add_owned_endpoint(repository, device_b_id)
    if not passive:
        connect_points(repository, point_a_id, point_b_id)
        return
    passive_object = repository.add_physical_object()
    passive_a = repository.add_connection_point(passive_object.id, 1)
    passive_b = repository.add_connection_point(passive_object.id, 1)
    connect_points(repository, point_a_id, passive_a.id)
    connect_points(repository, passive_a.id, passive_b.id)
    connect_points(repository, passive_b.id, point_b_id)


def test_empty_database_returns_empty_public_projection():
    response = client.post("/v1/topology/projection", json=projection_query())

    assert response.status_code == 200
    assert response.json() == {
        "schema_version": "1.0",
        "layer": "L2",
        "detail_level": "DEVICE",
        "nodes": [],
        "edges": [],
        "gaps": [],
        "warnings": [],
    }


def test_reference_seven_device_shape_and_passive_path_collapse():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        devices = [repository.add_physical_object() for _ in range(7)]
        for index, (left, right) in enumerate(
            [(0, 2), (1, 2), (2, 3), (3, 4), (3, 5), (4, 6)]
        ):
            add_device_link(
                repository,
                devices[left].id,
                devices[right].id,
                passive=index == 2,
            )

    response = client.post("/v1/topology/projection", json=projection_query())
    body = response.json()

    assert response.status_code == 200
    assert len(body["nodes"]) == 7
    assert len(body["edges"]) == 6
    assert all(node["kind"] == "NETWORK_DEVICE" for node in body["nodes"])
    assert all(edge["kind"] == "L2_DEVICE_LINK" for edge in body["edges"])
    assert all(edge["aggregate"] is True for edge in body["edges"])
    collapsed = [
        edge
        for edge in body["edges"]
        if sum(
            ref["entity_type"] == "ConnectionMember"
            for ref in edge["source_refs"]
        )
        == 3
    ]
    assert len(collapsed) == 1
    assert any(
        ref["entity_type"] == "PhysicalObject"
        and ref["entity_id"] not in {str(item.id) for item in devices}
        for ref in collapsed[0]["source_refs"]
    )


def test_sfp_connection_point_owner_is_not_inferred_as_interface_owner():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        switch = repository.add_physical_object()
        sfp = repository.add_physical_object()
        remote = repository.add_physical_object()
        _, switch_point = add_owned_endpoint(
            repository, switch.id, point_object_id=sfp.id
        )
        _, remote_point = add_owned_endpoint(repository, remote.id)
        connect_points(repository, switch_point, remote_point)

    response = client.post("/v1/topology/projection", json=projection_query())
    body = response.json()
    node_object_ids = {
        ref["entity_id"]
        for node in body["nodes"]
        for ref in node["source_refs"]
        if ref["entity_type"] == "PhysicalObject"
    }

    assert response.status_code == 200
    assert node_object_ids == {str(switch.id), str(remote.id)}
    assert str(sfp.id) not in node_object_ids
    assert any(
        ref["entity_type"] == "PhysicalObject"
        and ref["entity_id"] == str(sfp.id)
        for ref in body["edges"][0]["source_refs"]
    )


def test_parallel_paths_aggregate_into_one_device_edge():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = repository.add_physical_object()
        second = repository.add_physical_object()
        add_device_link(repository, first.id, second.id)
        add_device_link(repository, first.id, second.id)

    body = client.post("/v1/topology/projection", json=projection_query()).json()

    assert len(body["nodes"]) == 2
    assert len(body["edges"]) == 1
    assert body["edges"][0]["aggregate"] is True
    assert body["edges"][0]["attributes"]["supporting_path_count"] == 2
    assert body["edges"][0]["attributes"]["supporting_interface_pair_count"] == 2


def test_unknown_remote_interface_owner_stops_branch_with_gap():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        known_device = repository.add_physical_object()
        unknown_point_object = repository.add_physical_object()
        _, known_point = add_owned_endpoint(repository, known_device.id)
        unknown_interface = repository.add_network_interface()
        unknown_point = repository.add_connection_point(unknown_point_object.id, 1)
        repository.add_interface_physical_binding(
            unknown_interface.id, unknown_point.id, 1
        )
        connect_points(repository, known_point, unknown_point.id)

    body = client.post("/v1/topology/projection", json=projection_query()).json()

    assert len(body["nodes"]) == 1
    assert body["edges"] == []
    assert body["gaps"] == ["NETWORK_INTERFACE_OWNER_UNKNOWN"]


def test_unknown_active_endpoint_is_not_traversed_to_a_device_beyond_it():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = repository.add_physical_object()
        hidden_active_object = repository.add_physical_object()
        beyond = repository.add_physical_object()
        _, first_point = add_owned_endpoint(repository, first.id)
        hidden_interface = repository.add_network_interface()
        hidden_point = repository.add_connection_point(hidden_active_object.id, 1)
        repository.add_interface_physical_binding(
            hidden_interface.id, hidden_point.id, 1
        )
        _, beyond_point = add_owned_endpoint(repository, beyond.id)
        connect_points(repository, first_point, hidden_point.id)
        connect_points(repository, hidden_point.id, beyond_point)

    body = client.post("/v1/topology/projection", json=projection_query()).json()

    assert len(body["nodes"]) == 2
    assert body["edges"] == []
    assert body["gaps"] == ["NETWORK_INTERFACE_OWNER_UNKNOWN"]


def test_realization_down_is_used_and_referenced_only_on_supporting_path():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = repository.add_physical_object()
        second = repository.add_physical_object()
        upper = repository.add_network_interface()
        lower = repository.add_network_interface()
        repository.add_network_interface_physical_owner(upper.id, first.id)
        realization = repository.add_network_interface_realization(upper.id, lower.id)
        first_point = repository.add_connection_point(first.id, 1)
        repository.add_interface_physical_binding(lower.id, first_point.id, 1)
        _, second_point = add_owned_endpoint(repository, second.id)
        connect_points(repository, first_point.id, second_point)

    body = client.post("/v1/topology/projection", json=projection_query()).json()
    realization_refs = [
        ref
        for ref in body["edges"][0]["source_refs"]
        if ref["entity_type"] == "NetworkInterfaceRealization"
    ]

    assert len(body["edges"]) == 1
    assert realization_refs == [{
        "ref_type": "CANONICAL_FACT",
        "entity_type": "NetworkInterfaceRealization",
        "entity_id": str(realization.id),
    }]


def test_scope_is_induced_device_graph_and_scope_order_is_deterministic():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = repository.add_physical_object()
        second = repository.add_physical_object()
        third = repository.add_physical_object()
        add_device_link(repository, first.id, second.id)
        add_device_link(repository, second.id, third.id)

    first_order = client.post(
        "/v1/topology/projection", json=projection_query([first.id, second.id])
    ).json()
    reverse_order = client.post(
        "/v1/topology/projection", json=projection_query([second.id, first.id])
    ).json()

    assert first_order == reverse_order
    assert len(first_order["nodes"]) == 2
    assert len(first_order["edges"]) == 1
    assert str(third.id) not in str(first_order)


def test_explicit_passive_object_is_valid_but_not_representable_as_device():
    with SessionLocal.begin() as session:
        passive = CanonicalRepository(session).add_physical_object()

    body = client.post(
        "/v1/topology/projection", json=projection_query([passive.id])
    ).json()

    assert body["nodes"] == []
    assert body["edges"] == []
    assert body["gaps"] == ["ENTITY_NOT_REPRESENTABLE_AT_DEVICE_LEVEL"]


def test_projection_json_shape_and_derived_ids_are_frontend_compatible():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = repository.add_physical_object()
        second = repository.add_physical_object()
        add_device_link(repository, first.id, second.id)

    body = client.post("/v1/topology/projection", json=projection_query()).json()
    node = body["nodes"][0]
    edge = body["edges"][0]

    assert set(body) == {
        "schema_version", "layer", "detail_level", "nodes", "edges", "gaps", "warnings"
    }
    assert set(node) == {"id", "kind", "label", "source_refs", "attributes", "status"}
    assert set(edge) == {
        "id", "from_node_id", "to_node_id", "kind", "aggregate",
        "source_refs", "attributes", "status",
    }
    assert node["id"].startswith("l2-device:")
    assert node["id"] not in {str(first.id), str(second.id)}
    assert edge["id"].startswith("l2-device-link:")
    assert body["schema_version"] == "1.0"
    assert body["layer"] == "L2"
    assert body["detail_level"] == "DEVICE"
    assert not {"x", "y", "width", "height", "position", "workspace_id"} & set(node)


def test_reverse_uuid_insertion_order_still_returns_sorted_projection():
    object_ids = sorted((uuid.uuid4(), uuid.uuid4(), uuid.uuid4()), reverse=True)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        for object_id in object_ids:
            physical_object = repository.add_physical_object(object_id)
            interface = repository.add_network_interface()
            repository.add_network_interface_physical_owner(
                interface.id, physical_object.id
            )

    first = client.post("/v1/topology/projection", json=projection_query()).json()
    second = client.post("/v1/topology/projection", json=projection_query()).json()

    assert first == second
    assert [node["id"] for node in first["nodes"]] == sorted(
        node["id"] for node in first["nodes"]
    )


@pytest.mark.parametrize("layer", ["L3"])
def test_unsupported_projection_layer_returns_typed_validation_error(layer):
    response = client.post(
        "/v1/topology/projection", json=projection_query(layer=layer)
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["details"]["reason"] == "PROJECTION_LAYER_DETAIL_UNSUPPORTED"


@pytest.mark.parametrize(
    ("layer", "detail_level"),
    [("L1", "DEVICE"), ("L2", "PHYSICAL_OBJECT")],
)
def test_unsupported_projection_layer_detail_combinations_are_rejected(layer, detail_level):
    response = client.post(
        "/v1/topology/projection",
        json=projection_query(layer=layer, detail_level=detail_level),
    )

    assert response.status_code == 422
    assert response.json()["error"]["details"]["reason"] == "PROJECTION_LAYER_DETAIL_UNSUPPORTED"


@pytest.mark.parametrize(
    ("patch", "reason"),
    [
        (
            {"scope": {"include_location_subtrees": [{
                "ref_type": "CANONICAL_FACT", "entity_type": "Location",
                "entity_id": "00000000-0000-0000-0000-000000000001",
            }], "include_entities": []}},
            "PROJECTION_LOCATION_SCOPE_UNSUPPORTED",
        ),
        ({"grouping": {"by": "site"}}, "PROJECTION_GROUPING_UNSUPPORTED"),
        ({"filters": {"status": "CONFIGURED"}}, "PROJECTION_FILTER_UNSUPPORTED"),
    ],
)
def test_unsupported_projection_features_return_typed_validation_error(patch, reason):
    response = client.post(
        "/v1/topology/projection", json=projection_query(**patch)
    )

    assert response.status_code == 422
    assert response.json()["error"]["details"]["reason"] == reason


def test_non_physical_and_dangling_scope_refs_are_rejected():
    non_physical = projection_query()
    non_physical["scope"]["include_entities"] = [{
        "ref_type": "CANONICAL_FACT",
        "entity_type": "NetworkInterface",
        "entity_id": str(uuid.uuid4()),
    }]
    unsupported = client.post("/v1/topology/projection", json=non_physical)
    dangling = client.post(
        "/v1/topology/projection", json=projection_query([uuid.uuid4()])
    )

    assert unsupported.status_code == 422
    assert unsupported.json()["error"]["details"]["reason"] == "PROJECTION_ENTITY_SCOPE_UNSUPPORTED"
    assert dangling.status_code == 422
    assert dangling.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "mutation",
    [
        {"detail_level": "INTERFACE"},
        {"workspace_id": "00000000-0000-0000-0000-000000000001"},
        {"scope": {"include_location_subtrees": [], "include_entities": [{
            "ref_type": "CANONICAL_FACT", "entity_type": "PhysicalObject"
        }]}},
        {"scope": {"include_location_subtrees": [], "include_entities": [{
            "ref_type": "OBSERVED_FACT", "entity_type": "PhysicalObject",
            "entity_id": "00000000-0000-0000-0000-000000000001"
        }]}},
    ],
)
def test_malformed_public_projection_request_is_schema_validation_error(mutation):
    response = client.post(
        "/v1/topology/projection", json=projection_query(**mutation)
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
