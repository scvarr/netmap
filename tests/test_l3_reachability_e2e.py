import os

import httpx

from app.database import SessionLocal
from app.repository import CanonicalRepository, RouteNextHopInput


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def reachability(origin, destination, selections):
    return httpx.post(
        f"{BASE_URL}/v1/traces/l3/reachability",
        json={
            "origin_l3_binding_id": str(origin),
            "destination_ip": destination,
            "table_selections": [
                {
                    "routing_context_id": str(context),
                    "routing_table_id": str(table),
                }
                for context, table in selections
            ],
        },
        timeout=10,
    )


def add_context(repository, completeness="COMPLETE"):
    context = repository.add_routing_context()
    table = repository.add_routing_table(
        context.id, "IPv4", completeness
    )
    return context, table


def bind_interface(repository, context):
    interface = repository.add_network_interface()
    binding = repository.add_l3_binding(interface.id, context.id)
    return interface, binding


def attach_l2(repository, *interfaces):
    context = repository.add_l2_forwarding_context()
    for interface in interfaces:
        repository.add_l2_binding(interface.id, context.id)
    return context


def make_two_router_path(destination="203.0.113.9"):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        r1, t1 = add_context(repository)
        r2, t2 = add_context(repository)
        origin_interface, origin = bind_interface(repository, r1)
        r1_egress_interface, r1_egress = bind_interface(repository, r1)

        gateway_interface = repository.add_network_interface()
        gateway_identity = repository.add_l3_binding(gateway_interface.id, r1.id)
        gateway_ingress = repository.add_l3_binding(gateway_interface.id, r2.id)
        repository.add_interface_address(gateway_identity.id, "192.0.2.2", 24)
        attach_l2(repository, r1_egress_interface, gateway_interface)
        repository.add_route(
            t1.id,
            "0.0.0.0/0",
            "FORWARD",
            [
                RouteNextHopInput(
                    gateway_address="192.0.2.2",
                    egress_l3_binding_id=r1_egress.id,
                )
            ],
        )

        r2_egress_interface, r2_egress = bind_interface(repository, r2)
        target_interface, target = bind_interface(repository, r2)
        target_address = repository.add_interface_address(
            target.id, destination, 24
        )
        attach_l2(repository, r2_egress_interface, target_interface)
        repository.add_route(
            t2.id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=r2_egress.id)],
        )
        return {
            "origin": origin.id,
            "contexts": (r1.id, r2.id),
            "tables": (t1.id, t2.id),
            "gateway_ingress": gateway_ingress.id,
            "target": target.id,
            "target_address": target_address.id,
            "destination": destination,
        }


def test_one_router_direct_destination_is_target_reached():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table = add_context(repository)
        _origin_interface, origin = bind_interface(repository, context)
        egress_interface, egress = bind_interface(repository, context)
        target_interface, target = bind_interface(repository, context)
        repository.add_interface_address(target.id, "192.0.2.9", 24)
        attach_l2(repository, egress_interface, target_interface)
        repository.add_route(
            table.id,
            "192.0.2.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=egress.id)],
        )

    body = reachability(
        origin.id, "192.0.2.9", [(context.id, table.id)]
    ).json()

    assert body["verdict"] == "REACHABLE"
    assert {branch["termination"] for branch in body["branches"]} == {
        "TARGET_REACHED"
    }
    hop = body["branches"][0]["hops"][0]
    assert hop["next_hop_branch"]["outcome"] == "RESOLVED"
    assert hop["structural_adjacency"]["result"] == "REACHABLE"


def test_target_reached_on_first_handoff_needs_no_target_host_selection():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source_context, source_table = add_context(repository)
        host_context, _host_table = add_context(repository)
        _origin_interface, origin = bind_interface(repository, source_context)
        egress_interface, egress = bind_interface(repository, source_context)
        target_interface, target_identity = bind_interface(
            repository, source_context
        )
        repository.add_l3_binding(target_interface.id, host_context.id)
        repository.add_interface_address(
            target_identity.id, "192.0.2.9", 24
        )
        attach_l2(repository, egress_interface, target_interface)
        repository.add_route(
            source_table.id,
            "192.0.2.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=egress.id)],
        )

    body = reachability(
        origin.id,
        "192.0.2.9",
        [(source_context.id, source_table.id)],
    ).json()

    assert body["verdict"] == "REACHABLE"
    assert {branch["termination"] for branch in body["branches"]} == {
        "TARGET_REACHED"
    }


