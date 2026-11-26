"""Read optical evidence from the same snapshot as the canonical L1 result."""
from collections import defaultdict
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from app import models as m
from app.repository import CanonicalRepository, PointMember
from app.resolver import L1Resolver, TraversalStep
from app.schemas import (
    EvidenceEdge, EvidenceRef, FiberType, InterfacePhysicalTraceArtifact, L1TraceTermination,
    OpticalConflict, OpticalDiagnostic, OpticalFact, OpticalProposedEnding, OpticalProvenance,
    PhysicalObjectL1TraceArtifact, PointMemberAddress, TraceArtifact,
)


def address(point: PointMember) -> PointMemberAddress:
    return PointMemberAddress(point_id=point.point_id, member_index=point.member_index)


def point_member(point: PointMemberAddress) -> PointMember:
    return PointMember(point.point_id, point.member_index)


@dataclass(frozen=True)
class Ending:
    source: Literal["BASE_MEMBER_MAPPING", "MODULE_MEMBER_MAPPING"]
    mapping_id: UUID
    scope_id: UUID
    revision_id: UUID
    key: UUID | str
    medium: str
    transceiver: dict | None = None


@dataclass(frozen=True)
class OpticalPreviewLine:
    members: tuple[PointMember | None, PointMember | None]
    fiber_type: FiberType | None = None
    cable_id: UUID | None = None
    refs: tuple[EvidenceRef, ...] = ()
    interfaces: tuple[UUID | None, UUID | None] = (None, None)


def diagnose(
    facts: list[OpticalFact], termination: L1TraceTermination | None = None, *, cycle: bool = False,
) -> OpticalDiagnostic:
    modes = [index for index, fact in enumerate(facts) if fact.value in ("SM", "MM")]
    comparisons = list(pairwise(modes))
    if cycle and len(modes) > 1:
        comparisons.append((modes[-1], modes[0]))
    conflicts = []
    for left, right in comparisons:
        if facts[left].value == facts[right].value:
            continue
        between = range(left + 1, right) if left < right else [
            *range(left + 1, len(facts)), *range(right),
        ]
        if any(facts[index].value == "COPPER" for index in between):
            continue
        unknown = [index for index in between if facts[index].value is None]
        conflicts.append(OpticalConflict(
            kind="END_TO_END" if unknown else "LOCAL",
            left_fact=left, right_fact=right, unknown_facts=unknown,
        ))

    reason = None
    if termination is not None:
        reason = "INCOMPLETE_PATH"
    elif not any(fact.source not in ("TRANSCEIVER", "ACTIVE_ENDING") for fact in facts):
        reason = "NO_SEGMENTS"
    elif not modes and all(fact.value == "NO_FIBER" for fact in facts):
        reason = "OPTICAL_MODE_UNESTABLISHED"

    if conflicts:
        status = "CONFLICT"
    elif reason or any(fact.value is None for fact in facts):
        status = "UNKNOWN"
    elif all(fact.value == "COPPER" for fact in facts):
        status = "NOT_APPLICABLE"
    elif modes and all(fact.value != "COPPER" for fact in facts):
        status = "CONSISTENT"
    else:
        status = "UNKNOWN"
        reason = "OPTICAL_MODE_UNESTABLISHED"
    return OpticalDiagnostic(status=status, facts=facts, conflicts=conflicts, termination=termination, reason=reason)


