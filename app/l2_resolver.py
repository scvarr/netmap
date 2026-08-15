import uuid
from dataclasses import dataclass
from typing import Any, Literal

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
class BoundaryState:
    interface_id: uuid.UUID
    direction: Literal["INGRESS", "EGRESS"]
    encapsulation_stack: StackKey


@dataclass(frozen=True)
class ContextState:
    forwarding_context_id: uuid.UUID
    ingress_binding_id: uuid.UUID


SemanticState = BoundaryState | ContextState


@dataclass(frozen=True)
class TraversalFrame:
    state: SemanticState
    node_id: str
    edge_ids: tuple[str, ...]
    ancestry: frozenset[SemanticState]


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
    VERSION = "l2-configured-multihop/3.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.nodes: dict[str, L2TraceNode] = {}
        self.edges: dict[str, L2TraceEdge] = {}
        self.gaps: list[L2TraceGap] = []
        self.branches: list[L2ReachabilityTraceBranch] = []
        self._sequence = 0
        self._last_state_node_id: str | None = None

    def resolve(
        self, query: L2ReachabilityQuery, view: EvaluationView
    ) -> L2ReachabilityTraceArtifact:
        self.repository.validate_network_interface(query.from_.interface_id)
        self.repository.validate_network_interface(query.to.interface_id)
        source_state = BoundaryState(
            interface_id=query.from_.interface_id,
            direction="INGRESS",
            encapsulation_stack=self._stack_key(query.from_.encapsulation_stack),
        )
        source_node = self._boundary_node(source_state, "source", [])
        self._put_node(source_node)
        frontier = [TraversalFrame(source_state, source_node.id, (), frozenset())]
        target_state = BoundaryState(
            interface_id=query.to.interface_id,
            direction="EGRESS",
            encapsulation_stack=self._stack_key(query.to.encapsulation_stack),
        )

        while frontier:
            frame = frontier.pop()
            self._last_state_node_id = frame.node_id
            if frame.state in frame.ancestry:
                continue
            if frame.state == target_state:
                self._add_branch(list(frame.edge_ids))
                continue
            ancestry = frame.ancestry | {frame.state}
            if isinstance(frame.state, ContextState):
                frontier.extend(self._expand_context(frame, ancestry, target_state))
            elif frame.state.direction == "INGRESS":
                next_frame = self._expand_ingress(frame, ancestry)
                if next_frame is not None:
                    frontier.append(next_frame)
            else:
                frontier.extend(self._expand_egress(frame, ancestry, view))

        if not self.branches and not self.gaps:
            self._gap(
                "L2_TARGET_CONTEXT_PATH_UNKNOWN",
                self._last_state_node_id or source_node.id,
                [
                    self._ref("NetworkInterface", query.from_.interface_id),
                    self._ref("NetworkInterface", query.to.interface_id),
                ],
            )
        return self._artifact(query, view)

    def _expand_ingress(
        self,
        frame: TraversalFrame,
        ancestry: frozenset[SemanticState],
    ) -> TraversalFrame | None:
        state = frame.state
        assert isinstance(state, BoundaryState) and state.direction == "INGRESS"
        ingress = self.repository.get_l2_ingress_exact(
            state.interface_id, self._stack_key_json(state.encapsulation_stack)
        )
        if not ingress:
            self._gap(
                "L2_INGRESS_RULE_UNKNOWN",
                frame.node_id,
                [self._ref("NetworkInterface", state.interface_id)],
            )
            return None
        resolved = self._unique_ingress(state.interface_id, ingress, frame.node_id)
        if resolved is None:
            return None
        binding_id, context_id, ingress_refs = resolved
        context_state = ContextState(context_id, binding_id)
        context_node = self._context_node(context_state, self._prefix("context"))
        self._put_node(context_node)
        ingress_edge = self._edge(
            self._prefix("ingress-decode"),
            frame.node_id,
            context_node.id,
            "INGRESS_DECODE",
            "L2",
            ingress_refs,
        )
        return TraversalFrame(
            context_state,
            context_node.id,
            (*frame.edge_ids, ingress_edge.id),
            ancestry,
        )

    def _expand_context(
        self,
        frame: TraversalFrame,
        ancestry: frozenset[SemanticState],
        target_state: BoundaryState,
    ) -> list[TraversalFrame]:
        state = frame.state
        assert isinstance(state, ContextState)
        bindings = self.repository.get_l2_bindings_by_context(
            [state.forwarding_context_id]
        )[state.forwarding_context_id]
        egress_bindings = [
            binding for binding in bindings if binding.binding_id != state.ingress_binding_id
        ]
        if not egress_bindings:
            self._gap(
                "L2_TARGET_CONTEXT_PATH_UNKNOWN",
                frame.node_id,
                [
                    self._ref("L2ForwardingContext", state.forwarding_context_id),
                    self._ref("L2Binding", state.ingress_binding_id),
                ],
            )
            return []
        rules_by_binding = self.repository.get_l2_egress_rules(
            [binding.binding_id for binding in egress_bindings]
        )
        result: list[TraversalFrame] = []
        for binding in egress_bindings:
            binding_refs = self._binding_refs(binding)
            rules = rules_by_binding[binding.binding_id]
            if not rules:
                self._gap(
                    "L2_EGRESS_RULE_UNKNOWN",
                    frame.node_id,
                    binding_refs,
                )
                continue
            if len(rules) > 1:
                raise ModelError(
                    "Multiple effective L2EgressRules exist for one binding",
                    {"binding_id": str(binding.binding_id)},
                )
            rule = rules[0]
            rule_ref = self._ref("L2EgressRule", rule.rule_id)
            prefix = self._prefix("local")
            binding_node = self._binding_node(binding, prefix)
            self._put_node(binding_node)
            local_edge = self._edge(
                f"{prefix}:forward",
                frame.node_id,
                binding_node.id,
                "LOCAL_FORWARD",
                "L2",
                binding_refs,
            )
            boundary_state = BoundaryState(
                binding.interface_id, "EGRESS", rule.emit_stack
            )
            boundary_node = self._boundary_node(
                boundary_state,
                f"{prefix}:egress",
                self._dedupe(binding_refs + [rule_ref]),
            )
            self._put_node(boundary_node)
            encode_edge = self._edge(
                f"{prefix}:encode",
                binding_node.id,
                boundary_node.id,
                "EGRESS_ENCODE",
                "L2",
                self._dedupe(binding_refs + [rule_ref]),
            )
            edge_ids = (*frame.edge_ids, local_edge.id, encode_edge.id)
            if (
                boundary_state.interface_id == target_state.interface_id
                and boundary_state != target_state
            ):
                self._gap(
                    "L2_TARGET_CONTEXT_PATH_UNKNOWN",
                    boundary_node.id,
                    self._dedupe(binding_refs + [rule_ref]),
                )
            result.append(
                TraversalFrame(
                    boundary_state,
                    boundary_node.id,
                    edge_ids,
                    ancestry,
                )
            )
        return result

    def _expand_egress(
        self,
        frame: TraversalFrame,
        ancestry: frozenset[SemanticState],
        view: EvaluationView,
    ) -> list[TraversalFrame]:
        state = frame.state
        assert isinstance(state, BoundaryState) and state.direction == "EGRESS"
        physical_candidates, realization_facts = self._resolve_down(state.interface_id)
        if not physical_candidates:
            refs = [self._ref("NetworkInterface", state.interface_id)]
            for realization in realization_facts:
                refs.extend(self._realization_refs(realization))
            self._gap(
                "L2_PHYSICAL_TRANSPORT_UNKNOWN",
                frame.node_id,
                self._dedupe(refs),
            )
            return []

        result: list[TraversalFrame] = []
        for physical in physical_candidates:
            down_node_id, down_edge_ids = self._render_down(
                frame.node_id, state.encapsulation_stack, physical
            )
            remotes = self._remote_physical_endpoints(physical.binding, view)
            if not remotes:
                self._gap(
                    "L2_PHYSICAL_TRANSPORT_UNKNOWN",
                    down_node_id,
                    self._physical_refs(physical.binding),
                )
                continue
            for remote in remotes:
                prefix = self._prefix("physical")
                remote_state = BoundaryState(
                    remote.binding.interface_id,
                    "INGRESS",
                    state.encapsulation_stack,
                )
                remote_node = self._boundary_node(
                    remote_state,
                    f"{prefix}:remote-lower",
                    self._physical_refs(remote.binding),
                )
                self._put_node(remote_node)
                transport_refs = self._dedupe(
                    self._physical_refs(physical.binding)
                    + self._physical_refs(remote.binding)
                    + list(remote.l1_artifact.evidence_refs)
                )
                transport_edge = self._edge(
                    f"{prefix}:transport",
                    down_node_id,
                    remote_node.id,
                    "PHYSICAL_TRANSPORT",
                    "L1",
                    transport_refs,
                )
                for upper in self._resolve_up(remote.binding.interface_id):
                    ingress_state, ingress_node_id, up_edge_ids = self._render_up(
                        prefix,
                        remote_state,
                        remote_node.id,
                        upper,
                    )
                    result.append(
                        TraversalFrame(
                            ingress_state,
                            ingress_node_id,
                            (
                                *frame.edge_ids,
                                *down_edge_ids,
                                transport_edge.id,
                                *up_edge_ids,
                            ),
                            ancestry,
                        )
                    )
        return result

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
            bindings = self.repository.get_physical_bindings_by_interface([interface_id])[
                interface_id
            ]
            candidates.extend(PhysicalCandidate(binding, path) for binding in bindings)
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
        root_node_id: str,
        stack: StackKey,
        candidate: PhysicalCandidate,
    ) -> tuple[str, list[str]]:
        current_node_id = root_node_id
        edge_ids: list[str] = []
        prefix = self._prefix("down")
        for index, realization in enumerate(candidate.realization_path):
            state = BoundaryState(realization.lower_interface_id, "EGRESS", stack)
            node = self._boundary_node(
                state,
                f"{prefix}:{index}:{realization.realization_id}",
                self._realization_refs(realization),
            )
            self._put_node(node)
            edge = self._edge(
                f"{prefix}:{index}:{realization.realization_id}",
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
        root_state: BoundaryState,
        root_node_id: str,
        candidate: UpperCandidate,
    ) -> tuple[BoundaryState, str, list[str]]:
        current_state = root_state
        current_node_id = root_node_id
        edge_ids: list[str] = []
        for index, realization in enumerate(candidate.realization_path):
            current_state = BoundaryState(
                realization.upper_interface_id,
                "INGRESS",
                root_state.encapsulation_stack,
            )
            node = self._boundary_node(
                current_state,
                f"{prefix}:up:{index}:{realization.realization_id}",
                self._realization_refs(realization),
            )
            self._put_node(node)
            edge = self._edge(
                f"{prefix}:up:{index}:{realization.realization_id}",
                current_node_id,
                node.id,
                "REALIZATION_UP",
                "INTERFACE",
                self._realization_refs(realization),
            )
            current_node_id = node.id
            edge_ids.append(edge.id)
        return current_state, current_node_id, edge_ids

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

    def _context_node(self, state: ContextState, suffix: str) -> L2TraceNode:
        refs = [
            self._ref("L2ForwardingContext", state.forwarding_context_id),
            self._ref("L2Binding", state.ingress_binding_id),
        ]
        return L2TraceNode(
            id=(
                f"l2-context:{state.forwarding_context_id}:"
                f"{state.ingress_binding_id}:{suffix}"
            ),
            payload=L2ContextPayload(
                forwarding_context_id=state.forwarding_context_id,
                ingress_binding_id=state.ingress_binding_id,
            ),
            canonical_refs=refs,
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

    def _boundary_node(
        self, state: BoundaryState, suffix: str, refs: list[EvidenceRef]
    ) -> L2TraceNode:
        return L2TraceNode(
            id=f"l2-boundary:{state.direction.lower()}:{state.interface_id}:{suffix}",
            payload=L2BoundaryPayload(
                interface_id=state.interface_id,
                direction=state.direction,
                encapsulation_stack=[
                    EncapsulationLabel(kind=kind, value=value)
                    for kind, value in state.encapsulation_stack
                ],
            ),
            canonical_refs=self._dedupe(
                [self._ref("NetworkInterface", state.interface_id)] + refs
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
