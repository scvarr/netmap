import os

import httpx

from app.database import SessionLocal
from app.repository import CanonicalRepository, ConnectionMemberInput, RouteNextHopInput


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")
REFERENCE_PACKET = {
    "source_ip": "10.10.100.10",
    "destination_ip": "203.0.113.10",
    "ip_protocol": 6,
    "source_port": 50000,
    "destination_port": 443,
    "icmp_type": None,
    "icmp_code": None,
}


def packet_flow(context_id, **overrides):
    body = {
        "routing_context_id": str(context_id),
        "traffic_class": "LOCAL_OUTPUT",
        "packet_state": REFERENCE_PACKET,
    }
    body.update(overrides)
    return httpx.post(
        f"{BASE_URL}/v1/traces/packet-flow/evaluation",
        json=body,
        timeout=30,
    )


def topology_projection():
    return httpx.post(
        f"{BASE_URL}/v1/topology/projection",
        json={
            "layer": "L2",
            "detail_level": "DEVICE",
            "scope": {"include_location_subtrees": [], "include_entities": []},
        },
        timeout=30,
    )


def terminal(repository, plan_id, outcome):
    return repository.add_processing_stage(
        plan_id, "TERMINATE", {"outcome": outcome}
    )


def attach_plan(
    repository,
    context_id,
    traffic_class,
    plan,
    *,
    ingress_binding_id=None,
    completeness="COMPLETE",
):
    attachment_set = repository.add_packet_processing_plan_attachment_set(
        context_id, traffic_class, completeness
    )
    scope = (
        {"ingress_l3_binding_ids": [str(ingress_binding_id)]}
        if ingress_binding_id is not None
        else {}
    )
    repository.add_packet_processing_plan_attachment(
        attachment_set.id, plan.id, scope
    )
    return attachment_set


def add_owned_interface(repository, owner):
    interface = repository.add_network_interface()
    repository.add_network_interface_physical_owner(interface.id, owner.id)
    return interface


def add_physical_segment(
    repository,
    left_device,
    right_device,
    left_logical,
    right_logical,
    *,
    left_point_object=None,
    omit_egress=False,
):
    left_context = repository.add_l2_forwarding_context()
    right_context = repository.add_l2_forwarding_context()
    left_logical_binding = repository.add_l2_binding(
        left_logical.id, left_context.id
    )
    right_logical_binding = repository.add_l2_binding(
        right_logical.id, right_context.id
    )
    repository.add_l2_ingress_rule(left_logical_binding.id, [])
    repository.add_l2_egress_rule(right_logical_binding.id, [])

    left_uplink = add_owned_interface(repository, left_device)
    right_uplink = add_owned_interface(repository, right_device)
    left_uplink_binding = repository.add_l2_binding(
        left_uplink.id, left_context.id
    )
    right_uplink_binding = repository.add_l2_binding(
        right_uplink.id, right_context.id
    )
    if not omit_egress:
        repository.add_l2_egress_rule(left_uplink_binding.id, [])
    repository.add_l2_ingress_rule(right_uplink_binding.id, [])

    left_point = repository.add_connection_point(
        (left_point_object or left_device).id, 1
    )
    right_point = repository.add_connection_point(right_device.id, 1)
    left_physical_binding = repository.add_interface_physical_binding(
        left_uplink.id, left_point.id, 1
    )
    right_physical_binding = repository.add_interface_physical_binding(
        right_uplink.id, right_point.id, 1
    )
    connection, members = repository.add_connection(
        left_point.id,
        right_point.id,
        cardinality=1,
        members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
    )
    return {
        "left_context": left_context,
        "right_context": right_context,
        "left_uplink": left_uplink,
        "right_uplink": right_uplink,
        "left_physical_binding": left_physical_binding,
        "right_physical_binding": right_physical_binding,
        "connection": connection,
        "member": members[0],
    }