class OpticalEvidence:
    def __init__(self, session: Session, points: set[PointMember], edges: list[EvidenceEdge], *,
                 cable_ids: set[UUID] | None = None):
        self.endings: dict[UUID, Ending] = {}
        self.active: dict[PointMember, EvidenceRef] = {}
        self.facts: dict[tuple[UUID, PointMember, PointMember], OpticalFact] = {}
        point_ids = {point.point_id for point in points}
        base_revisions = set()
        module_links = {}
        if point_ids:
            self._read_base_endings(session, point_ids, base_revisions)
            self._read_module_endings(session, point_ids, module_links)
        if points:
            rows = session.execute(select(
                m.InterfacePhysicalBinding.point_id, m.InterfacePhysicalBinding.point_member,
                m.InterfacePhysicalBinding.id,
            ).where(tuple_(m.InterfacePhysicalBinding.point_id, m.InterfacePhysicalBinding.point_member).in_(
                [(point.point_id, point.member_index) for point in points]
            )))
            self.active = {PointMember(point, member): EvidenceRef(entity_type="InterfacePhysicalBinding", entity_id=identifier)
                           for point, member, identifier in rows}

        self.mappings = {}
        self.owners = {}
        if any(not any(ref.entity_type == "Cable" for ref in edge.evidence_refs) for edge in edges):
            self.owners = dict(session.execute(select(m.ConnectionPoint.id, m.ConnectionPoint.physical_object_id)
                                              .where(m.ConnectionPoint.id.in_(point_ids))).tuples().all())
        if base_revisions and edges:
            for link in session.scalars(select(m.BaseInternalLink).where(m.BaseInternalLink.base_revision_id.in_(base_revisions))):
                self._index_mappings("BASE_MEMBER_MAPPING", link.base_revision_id,
                                     link.slot_a_id, link.slot_b_id, link.member_mappings, link.id)
        if edges:
            for revision, links in module_links.items():
                for link in links:
                    self._index_mappings("MODULE_MEMBER_MAPPING", revision, link["from_endpoint_key"],
                                         link["to_endpoint_key"], link["member_mappings"], None)
        identifiers = (cable_ids or set()) | {
            ref.entity_id for edge in edges for ref in edge.evidence_refs if ref.entity_type == "Cable"
        }
        self.cables = dict(session.execute(select(m.Cable.id, m.Cable.fiber_type).where(
            m.Cable.id.in_(identifiers),
        )).tuples().all()) if identifiers else {}

    def _read_base_endings(self, session, point_ids, revisions):
        rows = session.execute(select(
            m.BuiltInEndpointMapping.connection_point_id, m.BuiltInEndpointMapping.id,
            m.ObjectConfiguration.id, m.ObjectConfiguration.base_revision_id,
            m.BuiltInEndpointDefinition.id, m.PortType.medium,
        ).select_from(m.BuiltInEndpointMapping)
            .join(m.ConnectionPoint, m.ConnectionPoint.id == m.BuiltInEndpointMapping.connection_point_id)
            .join(m.ObjectConfiguration, m.ObjectConfiguration.id == m.BuiltInEndpointMapping.configuration_id)
            .join(m.BuiltInEndpointDefinition, m.BuiltInEndpointDefinition.id == m.BuiltInEndpointMapping.definition_id)
            .join(m.PortType, m.PortType.id == m.BuiltInEndpointDefinition.port_type_id)
            .where(m.BuiltInEndpointMapping.connection_point_id.in_(point_ids),
                   m.ConnectionPoint.physical_object_id == m.ObjectConfiguration.physical_object_id,
                   m.ConnectionPoint.cardinality == m.BuiltInEndpointDefinition.cardinality,
                   m.ObjectConfiguration.base_revision_id == m.BuiltInEndpointDefinition.base_revision_id))
        for point, mapping, scope, revision, key, medium in rows:
            self.endings[point] = Ending("BASE_MEMBER_MAPPING", mapping, scope, revision, key, medium)
            revisions.add(revision)

    def _read_module_endings(self, session, point_ids, links):
        rows = session.execute(select(
            m.ModuleEndpointMapping.connection_point_id, m.ModuleEndpointMapping.id,
            m.ModuleInstallation.id, m.ModuleEndpointDefinition.definition_key, m.PortType.medium,
            m.ModuleTemplateRevision,
        ).select_from(m.ModuleEndpointMapping)
            .join(m.ConnectionPoint, m.ConnectionPoint.id == m.ModuleEndpointMapping.connection_point_id)
            .join(m.ModuleInstallation, m.ModuleInstallation.id == m.ModuleEndpointMapping.installation_id)
            .join(m.ObjectConfiguration, m.ObjectConfiguration.id == m.ModuleInstallation.configuration_id)
            .join(m.ModuleTemplateRevision, m.ModuleTemplateRevision.id == m.ModuleInstallation.module_revision_id)
            .join(m.ModuleEndpointDefinition, m.ModuleEndpointDefinition.id == m.ModuleEndpointMapping.definition_id)
            .join(m.PortType, m.PortType.id == m.ModuleEndpointDefinition.port_type_id)
            .where(m.ModuleEndpointMapping.connection_point_id.in_(point_ids),
                   m.ConnectionPoint.physical_object_id == m.ObjectConfiguration.physical_object_id,
                   m.ModuleEndpointDefinition.module_revision_id == m.ModuleInstallation.module_revision_id,
                   m.ConnectionPoint.cardinality == func.jsonb_array_length(m.PortType.members)))
        for point, mapping, scope, key, medium, revision in rows:
            if point in self.endings:
                del self.endings[point]  # Ambiguous provenance supplies no characteristic.
                continue
            self.endings[point] = Ending("MODULE_MEMBER_MAPPING", mapping, scope, revision.id, key, medium,
                                         revision.transceiver)
            links[revision.id] = revision.internal_links

    def _index_mappings(self, source, revision, left, right, mappings, link):
        for member in mappings:
            a = (left, member["from_member_index"])
            b = (right, member["to_member_index"])
            value = member.get("fiber_type")
            self.mappings[source, revision, frozenset((a, b))] = (
                value if value in ("SM", "MM", "NO_FIBER") else None, link,
            )

    def _copper(self, points: tuple[PointMember | None, PointMember | None]) -> bool:
        return all(point is not None and (ending := self.endings.get(point.point_id)) is not None
                   and ending.medium == "COPPER" for point in points)

    def segment(self, edge: EvidenceEdge, left: PointMember, right: PointMember) -> OpticalFact:
        member_id = next(ref.entity_id for ref in edge.evidence_refs if ref.entity_type == "ConnectionMember")
        key = (member_id, left, right)
        if key not in self.facts:
            self.facts[key] = self._segment(edge, left, right)
        fact = self.facts[key]
        return fact if fact.trace_edge_id == edge.id else fact.model_copy(update={"trace_edge_id": edge.id})

    def _segment(self, edge: EvidenceEdge, left: PointMember, right: PointMember) -> OpticalFact:
        facts = dict(points=[address(left), address(right)], trace_edge_id=edge.id, canonical_refs=edge.evidence_refs)
        cable_id = next((ref.entity_id for ref in edge.evidence_refs if ref.entity_type == "Cable"), None)
        if cable_id is not None:
            value = self.cables[cable_id]
            if value is None and self._copper((left, right)):
                value = "COPPER"
            return OpticalFact(source="CABLE", value=value,
                               unknown_reason="FIBER_TYPE_UNSPECIFIED" if value is None else None, **facts)
        a, b = (self.endings.get(point.point_id) for point in (left, right))
        if a is not None and b is not None and (a.source, a.scope_id) == (b.source, b.scope_id):
            mapping = self.mappings.get((a.source, a.revision_id, frozenset(
                ((a.key, left.member_index), (b.key, right.member_index))
            )))
            if mapping is not None:
                value, link_id = mapping
                if value is None and self._copper((left, right)):
                    value = "COPPER"
                return OpticalFact(
                    source=a.source, value=value,
                    unknown_reason="FIBER_TYPE_UNSPECIFIED" if value is None else None,
                    provenance=OpticalProvenance(revision_id=a.revision_id,
                                                 mapping_ids=[a.mapping_id, b.mapping_id], internal_link_id=link_id),
                    **facts,
                )
        if self.owners[left.point_id] == self.owners[right.point_id]:
            return OpticalFact(source="UNRESOLVED_INTERNAL_CONNECTION",
                               unknown_reason="INTERNAL_PROVENANCE_UNKNOWN", **facts)
        return OpticalFact(source="DIRECT_CONNECTION", unknown_reason="DIRECT_CONSTRUCTION_UNKNOWN", **facts)

    def endpoint(self, point: PointMember) -> OpticalFact | None:
        ending = self.endings.get(point.point_id)
        binding = self.active.get(point)
        refs = [EvidenceRef(entity_type="ConnectionPoint", entity_id=point.point_id)]
        if binding:
            refs.append(binding)
        if ending is not None and ending.transceiver is not None:
            value = ending.transceiver.get("fiber_type")
            if value not in ("SM", "MM"):
                value = "COPPER" if value is None and ending.medium == "COPPER" else None
            return OpticalFact(source="TRANSCEIVER", value=value, points=[address(point)], canonical_refs=refs,
                               unknown_reason="TRANSCEIVER_FIBER_TYPE_UNKNOWN" if value is None else None,
                               provenance=OpticalProvenance(revision_id=ending.revision_id, mapping_ids=[ending.mapping_id]))
        if binding:
            return OpticalFact(
                source="ACTIVE_ENDING", value="COPPER" if ending and ending.medium == "COPPER" else None,
                unknown_reason=None if ending and ending.medium == "COPPER" else "ACTIVE_ENDING_CHARACTERISTIC_UNKNOWN",
                points=[address(point)], canonical_refs=refs,
            )
        return None


