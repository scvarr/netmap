from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, IPvAnyAddress, model_validator


class PointMemberAddress(BaseModel):
    point_id: uuid.UUID
    member_index: int = Field(ge=1)


class L1TraceQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: PointMemberAddress = Field(alias="from")
    to: PointMemberAddress


class EvaluationView(BaseModel):
    mode: Literal["CONFIGURED"] = "CONFIGURED"


class ProjectionSourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ref_type: Literal["CANONICAL_FACT"]
    entity_type: str = Field(min_length=1)
    entity_id: uuid.UUID


class TopologyProjectionScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_location_subtrees: list[ProjectionSourceRef]
    include_entities: list[ProjectionSourceRef]


class TopologyProjectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layer: Literal["L1", "L2", "L3"]
    detail_level: Literal["DEVICE"]
    scope: TopologyProjectionScope
    grouping: dict[str, Any] | None = None
    filters: dict[str, Any] | None = None


class TopologyProjectionNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: str
    label: str
    source_refs: list[ProjectionSourceRef]
    attributes: dict[str, Any]
    status: str | None = None


class TopologyProjectionEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    from_node_id: str
    to_node_id: str
    kind: str
    aggregate: bool
    source_refs: list[ProjectionSourceRef]
    attributes: dict[str, Any]
    status: str | None = None


class TopologyProjectionDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    layer: Literal["L1", "L2", "L3"]
    detail_level: Literal["DEVICE"]
    nodes: list[TopologyProjectionNode]
    edges: list[TopologyProjectionEdge]
    gaps: list[str]
    warnings: list[str]


class InterfaceAddressDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    address: IPvAnyAddress
    prefix_length: int = Field(ge=0, le=128)
    source_refs: list[ProjectionSourceRef]


class InterfacePhysicalBindingDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_point_ref: ProjectionSourceRef
    member_index: int = Field(ge=1)
    source_refs: list[ProjectionSourceRef]


class DeviceInterfaceDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interface_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None
    addresses: list[InterfaceAddressDetails]
    l2_binding_count: int = Field(ge=0)
    l3_binding_count: int = Field(ge=0)
    direct_physical_bindings: list[InterfacePhysicalBindingDetails]
    realization_down_count: int = Field(ge=0)
    realization_up_count: int = Field(ge=0)
    source_refs: list[ProjectionSourceRef]


class DeviceDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None


class DeviceDetailsDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    device: DeviceDetails
    interfaces: list[DeviceInterfaceDetails]
    gaps: list[str]
    warnings: list[str]


class CreateNetworkInterfaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)


class CreateNetworkDeviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)
    initial_interface: CreateNetworkInterfaceRequest


class EvidenceRef(BaseModel):
    ref_type: Literal["CANONICAL_FACT"] = "CANONICAL_FACT"
    entity_type: Literal[
        "ConnectionPoint",
        "Connection",
        "ConnectionMember",
        "NetworkInterface",
        "InterfacePhysicalBinding",
        "NetworkInterfaceRealization",
        "L2ForwardingContext",
        "L2Binding",
        "L2IngressRule",
        "L2EgressRule",
        "RoutingContext",
        "L3Binding",
        "InterfaceAddress",
        "RoutingTable",
        "RoutingPolicy",
        "RoutingPolicyRule",
        "Route",
        "RouteNextHop",
        "SecurityPolicy",
        "SecurityRule",
        "SecurityPolicyAttachment",
        "NATPolicy",
        "NATRule",
        "NATPolicyAttachment",
        "NATPool",
        "PacketProcessingPlan",
        "ProcessingStage",
        "ProcessingTransition",
        "ProcessingEntryPoint",
        "PacketProcessingPlanAttachmentSet",
        "PacketProcessingPlanAttachment",
    ]
    entity_id: uuid.UUID


class EvidenceNode(BaseModel):
    id: str
    kind: Literal["STATE"] = "STATE"
    layer: Literal["L1"] = "L1"
    payload: PointMemberAddress
    canonical_refs: list[EvidenceRef]


class EvidenceEdge(BaseModel):
    id: str
    from_node_id: str
    to_node_id: str
    transition_kind: Literal["L1_TRAVERSE"] = "L1_TRAVERSE"
    layer: Literal["L1"] = "L1"
    evidence_refs: list[EvidenceRef]


class TraceGap(BaseModel):
    code: Literal["L1_TOPOLOGY_INCOMPLETE"]
    node_id: str | None = None
    evidence_refs: list[EvidenceRef]


class TraceArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: L1TraceQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l1-traversal/1.0"] = "l1-traversal/1.0"
    verdict: Literal["REACHABLE", "UNREACHABLE", "UNKNOWN"]
    nodes: list[EvidenceNode]
    edges: list[EvidenceEdge]
    evidence_refs: list[EvidenceRef]
    gaps: list[TraceGap]
    warnings: list[dict[str, Any]]


class InterfacePhysicalTraceQuery(BaseModel):
    from_interface_id: uuid.UUID
    to_interface_id: uuid.UUID


class RealizationCandidateStep(BaseModel):
    realization_id: uuid.UUID
    upper_interface_id: uuid.UUID
    lower_interface_id: uuid.UUID


class PhysicalBindingCandidate(BaseModel):
    candidate_id: str
    root_interface_id: uuid.UUID
    binding_id: uuid.UUID
    interface_id: uuid.UUID
    point: PointMemberAddress
    realization_path: list[RealizationCandidateStep]


