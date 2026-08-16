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
        "RoutingTable",
        "Route",
        "RouteNextHop",
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
    payload: L2BoundaryPayload | L2ContextPayload | L2BindingPayload
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


class ErrorBody(BaseModel):
    code: Literal["VALIDATION_ERROR", "MODEL_ERROR"]
    message: str
    details: dict[str, Any]


class ErrorResponse(BaseModel):
    error: ErrorBody