def add_exact_security_attachment(
    repository,
    *,
    destination,
    port,
    action="PERMIT",
    traffic_class=None,
    connection_state=False,
    stage_order=10,
):
    children = []
    if connection_state:
        children.append(
            {"op": "CONNECTION_STATE_IN", "values": ["ESTABLISHED"]}
        )
    else:
        children.extend(
            [
                {"op": "DESTINATION_IP_IN", "prefixes": [f"{destination}/32"]},
                {"op": "IP_PROTOCOL_IN", "values": [6]},
                {
                    "op": "DESTINATION_PORT_IN",
                    "ranges": [{"start": port, "end": port}],
                },
            ]
        )
    policy = repository.add_security_policy("DROP", "COMPLETE")
    rule = repository.add_security_rule(
        policy.id, 10, {"op": "ALL", "children": children}, action
    )
    scope = {"traffic_classes": [traffic_class]} if traffic_class else {}
    attachment = repository.add_security_policy_attachment(
        policy.id, stage_order, scope
    )
    return {"policy": policy, "rule": rule, "attachment": attachment}


def add_routing_plan(repository, traffic_class, policy, *, security=None):
    plan = repository.add_packet_processing_plan("COMPLETE")
    security_stage = None
    if security is not None:
        security_stage = repository.add_processing_stage(
            plan.id,
            "SECURITY",
            {"attachment_id": str(security["attachment"].id)},
        )
    policy_stage = repository.add_processing_stage(
        plan.id, "ROUTING_POLICY", {"policy_id": str(policy.id)}
    )
    route_stage = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
    adjacency_stage = repository.add_processing_stage(plan.id, "ADJACENCY_L2", {})
    proceed = terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
    negative = terminal(repository, plan.id, "NOT_DELIVERED")
    unknown = terminal(repository, plan.id, "UNKNOWN")
    entry = security_stage or policy_stage
    repository.add_processing_entry_point(plan.id, traffic_class, entry.id)
    if security_stage is not None:
        repository.add_processing_transition(
            plan.id, security_stage.id, "PASS", policy_stage.id
        )
        repository.add_processing_transition(
            plan.id, security_stage.id, "BLOCKED", negative.id
        )
        repository.add_processing_transition(
            plan.id, security_stage.id, "UNKNOWN", unknown.id
        )
    repository.add_processing_transition(
        plan.id, policy_stage.id, "TABLE_SELECTED", route_stage.id
    )
    repository.add_processing_transition(
        plan.id, policy_stage.id, "TABLE_SELECTION_UNKNOWN", unknown.id
    )
    for outcome, target in (
        ("FORWARD", adjacency_stage),
        ("LOCAL", unknown),
        ("DISCARD", negative),
        ("NO_ROUTE", negative),
        ("UNKNOWN", unknown),
        ("CONFLICTING", unknown),
    ):
        repository.add_processing_transition(
            plan.id, route_stage.id, outcome, target.id
        )
    for outcome, target in (
        ("NEXT_PROCESSING_POINT", proceed),
        ("TARGET_ATTACHMENT_REACHED", proceed),
        ("L2_UNREACHABLE", negative),
        ("UNKNOWN", unknown),
    ):
        repository.add_processing_transition(
            plan.id, adjacency_stage.id, outcome, target.id
        )
    return {
        "plan": plan,
        "security": security_stage,
        "routing_policy": policy_stage,
        "route": route_stage,
        "adjacency": adjacency_stage,
    }


