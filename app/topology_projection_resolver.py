import uuid
from dataclasses import dataclass

from app.device_catalog import (
    DeviceCatalog,
    DisplayAliasRecord,
    PhysicalObjectClassRecord,
)
from app.errors import ModelError, ValidationError
from app.repository import (
    CanonicalRepository,
    L1AdjacencyEdge,
    NetworkInterfacePhysicalOwnerRecord,
    PhysicalConnectionMemberRecord,
    PhysicalBindingRecord,
    PointMember,
    RealizationRecord,
)
from app.schemas import (
    EvaluationView,
    ProjectionSourceRef,
    TopologyProjectionDocument,
    TopologyProjectionEdge,
    TopologyProjectionNode,
    TopologyProjectionRequest,
)


@dataclass(frozen=True)
class _PhysicalCandidate:
    root_owner: NetworkInterfacePhysicalOwnerRecord
    binding: PhysicalBindingRecord
    realization_path: tuple[RealizationRecord, ...]


@dataclass(frozen=True)
class _L1Step:
    source: PointMember
    target: PointMember
    edge: L1AdjacencyEdge


@dataclass(frozen=True)
class _SupportingPath:
    source: _PhysicalCandidate
    target_binding: PhysicalBindingRecord
    target_owner: NetworkInterfacePhysicalOwnerRecord
    steps: tuple[_L1Step, ...]