class InterfaceStatePayload(BaseModel):
    interface_id: uuid.UUID


class InterfaceTraceNode(BaseModel):
    id: str
    kind: Literal["STATE"] = "STATE"
    layer: Literal["INTERFACE", "L1"]
    payload: InterfaceStatePayload | PointMemberAddress
    canonical_refs: list[EvidenceRef]


class InterfaceTraceEdge(BaseModel):
    id: str
    from_node_id: str
    to_node_id: str
    transition_kind: Literal[
        "INTERFACE_REALIZATION_DOWN",
        "INTERFACE_REALIZATION_UP",
        "INTERFACE_PHYSICAL_BIND",
        "L1_TRAVERSE",
    ]
    layer: Literal["INTERFACE", "BRIDGE", "L1"]
    evidence_refs: list[EvidenceRef]


class InterfaceTraceGap(BaseModel):
    code: Literal[
        "INTERFACE_PHYSICAL_BINDING_UNKNOWN",
        "INTERFACE_PHYSICAL_REALIZATION_UNKNOWN",
        "L1_TOPOLOGY_INCOMPLETE",
    ]
    node_id: str | None = None
    evidence_refs: list[EvidenceRef]


class InterfacePhysicalTraceBranch(BaseModel):
    branch_id: str
    source_candidate_id: str
    target_candidate_id: str
    edge_ids: list[str]
    evidence_refs: list[EvidenceRef]


class InterfacePhysicalTraceArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: InterfacePhysicalTraceQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["interface-physical/2.0"] = "interface-physical/2.0"
    verdict: Literal["REACHABLE", "UNKNOWN"]
    source_binding_candidates: list[PhysicalBindingCandidate]
    target_binding_candidates: list[PhysicalBindingCandidate]
    branches: list[InterfacePhysicalTraceBranch]
    nodes: list[InterfaceTraceNode]
    edges: list[InterfaceTraceEdge]
    evidence_refs: list[EvidenceRef]
    gaps: list[InterfaceTraceGap]
    warnings: list[dict[str, Any]]


class EncapsulationLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1)
    value: int


class L2BoundaryQuery(BaseModel):
    interface_id: uuid.UUID
    encapsulation_stack: list[EncapsulationLabel]


class L2ReachabilityQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: L2BoundaryQuery = Field(alias="from")
    to: L2BoundaryQuery


class L2BoundaryPayload(BaseModel):
    interface_id: uuid.UUID
    direction: Literal["INGRESS", "EGRESS"]
    encapsulation_stack: list[EncapsulationLabel]


class L2InternalInterfacePayload(BaseModel):
    interface_id: uuid.UUID
    direction: Literal["INGRESS", "EGRESS"]


class L2ContextPayload(BaseModel):
    forwarding_context_id: uuid.UUID
    ingress_binding_id: uuid.UUID


class L2BindingPayload(BaseModel):
    binding_id: uuid.UUID
    interface_id: uuid.UUID
    forwarding_context_id: uuid.UUID


class L2TraceNode(BaseModel):
    id: str
    kind: Literal["STATE"] = "STATE"
    layer: Literal["L2"] = "L2"
    payload: (
        L2BoundaryPayload
        | L2InternalInterfacePayload
        | L2ContextPayload
        | L2BindingPayload
    )
    canonical_refs: list[EvidenceRef]


class L2TraceEdge(BaseModel):
    id: str
    from_node_id: str
    to_node_id: str
    transition_kind: Literal[
        "INGRESS_DECODE",
        "LOCAL_FORWARD",
        "EGRESS_ENCODE",
        "REALIZATION_DOWN",
        "PHYSICAL_TRANSPORT",
        "REALIZATION_UP",
        "INTERNAL_ATTACH",
    ]
    layer: Literal["L2", "INTERFACE", "L1"] = "L2"
    evidence_refs: list[EvidenceRef]


class L2TraceGap(BaseModel):
    code: Literal[
        "L2_INGRESS_RULE_UNKNOWN",
        "L2_INGRESS_AMBIGUOUS",
        "L2_EGRESS_RULE_UNKNOWN",
        "L2_TARGET_CONTEXT_PATH_UNKNOWN",
        "L2_PHYSICAL_TRANSPORT_UNKNOWN",
        "L2_INTERNAL_ATTACHMENT_UNKNOWN",
    ]
    node_id: str | None = None
    evidence_refs: list[EvidenceRef]


class L2ReachabilityTraceBranch(BaseModel):
    branch_id: str
    edge_ids: list[str]
    evidence_refs: list[EvidenceRef]


class L2ReachabilityTraceArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: L2ReachabilityQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l2-configured-multihop/3.0"] = (
        "l2-configured-multihop/3.0"
    )
    verdict: Literal["REACHABLE", "UNKNOWN"]
    branches: list[L2ReachabilityTraceBranch] = Field(default_factory=list)
    nodes: list[L2TraceNode]
    edges: list[L2TraceEdge]
    evidence_refs: list[EvidenceRef]
    gaps: list[L2TraceGap]
    warnings: list[dict[str, Any]]