def test_multiple_l2_paths_expand_to_multiple_reachable_l3_branches():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table = add_context(repository)
        _origin_interface, origin = bind_interface(repository, context)
        egress_interface, egress = bind_interface(repository, context)
        target_interface, target = bind_interface(repository, context)
        repository.add_interface_address(target.id, "192.0.2.9", 24)
        attach_l2(repository, egress_interface, target_interface)
        attach_l2(repository, egress_interface, target_interface)
        repository.add_route(
            table.id,
            "192.0.2.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=egress.id)],
        )

    body = reachability(
        origin.id, "192.0.2.9", [(context.id, table.id)]
    ).json()

    reached = [
        branch for branch in body["branches"]
        if branch["termination"] == "TARGET_REACHED"
    ]
    assert body["verdict"] == "REACHABLE"
    assert len(reached) == 2
    assert len({branch["hops"][0]["l2_branch_id"] for branch in reached}) == 2


def test_two_router_path_reaches_destination_and_keeps_destination_constant():
    path = make_two_router_path()

    body = reachability(
        path["origin"],
        path["destination"],
        list(zip(path["contexts"], path["tables"])),
    ).json()

    assert body["verdict"] == "REACHABLE"
    reached = next(
        branch
        for branch in body["branches"]
        if branch["termination"] == "TARGET_REACHED"
    )
    assert len(reached["hops"]) == 2
    assert reached["hops"][0]["reached_l3_binding_id"] == str(
        path["gateway_ingress"]
    )
    assert all(
        hop["routing_state"]["destination_ip"] == path["destination"]
        for hop in reached["hops"]
    )
    assert [hop["selected_routing_table_id"] for hop in reached["hops"]] == [
        str(item) for item in path["tables"]
    ]


def test_local_route_is_reachable_without_l2():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table = add_context(repository)
        _interface, origin = bind_interface(repository, context)
        repository.add_route(table.id, "198.51.100.10/32", "LOCAL")

    body = reachability(
        origin.id, "198.51.100.10", [(context.id, table.id)]
    ).json()

    assert body["verdict"] == "REACHABLE"
    assert body["branches"][0]["termination"] == "LOCAL_DELIVERY"
    assert body["branches"][0]["hops"][0]["structural_adjacency"] is None


def test_missing_initial_table_selection_is_typed_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, _table = add_context(repository)
        _interface, origin = bind_interface(repository, context)

    body = reachability(origin.id, "192.0.2.1", []).json()

    assert body["verdict"] == "UNKNOWN"
    assert body["branches"][0]["termination"] == "TABLE_SELECTION_UNKNOWN"
    assert body["branches"][0]["hops"][0]["selected_routing_table_id"] is None


def test_missing_second_router_selection_preserves_first_hop():
    path = make_two_router_path()

    body = reachability(
        path["origin"],
        path["destination"],
        [(path["contexts"][0], path["tables"][0])],
    ).json()

    assert body["verdict"] == "UNKNOWN"
    unknown = next(
        branch
        for branch in body["branches"]
        if branch["termination"] == "TABLE_SELECTION_UNKNOWN"
    )
    assert len(unknown["hops"]) == 2
    assert unknown["hops"][0]["structural_adjacency"]["result"] == "REACHABLE"