class TraceOpticalEvidence:
    """Follow the ordered edges already selected by each resolver, using a shared fact cache."""
    def __init__(self, session: Session, nodes, edges):
        self.points = {node.id: point_member(node.payload) for node in nodes if isinstance(node.payload, PointMemberAddress)}
        self.edges = {edge.id: edge for edge in edges if edge.layer == "L1"}
        self.evidence = OpticalEvidence(session, set(self.points.values()), list(self.edges.values()))

    def path(self, source_id, edge_ids, termination=None, *, cycle=False):
        current = source_id
        facts = []
        if not cycle and (endpoint := self.evidence.endpoint(self.points[current])) is not None:
            facts.append(endpoint)
        for edge_id in edge_ids:
            edge = self.edges.get(edge_id)
            if edge is None:  # Composed interface evidence also contains realization and binding edges.
                continue
            peer = edge.to_node_id if current == edge.from_node_id else edge.from_node_id
            facts.append(self.evidence.segment(edge, self.points[current], self.points[peer]))
            current = peer
        if not cycle and current != source_id and (termination is None or termination.reason != "INVALID_CANONICAL_DATA"):
            if (endpoint := self.evidence.endpoint(self.points[current])) is not None:
                facts.append(endpoint)
        return diagnose(facts, termination, cycle=cycle)

    def exact(self, result: TraceArtifact):
        source = result.nodes[0].id
        if result.verdict == "REACHABLE":
            result.optical_diagnostics = [self.path(source, [edge.id for edge in result.edges])]
            return
        # The exact resolver emits the predecessor tree first, then its closing edges.
        parents = {}
        closures = defaultdict(list)
        for edge in result.edges:
            if edge.to_node_id == source or edge.to_node_id in parents:
                closures[edge.to_node_id].append(edge)
            else:
                parents[edge.to_node_id] = edge

        def prefix(node_id):
            ordered = []
            while node_id != source:
                edge = parents[node_id]
                ordered.append(edge.id)
                node_id = edge.from_node_id
            return list(reversed(ordered))

        for end in result.terminations:
            if end.reason == "CYCLE":
                closing = closures[end.node_id].pop(0)
                left, right = prefix(closing.from_node_id), prefix(closing.to_node_id)
                common = source
                shared = 0
                for first, second in zip(left, right):
                    if first != second:
                        break
                    common = self.edges[first].to_node_id
                    shared += 1
                cycle_edges = [*left[shared:], closing.id, *reversed(right[shared:])]
                result.optical_diagnostics.append(self.path(common, cycle_edges, end, cycle=True))
            else:
                result.optical_diagnostics.append(self.path(source, prefix(end.node_id), end))


