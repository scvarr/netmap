from app.repository import CanonicalRepository, PointMember
from app.schemas import (
    EvaluationView,
    EvidenceEdge,
    EvidenceNode,
    EvidenceRef,
    L1TraceQuery,
    PointMemberAddress,
    TraceArtifact,
)


class L1Resolver:
    VERSION = "l1-direct/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve_direct(
        self, query: L1TraceQuery, evaluation_view: EvaluationView
    ) -> TraceArtifact:
        source = PointMember(query.from_.point_id, query.from_.member_index)
        target = PointMember(query.to.point_id, query.to.member_index)
        self.repository.validate_point_member(source)
        self.repository.validate_point_member(target)

        matching_edges = [
            edge
            for edge in self.repository.get_l1_adjacency([source])[source]
            if edge.peer_point_id == target.point_id and edge.peer_member == target.member_index
        ]

        source_node_id = self._node_id(source)
        target_node_id = self._node_id(target)
        nodes = [self._node(source, source_node_id)]
        if target != source:
            nodes.append(self._node(target, target_node_id))

        artifact_edges: list[EvidenceEdge] = []
        evidence_refs: list[EvidenceRef] = []
        seen_refs: set[tuple[str, str]] = set()
        for edge in matching_edges:
            refs = [
                EvidenceRef(entity_type="Connection", entity_id=edge.connection_id),
                EvidenceRef(
                    entity_type="ConnectionMember", entity_id=edge.connection_member_id
                ),
            ]
            artifact_edges.append(
                EvidenceEdge(
                    id=f"l1-edge:{edge.connection_member_id}",
                    from_node_id=source_node_id,
                    to_node_id=target_node_id,
                    evidence_refs=refs,
                )
            )
            for ref in refs:
                key = (ref.entity_type, str(ref.entity_id))
                if key not in seen_refs:
                    seen_refs.add(key)
                    evidence_refs.append(ref)

        return TraceArtifact(
            query=query,
            evaluation_view=evaluation_view,
            verdict="REACHABLE" if artifact_edges else "UNREACHABLE",
            nodes=nodes,
            edges=artifact_edges,
            evidence_refs=evidence_refs,
            gaps=[],
            warnings=[],
        )

    @staticmethod
    def _node_id(address: PointMember) -> str:
        return f"l1-state:{address.point_id}:{address.member_index}"

    @staticmethod
    def _node(address: PointMember, node_id: str) -> EvidenceNode:
        return EvidenceNode(
            id=node_id,
            payload=PointMemberAddress(
                point_id=address.point_id, member_index=address.member_index
            ),
            canonical_refs=[
                EvidenceRef(entity_type="ConnectionPoint", entity_id=address.point_id)
            ],
        )

