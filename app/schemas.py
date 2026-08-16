import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, IPvAnyAddress


class PointMemberAddress(BaseModel):
    point_id: uuid.UUID
    member_index: int = Field(ge=1)


class L1TraceQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: PointMemberAddress = Field(alias="from")
    to: PointMemberAddress


class EvaluationView(BaseModel):
    mode: Literal["CONFIGURED"] = "CONFIGURED"


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
        "Route",
        "RouteNextHop",
        "SecurityPolicy",
        "SecurityRule",
        "SecurityPolicyAttachment",
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
    egress_l3_binding_id: uuid.UUID
    neighbor_target_ip: IPvAnyAddress
    original_destination: IPvAnyAddress


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
    resolver_version: Literal["l3-selected-table-next-hop-resolution/1.0"] = (
        "l3-selected-table-next-hop-resolution/1.0"
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
    resolver_version: Literal["l3-configured-multirouter/1.0"] = (
        "l3-configured-multirouter/1.0"
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


class SecurityEvaluationContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_state: PacketState
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    routing_context_id: uuid.UUID | None = None
    ingress_network_interface_id: uuid.UUID | None = None
    egress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    egress_l3_binding_id: uuid.UUID | None = None


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


class ErrorBody(BaseModel):
    code: Literal["VALIDATION_ERROR", "MODEL_ERROR"]
    message: str
    details: dict[str, Any]


class ErrorResponse(BaseModel):
    error: ErrorBody