class ConfiguredTopologyProjectionResolver:
    VERSION = "topology-projection-configured/1.1"
    EDGE_KIND = "L2_DEVICE_LINK"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self,
        request: TopologyProjectionRequest,
        evaluation_view: EvaluationView,
    ) -> TopologyProjectionDocument:
        self._validate_request(request)
        if evaluation_view.mode != "CONFIGURED":  # defensive boundary for future view modes
            raise ValidationError(
                "Topology projection supports only CONFIGURED view",
                {"reason": "PROJECTION_VIEW_UNSUPPORTED"},
            )
        if request.layer == "L1":
            return self._resolve_l1_physical(request)

        owners = self.repository.get_network_interface_physical_owners()
        owner_by_interface = {owner.interface_id: owner for owner in owners}
        owners_by_object: dict[
            uuid.UUID, list[NetworkInterfacePhysicalOwnerRecord]
        ] = {}
        for owner in owners:
            owners_by_object.setdefault(owner.physical_object_id, []).append(owner)

        explicit_ids = self.repository.require_physical_objects(
            [ref.entity_id for ref in request.scope.include_entities]
        )
        gaps: set[str] = set()
        if explicit_ids:
            selected_object_ids = {
                object_id for object_id in explicit_ids if object_id in owners_by_object
            }
            if len(selected_object_ids) != len(explicit_ids):
                gaps.add("ENTITY_NOT_REPRESENTABLE_AT_DEVICE_LEVEL")
        else:
            selected_object_ids = set(owners_by_object)

        display_aliases = DeviceCatalog(
            self.repository.session
        ).physical_object_display_aliases(list(selected_object_ids))

        nodes = [
            self._node(
                object_id,
                owners_by_object[object_id],
                display_aliases.get(object_id),
            )
            for object_id in sorted(selected_object_ids, key=self._node_id)
        ]

        paths_by_pair: dict[
            tuple[uuid.UUID, uuid.UUID], dict[tuple[str, ...], _SupportingPath]
        ] = {}
        for source_owner in sorted(
            (owner for owner in owners if owner.physical_object_id in selected_object_ids),
            key=lambda value: (str(value.physical_object_id), str(value.interface_id)),
        ):
            for candidate in self._physical_candidates(source_owner):
                paths, owner_unknown = self._walk_passive_l1(
                    candidate, owner_by_interface
                )
                if owner_unknown:
                    gaps.add("NETWORK_INTERFACE_OWNER_UNKNOWN")
                for path in paths:
                    source_object_id = path.source.root_owner.physical_object_id
                    target_object_id = path.target_owner.physical_object_id
                    if source_object_id == target_object_id:
                        continue
                    if target_object_id not in selected_object_ids:
                        continue
                    pair = tuple(
                        sorted((source_object_id, target_object_id), key=self._node_id)
                    )
                    paths_by_pair.setdefault(pair, {})[self._path_key(path)] = path

        edges = [
            self._edge(pair, tuple(paths_by_pair[pair].values()))
            for pair in sorted(
                paths_by_pair,
                key=lambda value: (self._node_id(value[0]), self._node_id(value[1])),
            )
        ]
        return TopologyProjectionDocument(
            layer="L2",
            detail_level="DEVICE",
            nodes=nodes,
            edges=edges,
            gaps=sorted(gaps),
            warnings=[],
        )

    def _resolve_l1_physical(
        self, request: TopologyProjectionRequest
    ) -> TopologyProjectionDocument:
        explicit_ids = self.repository.require_physical_objects(
            [ref.entity_id for ref in request.scope.include_entities]
        )
        selected_object_ids = set(
            explicit_ids or self.repository.get_physical_object_ids()
        )
        owners_by_object: dict[
            uuid.UUID, list[NetworkInterfacePhysicalOwnerRecord]
        ] = {}
        for owner in self.repository.get_network_interface_physical_owners():
            if owner.physical_object_id in selected_object_ids:
                owners_by_object.setdefault(owner.physical_object_id, []).append(owner)

        point_ids_by_object: dict[uuid.UUID, list[uuid.UUID]] = {}
        for point in self.repository.get_all_connection_point_records():
            if point.physical_object_id not in selected_object_ids:
                continue
            point_ids_by_object.setdefault(point.physical_object_id, []).append(
                point.point_id
            )

        aliases = DeviceCatalog(
            self.repository.session
        ).physical_object_display_aliases(list(selected_object_ids))
        classes = DeviceCatalog(self.repository.session).physical_object_classes(
            list(selected_object_ids)
        )
        nodes = [
            self._physical_node(
                object_id,
                point_ids_by_object.get(object_id, []),
                owners_by_object.get(object_id, []),
                aliases.get(object_id),
                classes.get(object_id),
            )
            for object_id in sorted(selected_object_ids, key=self._physical_node_id)
        ]

        members_by_pair: dict[
            tuple[uuid.UUID, uuid.UUID], list[PhysicalConnectionMemberRecord]
        ] = {}
        for member in self.repository.get_physical_connection_member_records():
            if member.object_a_id == member.object_b_id:
                continue
            if not {
                member.object_a_id,
                member.object_b_id,
            }.issubset(selected_object_ids):
                continue
            pair = tuple(
                sorted(
                    (member.object_a_id, member.object_b_id),
                    key=self._physical_node_id,
                )
            )
            members_by_pair.setdefault(pair, []).append(member)

        edges = [
            self._physical_edge(pair, tuple(members_by_pair[pair]))
            for pair in sorted(
                members_by_pair,
                key=lambda value: (
                    self._physical_node_id(value[0]),
                    self._physical_node_id(value[1]),
                ),
            )
        ]
        return TopologyProjectionDocument(
            layer="L1",
            detail_level="PHYSICAL_OBJECT",
            nodes=nodes,
            edges=edges,
            gaps=[],
            warnings=[],
        )

    def _validate_request(self, request: TopologyProjectionRequest) -> None:
        if (request.layer, request.detail_level) not in {
            ("L1", "PHYSICAL_OBJECT"),
            ("L2", "DEVICE"),
        }:
            raise ValidationError(
                "Topology projection layer/detail level combination is not supported",
                {
                    "reason": "PROJECTION_LAYER_DETAIL_UNSUPPORTED",
                    "layer": request.layer,
                    "detail_level": request.detail_level,
                },
            )
        if request.scope.include_location_subtrees:
            raise ValidationError(
                "Location subtree scope is not supported",
                {"reason": "PROJECTION_LOCATION_SCOPE_UNSUPPORTED"},
            )
        if request.grouping:
            raise ValidationError(
                "Topology projection grouping is not supported",
                {"reason": "PROJECTION_GROUPING_UNSUPPORTED"},
            )
        if request.filters:
            raise ValidationError(
                "Topology projection filters are not supported",
                {"reason": "PROJECTION_FILTER_UNSUPPORTED"},
            )
        invalid_refs = [
            ref
            for ref in request.scope.include_entities
            if ref.entity_type != "PhysicalObject"
        ]
        if invalid_refs:
            raise ValidationError(
                "Projection include_entities supports only PhysicalObject refs",
                {
                    "reason": "PROJECTION_ENTITY_SCOPE_UNSUPPORTED",
                    "entity_types": sorted({ref.entity_type for ref in invalid_refs}),
                },
            )

    def _physical_node(
        self,
        physical_object_id: uuid.UUID,
        point_ids: list[uuid.UUID],
        owners: list[NetworkInterfacePhysicalOwnerRecord],
        display_alias: DisplayAliasRecord | None,
        object_class: PhysicalObjectClassRecord | None,
    ) -> TopologyProjectionNode:
        refs = [self._ref("PhysicalObject", physical_object_id)]
        if display_alias is not None:
            refs.append(self._ref("EntityMetadata", display_alias.metadata_id))
        if object_class is not None:
            refs.append(self._ref("EntityMetadata", object_class.metadata_id))
        refs.extend(self._ref("ConnectionPoint", point_id) for point_id in point_ids)
        for owner in owners:
            refs.extend(
                [
                    self._ref("NetworkInterfacePhysicalOwner", owner.owner_relation_id),
                    self._ref("NetworkInterface", owner.interface_id),
                ]
            )
        return TopologyProjectionNode(
            id=self._physical_node_id(physical_object_id),
            kind="PHYSICAL_OBJECT",
            label=(
                display_alias.value
                if display_alias is not None
                else f"PhysicalObject {str(physical_object_id)[:8]}"
            ),
            source_refs=self._dedupe_refs(refs),
            attributes={
                "label_source": (
                    "ALIAS_DISPLAY" if display_alias is not None else "TECHNICAL_FALLBACK"
                ),
                "connection_point_count": len(point_ids),
                "owned_interface_count": len(owners),
                **({"class": object_class.value} if object_class is not None else {}),
            },
            status="CONFIGURED",
        )

    def _physical_edge(
        self,
        pair: tuple[uuid.UUID, uuid.UUID],
        members: tuple[PhysicalConnectionMemberRecord, ...],
    ) -> TopologyProjectionEdge:
        refs = [
            self._ref("PhysicalObject", pair[0]),
            self._ref("PhysicalObject", pair[1]),
        ]
        connection_ids: set[uuid.UUID] = set()
        member_ids: set[uuid.UUID] = set()
        for member in members:
            connection_ids.add(member.connection_id)
            member_ids.add(member.connection_member_id)
            refs.extend(
                [
                    self._ref("ConnectionPoint", member.point_a_id),
                    self._ref("ConnectionPoint", member.point_b_id),
                    self._ref("Connection", member.connection_id),
                    self._ref("ConnectionMember", member.connection_member_id),
                ]
            )
        return TopologyProjectionEdge(
            id=f"l1-physical-link:{pair[0]}:{pair[1]}",
            from_node_id=self._physical_node_id(pair[0]),
            to_node_id=self._physical_node_id(pair[1]),
            kind="L1_PHYSICAL_LINK",
            aggregate=True,
            source_refs=self._dedupe_refs(refs),
            attributes={
                "directed": False,
                "supporting_connection_count": len(connection_ids),
                "supporting_member_pair_count": len(member_ids),
            },
            status="CONFIGURED",
        )
    def _physical_candidates(
        self, owner: NetworkInterfacePhysicalOwnerRecord
    ) -> tuple[_PhysicalCandidate, ...]:
        candidates: list[_PhysicalCandidate] = []

        def visit(
            interface_id: uuid.UUID,
            path: tuple[RealizationRecord, ...],
            ancestry: frozenset[uuid.UUID],
        ) -> None:
            bindings = self.repository.get_physical_bindings_by_interface([interface_id])[
                interface_id
            ]
            for binding in sorted(bindings, key=lambda value: str(value.binding_id)):
                candidates.append(_PhysicalCandidate(owner, binding, path))
            realizations = self.repository.get_realizations_down([interface_id])[
                interface_id
            ]
            for realization in sorted(
                realizations, key=lambda value: str(value.realization_id)
            ):
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
                    (*path, realization),
                    ancestry | {realization.lower_interface_id},
                )

        visit(owner.interface_id, (), frozenset({owner.interface_id}))
        return tuple(candidates)

    def _walk_passive_l1(
        self,
        source: _PhysicalCandidate,
        owner_by_interface: dict[uuid.UUID, NetworkInterfacePhysicalOwnerRecord],
    ) -> tuple[tuple[_SupportingPath, ...], bool]:
        start = PointMember(source.binding.point_id, source.binding.point_member)
        paths: list[_SupportingPath] = []
        owner_unknown = False

        def visit(
            current: PointMember,
            ancestry: frozenset[PointMember],
            steps: tuple[_L1Step, ...],
        ) -> None:
            nonlocal owner_unknown
            adjacency = self.repository.get_l1_adjacency([current])[current]
            for edge in sorted(
                adjacency,
                key=lambda value: (
                    str(value.peer_point_id),
                    value.peer_member,
                    str(value.connection_id),
                    str(value.connection_member_id),
                ),
            ):
                peer = PointMember(edge.peer_point_id, edge.peer_member)
                if peer in ancestry:
                    continue
                next_steps = (*steps, _L1Step(current, peer, edge))
                endpoint_bindings = [
                    binding
                    for binding in self.repository.get_interfaces_by_point_members([peer])[
                        peer
                    ]
                    if binding.binding_id != source.binding.binding_id
                ]
                if endpoint_bindings:
                    for target_binding in sorted(
                        endpoint_bindings, key=lambda value: str(value.binding_id)
                    ):
                        target_owner = owner_by_interface.get(target_binding.interface_id)
                        if target_owner is None:
                            owner_unknown = True
                            continue
                        paths.append(
                            _SupportingPath(
                                source=source,
                                target_binding=target_binding,
                                target_owner=target_owner,
                                steps=next_steps,
                            )
                        )
                    continue
                visit(peer, ancestry | {peer}, next_steps)

        visit(start, frozenset({start}), ())
        return tuple(paths), owner_unknown

    def _node(
        self,
        physical_object_id: uuid.UUID,
        owners: list[NetworkInterfacePhysicalOwnerRecord],
        display_alias: DisplayAliasRecord | None,
    ) -> TopologyProjectionNode:
        refs = [self._ref("PhysicalObject", physical_object_id)]
        if display_alias is not None:
            refs.append(self._ref("EntityMetadata", display_alias.metadata_id))
        for owner in sorted(owners, key=lambda value: str(value.interface_id)):
            refs.extend(
                [
                    self._ref(
                        "NetworkInterfacePhysicalOwner", owner.owner_relation_id
                    ),
                    self._ref("NetworkInterface", owner.interface_id),
                ]
            )
        return TopologyProjectionNode(
            id=self._node_id(physical_object_id),
            kind="NETWORK_DEVICE",
            label=(
                display_alias.value
                if display_alias is not None
                else f"PhysicalObject {str(physical_object_id)[:8]}"
            ),
            source_refs=self._dedupe_refs(refs),
            attributes={
                "label_source": (
                    "ALIAS_DISPLAY" if display_alias is not None else "TECHNICAL_FALLBACK"
                ),
                "owned_interface_count": len(owners),
            },
            status="CONFIGURED",
        )

    def _edge(
        self,
        pair: tuple[uuid.UUID, uuid.UUID],
        paths: tuple[_SupportingPath, ...],
    ) -> TopologyProjectionEdge:
        ordered_paths = sorted(paths, key=self._path_key)
        refs: list[ProjectionSourceRef] = []
        interface_pairs: set[tuple[str, str]] = set()
        for path in ordered_paths:
            refs.extend(self._path_refs(path))
            interface_pairs.add(
                tuple(
                    sorted(
                        (
                            str(path.source.binding.interface_id),
                            str(path.target_binding.interface_id),
                        )
                    )
                )
            )
        from_id, to_id = (self._node_id(pair[0]), self._node_id(pair[1]))
        return TopologyProjectionEdge(
            id=f"l2-device-link:{pair[0]}:{pair[1]}",
            from_node_id=from_id,
            to_node_id=to_id,
            kind=self.EDGE_KIND,
            aggregate=True,
            source_refs=self._dedupe_refs(refs),
            attributes={
                "directed": False,
                "supporting_path_count": len(ordered_paths),
                "supporting_interface_pair_count": len(interface_pairs),
            },
            status="CONFIGURED",
        )

    def _path_refs(self, path: _SupportingPath) -> list[ProjectionSourceRef]:
        refs = [
            self._ref(
                "PhysicalObject", path.source.root_owner.physical_object_id
            ),
            self._ref(
                "NetworkInterfacePhysicalOwner",
                path.source.root_owner.owner_relation_id,
            ),
            self._ref("NetworkInterface", path.source.root_owner.interface_id),
            self._ref("NetworkInterface", path.source.binding.interface_id),
            self._ref("InterfacePhysicalBinding", path.source.binding.binding_id),
            self._ref("PhysicalObject", path.target_owner.physical_object_id),
            self._ref(
                "NetworkInterfacePhysicalOwner", path.target_owner.owner_relation_id
            ),
            self._ref("NetworkInterface", path.target_binding.interface_id),
            self._ref("InterfacePhysicalBinding", path.target_binding.binding_id),
        ]
        for realization in path.source.realization_path:
            refs.extend(
                [
                    self._ref(
                        "NetworkInterfaceRealization", realization.realization_id
                    ),
                    self._ref("NetworkInterface", realization.upper_interface_id),
                    self._ref("NetworkInterface", realization.lower_interface_id),
                ]
            )
        point_ids = {
            path.source.binding.point_id,
            path.target_binding.point_id,
            *(step.source.point_id for step in path.steps),
            *(step.target.point_id for step in path.steps),
        }
        point_records = self.repository.get_connection_point_records(list(point_ids))
        for point_id in sorted(point_ids, key=str):
            refs.extend(
                [
                    self._ref("ConnectionPoint", point_id),
                    self._ref(
                        "PhysicalObject", point_records[point_id].physical_object_id
                    ),
                ]
            )
        for step in path.steps:
            refs.extend(
                [
                    self._ref("Connection", step.edge.connection_id),
                    self._ref(
                        "ConnectionMember", step.edge.connection_member_id
                    ),
                ]
            )
        return refs

    @staticmethod
    def _path_key(path: _SupportingPath) -> tuple[str, ...]:
        fact_ids = {
            str(path.source.binding.binding_id),
            str(path.target_binding.binding_id),
            *(str(item.realization_id) for item in path.source.realization_path),
            *(str(step.edge.connection_member_id) for step in path.steps),
        }
        return tuple(sorted(fact_ids))

    @staticmethod
    def _node_id(physical_object_id: uuid.UUID) -> str:
        return f"l2-device:{physical_object_id}"

    @staticmethod
    def _physical_node_id(physical_object_id: uuid.UUID) -> str:
        return f"l1-physical-object:{physical_object_id}"

    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> ProjectionSourceRef:
        return ProjectionSourceRef(
            ref_type="CANONICAL_FACT",
            entity_type=entity_type,
            entity_id=entity_id,
        )

    @staticmethod
    def _dedupe_refs(
        refs: list[ProjectionSourceRef],
    ) -> list[ProjectionSourceRef]:
        unique = {
            (ref.ref_type, ref.entity_type, ref.entity_id): ref for ref in refs
        }
        return [unique[key] for key in sorted(unique, key=lambda item: (item[1], str(item[2])))]
