from dataclasses import dataclass

from app.repository import CanonicalRepository, L1AdjacencyEdge, PointMember
from app.schemas import (
    EvaluationView,
    EvidenceEdge,
    EvidenceNode,
    EvidenceRef,
    L1TraceQuery,
    PointMemberAddress,
    TraceArtifact,
    TraceGap,
)


@dataclass(frozen=True)
class TraversalStep:
    source: PointMember
    target: PointMember
    edge: L1AdjacencyEdge


class L1Resolver:
    VERSION = "l1-traversal/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: L1TraceQuery, evaluation_view: EvaluationView
    ) -> TraceArtifact:
        source = PointMember(query.from_.point_id, query.from_.member_index)
        target = PointMember(query.to.point_id, query.to.member_index)
        self.repository.validate_point_member(source)
        self.repository.validate_point_member(target)

        predecessors, discovery_order = self._traverse(source, target)
        if target == source or target in predecessors:
            steps = self._path(source, target, predecessors)
            return self._artifact(query, evaluation_view, steps, "REACHABLE")

        exploration_steps = [
            TraversalStep(parent, state, edge)
            for state in discovery_order
            if state != source
            for parent, edge in [predecessors[state]]
        ]
        return self._artifact(
            query,
            evaluation_view,
            exploration_steps,
            "UNKNOWN",
            gaps=[
                TraceGap(
                    code="L1_TOPOLOGY_INCOMPLETE",
                    node_id=self._node_id(source),
                    evidence_refs=[],
                )
            ],
        )

    def _traverse(
        self, source: PointMember, target: PointMember
    ) -> tuple[
        dict[PointMember, tuple[PointMember, L1AdjacencyEdge]], list[PointMember]
    ]:
        visited = {source}
        frontier = [source]
        predecessors: dict[PointMember, tuple[PointMember, L1AdjacencyEdge]] = {}
        discovery_order = [source]

        while frontier:
            adjacency = self.repository.get_l1_adjacency(frontier)
            next_frontier: list[PointMember] = []
            for current in frontier:
                for edge in adjacency[current]:
                    peer = PointMember(edge.peer_point_id, edge.peer_member)
                    if peer in visited:
                        continue
                    visited.add(peer)
                    predecessors[peer] = (current, edge)
                    discovery_order.append(peer)
                    if peer == target:
                        return predecessors, discovery_order
                    next_frontier.append(peer)
            frontier = next_frontier

        return predecessors, discovery_order

    @staticmethod
    def _path(
        source: PointMember,
        target: PointMember,
        predecessors: dict[PointMember, tuple[PointMember, L1AdjacencyEdge]],
    ) -> list[TraversalStep]:
        steps: list[TraversalStep] = []
        current = target
        while current != source:
            parent, edge = predecessors[current]
            steps.append(TraversalStep(parent, current, edge))
            current = parent
        steps.reverse()
        return steps

    def _artifact(
        self,
        query: L1TraceQuery,
        evaluation_view: EvaluationView,
        steps: list[TraversalStep],
        verdict: str,
        gaps: list[TraceGap] | None = None,
    ) -> TraceArtifact:
        source = PointMember(query.from_.point_id, query.from_.member_index)
        states = [source]
        states.extend(step.target for step in steps)
        if verdict == "UNKNOWN":
            target = PointMember(query.to.point_id, query.to.member_index)
            if target not in states:
                states.append(target)

        nodes = [self._node(state, self._node_id(state)) for state in states]
        artifact_edges: list[EvidenceEdge] = []
        evidence_refs: list[EvidenceRef] = []
        seen_refs: set[tuple[str, str]] = set()
        for step in steps:
            refs = [
                EvidenceRef(entity_type="Connection", entity_id=step.edge.connection_id),
                EvidenceRef(
                    entity_type="ConnectionMember",
                    entity_id=step.edge.connection_member_id,
                ),
            ]
            artifact_edges.append(
                EvidenceEdge(
                    id=f"l1-edge:{step.edge.connection_member_id}",
                    from_node_id=self._node_id(step.source),
                    to_node_id=self._node_id(step.target),
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
            verdict=verdict,
            nodes=nodes,
            edges=artifact_edges,
            evidence_refs=evidence_refs,
            gaps=gaps or [],
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