class RouteDecisionQuery(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID
    destination_ip: IPvAnyAddress


class RouteDecisionBasis(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID
    destination_ip: IPvAnyAddress
    address_family: Literal["IPv4", "IPv6"]
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]


class RouteNextHopCandidate(BaseModel):
    route_next_hop_id: uuid.UUID
    gateway_address: IPvAnyAddress | None = None
    egress_l3_binding_id: uuid.UUID | None = None


class RouteDecisionGap(BaseModel):
    code: Literal["ROUTING_TABLE_INCOMPLETE", "ROUTE_CONFLICTING"]
    evidence_refs: list[EvidenceRef]


class RouteDecisionArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: RouteDecisionQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-selected-table-route-decision/1.0"] = (
        "l3-selected-table-route-decision/1.0"
    )
    result: Literal[
        "FORWARD", "LOCAL", "DISCARD", "NO_ROUTE", "UNKNOWN", "CONFLICTING"
    ]
    decision_basis: RouteDecisionBasis
    selected_route_id: uuid.UUID | None = None
    next_hop_candidates: list[RouteNextHopCandidate]
    evidence_refs: list[EvidenceRef]
    gaps: list[RouteDecisionGap]
    warnings: list[dict[str, Any]]


class NextHopResolutionQuery(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID
    destination_ip: IPvAnyAddress


class L3LookupState(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID
    lookup_address: IPvAnyAddress
    original_destination: IPvAnyAddress
    purpose: Literal["PACKET_DESTINATION", "NEXT_HOP_RESOLUTION"]
    egress_constraint: uuid.UUID | None = None


class L3LookupStep(BaseModel):
    state: L3LookupState
    route_decision_result: Literal[
        "FORWARD",
        "LOCAL",
        "DISCARD",
        "NO_ROUTE",
        "UNKNOWN",
        "CONFLICTING",
        "LOOP_DETECTED",
    ]
    selected_route_id: uuid.UUID | None = None
    selected_route_next_hop_id: uuid.UUID | None = None
    gateway_address: IPvAnyAddress | None = None
    egress_l3_binding_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class DirectEgressState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    egress_l3_binding_id: uuid.UUID
    adjacency_mode: Literal["GATEWAY", "DIRECT_DESTINATION"]
    gateway_address: IPvAnyAddress | None = None
    original_destination: IPvAnyAddress

    @model_validator(mode="after")
    def validate_adjacency_target(self) -> "DirectEgressState":
        if self.adjacency_mode == "GATEWAY" and self.gateway_address is None:
            raise ValueError("GATEWAY direct egress requires gateway_address")
        if (
            self.adjacency_mode == "DIRECT_DESTINATION"
            and self.gateway_address is not None
        ):
            raise ValueError(
                "DIRECT_DESTINATION direct egress forbids gateway_address"
            )
        return self


class NextHopResolutionBranch(BaseModel):
    outcome: Literal[
        "RESOLVED",
        "LOCAL_TERMINAL",
        "DISCARD",
        "NO_ROUTE",
        "UNKNOWN",
        "CONFLICTING",
        "LOOP_DETECTED",
    ]
    lookup_steps: list[L3LookupStep]
    direct_egress: DirectEgressState | None = None
    evidence_refs: list[EvidenceRef]


class NextHopResolutionArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: NextHopResolutionQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-selected-table-next-hop-resolution/1.1"] = (
        "l3-selected-table-next-hop-resolution/1.1"
    )
    result: Literal[
        "RESOLVED",
        "LOCAL_TERMINAL",
        "DISCARD",
        "NO_ROUTE",
        "UNKNOWN",
        "CONFLICTING",
        "LOOP_DETECTED",
    ]
    branches: list[NextHopResolutionBranch]
    evidence_refs: list[EvidenceRef]
    warnings: list[dict[str, Any]]


class AdjacencyCandidatesQuery(BaseModel):
    egress_l3_binding_id: uuid.UUID
    neighbor_target_ip: IPvAnyAddress


class AdjacencyCandidate(BaseModel):
    interface_address_id: uuid.UUID
    target_l3_binding_id: uuid.UUID
    target_network_interface_id: uuid.UUID
    ip_address: IPvAnyAddress


class AdjacencyCandidatesGap(BaseModel):
    code: Literal["INTERFACE_ADDRESS_UNKNOWN"]
    evidence_refs: list[EvidenceRef]


class AdjacencyCandidatesArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: AdjacencyCandidatesQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-structural-adjacency-candidates/1.0"] = (
        "l3-structural-adjacency-candidates/1.0"
    )
    result: Literal["CANDIDATES_FOUND", "UNKNOWN"]
    routing_context_id: uuid.UUID
    candidates: list[AdjacencyCandidate]
    evidence_refs: list[EvidenceRef]
    gaps: list[AdjacencyCandidatesGap]
    warnings: list[dict[str, Any]]


class StructuralAdjacencyQuery(BaseModel):
    egress_l3_binding_id: uuid.UUID
    neighbor_target_ip: IPvAnyAddress


class StructuralL2TraversalArtifact(BaseModel):
    verdict: Literal["REACHABLE", "UNKNOWN"]
    source: L2InternalInterfacePayload
    target: L2InternalInterfacePayload
    branches: list[L2ReachabilityTraceBranch]
    nodes: list[L2TraceNode]
    edges: list[L2TraceEdge]
    evidence_refs: list[EvidenceRef]
    gaps: list[L2TraceGap]


class StructuralAdjacencyCandidateResult(BaseModel):
    identity_candidate: AdjacencyCandidate
    result: Literal["REACHABLE", "UNKNOWN"]
    l2_traversal: StructuralL2TraversalArtifact
    evidence_refs: list[EvidenceRef]


class StructuralAdjacencyArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: StructuralAdjacencyQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-structural-adjacency-proof/1.0"] = (
        "l3-structural-adjacency-proof/1.0"
    )
    result: Literal["REACHABLE", "UNKNOWN"]
    identity_resolution: AdjacencyCandidatesArtifact
    candidate_results: list[StructuralAdjacencyCandidateResult]
    evidence_refs: list[EvidenceRef]
    warnings: list[dict[str, Any]]


class L3ReachabilityTableSelection(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID


class L3ReachabilityQuery(BaseModel):
    origin_l3_binding_id: uuid.UUID
    destination_ip: IPvAnyAddress
    table_selections: list[L3ReachabilityTableSelection]


class L3RoutingState(BaseModel):
    routing_context_id: uuid.UUID
    ingress_l3_binding_id: uuid.UUID | None = None
    destination_ip: IPvAnyAddress


class L3ReachabilityHop(BaseModel):
    routing_state: L3RoutingState
    selected_routing_table_id: uuid.UUID | None = None
    next_hop_resolution: NextHopResolutionArtifact | None = None
    next_hop_branch: NextHopResolutionBranch | None = None
    structural_adjacency: StructuralAdjacencyArtifact | None = None
    adjacency_candidate: StructuralAdjacencyCandidateResult | None = None
    l2_branch_id: str | None = None
    reached_l3_binding_id: uuid.UUID | None = None
    next_routing_context_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class L3ReachabilityBranch(BaseModel):
    branch_id: str
    termination: Literal[
        "TARGET_REACHED",
        "LOCAL_DELIVERY",
        "TABLE_SELECTION_UNKNOWN",
        "ROUTE_DISCARD",
        "NO_ROUTE",
        "ROUTE_UNKNOWN",
        "ROUTE_CONFLICTING",
        "NEXT_HOP_UNRESOLVED",
        "LOOP_DETECTED",
        "STRUCTURAL_ADJACENCY_UNKNOWN",
        "FORWARDING_LOOP",
    ]
    hops: list[L3ReachabilityHop]
    evidence_refs: list[EvidenceRef]


class L3ReachabilityArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: L3ReachabilityQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-configured-multirouter/1.1"] = (
        "l3-configured-multirouter/1.1"
    )
    verdict: Literal["REACHABLE", "UNREACHABLE", "UNKNOWN"]
    branches: list[L3ReachabilityBranch]
    evidence_refs: list[EvidenceRef]
    warnings: list[dict[str, Any]]


class PacketState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    source_ip: IPvAnyAddress | None = None
    destination_ip: IPvAnyAddress | None = None
    ip_protocol: int | None = Field(default=None, ge=0, le=255)
    source_port: int | None = Field(default=None, ge=0, le=65535)
    destination_port: int | None = Field(default=None, ge=0, le=65535)
    icmp_type: int | None = Field(default=None, ge=0, le=255)
    icmp_code: int | None = Field(default=None, ge=0, le=255)


class RoutingTableSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    op: Literal["SELECT_TABLE"]
    routing_table_id: uuid.UUID


class PacketProcessingPlanValidationQuery(BaseModel):
    plan_id: uuid.UUID


class ProcessingStageArtifact(BaseModel):
    stage_id: uuid.UUID
    kind: Literal[
        "ROUTING_POLICY",
        "ROUTE_DECISION",
        "SECURITY",
        "NAT",
        "ADJACENCY_L2",
        "LOCAL_DELIVERY",
        "TERMINATE",
    ]
    payload: dict[str, str]


class ProcessingTransitionArtifact(BaseModel):
    transition_id: uuid.UUID
    from_stage_id: uuid.UUID
    outcome: str
    to_stage_id: uuid.UUID


class ProcessingEntryPointArtifact(BaseModel):
    entry_point_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    stage_id: uuid.UUID


class PacketProcessingPlanValidationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: PacketProcessingPlanValidationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["packet-processing-plan-validation/1.0"] = (
        "packet-processing-plan-validation/1.0"
    )
    result: Literal["VALID"] = "VALID"
    plan_id: uuid.UUID
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    entry_points: list[ProcessingEntryPointArtifact]
    stages: list[ProcessingStageArtifact]
    transitions: list[ProcessingTransitionArtifact]
    evidence_refs: list[EvidenceRef]
    warnings: list[dict[str, Any]]


class PacketProcessingPlanSelectionQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None


class PacketProcessingPlanAttachmentEvaluation(BaseModel):
    attachment_id: uuid.UUID
    plan_id: uuid.UUID
    scope: dict[str, list[str]]
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    evidence_refs: list[EvidenceRef]


class PacketProcessingPlanSelectionGap(BaseModel):
    code: Literal[
        "PLAN_ATTACHMENT_SET_UNKNOWN",
        "PLAN_ATTACHMENT_COVERAGE_INCOMPLETE",
        "PLAN_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "PLAN_SELECTION_CONFLICT",
    ]
    evidence_refs: list[EvidenceRef]


class PacketProcessingPlanSelectionArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: PacketProcessingPlanSelectionQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["packet-processing-plan-selection/1.0"] = (
        "packet-processing-plan-selection/1.0"
    )
    result: Literal[
        "PLAN_SELECTED", "NO_PLAN_CONFIRMED", "UNKNOWN", "CONFLICTING"
    ]
    attachment_set_id: uuid.UUID | None = None
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"] | None = None
    selected_plan_id: uuid.UUID | None = None
    selected_plan_configured_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ] | None = None
    attachment_evaluations: list[PacketProcessingPlanAttachmentEvaluation]
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketProcessingPlanSelectionGap]
    warnings: list[dict[str, Any]]


class RoutingPolicyEvaluationQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    policy_id: uuid.UUID
    routing_context_id: uuid.UUID
    packet_state: PacketState
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"] | None = None
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None


class RoutingPolicyRuleEvaluationStep(BaseModel):
    rule_id: uuid.UUID
    order_key: int
    predicate_result: Literal["TRUE", "FALSE", "UNKNOWN"]
    branch_assumption: Literal["MATCH", "NO_MATCH"]
    evidence_refs: list[EvidenceRef]


class RoutingPolicyEvaluationBranch(BaseModel):
    branch_id: str
    steps: list[RoutingPolicyRuleEvaluationStep]
    terminal_source: Literal["RULE", "DEFAULT"]
    terminal_rule_id: uuid.UUID | None = None
    selection: RoutingTableSelection
    selected_routing_table_id: uuid.UUID
    evidence_refs: list[EvidenceRef]


class RoutingPolicyEvaluationGap(BaseModel):
    code: Literal[
        "ROUTING_POLICY_INCOMPLETE",
        "ROUTING_TABLE_SELECTION_UNKNOWN",
    ]
    evidence_refs: list[EvidenceRef]


class RoutingPolicyEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: RoutingPolicyEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["routing-policy-configured/1.1"] = (
        "routing-policy-configured/1.1"
    )
    result: Literal["TABLE_SELECTED", "TABLE_SELECTION_UNKNOWN"]
    policy_id: uuid.UUID
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    routing_context_id: uuid.UUID
    address_family: Literal["IPv4", "IPv6"]
    selected_routing_table_id: uuid.UUID | None = None
    branches: list[RoutingPolicyEvaluationBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[RoutingPolicyEvaluationGap]
    warnings: list[dict[str, Any]]


class PacketProcessingEvaluationQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    plan_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    routing_context_id: uuid.UUID
    packet_state: PacketState
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None


class PacketProcessingFlowState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    original_packet_state: PacketState
    current_packet_state: PacketState | None = None
    current_packet_constraint: NATPacketConstraint | None = None
    current_packet_unknown: bool = False
    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None
    selected_routing_table_id: uuid.UUID | None = None
    current_route_resolution_branch: NextHopResolutionBranch | None = None
    direct_egress: DirectEgressState | None = None
    current_stage_id: uuid.UUID

    @model_validator(mode="after")
    def validate_packet_value(self) -> "PacketProcessingFlowState":
        active = sum(
            (
                self.current_packet_state is not None,
                self.current_packet_constraint is not None,
                self.current_packet_unknown,
            )
        )
        if active != 1:
            raise ValueError("Flow state requires exactly one current packet value")
        return self


class PacketProcessingExecutionGap(BaseModel):
    code: Literal[
        "PROCESSING_PLAN_INCOMPLETE",
        "STAGE_PRECONDITION_UNKNOWN",
        "NEXT_HOP_RESOLUTION_LOOP",
        "SECURITY_STAGE_UNKNOWN",
        "NAT_STAGE_UNKNOWN",
        "PACKET_CONSTRAINT_UNSUPPORTED",
        "PACKET_CONSTRAINT_EXPANSION_LIMIT",
        "PACKET_STATE_UNKNOWN",
        "STRUCTURAL_ADJACENCY_UNKNOWN",
    ]
    stage_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class PacketProcessingHandoff(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    outcome: Literal["NEXT_PROCESSING_POINT", "TARGET_ATTACHMENT_REACHED"]
    receiving_network_interface_id: uuid.UUID
    receiving_l3_binding_id: uuid.UUID
    receiving_routing_context_id: uuid.UUID


class PacketProcessingLocalDelivery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    result: Literal["DELIVERED", "UNKNOWN"]
    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    reason: Literal["LOCAL_INPUT_CONTEXT", "STAGE_PRECONDITION_UNKNOWN"]


class PacketProcessingStageExecution(BaseModel):
    stage_id: uuid.UUID
    stage_kind: Literal[
        "ROUTING_POLICY",
        "ROUTE_DECISION",
        "SECURITY",
        "NAT",
        "ADJACENCY_L2",
        "LOCAL_DELIVERY",
        "TERMINATE",
    ]
    packet_before: PacketState | None = None
    packet_before_constraint: NATPacketConstraint | None = None
    packet_before_unknown: bool = False
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    packet_after_unknown: bool = False
    traffic_class_before: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    traffic_class_after: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    selected_routing_table_id_before: uuid.UUID | None = None
    selected_routing_table_id_after: uuid.UUID | None = None
    stage_outcome: str
    transition_id: uuid.UUID | None = None
    next_stage_id: uuid.UUID | None = None
    routing_policy_evaluation: RoutingPolicyEvaluationArtifact | None = None
    next_hop_resolution: NextHopResolutionArtifact | None = None
    selected_next_hop_branch_index: int | None = None
    direct_egress: DirectEgressState | None = None
    security_attachment_evaluation: SecurityAttachmentStageArtifact | None = None
    nat_attachment_evaluation: NATAttachmentStageArtifact | None = None
    adjacency_target_ip: IPvAnyAddress | None = None
    structural_adjacency_evaluation: StructuralAdjacencyArtifact | None = None
    selected_adjacency_candidate: AdjacencyCandidate | None = None
    selected_l2_branch_id: str | None = None
    handoff: PacketProcessingHandoff | None = None
    local_delivery: PacketProcessingLocalDelivery | None = None
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketProcessingExecutionGap]

    @model_validator(mode="after")
    def validate_packet_values(self) -> "PacketProcessingStageExecution":
        before_active = sum(
            (
                self.packet_before is not None,
                self.packet_before_constraint is not None,
                self.packet_before_unknown,
            )
        )
        after_active = sum(
            (
                self.packet_after is not None,
                self.packet_after_constraint is not None,
                self.packet_after_unknown,
            )
        )
        if before_active != 1 or after_active != 1:
            raise ValueError("Stage execution requires one before/after packet value")
        return self


class PacketProcessingExecutionBranch(BaseModel):
    branch_id: str
    initial_state: PacketProcessingFlowState
    stage_executions: list[PacketProcessingStageExecution]
    final_state: PacketProcessingFlowState
    terminal_outcome: Literal[
        "CONTINUE_TO_NEXT_HOP",
        "NETWORK_DELIVERY",
        "NOT_DELIVERED",
        "UNKNOWN",
    ]
    evidence_refs: list[EvidenceRef]


class PacketProcessingEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: PacketProcessingEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["packet-processing-full-local/1.6"] = (
        "packet-processing-full-local/1.6"
    )
    result: Literal[
        "CONTINUE_TO_NEXT_HOP",
        "NETWORK_DELIVERY",
        "NOT_DELIVERED",
        "UNKNOWN",
    ]
    plan_id: uuid.UUID
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    original_packet_state: PacketState
    branches: list[PacketProcessingExecutionBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketProcessingExecutionGap]
    warnings: list[dict[str, Any]]


class PacketFlowEvaluationQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    packet_state: PacketState
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None
    analysis_mode: Literal["EXACT"] = "EXACT"
    max_processing_points: int = Field(default=32, ge=1, le=256)


class PacketFlowContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_state: PacketState
    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None


class PacketFlowGap(BaseModel):
    code: Literal[
        "PLAN_SELECTION_UNRESOLVED",
        "NO_PROCESSING_PLAN_APPLICABLE",
        "PROCESSING_HANDOFF_UNKNOWN",
        "PROCESSING_HANDOFF_PACKET_UNKNOWN",
        "PACKET_FLOW_LOOP_DETECTED",
        "PACKET_FLOW_SEARCH_LIMIT",
    ]
    local_step_sequence: int | None = None
    evidence_refs: list[EvidenceRef]


class PacketFlowLocalStep(BaseModel):
    sequence: int
    context_before: PacketFlowContext
    plan_selection: PacketProcessingPlanSelectionArtifact
    selected_plan_id: uuid.UUID | None = None
    packet_processing_evaluation: PacketProcessingEvaluationArtifact | None = None
    selected_execution_branch_id: str | None = None
    context_after: PacketFlowContext | None = None
    handoff: PacketProcessingHandoff | None = None
    evidence_refs: list[EvidenceRef]


class PacketFlowExecutionBranch(BaseModel):
    branch_id: str
    local_steps: list[PacketFlowLocalStep]
    verdict: Literal["DELIVERED", "NOT_DELIVERED", "UNKNOWN"]
    termination_reason: Literal[
        "NETWORK_DELIVERY",
        "NOT_DELIVERED",
        "LOCAL_EXECUTION_UNKNOWN",
        "PLAN_SELECTION_UNKNOWN",
        "PLAN_SELECTION_CONFLICTING",
        "NO_PROCESSING_PLAN_APPLICABLE",
        "PROCESSING_HANDOFF_UNKNOWN",
        "PROCESSING_HANDOFF_PACKET_UNKNOWN",
        "PACKET_FLOW_LOOP_DETECTED",
        "PACKET_FLOW_SEARCH_LIMIT",
    ]
    final_context: PacketFlowContext | None = None
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketFlowGap]


class PacketFlowEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: PacketFlowEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["packet-flow-configured/1.0"] = (
        "packet-flow-configured/1.0"
    )
    result: Literal["DELIVERED", "NOT_DELIVERED", "UNKNOWN"]
    original_packet_state: PacketState
    branches: list[PacketFlowExecutionBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketFlowGap]
    warnings: list[dict[str, Any]]


class ConnectionState(StrEnum):
    NEW = "NEW"
    ESTABLISHED = "ESTABLISHED"
    RELATED = "RELATED"
    INVALID = "INVALID"
    UNKNOWN = "UNKNOWN"


class SecurityPolicyEvaluationQuery(BaseModel):
    policy_id: uuid.UUID
    packet_state: PacketState


class SecurityRuleEvaluationStep(BaseModel):
    rule_id: uuid.UUID
    order_key: int
    predicate_result: Literal["TRUE", "FALSE", "UNKNOWN"]
    branch_assumption: Literal["MATCH", "NO_MATCH"]
    evidence_refs: list[EvidenceRef]


class SecurityEvaluationBranch(BaseModel):
    branch_id: str
    steps: list[SecurityRuleEvaluationStep]
    terminal_action: Literal["PERMIT", "DROP", "REJECT"]
    terminal_source: Literal["RULE", "DEFAULT"]
    terminal_rule_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class SecurityEvaluationGap(BaseModel):
    code: Literal["SECURITY_POLICY_INCOMPLETE"]
    evidence_refs: list[EvidenceRef]


class SecurityPolicyEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: SecurityPolicyEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["security-configured-policy/1.0"] = (
        "security-configured-policy/1.0"
    )
    result: Literal["PERMIT", "DROP", "REJECT", "UNKNOWN"]
    policy_id: uuid.UUID
    default_action: Literal["PERMIT", "DROP", "REJECT"]
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    branches: list[SecurityEvaluationBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[SecurityEvaluationGap]
    warnings: list[dict[str, Any]]


class SecurityAttachmentStageGap(BaseModel):
    code: Literal[
        "SECURITY_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "SECURITY_POLICY_EVALUATION_UNKNOWN",
    ]
    evidence_refs: list[EvidenceRef]


class SecurityAttachmentStageArtifact(BaseModel):
    schema_version: Literal[1] = 1
    evaluation_view: EvaluationView
    resolver_version: Literal["security-configured-attachment/1.0"] = (
        "security-configured-attachment/1.0"
    )
    context: SecurityEvaluationContext
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    stage_order: int
    scope: dict[str, list[str]]
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    result: Literal["PASS", "BLOCKED", "UNKNOWN"]
    reason: Literal[
        "ATTACHMENT_NOT_APPLICABLE",
        "POLICY_PERMIT",
        "POLICY_DROP",
        "POLICY_REJECT",
        "ATTACHMENT_APPLICABILITY_COLLAPSED_PERMIT",
        "SECURITY_UNCERTAINTY",
    ]
    policy_evaluation: SecurityPolicyEvaluationArtifact | None = None
    evidence_refs: list[EvidenceRef]
    gaps: list[SecurityAttachmentStageGap]
    warnings: list[dict[str, Any]]


class SecurityEvaluationContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_state: PacketState
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    routing_context_id: uuid.UUID | None = None
    ingress_network_interface_id: uuid.UUID | None = None
    egress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    egress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None


class SecurityEvaluationQuery(BaseModel):
    context: SecurityEvaluationContext
    configured_attachment_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ]


class SecurityAttachmentEvaluation(BaseModel):
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    stage_order: int
    scope: dict[str, list[str]]
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    policy_evaluation: SecurityPolicyEvaluationArtifact | None = None
    evidence_refs: list[EvidenceRef]


class SecurityStageEvaluationGap(BaseModel):
    code: Literal[
        "SECURITY_ATTACHMENT_COVERAGE_INCOMPLETE",
        "SECURITY_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "SECURITY_POLICY_EVALUATION_UNKNOWN",
    ]
    attachment_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class SecurityEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: SecurityEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["security-configured-stages/1.0"] = (
        "security-configured-stages/1.0"
    )
    context: SecurityEvaluationContext
    configured_attachment_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ]
    result: Literal["PASS", "BLOCKED", "UNKNOWN"]
    reason: Literal[
        "NO_POLICY_APPLICABLE",
        "ALL_APPLICABLE_POLICIES_PERMIT",
        "POLICY_DROP",
        "POLICY_REJECT",
        "SECURITY_UNCERTAINTY",
    ]
    attachment_evaluations: list[SecurityAttachmentEvaluation]
    evidence_refs: list[EvidenceRef]
    gaps: list[SecurityStageEvaluationGap]
    warnings: list[dict[str, Any]]


class NATPolicyEvaluationQuery(BaseModel):
    policy_id: uuid.UUID
    packet_state: PacketState


class NATIPAddressRange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    start: IPvAnyAddress
    end: IPvAnyAddress

    @model_validator(mode="after")
    def validate_range(self) -> "NATIPAddressRange":
        if self.start.version != self.end.version or int(self.start) > int(self.end):
            raise ValueError("NAT IP constraint range is invalid")
        return self


class NATPortRange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    start: int = Field(ge=0, le=65535, strict=True)
    end: int = Field(ge=0, le=65535, strict=True)

    @model_validator(mode="after")
    def validate_range(self) -> "NATPortRange":
        if self.start > self.end:
            raise ValueError("NAT port constraint range is invalid")
        return self