def test_table_selection_must_belong_to_declared_context():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context_a, _table_a = add_context(repository)
        _context_b, table_b = add_context(repository)
        _interface, origin = bind_interface(repository, context_a)

    response = reachability(
        origin.id, "192.0.2.1", [(context_a.id, table_b.id)]
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_duplicate_table_selection_for_context_is_validation_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table_a = add_context(repository)
        table_b = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        _interface, origin = bind_interface(repository, context)

    response = reachability(
        origin.id,
        "192.0.2.1",
        [(context.id, table_a.id), (context.id, table_b.id)],
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_explicit_second_table_is_used_without_default_heuristic():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, first = add_context(repository)
        second = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        _interface, origin = bind_interface(repository, context)
        repository.add_route(first.id, "0.0.0.0/0", "DISCARD")
        repository.add_route(second.id, "192.0.2.9/32", "LOCAL")

    body = reachability(
        origin.id, "192.0.2.9", [(context.id, second.id)]
    ).json()

    assert body["verdict"] == "REACHABLE"
    hop = body["branches"][0]["hops"][0]
    assert hop["selected_routing_table_id"] == str(second.id)
    assert hop["next_hop_resolution"]["result"] == "LOCAL_TERMINAL"


def test_complete_no_route_and_discard_are_unreachable():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        no_route_context, no_route_table = add_context(repository)
        _interface, no_route_origin = bind_interface(repository, no_route_context)
        discard_context, discard_table = add_context(repository)
        _interface, discard_origin = bind_interface(repository, discard_context)
        repository.add_route(discard_table.id, "0.0.0.0/0", "DISCARD")

    no_route = reachability(
        no_route_origin.id,
        "192.0.2.1",
        [(no_route_context.id, no_route_table.id)],
    ).json()
    discard = reachability(
        discard_origin.id,
        "192.0.2.1",
        [(discard_context.id, discard_table.id)],
    ).json()

    assert no_route["verdict"] == "UNREACHABLE"
    assert no_route["branches"][0]["termination"] == "NO_ROUTE"
    assert discard["verdict"] == "UNREACHABLE"
    assert discard["branches"][0]["termination"] == "ROUTE_DISCARD"


def test_partial_route_unknown_is_not_unreachable():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table = add_context(repository, "PARTIAL")
        _interface, origin = bind_interface(repository, context)

    body = reachability(
        origin.id, "192.0.2.1", [(context.id, table.id)]
    ).json()

    assert body["verdict"] == "UNKNOWN"
    assert body["branches"][0]["termination"] == "ROUTE_UNKNOWN"


def test_structural_adjacency_unknown_makes_overall_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table = add_context(repository)
        _origin_interface, origin = bind_interface(repository, context)
        _egress_interface, egress = bind_interface(repository, context)
        repository.add_route(
            table.id,
            "192.0.2.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=egress.id)],
        )

    body = reachability(
        origin.id, "192.0.2.9", [(context.id, table.id)]
    ).json()

    assert body["verdict"] == "UNKNOWN"
    assert body["branches"][0]["termination"] == (
        "STRUCTURAL_ADJACENCY_UNKNOWN"
    )


def test_recursive_next_hop_loop_is_known_negative():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table = add_context(repository)
        _interface, origin = bind_interface(repository, context)
        repository.add_route(
            table.id,
            "203.0.113.9/32",
            "FORWARD",
            [RouteNextHopInput(gateway_address="192.0.2.1")],
        )
        repository.add_route(
            table.id,
            "192.0.2.1/32",
            "FORWARD",
            [RouteNextHopInput(gateway_address="192.0.2.2")],
        )
        repository.add_route(
            table.id,
            "192.0.2.2/32",
            "FORWARD",
            [RouteNextHopInput(gateway_address="192.0.2.1")],
        )

    body = reachability(
        origin.id, "203.0.113.9", [(context.id, table.id)]
    ).json()

    assert body["verdict"] == "UNREACHABLE"
    assert body["branches"][0]["termination"] == "LOOP_DETECTED"


def test_recursive_local_route_is_unresolved_not_local_delivery():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table = add_context(repository)
        _interface, origin = bind_interface(repository, context)
        repository.add_route(
            table.id,
            "203.0.113.9/32",
            "FORWARD",
            [RouteNextHopInput(gateway_address="192.0.2.1")],
        )
        repository.add_route(table.id, "192.0.2.1/32", "LOCAL")

    body = reachability(
        origin.id, "203.0.113.9", [(context.id, table.id)]
    ).json()

    assert body["verdict"] == "UNKNOWN"
    assert body["branches"][0]["termination"] == "NEXT_HOP_UNRESOLVED"


def test_duplicate_neighbor_keeps_reachable_and_unknown_branches():
    path = make_two_router_path()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        unknown_interface = repository.add_network_interface()
        unknown_binding = repository.add_l3_binding(
            unknown_interface.id, path["contexts"][0]
        )
        repository.add_interface_address(unknown_binding.id, "192.0.2.2", 24)

    body = reachability(
        path["origin"],
        path["destination"],
        list(zip(path["contexts"], path["tables"])),
    ).json()

    assert body["verdict"] == "REACHABLE"
    terminations = {branch["termination"] for branch in body["branches"]}
    assert "TARGET_REACHED" in terminations
    assert "STRUCTURAL_ADJACENCY_UNKNOWN" in terminations
    assert {
        ref["entity_type"] for ref in body["evidence_refs"]
    } >= {"RoutingContext", "RoutingTable", "Route", "RouteNextHop", "L3Binding"}


def test_three_router_chain_is_reachable():
    destination = "203.0.113.9"
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        contexts_and_tables = [add_context(repository) for _ in range(3)]
        (r1, t1), (r2, t2), (r3, t3) = contexts_and_tables
        _origin_interface, origin = bind_interface(repository, r1)

        egress1_interface, egress1 = bind_interface(repository, r1)
        link12 = repository.add_network_interface()
        link12_identity = repository.add_l3_binding(link12.id, r1.id)
        repository.add_l3_binding(link12.id, r2.id)
        repository.add_interface_address(link12_identity.id, "192.0.2.2", 30)
        attach_l2(repository, egress1_interface, link12)
        repository.add_route(
            t1.id,
            "0.0.0.0/0",
            "FORWARD",
            [RouteNextHopInput("192.0.2.2", egress1.id)],
        )

        egress2_interface, egress2 = bind_interface(repository, r2)
        link23 = repository.add_network_interface()
        link23_identity = repository.add_l3_binding(link23.id, r2.id)
        repository.add_l3_binding(link23.id, r3.id)
        repository.add_interface_address(link23_identity.id, "198.51.100.2", 30)
        attach_l2(repository, egress2_interface, link23)
        repository.add_route(
            t2.id,
            "0.0.0.0/0",
            "FORWARD",
            [RouteNextHopInput("198.51.100.2", egress2.id)],
        )

        egress3_interface, egress3 = bind_interface(repository, r3)
        target_interface, target = bind_interface(repository, r3)
        repository.add_interface_address(target.id, destination, 24)
        attach_l2(repository, egress3_interface, target_interface)
        repository.add_route(
            t3.id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=egress3.id)],
        )
        selections = [(context.id, table.id) for context, table in contexts_and_tables]

    body = reachability(origin.id, destination, selections).json()

    assert body["verdict"] == "REACHABLE"
    reached = next(
        branch for branch in body["branches"]
        if branch["termination"] == "TARGET_REACHED"
    )
    assert len(reached["hops"]) == 3
    assert [hop["routing_state"]["routing_context_id"] for hop in reached["hops"]] == [
        str(r1.id), str(r2.id), str(r3.id)
    ]


