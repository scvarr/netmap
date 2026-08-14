import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


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
    entity_type: Literal["ConnectionPoint", "Connection", "ConnectionMember"]
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


class ErrorBody(BaseModel):
    code: Literal["VALIDATION_ERROR", "MODEL_ERROR"]
    message: str
    details: dict[str, Any]


class ErrorResponse(BaseModel):
    error: ErrorBody