def add_firewall_plan(repository, policy, pre_security, post_security, nat_attachment):
    plan = repository.add_packet_processing_plan("COMPLETE")
    pre = repository.add_processing_stage(
        plan.id,
        "SECURITY",
        {"attachment_id": str(pre_security["attachment"].id)},
    )
    nat = repository.add_processing_stage(
        plan.id, "NAT", {"attachment_id": str(nat_attachment.id)}
    )
    policy_stage = repository.add_processing_stage(
        plan.id, "ROUTING_POLICY", {"policy_id": str(policy.id)}
    )
    route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
    post = repository.add_processing_stage(
        plan.id,
        "SECURITY",
        {"attachment_id": str(post_security["attachment"].id)},
    )
    adjacency = repository.add_processing_stage(plan.id, "ADJACENCY_L2", {})
    proceed = terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
    negative = terminal(repository, plan.id, "NOT_DELIVERED")
    unknown = terminal(repository, plan.id, "UNKNOWN")
    repository.add_processing_entry_point(plan.id, "TRANSIT", pre.id)
    repository.add_processing_transition(plan.id, pre.id, "PASS", nat.id)
    repository.add_processing_transition(plan.id, pre.id, "BLOCKED", negative.id)
    repository.add_processing_transition(plan.id, pre.id, "UNKNOWN", unknown.id)
    for outcome, target in (
        ("IDENTITY", policy_stage),
        ("TRANSFORMED_EXACT", policy_stage),
        ("TRANSFORMED_CONSTRAINED", policy_stage),
        ("UNKNOWN", unknown),
    ):
        repository.add_processing_transition(plan.id, nat.id, outcome, target.id)
    repository.add_processing_transition(
        plan.id, policy_stage.id, "TABLE_SELECTED", route.id
    )
    repository.add_processing_transition(
        plan.id, policy_stage.id, "TABLE_SELECTION_UNKNOWN", unknown.id
    )
    for outcome, target in (
        ("FORWARD", post),
        ("LOCAL", unknown),
        ("DISCARD", negative),
        ("NO_ROUTE", negative),
        ("UNKNOWN", unknown),
        ("CONFLICTING", unknown),
    ):
        repository.add_processing_transition(plan.id, route.id, outcome, target.id)
    repository.add_processing_transition(plan.id, post.id, "PASS", adjacency.id)
    repository.add_processing_transition(plan.id, post.id, "BLOCKED", negative.id)
    repository.add_processing_transition(plan.id, post.id, "UNKNOWN", unknown.id)
    for outcome, target in (
        ("NEXT_PROCESSING_POINT", proceed),
        ("TARGET_ATTACHMENT_REACHED", proceed),
        ("L2_UNREACHABLE", negative),
        ("UNKNOWN", unknown),
    ):
        repository.add_processing_transition(plan.id, adjacency.id, outcome, target.id)
    return {
        "plan": plan,
        "pre_security": pre,
        "nat": nat,
        "routing_policy": policy_stage,
        "route": route,
        "post_security": post,
        "adjacency": adjacency,
    }


def add_app_plan(repository, security):
    plan = repository.add_packet_processing_plan("COMPLETE")
    security_stage = repository.add_processing_stage(
        plan.id,
        "SECURITY",
        {"attachment_id": str(security["attachment"].id)},
    )
    delivery = repository.add_processing_stage(plan.id, "LOCAL_DELIVERY", {})
    delivered = terminal(repository, plan.id, "NETWORK_DELIVERY")
    negative = terminal(repository, plan.id, "NOT_DELIVERED")
    unknown = terminal(repository, plan.id, "UNKNOWN")
    repository.add_processing_entry_point(plan.id, "LOCAL_INPUT", security_stage.id)
    repository.add_processing_transition(
        plan.id, security_stage.id, "PASS", delivery.id
    )
    repository.add_processing_transition(
        plan.id, security_stage.id, "BLOCKED", negative.id
    )
    repository.add_processing_transition(
        plan.id, security_stage.id, "UNKNOWN", unknown.id
    )
    repository.add_processing_transition(
        plan.id, delivery.id, "DELIVERED", delivered.id
    )
    repository.add_processing_transition(
        plan.id, delivery.id, "UNKNOWN", unknown.id
    )
    return {"plan": plan, "security": security_stage, "delivery": delivery}


def add_terminal_plan(repository, traffic_class, outcome):
    plan = repository.add_packet_processing_plan("COMPLETE")
    end = terminal(repository, plan.id, outcome)
    repository.add_processing_entry_point(plan.id, traffic_class, end.id)
    return plan