def make_ecmp_outcomes(second_outcome="NO_ROUTE"):
    destination = "203.0.113.9"
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        r1, t1 = add_context(repository)
        r2, t2 = add_context(repository)
        r3, t3 = add_context(
            repository, "PARTIAL" if second_outcome == "UNKNOWN" else "COMPLETE"
        )
        _origin_interface, origin = bind_interface(repository, r1)

        next_hops = []
        for address, target_context in (("192.0.2.2", r2), ("198.51.100.2", r3)):
            egress_interface, egress = bind_interface(repository, r1)
            gateway_interface = repository.add_network_interface()
            identity = repository.add_l3_binding(gateway_interface.id, r1.id)
            repository.add_l3_binding(gateway_interface.id, target_context.id)
            repository.add_interface_address(identity.id, address, 30)
            attach_l2(repository, egress_interface, gateway_interface)
            next_hops.append(RouteNextHopInput(address, egress.id))
        repository.add_route(t1.id, "0.0.0.0/0", "FORWARD", next_hops)

        egress2_interface, egress2 = bind_interface(repository, r2)
        target_interface, target = bind_interface(repository, r2)
        repository.add_interface_address(target.id, destination, 24)
        attach_l2(repository, egress2_interface, target_interface)
        repository.add_route(
            t2.id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=egress2.id)],
        )
        return origin.id, destination, [
            (r1.id, t1.id), (r2.id, t2.id), (r3.id, t3.id)
        ]