def diagnose_exact_traces(session: Session, results: list[TraceArtifact]) -> None:
    evidence = TraceOpticalEvidence(session, [node for result in results for node in result.nodes],
                                   [edge for result in results for edge in result.edges])
    for result in results:
        # The same canonical edge may appear in opposite directions in different results.
        evidence.edges = {edge.id: edge for edge in result.edges}
        evidence.exact(result)


def diagnose_composed_trace(session: Session, result: InterfacePhysicalTraceArtifact | PhysicalObjectL1TraceArtifact) -> None:
    if isinstance(result, InterfacePhysicalTraceArtifact):
        if not result.branches:
            return
        evidence = TraceOpticalEvidence(session, result.nodes, result.edges)
        bindings = {edge.id: edge for edge in result.edges if edge.layer == "BRIDGE"}
        for branch in result.branches:
            source = next(bindings[edge_id].to_node_id for edge_id in branch.edge_ids if edge_id in bindings)
            branch.optical_diagnostic = evidence.path(source, branch.edge_ids)
    elif result.branches or result.cycles:
        evidence = TraceOpticalEvidence(session, result.nodes, result.edges)
        for branch in result.branches:
            branch.optical_diagnostic = evidence.path(L1Resolver._node_id(point_member(branch.source)), branch.edge_ids)
        for cycle in result.cycles:
            cycle.optical_diagnostic = evidence.path(cycle.state_node_ids[0], cycle.edge_ids, cycle=True)