def build_reference_network(scenario="S0"):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        devices = {
            name: repository.add_physical_object()
            for name in ("CLIENT", "CORE", "FW", "APP")
        }
        contexts = {
            name: repository.add_routing_context()
            for name in ("CLIENT", "CORE", "FW", "APP")
        }

        interfaces = {
            "client": add_owned_interface(repository, devices["CLIENT"]),
            "core_client": add_owned_interface(repository, devices["CORE"]),
            "core_transit": add_owned_interface(repository, devices["CORE"]),
            "fw_outside": add_owned_interface(repository, devices["FW"]),
            "fw_inside": add_owned_interface(repository, devices["FW"]),
            "app": add_owned_interface(repository, devices["APP"]),
        }
        bindings = {
            "client": repository.add_l3_binding(
                interfaces["client"].id, contexts["CLIENT"].id
            ),
            "core_client": repository.add_l3_binding(
                interfaces["core_client"].id, contexts["CORE"].id
            ),
            "core_transit": repository.add_l3_binding(
                interfaces["core_transit"].id, contexts["CORE"].id
            ),
            "fw_outside": repository.add_l3_binding(
                interfaces["fw_outside"].id, contexts["FW"].id
            ),
            "fw_inside": repository.add_l3_binding(
                interfaces["fw_inside"].id, contexts["FW"].id
            ),
            "app": repository.add_l3_binding(
                interfaces["app"].id, contexts["APP"].id
            ),
        }
        for name, address, prefix in (
            ("client", "10.10.100.10", 24),
            ("core_client", "10.10.100.1", 24),
            ("core_transit", "10.10.200.1", 30),
            ("fw_outside", "10.10.200.2", 30),
            ("fw_inside", "10.20.30.1", 24),
            ("app", "10.20.30.40", 24),
        ):
            repository.add_interface_address(bindings[name].id, address, prefix)
        if scenario in {"S9", "S9_ALL_DELIVERED"}:
            repository.add_interface_address(
                bindings["app"].id, "10.20.30.41", 24
            )

        client_core = add_physical_segment(
            repository,
            devices["CLIENT"],
            devices["CORE"],
            interfaces["client"],
            interfaces["core_client"],
        )
        core_sfp = repository.add_physical_object()
        core_fw = add_physical_segment(
            repository,
            devices["CORE"],
            devices["FW"],
            interfaces["core_transit"],
            interfaces["fw_outside"],
            left_point_object=core_sfp,
            omit_egress=scenario == "S5",
        )
        fw_app = add_physical_segment(
            repository,
            devices["FW"],
            devices["APP"],
            interfaces["fw_inside"],
            interfaces["app"],
        )
        extra_path = None
        if scenario == "S7":
            extra_path = add_physical_segment(
                repository,
                devices["CORE"],
                devices["FW"],
                interfaces["core_transit"],
                interfaces["fw_outside"],
            )

        tables = {
            "CLIENT": repository.add_routing_table(
                contexts["CLIENT"].id, "IPv4", "COMPLETE"
            ),
            "CORE": repository.add_routing_table(
                contexts["CORE"].id,
                "IPv4",
                "PARTIAL" if scenario == "S4" else "COMPLETE",
            ),
            "FW": repository.add_routing_table(
                contexts["FW"].id, "IPv4", "COMPLETE"
            ),
            "APP": repository.add_routing_table(
                contexts["APP"].id, "IPv4", "COMPLETE"
            ),
        }
        policies = {
            name: repository.add_routing_policy(
                {"op": "SELECT_TABLE", "routing_table_id": str(table.id)},
                "COMPLETE",
            )
            for name, table in tables.items()
        }
        repository.add_route(
            tables["CLIENT"].id,
            "10.10.100.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=bindings["client"].id)],
        )
        repository.add_route(
            tables["CLIENT"].id,
            "0.0.0.0/0",
            "FORWARD",
            [
                RouteNextHopInput(
                    gateway_address="10.10.100.1",
                    egress_l3_binding_id=bindings["client"].id,
                )
            ],
        )
        repository.add_route(
            tables["CORE"].id,
            "10.10.200.0/30",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=bindings["core_transit"].id)],
        )
        if scenario != "S4":
            repository.add_route(
                tables["CORE"].id,
                "203.0.113.10/32",
                "FORWARD",
                [
                    RouteNextHopInput(
                        gateway_address="10.10.200.2",
                        egress_l3_binding_id=bindings["core_transit"].id,
                    )
                ],
            )
        repository.add_route(
            tables["FW"].id,
            "10.20.30.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=bindings["fw_inside"].id)],
        )

        pre_security = add_exact_security_attachment(
            repository,
            destination="203.0.113.10",
            port=443,
            action="DROP" if scenario == "S1" else "PERMIT",
            stage_order=10,
        )
        post_security = add_exact_security_attachment(
            repository,
            destination="10.20.30.40",
            port=8443,
            stage_order=20,
        )
        app_security = add_exact_security_attachment(
            repository,
            destination="10.20.30.40",
            port=8443,
            action="DROP" if scenario == "S2" else "PERMIT",
            traffic_class="LOCAL_INPUT",
        )
        if scenario == "S9_ALL_DELIVERED":
            for security in (post_security, app_security):
                repository.add_security_rule(
                    security["policy"].id,
                    20,
                    {
                        "op": "ALL",
                        "children": [
                            {
                                "op": "DESTINATION_IP_IN",
                                "prefixes": ["10.20.30.41/32"],
                            },
                            {"op": "IP_PROTOCOL_IN", "values": [6]},
                            {
                                "op": "DESTINATION_PORT_IN",
                                "ranges": [{"start": 8443, "end": 8443}],
                            },
                        ],
                    },
                    "PERMIT",
                )

        nat_policy = repository.add_nat_policy({"op": "IDENTITY"}, "COMPLETE")
        if scenario in {"S9", "S9_ALL_DELIVERED"}:
            pool = repository.add_nat_pool(
                address_ranges=[
                    {"start": "10.20.30.40", "end": "10.20.30.41"}
                ]
            )
            destination_transform = {
                "op": "SELECT_FROM",
                "pool_id": str(pool.id),
            }
        else:
            pool = None
            destination_transform = {
                "op": "REPLACE_EXACT",
                "value": "10.20.30.40",
            }
        nat_rule = repository.add_nat_rule(
            nat_policy.id,
            10,
            {
                "op": "ALL",
                "children": [
                    {
                        "op": "DESTINATION_IP_IN",
                        "prefixes": ["203.0.113.10/32"],
                    },
                    {"op": "IP_PROTOCOL_IN", "values": [6]},
                    {
                        "op": "DESTINATION_PORT_IN",
                        "ranges": [{"start": 443, "end": 443}],
                    },
                ],
            },
            {
                "op": "TRANSFORM",
                "destination_ip": destination_transform,
                "destination_port": {"op": "REPLACE_EXACT", "value": 8443},
            },
        )
        nat_attachment = repository.add_nat_policy_attachment(
            nat_policy.id, 10, {}
        )

        core_security = (
            add_exact_security_attachment(
                repository,
                destination="203.0.113.10",
                port=443,
                connection_state=True,
            )
            if scenario == "S8"
            else None
        )
        plans = {
            "CLIENT": add_routing_plan(
                repository, "LOCAL_OUTPUT", policies["CLIENT"]
            ),
            "CORE": add_routing_plan(
                repository,
                "TRANSIT",
                policies["CORE"],
                security=core_security,
            ),
            "FW": add_firewall_plan(
                repository,
                policies["FW"],
                pre_security,
                post_security,
                nat_attachment,
            ),
            "APP": add_app_plan(repository, app_security),
        }
        attach_plan(
            repository,
            contexts["CLIENT"].id,
            "LOCAL_OUTPUT",
            plans["CLIENT"]["plan"],
        )
        attach_plan(
            repository,
            contexts["CORE"].id,
            "TRANSIT",
            plans["CORE"]["plan"],
            ingress_binding_id=bindings["core_client"].id,
            completeness="PARTIAL" if scenario == "S3" else "COMPLETE",
        )
        attach_plan(
            repository,
            contexts["FW"].id,
            "TRANSIT",
            plans["FW"]["plan"],
            ingress_binding_id=bindings["fw_outside"].id,
        )
        attach_plan(
            repository,
            contexts["APP"].id,
            "LOCAL_INPUT",
            plans["APP"]["plan"],
            ingress_binding_id=bindings["app"].id,
        )

        alternate = None
        if scenario == "S6":
            alternate_device = repository.add_physical_object()
            alternate_context = repository.add_routing_context()
            alternate_interface = add_owned_interface(repository, alternate_device)
            alternate_binding = repository.add_l3_binding(
                alternate_interface.id, alternate_context.id
            )
            alternate_address = repository.add_interface_address(
                alternate_binding.id, "10.10.200.2", 30
            )
            alternate_segment = add_physical_segment(
                repository,
                devices["CORE"],
                alternate_device,
                interfaces["core_transit"],
                alternate_interface,
            )
            alternate_plan = add_terminal_plan(
                repository, "TRANSIT", "NOT_DELIVERED"
            )
            attach_plan(
                repository,
                alternate_context.id,
                "TRANSIT",
                alternate_plan,
                ingress_binding_id=alternate_binding.id,
            )
            alternate = {
                "device": alternate_device,
                "context": alternate_context,
                "interface": alternate_interface,
                "binding": alternate_binding,
                "address": alternate_address,
                "segment": alternate_segment,
            }

        return {
            "devices": devices,
            "core_sfp": core_sfp,
            "contexts": contexts,
            "interfaces": interfaces,
            "bindings": bindings,
            "tables": tables,
            "policies": policies,
            "plans": plans,
            "security": {
                "pre": pre_security,
                "post": post_security,
                "app": app_security,
                "core": core_security,
            },
            "nat": {
                "policy": nat_policy,
                "rule": nat_rule,
                "attachment": nat_attachment,
                "pool": pool,
            },
            "segments": {
                "client_core": client_core,
                "core_fw": core_fw,
                "fw_app": fw_app,
                "extra": extra_path,
            },
            "alternate": alternate,
        }