def test_ecmp_reachable_and_no_route_branches_are_both_preserved():
    origin, destination, selections = make_ecmp_outcomes()

    body = reachability(origin, destination, selections).json()

    assert body["verdict"] == "REACHABLE"
    terminations = {branch["termination"] for branch in body["branches"]}
    assert {"TARGET_REACHED", "NO_ROUTE"} <= terminations


def test_known_negative_plus_unknown_without_success_is_unknown():
    origin, destination, selections = make_ecmp_outcomes("UNKNOWN")
    # Make the otherwise successful context a known-negative table as well.
    with SessionLocal.begin() as session:
        # Its existing FORWARD route is intentionally retained, but direct L2
        # target identity is removed by test isolation being unavailable here;
        # use only the NO_ROUTE and partial branches by selecting a new empty
        # complete table for that context.
        repository = CanonicalRepository(session)
        r2_id, _old_t2 = selections[1]
        new_t2 = repository.add_routing_table(r2_id, "IPv4", "COMPLETE")
        selections[1] = (r2_id, new_t2.id)

    body = reachability(origin, destination, selections).json()

    assert body["verdict"] == "UNKNOWN"
    terminations = {branch["termination"] for branch in body["branches"]}
    assert "NO_ROUTE" in terminations
    assert "ROUTE_UNKNOWN" in terminations


def test_all_ecmp_continuations_known_negative_are_unreachable():
    origin, destination, selections = make_ecmp_outcomes()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        r2_id, _old_t2 = selections[1]
        r3_id, _old_t3 = selections[2]
        no_route_table = repository.add_routing_table(
            r2_id, "IPv4", "COMPLETE"
        )
        discard_table = repository.add_routing_table(
            r3_id, "IPv4", "COMPLETE"
        )
        repository.add_route(discard_table.id, "0.0.0.0/0", "DISCARD")
        selections[1] = (r2_id, no_route_table.id)
        selections[2] = (r3_id, discard_table.id)

    body = reachability(origin, destination, selections).json()

    assert body["verdict"] == "UNREACHABLE"
    assert {branch["termination"] for branch in body["branches"]} == {
        "NO_ROUTE",
        "ROUTE_DISCARD",
    }


def test_inter_router_forwarding_loop_is_known_unreachable():
    destination = "203.0.113.9"
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        r1, t1 = add_context(repository)
        r2, t2 = add_context(repository)
        _origin_interface, origin = bind_interface(repository, r1)

        egress1_interface, egress1 = bind_interface(repository, r1)
        to_r2 = repository.add_network_interface()
        to_r2_identity = repository.add_l3_binding(to_r2.id, r1.id)
        repository.add_l3_binding(to_r2.id, r2.id)
        repository.add_interface_address(to_r2_identity.id, "192.0.2.2", 30)
        attach_l2(repository, egress1_interface, to_r2)
        repository.add_route(
            t1.id,
            "0.0.0.0/0",
            "FORWARD",
            [RouteNextHopInput("192.0.2.2", egress1.id)],
        )

        egress2_interface, egress2 = bind_interface(repository, r2)
        to_r1 = repository.add_network_interface()
        to_r1_identity = repository.add_l3_binding(to_r1.id, r2.id)
        repository.add_l3_binding(to_r1.id, r1.id)
        repository.add_interface_address(to_r1_identity.id, "198.51.100.1", 30)
        attach_l2(repository, egress2_interface, to_r1)
        repository.add_route(
            t2.id,
            "0.0.0.0/0",
            "FORWARD",
            [RouteNextHopInput("198.51.100.1", egress2.id)],
        )

    body = reachability(
        origin.id,
        destination,
        [(r1.id, t1.id), (r2.id, t2.id)],
    ).json()

    assert body["verdict"] == "UNREACHABLE"
    assert {branch["termination"] for branch in body["branches"]} == {
        "FORWARDING_LOOP"
    }
    loop = body["branches"][0]
    assert len(loop["hops"]) == 4
