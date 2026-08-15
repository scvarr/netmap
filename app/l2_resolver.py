import uuid
from dataclasses import dataclass
from typing import Any

from app.errors import ModelError
from app.repository import (
    CanonicalRepository,
    L2BindingRecord,
    PhysicalBindingRecord,
    PointMember,
    RealizationRecord,
)
from app.resolver import L1Resolver
from app.schemas import (
    EncapsulationLabel,
    EvaluationView,
    EvidenceRef,
    L1TraceQuery,
    L2BindingPayload,
    L2BoundaryPayload,
    L2ContextPayload,
    L2ReachabilityQuery,
    L2ReachabilityTraceArtifact,
    L2ReachabilityTraceBranch,
    L2TraceEdge,
    L2TraceGap,
    L2TraceNode,
)

StackKey = tuple[tuple[str, int], ...]


@dataclass(frozen=True)
class PhysicalCandidate:
    binding: PhysicalBindingRecord
    realization_path: tuple[RealizationRecord, ...]


@dataclass(frozen=True)
class UpperCandidate:
    interface_id: uuid.UUID
    realization_path: tuple[RealizationRecord, ...]


@dataclass(frozen=True)
class RemotePhysicalCandidate:
    binding: PhysicalBindingRecord
    l1_artifact: Any