class NATPacketConstraint(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_base: PacketState
    source_ip_ranges: list[NATIPAddressRange] | None = None
    destination_ip_ranges: list[NATIPAddressRange] | None = None
    source_port_ranges: list[NATPortRange] | None = None
    destination_port_ranges: list[NATPortRange] | None = None

    @model_validator(mode="after")
    def validate_has_constraint(self) -> "NATPacketConstraint":
        if not any(
            (
                self.source_ip_ranges,
                self.destination_ip_ranges,
                self.source_port_ranges,
                self.destination_port_ranges,
            )
        ):
            raise ValueError("NATPacketConstraint requires a constrained field")
        return self


class NATTransformApplication(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    result: Literal["IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED"]
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    nat_pool_ids: list[uuid.UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_output_shape(self) -> "NATTransformApplication":
        if self.result == "TRANSFORMED_CONSTRAINED":
            if self.packet_after is not None or self.packet_after_constraint is None:
                raise ValueError("Constrained NAT application requires only a constraint")
        elif self.packet_after is None or self.packet_after_constraint is not None:
            raise ValueError("Exact NAT application requires only packet_after")
        return self


class NATRuleEvaluationStep(BaseModel):
    rule_id: uuid.UUID
    order_key: int
    predicate_result: Literal["TRUE", "FALSE", "UNKNOWN"]
    branch_assumption: Literal["MATCH", "NO_MATCH"]
    evidence_refs: list[EvidenceRef]


class NATPolicyEvaluationBranch(BaseModel):
    branch_id: str
    steps: list[NATRuleEvaluationStep]
    terminal_source: Literal["RULE", "DEFAULT"]
    terminal_rule_id: uuid.UUID | None = None
    selected_transform: dict[str, Any]
    transform_result: Literal[
        "IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED"
    ]
    packet_before: PacketState
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    evidence_refs: list[EvidenceRef]


class NATPolicyEvaluationGap(BaseModel):
    code: Literal["NAT_POLICY_INCOMPLETE", "NAT_TRANSLATION_UNKNOWN"]
    evidence_refs: list[EvidenceRef]


class NATPolicyEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: NATPolicyEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["nat-configured-policy/1.0"] = (
        "nat-configured-policy/1.0"
    )
    result: Literal[
        "IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED", "UNKNOWN"
    ]
    policy_id: uuid.UUID
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    packet_before: PacketState
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    branches: list[NATPolicyEvaluationBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[NATPolicyEvaluationGap]
    warnings: list[dict[str, Any]]


class NATAttachmentStageGap(BaseModel):
    code: Literal[
        "NAT_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "NAT_POLICY_EVALUATION_UNKNOWN",
        "NAT_TRANSLATION_UNKNOWN",
    ]
    evidence_refs: list[EvidenceRef]


class NATAttachmentStageArtifact(BaseModel):
    schema_version: Literal[1] = 1
    evaluation_view: EvaluationView
    resolver_version: Literal["nat-configured-attachment/1.0"] = (
        "nat-configured-attachment/1.0"
    )
    context: NATEvaluationContext
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    local_stage_order: int
    scope: dict[str, list[str]]
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    result: Literal[
        "IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED", "UNKNOWN"
    ]
    reason: Literal[
        "ATTACHMENT_NOT_APPLICABLE",
        "POLICY_IDENTITY",
        "POLICY_TRANSFORMED_EXACT",
        "POLICY_TRANSFORMED_CONSTRAINED",
        "ATTACHMENT_APPLICABILITY_COLLAPSED_IDENTITY",
        "NAT_UNCERTAINTY",
    ]
    packet_before: PacketState
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    policy_evaluation: NATPolicyEvaluationArtifact | None = None
    evidence_refs: list[EvidenceRef]
    gaps: list[NATAttachmentStageGap]
    warnings: list[dict[str, Any]]

    @model_validator(mode="after")
    def validate_output(self) -> "NATAttachmentStageArtifact":
        if self.result in {"IDENTITY", "TRANSFORMED_EXACT"}:
            if self.packet_after is None or self.packet_after_constraint is not None:
                raise ValueError("Exact NAT stage result requires only packet_after")
        elif self.result == "TRANSFORMED_CONSTRAINED":
            if self.packet_after is not None or self.packet_after_constraint is None:
                raise ValueError("Constrained NAT stage requires only constraint output")
        elif self.packet_after is not None or self.packet_after_constraint is not None:
            raise ValueError("Unknown NAT stage must not expose an output representative")
        if self.result == "IDENTITY" and self.packet_after != self.packet_before:
            raise ValueError("Identity NAT stage must preserve packet")
        return self


class NATEvaluationContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_state: PacketState
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    routing_context_id: uuid.UUID | None = None
    ingress_network_interface_id: uuid.UUID | None = None
    egress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    egress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None


class NATEvaluationQuery(BaseModel):
    context: NATEvaluationContext
    configured_attachment_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ]


class NATStageExecution(BaseModel):
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    local_stage_order: int
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    branch_assumption: Literal["APPLY", "SKIP"]
    executed: bool
    policy_evaluation: NATPolicyEvaluationArtifact | None = None
    packet_before: PacketState
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    evidence_refs: list[EvidenceRef]


class NATExecutionBranch(BaseModel):
    branch_id: str
    initial_packet: PacketState
    stage_executions: list[NATStageExecution]
    final_packet: PacketState | None = None
    termination: Literal[
        "COMPLETED",
        "NAT_POLICY_EVALUATION_UNKNOWN",
        "NAT_STAGE_ORDER_AMBIGUOUS",
        "NAT_CONSTRAINED_OUTPUT",
    ]
    evidence_refs: list[EvidenceRef]


class NATEvaluationGap(BaseModel):
    code: Literal[
        "NAT_ATTACHMENT_COVERAGE_INCOMPLETE",
        "NAT_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "NAT_POLICY_EVALUATION_UNKNOWN",
        "NAT_STAGE_ORDER_AMBIGUOUS",
        "NAT_TRANSLATION_UNKNOWN",
        "NAT_CONSTRAINED_OUTPUT",
    ]
    attachment_id: uuid.UUID | None = None
    competing_attachment_ids: list[uuid.UUID] = Field(default_factory=list)
    evidence_refs: list[EvidenceRef]


class NATEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: NATEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["nat-configured-stages/1.0"] = (
        "nat-configured-stages/1.0"
    )
    context: NATEvaluationContext
    configured_attachment_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ]
    result: Literal["IDENTITY", "TRANSFORMED_EXACT", "UNKNOWN"]
    reason: Literal[
        "NO_NAT_POLICY_APPLICABLE",
        "NAT_STAGES_IDENTITY",
        "NAT_STAGES_TRANSFORMED",
        "NAT_UNCERTAINTY",
    ]
    packet_before: PacketState
    packet_after: PacketState | None = None
    branches: list[NATExecutionBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[NATEvaluationGap]
    warnings: list[dict[str, Any]]


class ErrorBody(BaseModel):
    code: Literal["VALIDATION_ERROR", "MODEL_ERROR"]
    message: str
    details: dict[str, Any]


class ErrorResponse(BaseModel):
    error: ErrorBody
