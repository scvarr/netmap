import uuid

from app.repository import CanonicalRepository, PhysicalBindingRecord
from app.resolver import L1Resolver
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    InterfacePhysicalTraceArtifact,
    InterfacePhysicalTraceQuery,
    InterfaceStatePayload,
    InterfaceTraceEdge,
    InterfaceTraceGap,
    InterfaceTraceNode,
    L1TraceQuery,
    PhysicalBindingCandidate,
    PointMemberAddress,
)


class InterfacePhysicalResolver:
    VERSION = "interface-physical/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self,
        query: InterfacePhysicalTraceQuery,
        evaluation_view: EvaluationView,
    ) -> InterfacePhysicalTraceArtifact:
        self.repository.validate_network_interface(query.from_interface_id)
        self.repository.validate_network_interface(query.to_interface_id)
        bindings = self.repository.get_physical_bindings_by_interface(
            [query.from_interface_id, query.to_interface_id]
        )
        source_bindings = bindings[query.from_interface_id]
        target_bindings = bindings[query.to_interface_id]
        source_candidates = [self._candidate(binding) for binding in source_bindings]
        target_candidates = [self._candidate(binding) for binding in target_bindings]

        if not source_bindings or not target_bindings:
            missing_interface_id = (
                query.from_interface_id if not source_bindings else query.to_interface_id
            )
            interface_ref = self._interface_ref(missing_interface_id)
            return self._unknown_artifact(
                query,
                evaluation_view,
                source_candidates,
                target_candidates,
                InterfaceTraceGap(
                    code="INTERFACE_PHYSICAL_BINDING_UNKNOWN",
                    node_id=self._interface_node_id(missing_interface_id),
                    evidence_refs=[interface_ref],
                ),
                source_bindings + target_bindings,
            )

        l1_resolver = L1Resolver(self.repository)
        for source_binding in source_bindings:
            for target_binding in target_bindings:
                l1_artifact = l1_resolver.resolve(
                    L1TraceQuery(
                        **{
                            "from": {
                                "point_id": source_binding.point_id,
                                "member_index": source_binding.point_member,
                            },
                            "to": {
                                "point_id": target_binding.point_id,
                                "member_index": target_binding.point_member,
                            },
                        }
                    ),
                    evaluation_view,
                )
                if l1_artifact.verdict == "REACHABLE":
                    return self._reachable_artifact(
                        query,
                        evaluation_view,
                        source_candidates,
                        target_candidates,
                        source_binding,
                        target_binding,
                        l1_artifact,
                    )

        candidate_bindings = source_bindings + target_bindings
        candidate_refs = [self._binding_ref(binding.binding_id) for binding in candidate_bindings]
        return self._unknown_artifact(
            query,
            evaluation_view,
            source_candidates,
            target_candidates,
            InterfaceTraceGap(
                code="L1_TOPOLOGY_INCOMPLETE",
                node_id=self._interface_node_id(query.from_interface_id),
                evidence_refs=candidate_refs,
            ),
            candidate_bindings,
        )

    def _reachable_artifact(
        self,
        query: InterfacePhysicalTraceQuery,
        evaluation_view: EvaluationView,
        source_candidates: list[PhysicalBindingCandidate],
        target_candidates: list[PhysicalBindingCandidate],
        source_binding: PhysicalBindingRecord,
        target_binding: PhysicalBindingRecord,
        l1_artifact,
    ) -> InterfacePhysicalTraceArtifact:
        source_interface_node = self._interface_node(query.from_interface_id)
        target_interface_node = self._interface_node(query.to_interface_id)
        l1_nodes = [
            InterfaceTraceNode(
                id=node.id,
                layer="L1",
                payload=node.payload,
                canonical_refs=node.canonical_refs,
            )
            for node in l1_artifact.nodes
        ]
        source_point_node_id = self._point_node_id(source_binding)
        target_point_node_id = self._point_node_id(target_binding)
        source_refs = [
            self._interface_ref(query.from_interface_id),
            self._binding_ref(source_binding.binding_id),
        ]
        target_refs = [
            self._binding_ref(target_binding.binding_id),
            self._interface_ref(query.to_interface_id),
        ]
        edges = [
            InterfaceTraceEdge(
                id=f"interface-binding:{source_binding.binding_id}:out",
                from_node_id=source_interface_node.id,
                to_node_id=source_point_node_id,
                transition_kind="INTERFACE_PHYSICAL_BIND",
                layer="BRIDGE",
                evidence_refs=source_refs,
            ),
            *[
                InterfaceTraceEdge(
                    id=edge.id,
                    from_node_id=edge.from_node_id,
                    to_node_id=edge.to_node_id,
                    transition_kind="L1_TRAVERSE",
                    layer="L1",
                    evidence_refs=edge.evidence_refs,
                )
                for edge in l1_artifact.edges
            ],
            InterfaceTraceEdge(
                id=f"interface-binding:{target_binding.binding_id}:in",
                from_node_id=target_point_node_id,
                to_node_id=target_interface_node.id,
                transition_kind="INTERFACE_PHYSICAL_BIND",
                layer="BRIDGE",
                evidence_refs=target_refs,
            ),
        ]
        evidence_refs = self._deduplicate_refs(
            source_refs + l1_artifact.evidence_refs + target_refs
        )
        return InterfacePhysicalTraceArtifact(
            query=query,
            evaluation_view=evaluation_view,
            verdict="REACHABLE",
            source_binding_candidates=source_candidates,
            target_binding_candidates=target_candidates,
            nodes=[source_interface_node, *l1_nodes, target_interface_node],
            edges=edges,
            evidence_refs=evidence_refs,
            gaps=[],
            warnings=[],
        )

    def _unknown_artifact(
        self,
        query: InterfacePhysicalTraceQuery,
        evaluation_view: EvaluationView,
        source_candidates: list[PhysicalBindingCandidate],
        target_candidates: list[PhysicalBindingCandidate],
        gap: InterfaceTraceGap,
        bindings: list[PhysicalBindingRecord],
    ) -> InterfacePhysicalTraceArtifact:
        refs = [
            self._interface_ref(query.from_interface_id),
            self._interface_ref(query.to_interface_id),
            *[self._binding_ref(binding.binding_id) for binding in bindings],
        ]
        return InterfacePhysicalTraceArtifact(
            query=query,
            evaluation_view=evaluation_view,
            verdict="UNKNOWN",
            source_binding_candidates=source_candidates,
            target_binding_candidates=target_candidates,
            nodes=[
                self._interface_node(query.from_interface_id),
                self._interface_node(query.to_interface_id),
            ],
            edges=[],
            evidence_refs=self._deduplicate_refs(refs),
            gaps=[gap],
            warnings=[],
        )

    @staticmethod
    def _candidate(binding: PhysicalBindingRecord) -> PhysicalBindingCandidate:
        return PhysicalBindingCandidate(
            binding_id=binding.binding_id,
            interface_id=binding.interface_id,
            point=PointMemberAddress(
                point_id=binding.point_id,
                member_index=binding.point_member,
            ),
        )

    def _interface_node(self, interface_id: uuid.UUID) -> InterfaceTraceNode:
        return InterfaceTraceNode(
            id=self._interface_node_id(interface_id),
            layer="INTERFACE",
            payload=InterfaceStatePayload(interface_id=interface_id),
            canonical_refs=[self._interface_ref(interface_id)],
        )

    @staticmethod
    def _interface_node_id(interface_id: uuid.UUID) -> str:
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