def selected_local_branch(step):
    branch_number = int(step["selected_execution_branch_id"].rsplit("-", 1)[1])
    return step["packet_processing_evaluation"]["branches"][branch_number - 1]


def stage(step, kind, occurrence=0):
    matches = [
        item
        for item in selected_local_branch(step)["stage_executions"]
        if item["stage_kind"] == kind
    ]
    return matches[occurrence]


def stage_kinds(step):
    return [
        item["stage_kind"]
        for item in selected_local_branch(step)["stage_executions"]
        if item["stage_kind"] != "TERMINATE"
    ]


def test_s0_realistic_reference_network_is_delivered_with_exact_evidence():
    fixture = build_reference_network()

    response = packet_flow(fixture["contexts"]["CLIENT"].id)
    artifact = response.json()

    assert response.status_code == 200
    assert artifact["result"] == "DELIVERED"
    branch = artifact["branches"][0]
    steps = branch["local_steps"]
    assert len(steps) == 4
    assert [step["context_before"]["routing_context_id"] for step in steps] == [
        str(fixture["contexts"][name].id) for name in ("CLIENT", "CORE", "FW", "APP")
    ]
    assert [step["context_before"]["traffic_class"] for step in steps] == [
        "LOCAL_OUTPUT",
        "TRANSIT",
        "TRANSIT",
        "LOCAL_INPUT",
    ]
    assert stage_kinds(steps[0]) == [
        "ROUTING_POLICY",
        "ROUTE_DECISION",
        "ADJACENCY_L2",
    ]
    assert stage_kinds(steps[1]) == [
        "ROUTING_POLICY",
        "ROUTE_DECISION",
        "ADJACENCY_L2",
    ]
    assert stage_kinds(steps[2]) == [
        "SECURITY",
        "NAT",
        "ROUTING_POLICY",
        "ROUTE_DECISION",
        "SECURITY",
        "ADJACENCY_L2",
    ]
    assert stage_kinds(steps[3]) == ["SECURITY", "LOCAL_DELIVERY"]

    original = stage(steps[2], "SECURITY", 0)
    translated = stage(steps[2], "NAT")
    routed = stage(steps[2], "ROUTE_DECISION")
    post_route = stage(steps[2], "SECURITY", 1)
    app_security = stage(steps[3], "SECURITY")
    assert original["packet_before"] == REFERENCE_PACKET
    assert translated["stage_outcome"] == "TRANSFORMED_EXACT"
    assert translated["packet_before"] == REFERENCE_PACKET
    assert translated["packet_after"] == {
        **REFERENCE_PACKET,
        "destination_ip": "10.20.30.40",
        "destination_port": 8443,
    }
    assert routed["packet_before"] == translated["packet_after"]
    assert post_route["packet_before"] == translated["packet_after"]
    assert steps[3]["context_before"]["packet_state"] == translated["packet_after"]
    assert app_security["packet_before"] == translated["packet_after"]
    assert stage(steps[3], "LOCAL_DELIVERY")["stage_outcome"] == "DELIVERED"
    assert selected_local_branch(steps[3])["terminal_outcome"] == "NETWORK_DELIVERY"
    for current, following in zip(steps, steps[1:]):
        final_state = selected_local_branch(current)["final_state"]
        assert final_state["selected_routing_table_id"] is None
        assert final_state["current_route_resolution_branch"] is None
        assert final_state["direct_egress"] is None
        assert following["context_before"]["packet_state"] == final_state[
            "current_packet_state"
        ]

    projection_response = topology_projection()
    projection = projection_response.json()
    node_objects = {
        ref["entity_id"]
        for node in projection["nodes"]
        for ref in node["source_refs"]
        if ref["entity_type"] == "PhysicalObject"
    }
    assert projection_response.status_code == 200
    assert node_objects == {str(device.id) for device in fixture["devices"].values()}
    assert all(node["kind"] == "NETWORK_DEVICE" for node in projection["nodes"])
    assert str(fixture["core_sfp"].id) not in node_objects
    assert any(
        ref["entity_type"] == "PhysicalObject"
        and ref["entity_id"] == str(fixture["core_sfp"].id)
        for edge in projection["edges"]
        for ref in edge["source_refs"]
    )


