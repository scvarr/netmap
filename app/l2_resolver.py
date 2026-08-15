import uuid

from app.errors import ModelError
from app.repository import CanonicalRepository, L2BindingRecord
from app.schemas import (
    EncapsulationLabel,
    EvaluationView,
    EvidenceRef,
    L2BindingPayload,
    L2BoundaryPayload,
    L2ContextPayload,
    L2ReachabilityQuery,
    L2ReachabilityTraceArtifact,
    L2TraceEdge,
    L2TraceGap,
    L2TraceNode,
)


class L2ReachabilityResolver:
    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: L2ReachabilityQuery, view: EvaluationView
    ) -> L2ReachabilityTraceArtifact:
        self.repository.validate_network_interface(query.from_.interface_id)
        self.repository.validate_network_interface(query.to.interface_id)
        source_ref = self._ref("NetworkInterface", query.from_.interface_id)
        target_ref = self._ref("NetworkInterface", query.to.interface_id)
        source_node = self._boundary_node(query, ingress=True, refs=[source_ref])

        ingress = self.repository.get_l2_ingress_exact(
            query.from_.interface_id, self._stack_json(query.from_.encapsulation_stack)
        )
        if not ingress:
            return self._unknown(
                query, view, [source_node], "L2_INGRESS_RULE_UNKNOWN", source_node.id, [source_ref]
            )

        bindings_by_context: dict[uuid.UUID, set[uuid.UUID]] = {}
        for candidate in ingress:
            bindings_by_context.setdefault(candidate.forwarding_context_id, set()).add(
                candidate.binding_id
            )
        corrupted_contexts = [
            context_id
            for context_id, binding_ids in bindings_by_context.items()
            if len(binding_ids) > 1
        ]
        if corrupted_contexts:
            raise ModelError(
                "Multiple L2Bindings exist for one interface and forwarding context",
                {
                    "interface_id": str(query.from_.interface_id),
                    "forwarding_context_ids": [str(value) for value in corrupted_contexts],
                },
            )

        ingress_bindings = {
            (candidate.binding_id, candidate.forwarding_context_id) for candidate in ingress
        }
        if len(ingress_bindings) != 1:
            refs = [source_ref]
            for candidate in ingress:
                refs.extend(
                    [
                        self._ref("L2Binding", candidate.binding_id),
                        self._ref("L2IngressRule", candidate.rule_id),
                        self._ref("L2ForwardingContext", candidate.forwarding_context_id),
                    ]
                )
            return self._unknown(
                query,
                view,
                [source_node],
                "L2_INGRESS_AMBIGUOUS",
                source_node.id,
                self._dedupe(refs),
            )

        source_binding_id, context_id = next(iter(ingress_bindings))
        context_ref = self._ref("L2ForwardingContext", context_id)
        ingress_refs = [source_ref, self._ref("L2Binding", source_binding_id), context_ref]
        ingress_refs.extend(self._ref("L2IngressRule", candidate.rule_id) for candidate in ingress)
        ingress_refs = self._dedupe(ingress_refs)
        source_node.canonical_refs = ingress_refs
        context_node = L2TraceNode(
            id=f"l2-context:{context_id}",
            payload=L2ContextPayload(forwarding_context_id=context_id),
            canonical_refs=[context_ref],
        )
        ingress_edge = L2TraceEdge(
            id="l2-edge:ingress-decode",
            from_node_id=source_node.id,
            to_node_id=context_node.id,
            transition_kind="INGRESS_DECODE",
            evidence_refs=ingress_refs,
        )

        target_bindings = [
            binding
            for binding in self.repository.get_l2_bindings_by_interface(
                [query.to.interface_id]
            )[query.to.interface_id]
            if binding.forwarding_context_id == context_id
        ]
        if not target_bindings:
            return self._unknown(
                query,
                view,
                [source_node, context_node],
                "L2_TARGET_CONTEXT_PATH_UNKNOWN",
                context_node.id,
                self._dedupe(ingress_refs + [target_ref]),
                [ingress_edge],
            )
        if len(target_bindings) > 1:
            raise ModelError(
                "Multiple L2Bindings exist for one interface and forwarding context",
                {
                    "interface_id": str(query.to.interface_id),
                    "forwarding_context_id": str(context_id),
                },
            )
        target_binding = target_bindings[0]
        target_binding_ref = self._ref("L2Binding", target_binding.binding_id)
        binding_node = self._binding_node(target_binding, [target_ref, target_binding_ref, context_ref])
        local_refs = binding_node.canonical_refs
        local_edge = L2TraceEdge(
            id="l2-edge:local-forward",
            from_node_id=context_node.id,
            to_node_id=binding_node.id,
            transition_kind="LOCAL_FORWARD",
            evidence_refs=local_refs,
        )

        egress_rules = self.repository.get_l2_egress_rules([target_binding.binding_id])[
            target_binding.binding_id
        ]
        if not egress_rules:
            return self._unknown(
                query,
                view,
                [source_node, context_node, binding_node],
                "L2_EGRESS_RULE_UNKNOWN",
                binding_node.id,
                self._dedupe(ingress_refs + local_refs),
                [ingress_edge, local_edge],
            )
        if len(egress_rules) > 1:
            raise ModelError(
                "Multiple effective L2EgressRules exist for one binding",
                {"binding_id": str(target_binding.binding_id)},
            )
        egress_rule = egress_rules[0]
        requested_stack = tuple(
            (label.kind, label.value) for label in query.to.encapsulation_stack
        )
        egress_ref = self._ref("L2EgressRule", egress_rule.rule_id)
        if egress_rule.emit_stack != requested_stack:
            return self._unknown(
                query,
                view,
                [source_node, context_node, binding_node],
                "L2_TARGET_CONTEXT_PATH_UNKNOWN",
                binding_node.id,
                self._dedupe(ingress_refs + local_refs + [egress_ref]),
                [ingress_edge, local_edge],
            )

        target_node = self._boundary_node(
            query, ingress=False, refs=[target_ref, target_binding_ref, egress_ref]
        )
        egress_edge = L2TraceEdge(
            id="l2-edge:egress-encode",
            from_node_id=binding_node.id,
            to_node_id=target_node.id,
            transition_kind="EGRESS_ENCODE",
            evidence_refs=[target_ref, target_binding_ref, egress_ref],
        )
        nodes = [source_node, context_node, binding_node, target_node]
        edges = [ingress_edge, local_edge, egress_edge]
        evidence = self._dedupe([ref for edge in edges for ref in edge.evidence_refs])
        return L2ReachabilityTraceArtifact(
            query=query,
            evaluation_view=view,
            verdict="REACHABLE",
            nodes=nodes,
            edges=edges,
            evidence_refs=evidence,
            gaps=[],
            warnings=[],
        )

    @staticmethod
    def _stack_json(stack: list[EncapsulationLabel]) -> list[dict[str, object]]:
        return [label.model_dump() for label in stack]

    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> EvidenceRef:
        return EvidenceRef(entity_type=entity_type, entity_id=entity_id)  # type: ignore[arg-type]

    @staticmethod
    def _dedupe(refs: list[EvidenceRef]) -> list[EvidenceRef]:
        seen: set[tuple[str, uuid.UUID]] = set()
        result: list[EvidenceRef] = []
        for ref in refs:
            key = (ref.entity_type, ref.entity_id)
            if key not in seen:
                seen.add(key)
                result.append(ref)
        return result

    @staticmethod
    def _boundary_node(
        query: L2ReachabilityQuery, *, ingress: bool, refs: list[EvidenceRef]
    ) -> L2TraceNode:
        boundary = query.from_ if ingress else query.to
        direction = "INGRESS" if ingress else "EGRESS"
        return L2TraceNode(
            id=f"l2-boundary:{direction.lower()}:{boundary.interface_id}",
            payload=L2BoundaryPayload(
                interface_id=boundary.interface_id,
                direction=direction,
                encapsulation_stack=boundary.encapsulation_stack,
            ),
            canonical_refs=refs,
        )

    @staticmethod
    def _binding_node(binding: L2BindingRecord, refs: list[EvidenceRef]) -> L2TraceNode:
        return L2TraceNode(
            id=f"l2-binding:{binding.binding_id}",
            payload=L2BindingPayload(
                binding_id=binding.binding_id,
                interface_id=binding.interface_id,
                forwarding_context_id=binding.forwarding_context_id,
            ),
            canonical_refs=refs,
        )

    @staticmethod
    def _unknown(
        query: L2ReachabilityQuery,
        view: EvaluationView,
        nodes: list[L2TraceNode],
        code: str,
        node_id: str,
        refs: list[EvidenceRef],
        edges: list[L2TraceEdge] | None = None,
    ) -> L2ReachabilityTraceArtifact:
        return L2ReachabilityTraceArtifact(
            query=query,
            evaluation_view=view,
            verdict="UNKNOWN",
            nodes=nodes,
            edges=edges or [],
            evidence_refs=refs,
            gaps=[L2TraceGap(code=code, node_id=node_id, evidence_refs=refs)],  # type: ignore[arg-type]
            warnings=[],
        )
