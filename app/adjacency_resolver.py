import uuid

from app.repository import CanonicalRepository
from app.schemas import (
    AdjacencyCandidate,
    AdjacencyCandidatesArtifact,
    AdjacencyCandidatesGap,
    AdjacencyCandidatesQuery,
    EvaluationView,
    EvidenceRef,
)


class StructuralAdjacencyResolver:
    VERSION = "l3-structural-adjacency-candidates/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: AdjacencyCandidatesQuery, view: EvaluationView
    ) -> AdjacencyCandidatesArtifact:
        identity = self.repository.get_adjacency_identity_candidates(
            query.egress_l3_binding_id, query.neighbor_target_ip
        )
        base_refs = [
            self._ref("L3Binding", identity.egress_l3_binding_id),
            self._ref("NetworkInterface", identity.egress_network_interface_id),
            self._ref("RoutingContext", identity.routing_context_id),
        ]
        candidates: list[AdjacencyCandidate] = []
        refs = list(base_refs)
        for candidate in identity.candidates:
            candidates.append(
                AdjacencyCandidate(
                    interface_address_id=candidate.interface_address_id,
                    target_l3_binding_id=candidate.l3_binding_id,
                    target_network_interface_id=candidate.network_interface_id,
                    ip_address=candidate.address,
                )
            )
            refs.extend(
                [
                    self._ref("InterfaceAddress", candidate.interface_address_id),
                    self._ref("L3Binding", candidate.l3_binding_id),
                    self._ref("NetworkInterface", candidate.network_interface_id),
                ]
            )
        refs = self._dedupe(refs)
        if candidates:
            result = "CANDIDATES_FOUND"
            gaps: list[AdjacencyCandidatesGap] = []
        else:
            result = "UNKNOWN"
            gaps = [
                AdjacencyCandidatesGap(
                    code="INTERFACE_ADDRESS_UNKNOWN", evidence_refs=base_refs
                )
            ]
        return AdjacencyCandidatesArtifact(
            query=query,
            evaluation_view=view,
            result=result,
            routing_context_id=identity.routing_context_id,
            candidates=candidates,
            evidence_refs=refs,
            gaps=gaps,
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