def test_s1_firewall_explicit_deny_is_not_delivered():
    fixture = build_reference_network("S1")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "NOT_DELIVERED"
    branch = artifact["branches"][0]
    assert len(branch["local_steps"]) == 3
    denied = stage(branch["local_steps"][2], "SECURITY")
    assert denied["stage_outcome"] == "BLOCKED"
    assert denied["security_attachment_evaluation"]["policy_evaluation"]["result"] == "DROP"


def test_s2_app_deny_proves_attachment_reached_is_not_network_delivery():
    fixture = build_reference_network("S2")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "NOT_DELIVERED"
    branch = artifact["branches"][0]
    assert len(branch["local_steps"]) == 4
    fw_handoff = branch["local_steps"][2]["handoff"]
    assert fw_handoff["outcome"] == "TARGET_ATTACHMENT_REACHED"
    denied = stage(branch["local_steps"][3], "SECURITY")
    assert denied["stage_outcome"] == "BLOCKED"
    assert not any(
        item["stage_kind"] == "LOCAL_DELIVERY"
        for item in selected_local_branch(branch["local_steps"][3])["stage_executions"]
    )


def test_s3_incomplete_plan_attachment_coverage_is_unknown():
    fixture = build_reference_network("S3")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "UNKNOWN"
    branch = artifact["branches"][0]
    assert len(branch["local_steps"]) == 2
    assert branch["local_steps"][1]["plan_selection"]["result"] == "UNKNOWN"
    assert branch["local_steps"][1]["packet_processing_evaluation"] is None