def diagnose_preview(session: Session, lines: list[OpticalPreviewLine]) -> list[OpticalDiagnostic]:
    points = {point for line in lines for point in line.members if point is not None}
    links = CanonicalRepository(session).get_l1_member_links_batch(list(points))
    adjacent = {}
    for point, (active, edges) in links.items():
        if active:
            continue
        for link in edges:
            if not link.external:
                peer = PointMember(link.peer_point_id, link.peer_member)
                adjacent[point] = (L1Resolver.evidence_edge(TraversalStep(point, peer, link)), peer)

    edges = [edge for edge, _ in adjacent.values()]
    evidence = OpticalEvidence(session, points | {peer for _, peer in adjacent.values()}, edges,
                               cable_ids={line.cable_id for line in lines if line.cable_id is not None})
    results = []
    for line in lines:
        value = evidence.cables[line.cable_id] if line.cable_id is not None else line.fiber_type
        if value is None and evidence._copper(line.members):
            value = "COPPER"
        sides = list(zip(line.members, line.interfaces, ("A", "B"), strict=True))
        proposed = {side: OpticalProposedEnding(side=side, interface_id=interface,
                                                member_index=point.member_index if point else 1)
                    for point, interface, side in sides if interface is not None}
        refs = [*line.refs]
        for point, interface, _ in sides:
            if interface is not None:
                refs.append(EvidenceRef(entity_type="NetworkInterface", entity_id=interface))
            elif point is not None:
                refs.append(EvidenceRef(entity_type="ConnectionPoint", entity_id=point.point_id))
        if line.cable_id is not None:
            refs.append(EvidenceRef(entity_type="Cable", entity_id=line.cable_id))
        cable = OpticalFact(
            source="CABLE" if line.cable_id is not None else "PROPOSED_CABLE", value=value,
            unknown_reason="FIBER_TYPE_UNSPECIFIED" if value is None else None,
            points=[address(point) for point, interface, _ in sides if point is not None and interface is None],
            canonical_refs=refs, proposed_endings=list(proposed.values()),
        )
        side_facts = []
        for point, interface, side in sides:
            if interface is not None:
                ref = EvidenceRef(entity_type="NetworkInterface", entity_id=interface)
                known = evidence.endpoint(point) if point is not None else None
                if known is None:
                    fact = OpticalFact(source="ACTIVE_ENDING", unknown_reason="ACTIVE_ENDING_CHARACTERISTIC_UNKNOWN",
                                       points=[], canonical_refs=[ref], proposed_endings=[proposed[side]])
                else:
                    provenance = known.provenance.model_copy(update={"mapping_ids": []}) if known.provenance else None
                    fact = known.model_copy(update={"points": [], "canonical_refs": [ref], "provenance": provenance,
                                                    "proposed_endings": [proposed[side]]})
            elif point in adjacent:
                edge, peer = adjacent[point]
                fact = evidence.segment(edge, peer, point) if side == "A" else evidence.segment(edge, point, peer)
                fact = fact.model_copy(update={"trace_edge_id": None})
            else:
                fact = evidence.endpoint(point) if point is not None else None
            side_facts.append(fact)
        a, b = side_facts
        results.append(diagnose([fact for fact in (a, cable, b) if fact is not None]))
    return results
