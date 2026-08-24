from app.repository import CanonicalRepository, PointMember
from app.resolver import L1Resolver
from app.schemas import (
    EvaluationView,
    EvidenceEdge,
    EvidenceNode,
    EvidenceRef,
    L1TraceQuery,
    PhysicalObjectL1TraceArtifact,
    PhysicalObjectL1TraceBranch,
    PhysicalObjectL1TraceCycle,
    PhysicalObjectL1TraceQuery,
    PointMemberAddress,
    TraceGap,
)


class PhysicalObjectL1Resolver:
    VERSION = "physical-object-l1/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self,
        query: PhysicalObjectL1TraceQuery,
        evaluation_view: EvaluationView,
    ) -> PhysicalObjectL1TraceArtifact:
        sources = self.repository.get_l1_point_members_for_physical_object(
            query.from_physical_object_id, query.from_connection_point_id
        )
        targets = self.repository.get_l1_point_members_for_physical_object(
            query.to_physical_object_id, query.to_connection_point_id
        )
        l1 = L1Resolver(self.repository)
        nodes: dict[str, EvidenceNode] = {}
        edges: dict[str, EvidenceEdge] = {}
        branches: list[PhysicalObjectL1TraceBranch] = []
        refs = self._endpoint_refs(query, sources, targets)

        for source in sources:
            for target in targets:
                artifact = l1.resolve(self._query(source, target), evaluation_view)
                if artifact.verdict != "REACHABLE":
                    continue
                for node in artifact.nodes:
                    nodes[node.id] = node
                for edge in artifact.edges:
                    edges[edge.id] = edge
                branch_refs = self._deduplicate_refs(artifact.evidence_refs)
                refs.extend(branch_refs)
                branches.append(
                    PhysicalObjectL1TraceBranch(
                        branch_id=f"physical-object-branch:{source.point_id}:{source.member_index}:{target.point_id}:{target.member_index}",
                        source=self._address(source),
                        target=self._address(target),
                        edge_ids=[edge.id for edge in artifact.edges],
                        evidence_refs=branch_refs,
                    )
                )

        cycles = self._cycles(l1, sources, nodes, edges)
        for cycle in cycles:
            refs.extend(cycle.evidence_refs)
        gaps = [] if branches else [
            TraceGap(
                code="L1_TOPOLOGY_INCOMPLETE",
                node_id=self._node_id(sources[0]) if sources else None,
                evidence_refs=self._deduplicate_refs(refs),
            )
        ]
        return PhysicalObjectL1TraceArtifact(
            query=query,
            evaluation_view=evaluation_view,
            verdict="REACHABLE" if branches else "UNKNOWN",
            source_candidates=[self._address(source) for source in sources],
            target_candidates=[self._address(target) for target in targets],
            branches=branches,
            cycles=cycles,
            nodes=list(nodes.values()),
            edges=list(edges.values()),
            evidence_refs=self._deduplicate_refs(refs),
            gaps=gaps,
            warnings=[],
        )

    def _cycles(
        self,
        l1: L1Resolver,
        sources: tuple[PointMember, ...],
        nodes: dict[str, EvidenceNode],
        edges: dict[str, EvidenceEdge],
    ) -> list[PhysicalObjectL1TraceCycle]:
        result: list[PhysicalObjectL1TraceCycle] = []
        seen: set[tuple[str, ...]] = set()
        for source in sources:
            for steps in l1.find_cycles(source):
                edge_ids = tuple(sorted(str(step.edge.connection_member_id) for step in steps))
                if edge_ids in seen:
                    continue
                seen.add(edge_ids)
                refs: list[EvidenceRef] = []
                state_ids = [self._node_id(steps[0].source)]
                for step in steps:
                    nodes[self._node_id(step.source)] = self._node(step.source)
                    nodes[self._node_id(step.target)] = self._node(step.target)
                    edge = self._edge(step.source, step.target, step.edge.connection_member_id, step.edge.connection_id)
                    edges[edge.id] = edge
                    refs.extend(edge.evidence_refs)
                    state_ids.append(self._node_id(step.target))
                result.append(
                    PhysicalObjectL1TraceCycle(
                        cycle_id=f"l1-cycle:{':'.join(edge_ids)}",
                        state_node_ids=state_ids,
                        edge_ids=[self._edge_id(step.edge.connection_member_id) for step in steps],
                        evidence_refs=self._deduplicate_refs(refs),
                    )
                )
        return result

    @staticmethod
    def _query(source: PointMember, target: PointMember) -> L1TraceQuery:
        return L1TraceQuery(**{"from": PhysicalObjectL1Resolver._address(source), "to": PhysicalObjectL1Resolver._address(target)})

    @staticmethod
    def _address(point: PointMember) -> PointMemberAddress:
        return PointMemberAddress(point_id=point.point_id, member_index=point.member_index)

    @staticmethod
    def _node_id(point: PointMember) -> str:
        return f"l1-state:{point.point_id}:{point.member_index}"

    def _node(self, point: PointMember) -> EvidenceNode:
        return EvidenceNode(id=self._node_id(point), payload=self._address(point), canonical_refs=[EvidenceRef(entity_type="ConnectionPoint", entity_id=point.point_id)])

    @staticmethod
    def _edge_id(member_id) -> str:
        return f"l1-edge:{member_id}"

    def _edge(self, source: PointMember, target: PointMember, member_id, connection_id) -> EvidenceEdge:
        refs = [EvidenceRef(entity_type="Connection", entity_id=connection_id), EvidenceRef(entity_type="ConnectionMember", entity_id=member_id)]
        return EvidenceEdge(id=self._edge_id(member_id), from_node_id=self._node_id(source), to_node_id=self._node_id(target), evidence_refs=refs)

    @staticmethod
    def _endpoint_refs(query, sources, targets) -> list[EvidenceRef]:
        return [
            EvidenceRef(entity_type="ConnectionPoint", entity_id=point.point_id)
            for point in (*sources, *targets)
        ]

    @staticmethod
    def _deduplicate_refs(refs: list[EvidenceRef]) -> list[EvidenceRef]:
        result: list[EvidenceRef] = []
        seen: set[tuple[str, str]] = set()
        for ref in refs:
            key = (ref.entity_type, str(ref.entity_id))
            if key not in seen:
                seen.add(key)
                result.append(ref)
        return result