def test_s4_missing_route_in_incomplete_table_is_unknown_not_no_route():
    fixture = build_reference_network("S4")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "UNKNOWN"
    core_step = artifact["branches"][0]["local_steps"][1]
    route = stage(core_step, "ROUTE_DECISION")
    assert route["stage_outcome"] == "UNKNOWN"
    assert route["next_hop_resolution"]["result"] == "UNKNOWN"
    assert "NO_ROUTE" not in {gap["code"] for gap in route["gaps"]}


def test_s5_missing_physical_l2_egress_fact_is_unknown():
    fixture = build_reference_network("S5")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "UNKNOWN"
    core_step = artifact["branches"][0]["local_steps"][1]
    adjacency = stage(core_step, "ADJACENCY_L2")
    assert adjacency["stage_outcome"] == "UNKNOWN"
    assert "L2_EGRESS_RULE_UNKNOWN" in {
        gap["code"]
        for candidate in adjacency["structural_adjacency_evaluation"][
            "candidate_results"
        ]
        for gap in candidate["l2_traversal"]["gaps"]
    }


def test_s6_ambiguous_reachable_targets_with_different_results_are_unknown():
    fixture = build_reference_network("S6")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "UNKNOWN"
    assert {branch["verdict"] for branch in artifact["branches"]} >= {
        "DELIVERED",
        "NOT_DELIVERED",
    }
    expected_targets = {
        str(fixture["bindings"]["fw_outside"].id),
        str(fixture["alternate"]["binding"].id),
    }
    reached = {
        branch["local_steps"][1]["handoff"]["receiving_l3_binding_id"]
        for branch in artifact["branches"]
        if len(branch["local_steps"]) > 1
        and branch["local_steps"][1]["handoff"] is not None
    }
    assert reached == expected_targets
    for branch in artifact["branches"]:
        handoff = branch["local_steps"][1].get("handoff")
        if handoff is None:
            continue
        target = handoff["receiving_l3_binding_id"]
        refs = {
            ref["entity_id"]
            for ref in branch["evidence_refs"]
            if ref["entity_type"] == "L3Binding"
        }
        assert target in refs
        assert not (expected_targets - {target}) & refs


