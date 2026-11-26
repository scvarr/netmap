from dataclasses import dataclass
from typing import Literal

from app.errors import ModelError, ValidationError
from app.repository import CanonicalRepository, L1AdjacencyEdge, PointMember
from app.schemas import (
    EvaluationView,
    EvidenceEdge,
    EvidenceNode,
    EvidenceRef,
    L1TraceGroupArtifact,
    L1TraceGroupQuery,
    L1TraceQuery,
    L1TraceTermination,
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
    VERSION = "l1-traversal/2.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: L1TraceQuery, evaluation_view: EvaluationView, *,
        localize_model_errors: bool = False,
    ) -> TraceArtifact:
        source = PointMember(query.from_.point_id, query.from_.member_index)
        target = PointMember(query.to.point_id, query.to.member_index)
        self.repository.validate_point_member(source)
        self.repository.validate_point_member(target)
        reached, predecessors, closures, terminations = self._traverse(
            source, target, localize_model_errors=localize_model_errors
        )
        if reached:
            steps = self._path(source, target, predecessors)
        else:
            steps = [*predecessors.values(), *closures]

        states = dict.fromkeys([source, *(step.target for step in steps)])
        nodes = [
            EvidenceNode(
                id=self._node_id(state),
                payload=PointMemberAddress(point_id=state.point_id, member_index=state.member_index),
                canonical_refs=[EvidenceRef(entity_type="ConnectionPoint", entity_id=state.point_id)],
            )
            for state in states
        ]
        edges = [self.evidence_edge(step) for step in steps]
        refs = {
            (ref.entity_type, ref.entity_id): ref
            for ref in [
                *(ref for node in nodes for ref in node.canonical_refs),
                *(ref for edge in edges for ref in edge.evidence_refs),
            ]
        }
        return TraceArtifact(
            query=query,
            evaluation_view=evaluation_view,
            verdict="REACHABLE" if reached else "UNKNOWN",
            nodes=nodes,
            edges=edges,
            evidence_refs=list(refs.values()),
            gaps=[] if reached else [
                TraceGap(code="L1_TOPOLOGY_INCOMPLETE", node_id=end.node_id, evidence_refs=[])
                for end in terminations
            ],
            warnings=[],
            terminations=terminations,
        )

    def resolve_group(
        self, query: L1TraceGroupQuery, evaluation_view: EvaluationView
    ) -> L1TraceGroupArtifact:
        sources = set()
        targets = set()
        for index, pair in enumerate(query.expected_pairs):
            source = (pair.from_.point_id, pair.from_.member_index)
            target = (pair.to.point_id, pair.to.member_index)
            if source == target or source in sources or target in targets:
                raise ValidationError(
                    "Expected L1 pairs must map distinct endpoints one-to-one",
                    {"pair_index": index},
                )
            sources.add(source)
            targets.add(target)

        results = [
            self.resolve(pair, evaluation_view, localize_model_errors=True)
            for pair in query.expected_pairs
        ]
        confirmed = sum(result.verdict == "REACHABLE" for result in results)
        completeness: Literal["COMPLETE", "PARTIAL", "UNCONFIRMED"] = "UNCONFIRMED"
        if confirmed == len(results):
            completeness = "COMPLETE"
        elif confirmed:
            completeness = "PARTIAL"
        return L1TraceGroupArtifact(completeness=completeness, results=results)

    def _traverse(
        self, source: PointMember, target: PointMember | None, *,
        localize_model_errors: bool = False,
    ) -> tuple[
        bool,
        dict[PointMember, TraversalStep],
        list[TraversalStep],
        list[L1TraceTermination],
    ]:
        predecessors: dict[PointMember, TraversalStep] = {}
        traversed_members = set()
        terminal_members: set[PointMember] = set()
        closures: list[TraversalStep] = []
        terminations: list[L1TraceTermination] = []
        frontier = [source]
        for current in frontier:
            node_id = self._node_id(current)
            try:
                active, edges = self.repository.get_l1_member_links(current)
            except ModelError as error:
                if not localize_model_errors:
                    raise
                terminal_members.add(current)
                terminations.append(L1TraceTermination(
                    node_id=node_id,
                    reason="INVALID_CANONICAL_DATA",
                    details={"message": error.message, **error.details},
                ))
                continue

            if current == target:
                return True, predecessors, [], [
                    L1TraceTermination(node_id=node_id, reason="EXPECTED_MEMBER")
                ]

            arrival = predecessors.get(current)
            if active:
                terminal_members.add(current)
            if arrival is not None and active:
                terminations.append(L1TraceTermination(node_id=node_id, reason="OTHER_ENDING"))
                continue

            if arrival is not None:
                edges = [
                    edge for edge in edges
                    if edge.external != arrival.edge.external
                ]
            if not edges:
                reason: Literal[
                    "NO_CONNECTION", "MISSING_EXTERNAL_CONNECTION", "MISSING_INTERNAL_CONTINUITY", "OTHER_ENDING"
                ] = "NO_CONNECTION"
                if arrival is not None and target is not None and current.point_id == target.point_id:
                    reason = "OTHER_ENDING"
                elif arrival is not None:
                    reason = (
                        "MISSING_INTERNAL_CONTINUITY" if arrival.edge.external
                        else "MISSING_EXTERNAL_CONNECTION"
                    )
                terminations.append(L1TraceTermination(node_id=node_id, reason=reason))

            for edge in edges:
                if edge.connection_member_id in traversed_members:
                    continue
                traversed_members.add(edge.connection_member_id)
                peer = PointMember(edge.peer_point_id, edge.peer_member)
                step = TraversalStep(current, peer, edge)
                if peer == source or peer in predecessors:
                    closures.append(step)
                    continue
                predecessors[peer] = step
                frontier.append(peer)

        cycles = [
            step for step in closures
            if all(hop.source not in terminal_members for hop in self._cycle_steps(step, predecessors))
        ]
        terminations.extend(
            L1TraceTermination(node_id=self._node_id(step.target), reason="CYCLE")
            for step in cycles
        )
        return False, predecessors, cycles, terminations

    def find_cycles(self, source: PointMember) -> list[list[TraversalStep]]:
        _, predecessors, closures, _ = self._traverse(source, None)
        return [self._cycle_steps(step, predecessors) for step in closures]

    def _cycle_steps(
        self,
        closing: TraversalStep,
        predecessors: dict[PointMember, TraversalStep],
    ) -> list[TraversalStep]:
        ancestors = {closing.source}
        ancestor = closing.source
        while ancestor in predecessors:
            ancestor = predecessors[ancestor].source
            ancestors.add(ancestor)
        common = closing.target
        while common not in ancestors:
            common = predecessors[common].source
        forward = self._path(common, closing.source, predecessors)
        reverse = self._path(common, closing.target, predecessors)
        return [
            *forward,
            closing,
            *(TraversalStep(step.target, step.source, step.edge) for step in reversed(reverse)),
        ]

    @staticmethod
    def _path(
        source: PointMember,
        target: PointMember,
        predecessors: dict[PointMember, TraversalStep],
    ) -> list[TraversalStep]:
        steps: list[TraversalStep] = []
        current = target
        while current != source:
            step = predecessors[current]
            steps.append(step)
            current = step.source
        steps.reverse()
        return steps

    @classmethod
    def evidence_edge(cls, step: TraversalStep) -> EvidenceEdge:
        refs = [
            EvidenceRef(entity_type="ConnectionPoint", entity_id=step.source.point_id),
            EvidenceRef(entity_type="ConnectionPoint", entity_id=step.target.point_id),
            EvidenceRef(entity_type="Connection", entity_id=step.edge.connection_id),
            EvidenceRef(entity_type="ConnectionMember", entity_id=step.edge.connection_member_id),
        ]
        if step.edge.cable_id is not None:
            refs.append(EvidenceRef(entity_type="Cable", entity_id=step.edge.cable_id))
        return EvidenceEdge(
            id=f"l1-edge:{step.edge.connection_member_id}",
            from_node_id=cls._node_id(step.source),
            to_node_id=cls._node_id(step.target),
            evidence_refs=refs,
        )

    @staticmethod
    def _node_id(address: PointMember) -> str:
        return f"l1-state:{address.point_id}:{address.member_index}"
