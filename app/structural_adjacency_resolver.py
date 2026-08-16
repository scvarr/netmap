import uuid

from app.adjacency_resolver import StructuralAdjacencyResolver
from app.l2_resolver import L2ReachabilityResolver
from app.repository import CanonicalRepository
from app.schemas import (
    AdjacencyCandidatesQuery,
    EvaluationView,
    EvidenceRef,
    L2InternalInterfacePayload,
    StructuralAdjacencyArtifact,
    StructuralAdjacencyCandidateResult,
    StructuralAdjacencyQuery,
    StructuralL2TraversalArtifact,
)


class StructuralAdjacencyProofResolver:
    VERSION = "l3-structural-adjacency-proof/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: StructuralAdjacencyQuery, view: EvaluationView
    ) -> StructuralAdjacencyArtifact:
        identity = StructuralAdjacencyResolver(self.repository).resolve(
            AdjacencyCandidatesQuery(
                egress_l3_binding_id=query.egress_l3_binding_id,
                neighbor_target_ip=query.neighbor_target_ip,
            ),
            view,
        )
        source = self.repository.get_l3_binding_attachment(
            query.egress_l3_binding_id
        )
        candidate_results: list[StructuralAdjacencyCandidateResult] = []
        refs = list(identity.evidence_refs)
        for candidate in identity.candidates:
            traversal = L2ReachabilityResolver(self.repository).resolve_internal(
                source.network_interface_id,
                candidate.target_network_interface_id,
                view,
            )
            l2_artifact = StructuralL2TraversalArtifact(
                verdict=traversal.verdict,
                source=L2InternalInterfacePayload(
                    interface_id=source.network_interface_id,
                    direction="INGRESS",
                ),
                target=L2InternalInterfacePayload(
                    interface_id=candidate.target_network_interface_id,
                    direction="EGRESS",
                ),
                branches=traversal.branches,
                nodes=traversal.nodes,
                edges=traversal.edges,
                evidence_refs=traversal.evidence_refs,
                gaps=traversal.gaps,
            )
            candidate_refs = self._dedupe(
                [
                    self._ref("L3Binding", source.l3_binding_id),
                    self._ref("NetworkInterface", source.network_interface_id),
                    self._ref("RoutingContext", source.routing_context_id),
                    self._ref("InterfaceAddress", candidate.interface_address_id),
                    self._ref("L3Binding", candidate.target_l3_binding_id),
                    self._ref(
                        "NetworkInterface", candidate.target_network_interface_id
                    ),
                    *traversal.evidence_refs,
                ]
            )
            refs.extend(candidate_refs)
            candidate_results.append(
                StructuralAdjacencyCandidateResult(
                    identity_candidate=candidate,
                    result=traversal.verdict,
                    l2_traversal=l2_artifact,
                    evidence_refs=candidate_refs,
                )
            )
        return StructuralAdjacencyArtifact(
            query=query,
            evaluation_view=view,
            result=(
                "REACHABLE"
                if any(item.result == "REACHABLE" for item in candidate_results)
                else "UNKNOWN"
            ),
            identity_resolution=identity,
            candidate_results=candidate_results,
            evidence_refs=self._dedupe(refs),
            warnings=[],
        )

    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> EvidenceRef:
        return EvidenceRef(entity_type=entity_type, entity_id=entity_id)  # type: ignore[arg-type]

    @staticmethod
    def _dedupe(refs: list[EvidenceRef]) -> list[EvidenceRef]:
        result: list[EvidenceRef] = []
        seen: set[tuple[str, uuid.UUID]] = set()
        for ref in refs:
            key = (ref.entity_type, ref.entity_id)
            if key not in seen:
                seen.add(key)
                result.append(ref)
        return result