def test_s7_dual_physical_paths_remain_distinct_and_both_deliver():
    fixture = build_reference_network("S7")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "DELIVERED"
    assert len(artifact["branches"]) >= 2
    assert {branch["verdict"] for branch in artifact["branches"]} == {"DELIVERED"}
    selected_l2 = {
        stage(branch["local_steps"][1], "ADJACENCY_L2")["selected_l2_branch_id"]
        for branch in artifact["branches"]
    }
    assert len(selected_l2) >= 2
    connection_sets = {
        frozenset(
            ref["entity_id"]
            for ref in branch["evidence_refs"]
            if ref["entity_type"] == "Connection"
        )
        for branch in artifact["branches"]
    }
    assert len(connection_sets) >= 2


def test_s8_connection_state_is_not_inherited_across_processing_points():
    fixture = build_reference_network("S8")

    artifact = packet_flow(
        fixture["contexts"]["CLIENT"].id, connection_state="ESTABLISHED"
    ).json()

    assert artifact["result"] == "UNKNOWN"
    first, second = artifact["branches"][0]["local_steps"][:2]
    assert first["context_before"]["connection_state"] == "ESTABLISHED"
    assert first["packet_processing_evaluation"]["query"]["connection_state"] == "ESTABLISHED"
    assert second["context_before"]["connection_state"] is None
    assert second["packet_processing_evaluation"]["query"]["connection_state"] is None
    core_security = stage(second, "SECURITY")
    assert core_security["stage_outcome"] == "UNKNOWN"
    assert core_security["security_attachment_evaluation"]["policy_evaluation"][
        "result"
    ] == "UNKNOWN"


def test_s9_constrained_nat_expands_into_exact_downstream_branches():
    fixture = build_reference_network("S9")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "UNKNOWN"
    assert len(artifact["branches"]) == 2
    assert {branch["verdict"] for branch in artifact["branches"]} == {
        "DELIVERED",
        "NOT_DELIVERED",
    }
    translated_destinations = set()
    for branch in artifact["branches"]:
        fw_step = branch["local_steps"][2]
        nat = stage(fw_step, "NAT")
        routing_policy = stage(fw_step, "ROUTING_POLICY")
        assert nat["stage_outcome"] == "TRANSFORMED_CONSTRAINED"
        assert nat["packet_after"] is None
        assert nat["packet_after_constraint"] is not None
        assert routing_policy["stage_outcome"] == "TABLE_SELECTED"
        assert routing_policy["routing_policy_evaluation"] is not None
        translated_destinations.add(routing_policy["packet_before"]["destination_ip"])
        assert "PACKET_CONSTRAINT_UNSUPPORTED" not in {
            gap["code"] for gap in routing_policy["gaps"]
        }
    assert translated_destinations == {"10.20.30.40", "10.20.30.41"}
