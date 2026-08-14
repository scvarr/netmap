import uuid
from dataclasses import dataclass

from app.errors import ModelError
from app.repository import (
    CanonicalRepository,
    PhysicalBindingRecord,
    RealizationRecord,
)
from app.resolver import L1Resolver
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    InterfacePhysicalTraceArtifact,
    InterfacePhysicalTraceBranch,
    InterfacePhysicalTraceQuery,
    InterfaceStatePayload,
    InterfaceTraceEdge,
    InterfaceTraceGap,
    InterfaceTraceNode,
    L1TraceQuery,
    PhysicalBindingCandidate,
    PointMemberAddress,
    RealizationCandidateStep,
)


@dataclass(frozen=True)
class ResolvedPhysicalCandidate:
    candidate_id: str
    root_interface_id: uuid.UUID
    binding: PhysicalBindingRecord
    realization_path: tuple[RealizationRecord, ...]


@dataclass
class PhysicalResolution:
    root_interface_id: uuid.UUID
    candidates: list[ResolvedPhysicalCandidate]
    realizations: list[RealizationRecord]


class InterfacePhysicalResolver:
    VERSION = "interface-physical/2.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self,
        query: InterfacePhysicalTraceQuery,
        evaluation_view: EvaluationView,
    ) -> InterfacePhysicalTraceArtifact:
        self.repository.validate_network_interface(query.from_interface_id)
        self.repository.validate_network_interface(query.to_interface_id)
        source_resolution = self._resolve_physical(query.from_interface_id)
        target_resolution = self._resolve_physical(query.to_interface_id)
        source_candidates = [
            self._candidate_schema(candidate) for candidate in source_resolution.candidates
        ]
        target_candidates = [
            self._candidate_schema(candidate) for candidate in target_resolution.candidates
        ]

        if not source_resolution.candidates or not target_resolution.candidates:
            missing = (
                source_resolution
                if not source_resolution.candidates
                else target_resolution
            )
            gap_code = (
                "INTERFACE_PHYSICAL_REALIZATION_UNKNOWN"
                if missing.realizations
                else "INTERFACE_PHYSICAL_BINDING_UNKNOWN"
            )
            return self._unknown_artifact(
                query,
                evaluation_view,
                source_resolution,
                target_resolution,
                source_candidates,
                target_candidates,
                InterfaceTraceGap(
                    code=gap_code,
                    node_id=self._root_node_id(missing.root_interface_id),
                    evidence_refs=self._resolution_refs(missing),
                ),
            )

        nodes: dict[str, InterfaceTraceNode] = {}
        edges: dict[str, InterfaceTraceEdge] = {}
        evidence_refs: list[EvidenceRef] = []
        branches: list[InterfacePhysicalTraceBranch] = []
        l1_resolver = L1Resolver(self.repository)

        for source_candidate in source_resolution.candidates:
            for target_candidate in target_resolution.candidates:
                l1_artifact = l1_resolver.resolve(
                    self._l1_query(source_candidate, target_candidate),
                    evaluation_view,
                )
                if l1_artifact.verdict != "REACHABLE":
                    continue
                branch_nodes, branch_edges, branch_refs = self._build_branch(
                    source_candidate, target_candidate, l1_artifact
                )
                nodes.update({node.id: node for node in branch_nodes})
                edges.update({edge.id: edge for edge in branch_edges})
                evidence_refs.extend(branch_refs)
                branches.append(
                    InterfacePhysicalTraceBranch(
                        branch_id=(
                            f"physical-branch:{source_candidate.candidate_id}:"
                            f"{target_candidate.candidate_id}"
                        ),
                        source_candidate_id=source_candidate.candidate_id,
                        target_candidate_id=target_candidate.candidate_id,
                        edge_ids=[edge.id for edge in branch_edges],
                        evidence_refs=self._deduplicate_refs(branch_refs),
                    )
                )

        if not branches:
            candidate_refs = self._resolution_refs(source_resolution) + self._resolution_refs(
                target_resolution
            )
            return self._unknown_artifact(
                query,
                evaluation_view,
                source_resolution,
                target_resolution,
                source_candidates,
                target_candidates,
                InterfaceTraceGap(
                    code="L1_TOPOLOGY_INCOMPLETE",
                    node_id=self._root_node_id(query.from_interface_id),
                    evidence_refs=self._deduplicate_refs(candidate_refs),
                ),
            )

        return InterfacePhysicalTraceArtifact(
            query=query,
            evaluation_view=evaluation_view,
            verdict="REACHABLE",
            source_binding_candidates=source_candidates,
            target_binding_candidates=target_candidates,
            branches=branches,
            nodes=list(nodes.values()),
            edges=list(edges.values()),
            evidence_refs=self._deduplicate_refs(evidence_refs),
            gaps=[],
            warnings=[],
        )

    def _resolve_physical(self, root_interface_id: uuid.UUID) -> PhysicalResolution:
        resolution = PhysicalResolution(root_interface_id, [], [])

        def visit(
            interface_id: uuid.UUID,
            realization_path: tuple[RealizationRecord, ...],
            ancestry: frozenset[uuid.UUID],
        ) -> None:
            bindings = self.repository.get_physical_bindings_by_interface([interface_id])[
                interface_id
            ]
            for binding in bindings:
                resolution.candidates.append(
                    ResolvedPhysicalCandidate(
                        candidate_id=self._candidate_id(
                            root_interface_id, realization_path, binding.binding_id
                        ),
                        root_interface_id=root_interface_id,
                        binding=binding,
                        realization_path=realization_path,
                    )
                )

            realizations = self.repository.get_realizations_down([interface_id])[interface_id]
            for realization in realizations:
                resolution.realizations.append(realization)
                if realization.lower_interface_id in ancestry:
                    raise ModelError(
                        "NetworkInterfaceRealization graph contains a cycle",
                        {
                            "realization_id": str(realization.realization_id),
                            "upper_interface_id": str(realization.upper_interface_id),
                            "lower_interface_id": str(realization.lower_interface_id),
                        },
                    )
                visit(
                    realization.lower_interface_id,
                    (*realization_path, realization),
                    ancestry | {realization.lower_interface_id},
                )

        visit(root_interface_id, (), frozenset({root_interface_id}))
        return resolution

    def _build_branch(
        self, source: ResolvedPhysicalCandidate, target: ResolvedPhysicalCandidate, l1_artifact
    ) -> tuple[list[InterfaceTraceNode], list[InterfaceTraceEdge], list[EvidenceRef]]:
        nodes: list[InterfaceTraceNode] = []
        edges: list[InterfaceTraceEdge] = []
        refs: list[EvidenceRef] = []
        branch_key = f"{source.candidate_id}:{target.candidate_id}"

        source_interface_nodes = self._path_interface_nodes(source, "source")
        target_interface_nodes = self._path_interface_nodes(target, "target")
        nodes.extend(source_interface_nodes)
        l1_node_ids = {
            node.id: f"{node.id}:branch:{branch_key}" for node in l1_artifact.nodes
        }
        nodes.extend(
            InterfaceTraceNode(
                id=l1_node_ids[node.id],
                layer="L1",
                payload=node.payload,
                canonical_refs=node.canonical_refs,
            )
            for node in l1_artifact.nodes
        )
        nodes.extend(target_interface_nodes)

        for index, realization in enumerate(source.realization_path):
            edge_refs = self._realization_refs(realization)
            edge = InterfaceTraceEdge(
                id=(
                    f"interface-realization:{realization.realization_id}:down:"
                    f"{source.candidate_id}"
                ),
                from_node_id=source_interface_nodes[index].id,
                to_node_id=source_interface_nodes[index + 1].id,
                transition_kind="INTERFACE_REALIZATION_DOWN",
                layer="INTERFACE",
                evidence_refs=edge_refs,
            )
            edges.append(edge)
            refs.extend(edge_refs)

        source_binding_refs = [
            self._interface_ref(source.binding.interface_id),
            self._binding_ref(source.binding.binding_id),
        ]
        edges.append(
            InterfaceTraceEdge(
                id=f"interface-binding:{source.binding.binding_id}:out:{branch_key}",
                from_node_id=source_interface_nodes[-1].id,
                to_node_id=l1_node_ids[self._point_node_id(source.binding)],
                transition_kind="INTERFACE_PHYSICAL_BIND",
                layer="BRIDGE",
                evidence_refs=source_binding_refs,
            )
        )
        refs.extend(source_binding_refs)

        for edge in l1_artifact.edges:
            edges.append(
                InterfaceTraceEdge(
                    id=f"{edge.id}:branch:{branch_key}",
                    from_node_id=l1_node_ids[edge.from_node_id],
                    to_node_id=l1_node_ids[edge.to_node_id],
                    transition_kind="L1_TRAVERSE",
                    layer="L1",
                    evidence_refs=edge.evidence_refs,
                )
            )
        refs.extend(l1_artifact.evidence_refs)

        target_binding_refs = [
            self._binding_ref(target.binding.binding_id),
            self._interface_ref(target.binding.interface_id),
        ]
        edges.append(
            InterfaceTraceEdge(
                id=f"interface-binding:{target.binding.binding_id}:in:{branch_key}",
                from_node_id=l1_node_ids[self._point_node_id(target.binding)],
                to_node_id=target_interface_nodes[-1].id,
                transition_kind="INTERFACE_PHYSICAL_BIND",
                layer="BRIDGE",
                evidence_refs=target_binding_refs,
            )
        )
        refs.extend(target_binding_refs)

        for index in range(len(target.realization_path) - 1, -1, -1):
            realization = target.realization_path[index]
            edge_refs = self._realization_refs(realization)
            edges.append(
                InterfaceTraceEdge(
                    id=(
                        f"interface-realization:{realization.realization_id}:up:"
                        f"{target.candidate_id}"
                    ),
                    from_node_id=target_interface_nodes[index + 1].id,
                    to_node_id=target_interface_nodes[index].id,
                    transition_kind="INTERFACE_REALIZATION_UP",
                    layer="INTERFACE",
                    evidence_refs=edge_refs,
                )
            )
            refs.extend(edge_refs)

        return nodes, edges, self._deduplicate_refs(refs)

    def _unknown_artifact(
        self,
        query: InterfacePhysicalTraceQuery,
        evaluation_view: EvaluationView,
        source_resolution: PhysicalResolution,
        target_resolution: PhysicalResolution,
        source_candidates: list[PhysicalBindingCandidate],
        target_candidates: list[PhysicalBindingCandidate],
        gap: InterfaceTraceGap,
    ) -> InterfacePhysicalTraceArtifact:
        refs = self._resolution_refs(source_resolution) + self._resolution_refs(
            target_resolution
        )
        return InterfacePhysicalTraceArtifact(
            query=query,
            evaluation_view=evaluation_view,
            verdict="UNKNOWN",
            source_binding_candidates=source_candidates,
            target_binding_candidates=target_candidates,
            branches=[],
            nodes=[
                self._interface_node(
                    query.from_interface_id, self._root_node_id(query.from_interface_id)
                ),
                self._interface_node(
                    query.to_interface_id, self._root_node_id(query.to_interface_id)
                ),
            ],
            edges=[],
            evidence_refs=self._deduplicate_refs(refs),
            gaps=[gap],
            warnings=[],
        )

    def _path_interface_nodes(
        self, candidate: ResolvedPhysicalCandidate, side: str
    ) -> list[InterfaceTraceNode]:
        nodes = [
            self._interface_node(
                candidate.root_interface_id,
                self._root_node_id(candidate.root_interface_id),
            )
        ]
        for realization in candidate.realization_path:
            nodes.append(
                self._interface_node(
                    realization.lower_interface_id,
                    (
                        f"interface-state:{realization.lower_interface_id}:{side}:"
                        f"{candidate.candidate_id}"
                    ),
                )
            )
        return nodes

    def _resolution_refs(self, resolution: PhysicalResolution) -> list[EvidenceRef]:
        refs = [self._interface_ref(resolution.root_interface_id)]
        for realization in resolution.realizations:
            refs.extend(self._realization_refs(realization))
        for candidate in resolution.candidates:
            refs.extend(
                [
                    self._interface_ref(candidate.binding.interface_id),
                    self._binding_ref(candidate.binding.binding_id),
                ]
            )
        return self._deduplicate_refs(refs)

    @staticmethod
    def _l1_query(
        source: ResolvedPhysicalCandidate, target: ResolvedPhysicalCandidate
    ) -> L1TraceQuery:
        return L1TraceQuery(
            **{
                "from": {
                    "point_id": source.binding.point_id,
                    "member_index": source.binding.point_member,
                },
                "to": {
                    "point_id": target.binding.point_id,
                    "member_index": target.binding.point_member,
                },
            }
        )

    @staticmethod
    def _candidate_schema(candidate: ResolvedPhysicalCandidate) -> PhysicalBindingCandidate:
        return PhysicalBindingCandidate(
            candidate_id=candidate.candidate_id,
            root_interface_id=candidate.root_interface_id,
            binding_id=candidate.binding.binding_id,
            interface_id=candidate.binding.interface_id,
            point=PointMemberAddress(
                point_id=candidate.binding.point_id,
                member_index=candidate.binding.point_member,
            ),
            realization_path=[
                RealizationCandidateStep(
                    realization_id=step.realization_id,
                    upper_interface_id=step.upper_interface_id,
                    lower_interface_id=step.lower_interface_id,
                )
                for step in candidate.realization_path
            ],
        )

    @staticmethod
    def _candidate_id(
        root_interface_id: uuid.UUID,
        path: tuple[RealizationRecord, ...],
        binding_id: uuid.UUID,
    ) -> str:
        path_key = ".".join(str(step.realization_id) for step in path) or "direct"
        return f"physical-candidate:{root_interface_id}:{path_key}:{binding_id}"

    def _interface_node(self, interface_id: uuid.UUID, node_id: str) -> InterfaceTraceNode:
        return InterfaceTraceNode(
            id=node_id,
            layer="INTERFACE",
            payload=InterfaceStatePayload(interface_id=interface_id),
            canonical_refs=[self._interface_ref(interface_id)],
        )

    @staticmethod
    def _root_node_id(interface_id: uuid.UUID) -> str:
        return f"interface-state:{interface_id}"

    @staticmethod
    def _point_node_id(binding: PhysicalBindingRecord) -> str:
        return f"l1-state:{binding.point_id}:{binding.point_member}"

    @staticmethod
    def _interface_ref(interface_id: uuid.UUID) -> EvidenceRef:
        return EvidenceRef(entity_type="NetworkInterface", entity_id=interface_id)

    @staticmethod
    def _binding_ref(binding_id: uuid.UUID) -> EvidenceRef:
        return EvidenceRef(entity_type="InterfacePhysicalBinding", entity_id=binding_id)

    def _realization_refs(self, realization: RealizationRecord) -> list[EvidenceRef]:
        return [
            EvidenceRef(
                entity_type="NetworkInterfaceRealization",
                entity_id=realization.realization_id,
            ),
            self._interface_ref(realization.upper_interface_id),
            self._interface_ref(realization.lower_interface_id),
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