class L2ReachabilityResolver:
    VERSION = "l2-configured-one-hop/2.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.nodes: dict[str, L2TraceNode] = {}
        self.edges: dict[str, L2TraceEdge] = {}
        self.gaps: list[L2TraceGap] = []
        self.branches: list[L2ReachabilityTraceBranch] = []
        self._sequence = 0

    def resolve(
        self, query: L2ReachabilityQuery, view: EvaluationView
    ) -> L2ReachabilityTraceArtifact:
        self.repository.validate_network_interface(query.from_.interface_id)
        self.repository.validate_network_interface(query.to.interface_id)
        source_ref = self._ref("NetworkInterface", query.from_.interface_id)
        source_node = self._boundary_node(
            query.from_.interface_id,
            "INGRESS",
            self._stack_key(query.from_.encapsulation_stack),
            "source",
            [source_ref],
        )
        self._put_node(source_node)
        ingress = self.repository.get_l2_ingress_exact(
            query.from_.interface_id, self._stack_json(query.from_.encapsulation_stack)
        )
        if not ingress:
            self._gap("L2_INGRESS_RULE_UNKNOWN", source_node.id, [source_ref])
            return self._artifact(query, view)

        source_ingress = self._unique_ingress(query.from_.interface_id, ingress, source_node.id)
        if source_ingress is None:
            return self._artifact(query, view)
        source_binding_id, source_context_id, ingress_refs = source_ingress
        source_node.canonical_refs = ingress_refs
        context_node = self._context_node(source_context_id, "source")
        self._put_node(context_node)
        ingress_edge = self._edge(
            "source-ingress",
            source_node.id,
            context_node.id,
            "INGRESS_DECODE",
            "L2",
            ingress_refs,
        )

        source_bindings = self.repository.get_l2_bindings_by_context([source_context_id])[
            source_context_id
        ]
        rules_by_binding = self.repository.get_l2_egress_rules(
            [binding.binding_id for binding in source_bindings]
        )
        for binding in source_bindings:
            if binding.binding_id == source_binding_id:
                continue
            rules = rules_by_binding[binding.binding_id]
            binding_refs = self._binding_refs(binding)
            if not rules:
                self._gap(
                    "L2_EGRESS_RULE_UNKNOWN",
                    context_node.id,
                    self._dedupe(ingress_refs + binding_refs),
                )
                continue
            if len(rules) > 1:
                raise ModelError(
                    "Multiple effective L2EgressRules exist for one binding",
                    {"binding_id": str(binding.binding_id)},
                )
            rule = rules[0]
            rule_ref = self._ref("L2EgressRule", rule.rule_id)
            prefix = self._prefix("source-egress")
            binding_node = self._binding_node(binding, prefix)
            self._put_node(binding_node)
            local_edge = self._edge(
                f"{prefix}:local-forward",
                context_node.id,
                binding_node.id,
                "LOCAL_FORWARD",
                "L2",
                binding_refs,
            )
            egress_node = self._boundary_node(
                binding.interface_id,
                "EGRESS",
                rule.emit_stack,
                f"{prefix}:boundary",
                self._dedupe(binding_refs + [rule_ref]),
            )
            self._put_node(egress_node)
            encode_edge = self._edge(
                f"{prefix}:egress-encode",
                binding_node.id,
                egress_node.id,
                "EGRESS_ENCODE",
                "L2",
                self._dedupe(binding_refs + [rule_ref]),
            )
            base_edges = [ingress_edge.id, local_edge.id, encode_edge.id]
            if binding.interface_id == query.to.interface_id:
                if rule.emit_stack == self._stack_key(query.to.encapsulation_stack):
                    self._add_branch(base_edges)
                else:
                    self._gap(
                        "L2_TARGET_CONTEXT_PATH_UNKNOWN",
                        binding_node.id,
                        self._dedupe(binding_refs + [rule_ref]),
                    )
                continue

            physical_candidates, realization_facts = self._resolve_down(binding.interface_id)
            if not physical_candidates:
                refs = binding_refs + [rule_ref]
                for realization in realization_facts:
                    refs.extend(self._realization_refs(realization))
                self._gap(
                    "L2_PHYSICAL_TRANSPORT_UNKNOWN",
                    egress_node.id,
                    self._dedupe(refs),
                )
                continue
            for physical in physical_candidates:
                down_node_id, down_edge_ids = self._render_down(
                    prefix, egress_node.id, rule.emit_stack, physical
                )
                remotes = self._remote_physical_endpoints(physical.binding, view)
                if not remotes:
                    self._gap(
                        "L2_PHYSICAL_TRANSPORT_UNKNOWN",
                        down_node_id,
                        self._dedupe(
                            binding_refs
                            + [rule_ref]
                            + self._physical_refs(physical.binding)
                        ),
                    )
                    continue
                for remote in remotes:
                    transport_prefix = self._prefix("physical")
                    remote_node = self._boundary_node(
                        remote.binding.interface_id,
                        "INGRESS",
                        rule.emit_stack,
                        f"{transport_prefix}:remote-lower",
                        self._physical_refs(remote.binding),
                    )
                    self._put_node(remote_node)
                    transport_refs = self._dedupe(
                        self._physical_refs(physical.binding)
                        + self._physical_refs(remote.binding)
                        + list(remote.l1_artifact.evidence_refs)
                    )
                    transport_edge = self._edge(
                        f"{transport_prefix}:transport",
                        down_node_id,
                        remote_node.id,
                        "PHYSICAL_TRANSPORT",
                        "L1",
                        transport_refs,
                    )
                    for upper in self._resolve_up(remote.binding.interface_id):
                        ingress_node_id, up_edge_ids = self._render_up(
                            transport_prefix,
                            remote_node.id,
                            rule.emit_stack,
                            upper,
                        )
                        self._remote_ingress_and_target(
                            query,
                            upper.interface_id,
                            rule.emit_stack,
                            ingress_node_id,
                            base_edges
                            + down_edge_ids
                            + [transport_edge.id]
                            + up_edge_ids,
                        )

        if not self.branches and not self.gaps:
            self._gap(
                "L2_TARGET_CONTEXT_PATH_UNKNOWN",
                context_node.id,
                self._dedupe(
                    ingress_refs + [self._ref("NetworkInterface", query.to.interface_id)]
                ),
            )
        return self._artifact(query, view)

    def _remote_ingress_and_target(
        self,
        query: L2ReachabilityQuery,
        interface_id: uuid.UUID,
        stack: StackKey,
        ingress_node_id: str,
        path_edge_ids: list[str],
    ) -> None:
        ingress = self.repository.get_l2_ingress_exact(
            interface_id, self._stack_key_json(stack)
        )
        if not ingress:
            self._gap(
                "L2_INGRESS_RULE_UNKNOWN",
                ingress_node_id,
                [self._ref("NetworkInterface", interface_id)],
            )
            return
        resolved = self._unique_ingress(interface_id, ingress, ingress_node_id)
        if resolved is None:
            return
        _, context_id, ingress_refs = resolved
        prefix = self._prefix("remote-ingress")
        context_node = self._context_node(context_id, prefix)
        self._put_node(context_node)
        ingress_edge = self._edge(
            f"{prefix}:ingress-decode",
            ingress_node_id,
            context_node.id,
            "INGRESS_DECODE",
            "L2",
            ingress_refs,
        )
        self._finish_target(
            query,
            context_id,
            context_node.id,
            path_edge_ids + [ingress_edge.id],
            ingress_refs,
        )

    def _finish_target(
        self,
        query: L2ReachabilityQuery,
        context_id: uuid.UUID,
        context_node_id: str,
        path_edge_ids: list[str],
        path_refs: list[EvidenceRef],
    ) -> None:
        target_bindings = [
            binding
            for binding in self.repository.get_l2_bindings_by_interface(
                [query.to.interface_id]
            )[query.to.interface_id]
            if binding.forwarding_context_id == context_id
        ]
        if not target_bindings:
            self._gap(
                "L2_TARGET_CONTEXT_PATH_UNKNOWN",
                context_node_id,
                self._dedupe(
                    path_refs + [self._ref("NetworkInterface", query.to.interface_id)]
                ),
            )
            return
        if len(target_bindings) > 1:
            raise ModelError(
                "Multiple L2Bindings exist for one interface and forwarding context",
                {
                    "interface_id": str(query.to.interface_id),
                    "forwarding_context_id": str(context_id),
                },
            )
        binding = target_bindings[0]
        rules = self.repository.get_l2_egress_rules([binding.binding_id])[binding.binding_id]
        if not rules:
            self._gap(
                "L2_EGRESS_RULE_UNKNOWN",
                context_node_id,
                self._dedupe(path_refs + self._binding_refs(binding)),
            )
            return
        if len(rules) > 1:
            raise ModelError(
                "Multiple effective L2EgressRules exist for one binding",
                {"binding_id": str(binding.binding_id)},
            )
        rule = rules[0]
        rule_ref = self._ref("L2EgressRule", rule.rule_id)
        if rule.emit_stack != self._stack_key(query.to.encapsulation_stack):
            self._gap(
                "L2_TARGET_CONTEXT_PATH_UNKNOWN",
                context_node_id,
                self._dedupe(path_refs + self._binding_refs(binding) + [rule_ref]),
            )
            return
        prefix = self._prefix("target")
        binding_node = self._binding_node(binding, prefix)
        self._put_node(binding_node)
        local_edge = self._edge(
            f"{prefix}:local-forward",
            context_node_id,
            binding_node.id,
            "LOCAL_FORWARD",
            "L2",
            self._binding_refs(binding),
        )
        target_node = self._boundary_node(
            query.to.interface_id,
            "EGRESS",
            rule.emit_stack,
            f"{prefix}:boundary",
            self._dedupe(self._binding_refs(binding) + [rule_ref]),
        )
        self._put_node(target_node)
        encode_edge = self._edge(
            f"{prefix}:egress-encode",
            binding_node.id,
            target_node.id,
            "EGRESS_ENCODE",
            "L2",
            self._dedupe(self._binding_refs(binding) + [rule_ref]),
        )
        self._add_branch(path_edge_ids + [local_edge.id, encode_edge.id])

    def _resolve_down(
        self, root_interface_id: uuid.UUID
    ) -> tuple[list[PhysicalCandidate], list[RealizationRecord]]:
        candidates: list[PhysicalCandidate] = []
        facts: list[RealizationRecord] = []

        def visit(
            interface_id: uuid.UUID,
            path: tuple[RealizationRecord, ...],
            ancestry: frozenset[uuid.UUID],
        ) -> None:
            for binding in self.repository.get_physical_bindings_by_interface([interface_id])[
                interface_id
            ]:
                candidates.append(PhysicalCandidate(binding, path))
            for realization in self.repository.get_realizations_down([interface_id])[
                interface_id
            ]:
                facts.append(realization)
                if realization.lower_interface_id in ancestry:
                    self._realization_cycle(realization)
                visit(
                    realization.lower_interface_id,
                    (*path, realization),
                    ancestry | {realization.lower_interface_id},
                )

        visit(root_interface_id, (), frozenset({root_interface_id}))
        return candidates, facts

    def _resolve_up(self, lower_interface_id: uuid.UUID) -> list[UpperCandidate]:
        candidates: list[UpperCandidate] = []

        def visit(
            interface_id: uuid.UUID,
            path: tuple[RealizationRecord, ...],
            ancestry: frozenset[uuid.UUID],
        ) -> None:
            candidates.append(UpperCandidate(interface_id, path))
            for realization in self.repository.get_realizations_up([interface_id])[interface_id]:
                if realization.upper_interface_id in ancestry:
                    self._realization_cycle(realization)
                visit(
                    realization.upper_interface_id,
                    (*path, realization),
                    ancestry | {realization.upper_interface_id},
                )

        visit(lower_interface_id, (), frozenset({lower_interface_id}))
        return candidates

    def _remote_physical_endpoints(
        self, source: PhysicalBindingRecord, view: EvaluationView
    ) -> list[RemotePhysicalCandidate]:
        source_address = PointMember(source.point_id, source.point_member)
        visited = {source_address}
        frontier = [source_address]
        endpoints: list[PhysicalBindingRecord] = []
        while frontier:
            adjacency = self.repository.get_l1_adjacency(frontier)
            next_frontier: list[PointMember] = []
            for current in frontier:
                for edge in adjacency[current]:
                    peer = PointMember(edge.peer_point_id, edge.peer_member)
                    if peer in visited:
                        continue
                    visited.add(peer)
                    bindings = self.repository.get_interfaces_by_point_members([peer])[peer]
                    bindings = [item for item in bindings if item.binding_id != source.binding_id]
                    if bindings:
                        endpoints.extend(bindings)
                    else:
                        next_frontier.append(peer)
            frontier = next_frontier

        resolver = L1Resolver(self.repository)
        result: list[RemotePhysicalCandidate] = []
        for endpoint in endpoints:
            artifact = resolver.resolve(
                L1TraceQuery(
                    **{
                        "from": {
                            "point_id": source.point_id,
                            "member_index": source.point_member,
                        },
                        "to": {
                            "point_id": endpoint.point_id,
                            "member_index": endpoint.point_member,
                        },
                    }
                ),
                view,
            )
            if artifact.verdict == "REACHABLE":
                result.append(RemotePhysicalCandidate(endpoint, artifact))
        return result

    def _render_down(
        self,
        prefix: str,
        root_node_id: str,
        stack: StackKey,
        candidate: PhysicalCandidate,
    ) -> tuple[str, list[str]]:
        current_node_id = root_node_id
        edge_ids: list[str] = []
        for index, realization in enumerate(candidate.realization_path):
            node = self._boundary_node(
                realization.lower_interface_id,
                "EGRESS",
                stack,
                f"{prefix}:down:{index}:{realization.realization_id}",
                self._realization_refs(realization),
            )
            self._put_node(node)
            edge = self._edge(
                f"{prefix}:realization-down:{index}:{realization.realization_id}",
                current_node_id,
                node.id,
                "REALIZATION_DOWN",
                "INTERFACE",
                self._realization_refs(realization),
            )
            current_node_id = node.id
            edge_ids.append(edge.id)
        return current_node_id, edge_ids

    def _render_up(
        self,
        prefix: str,
        root_node_id: str,
        stack: StackKey,
        candidate: UpperCandidate,
    ) -> tuple[str, list[str]]:
        current_node_id = root_node_id
        edge_ids: list[str] = []
        for index, realization in enumerate(candidate.realization_path):
            node = self._boundary_node(
                realization.upper_interface_id,
                "INGRESS",
                stack,
                f"{prefix}:up:{index}:{realization.realization_id}",
                self._realization_refs(realization),
            )
            self._put_node(node)
            edge = self._edge(
                f"{prefix}:realization-up:{index}:{realization.realization_id}",
                current_node_id,
                node.id,
                "REALIZATION_UP",
                "INTERFACE",
                self._realization_refs(realization),
            )
            current_node_id = node.id
            edge_ids.append(edge.id)
        return current_node_id, edge_ids

    def _unique_ingress(self, interface_id, ingress, node_id):
        by_context: dict[uuid.UUID, set[uuid.UUID]] = {}
        for candidate in ingress:
            by_context.setdefault(candidate.forwarding_context_id, set()).add(
                candidate.binding_id
            )
        corrupted = [context for context, ids in by_context.items() if len(ids) > 1]
        if corrupted:
            raise ModelError(
                "Multiple L2Bindings exist for one interface and forwarding context",
                {
                    "interface_id": str(interface_id),
                    "forwarding_context_ids": [str(value) for value in corrupted],
                },
            )
        pairs = {(item.binding_id, item.forwarding_context_id) for item in ingress}
        refs = [self._ref("NetworkInterface", interface_id)]
        for item in ingress:
            refs.extend(
                [
                    self._ref("L2Binding", item.binding_id),
                    self._ref("L2IngressRule", item.rule_id),
                    self._ref("L2ForwardingContext", item.forwarding_context_id),
                ]
            )
        refs = self._dedupe(refs)
        if len(pairs) != 1:
            self._gap("L2_INGRESS_AMBIGUOUS", node_id, refs)
            return None
        binding_id, context_id = next(iter(pairs))
        return binding_id, context_id, refs

    def _artifact(self, query, view) -> L2ReachabilityTraceArtifact:
        refs = self._dedupe(
            [ref for edge in self.edges.values() for ref in edge.evidence_refs]
            + [ref for gap in self.gaps for ref in gap.evidence_refs]
        )
        return L2ReachabilityTraceArtifact(
            query=query,
            evaluation_view=view,
            verdict="REACHABLE" if self.branches else "UNKNOWN",
            branches=self.branches,
            nodes=list(self.nodes.values()),
            edges=list(self.edges.values()),
            evidence_refs=refs,
            gaps=self.gaps,
            warnings=[],
        )

    def _add_branch(self, edge_ids: list[str]) -> None:
        refs = self._dedupe(
            [ref for edge_id in edge_ids for ref in self.edges[edge_id].evidence_refs]
        )
        self.branches.append(
            L2ReachabilityTraceBranch(
                branch_id=f"l2-reachable-branch:{len(self.branches) + 1}",
                edge_ids=edge_ids,
                evidence_refs=refs,
            )
        )

    def _edge(self, edge_id, from_id, to_id, kind, layer, refs) -> L2TraceEdge:
        edge = L2TraceEdge(
            id=f"l2-edge:{edge_id}",
            from_node_id=from_id,
            to_node_id=to_id,
            transition_kind=kind,
            layer=layer,
            evidence_refs=self._dedupe(refs),
        )
        self.edges[edge.id] = edge
        return edge

    def _gap(self, code, node_id, refs) -> None:
        self.gaps.append(
            L2TraceGap(code=code, node_id=node_id, evidence_refs=self._dedupe(refs))
        )

    def _prefix(self, label: str) -> str:
        self._sequence += 1
        return f"{label}:{self._sequence}"

    def _put_node(self, node: L2TraceNode) -> None:
        self.nodes[node.id] = node

    def _context_node(self, context_id: uuid.UUID, suffix: str) -> L2TraceNode:
        ref = self._ref("L2ForwardingContext", context_id)
        return L2TraceNode(
            id=f"l2-context:{context_id}:{suffix}",
            payload=L2ContextPayload(forwarding_context_id=context_id),
            canonical_refs=[ref],
        )

    def _binding_node(self, binding: L2BindingRecord, suffix: str) -> L2TraceNode:
        return L2TraceNode(
            id=f"l2-binding:{binding.binding_id}:{suffix}",
            payload=L2BindingPayload(
                binding_id=binding.binding_id,
                interface_id=binding.interface_id,
                forwarding_context_id=binding.forwarding_context_id,
            ),
            canonical_refs=self._binding_refs(binding),
        )

    def _boundary_node(self, interface_id, direction, stack, suffix, refs) -> L2TraceNode:
        return L2TraceNode(
            id=f"l2-boundary:{direction.lower()}:{interface_id}:{suffix}",
            payload=L2BoundaryPayload(
                interface_id=interface_id,
                direction=direction,
                encapsulation_stack=[
                    EncapsulationLabel(kind=kind, value=value) for kind, value in stack
                ],
            ),
            canonical_refs=self._dedupe(
                [self._ref("NetworkInterface", interface_id)] + refs
            ),
        )

    def _binding_refs(self, binding: L2BindingRecord) -> list[EvidenceRef]:
        return [
            self._ref("NetworkInterface", binding.interface_id),
            self._ref("L2Binding", binding.binding_id),
            self._ref("L2ForwardingContext", binding.forwarding_context_id),
        ]

    def _physical_refs(self, binding: PhysicalBindingRecord) -> list[EvidenceRef]:
        return [
            self._ref("NetworkInterface", binding.interface_id),
            self._ref("InterfacePhysicalBinding", binding.binding_id),
        ]

    def _realization_refs(self, realization: RealizationRecord) -> list[EvidenceRef]:
        return [
            self._ref("NetworkInterfaceRealization", realization.realization_id),
            self._ref("NetworkInterface", realization.upper_interface_id),
            self._ref("NetworkInterface", realization.lower_interface_id),
        ]

    @staticmethod
    def _realization_cycle(realization: RealizationRecord) -> None:
        raise ModelError(
            "NetworkInterfaceRealization graph contains a cycle",
            {
                "realization_id": str(realization.realization_id),
                "upper_interface_id": str(realization.upper_interface_id),
                "lower_interface_id": str(realization.lower_interface_id),
            },
        )

    @staticmethod
    def _stack_json(stack: list[EncapsulationLabel]) -> list[dict[str, object]]:
        return [label.model_dump() for label in stack]

    @staticmethod
    def _stack_key(stack: list[EncapsulationLabel]) -> StackKey:
        return tuple((label.kind, label.value) for label in stack)

    @staticmethod
    def _stack_key_json(stack: StackKey) -> list[dict[str, object]]:
        return [{"kind": kind, "value": value} for kind, value in stack]

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
