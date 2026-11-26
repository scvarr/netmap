import uuid
from dataclasses import dataclass

from sqlalchemy import and_, or_, select, tuple_
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, aliased, joinedload

from app.errors import NetMapError, ValidationError
from app.cable_labels import CableLabelCatalog, resolved_cable_label
from app.module_endpoint_names import EndpointNames
from app.models import (
    Cable, CableLabelTemplate, Connection, ConnectionMember,
    ConnectionPoint, HardwareInterfaceAssociation, NetworkInterface, NetworkInterfacePhysicalOwner,
)
from app.physical_compatibility import point_member_designations, verify_compatibility
from app.optical_diagnostics import OpticalPreviewLine
from app.repository import CanonicalRepository, ConnectionMemberInput, PointMember
from app.schemas import (
    BulkCableDeleteCandidate, BulkCableDeleteExpectation, BulkCableDeleteMember,
    CableReconnectExactExpectation, CableReconnectRequest, CableReconnectSnapshot,
    EvidenceRef, FiberType, PhysicalCompatibilityConfirmation, PhysicalCompatibilityPreview,
)


@dataclass(frozen=True)
class CreatedPhysicalConnection:
    source_interface_id: uuid.UUID
    target_interface_id: uuid.UUID
    cable_id: uuid.UUID
    source_binding_id: uuid.UUID
    target_binding_id: uuid.UUID
    connection_id: uuid.UUID


@dataclass(frozen=True)
class NetworkInterfaceEndpoint:
    interface_id: uuid.UUID


@dataclass(frozen=True)
class ConnectionPointEndpoint:
    connection_point_id: uuid.UUID
    member_index: int | None = None


PhysicalEndpoint = NetworkInterfaceEndpoint | ConnectionPointEndpoint


@dataclass(frozen=True)
class MaterializedPhysicalEndpoint:
    endpoint: PhysicalEndpoint
    connection_point_id: uuid.UUID
    binding_id: uuid.UUID | None


@dataclass(frozen=True)
class CreatedEndpointPhysicalConnection:
    source: MaterializedPhysicalEndpoint
    target: MaterializedPhysicalEndpoint
    cable_id: uuid.UUID
    connection_id: uuid.UUID


class PhysicalConnectionCatalog:
    """Bounded user-intent composition over existing canonical L1 primitives."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_atomic_link(
        self,
        source_interface_id: uuid.UUID,
        target_interface_id: uuid.UUID,
        *,
        cable_label: str | None = None,
        fiber_type: FiberType | None = None,
        cable_label_template_id: uuid.UUID | None = None,
        generate_cable_label: bool = False,
        preview: bool = False,
        compatibility: PhysicalCompatibilityConfirmation | None = None,
    ) -> CreatedPhysicalConnection | PhysicalCompatibilityPreview:
        if source_interface_id == target_interface_id:
            raise ValidationError(
                "A physical link requires two different NetworkInterfaces",
                {"interface_id": str(source_interface_id)},
            )
        created = self.create_endpoint_link(
            NetworkInterfaceEndpoint(source_interface_id),
            NetworkInterfaceEndpoint(target_interface_id),
            cable_label=cable_label,
            fiber_type=fiber_type,
            cable_label_template_id=cable_label_template_id,
            generate_cable_label=generate_cable_label,
            preview=preview,
            compatibility=compatibility,
        )
        if isinstance(created, PhysicalCompatibilityPreview):
            return created
        assert created.source.binding_id is not None
        assert created.target.binding_id is not None
        return CreatedPhysicalConnection(
            source_interface_id=source_interface_id,
            target_interface_id=target_interface_id,
            cable_id=created.cable_id,
            source_binding_id=created.source.binding_id,
            target_binding_id=created.target.binding_id,
            connection_id=created.connection_id,
        )

    def create_endpoint_link(
        self,
        source: PhysicalEndpoint,
        target: PhysicalEndpoint,
        *,
        cable_label: str | None = None,
        fiber_type: FiberType | None = None,
        cable_label_template_id: uuid.UUID | None = None,
        generate_cable_label: bool = False,
        preview: bool = False,
        compatibility: PhysicalCompatibilityConfirmation | None = None,
    ) -> CreatedEndpointPhysicalConnection | PhysicalCompatibilityPreview:
        if source == target:
            raise ValidationError(
                "A physical connection requires two different endpoints",
                {"endpoint": self._endpoint_description(source)},
            )

        interface_ids = tuple(
            sorted(
                {
                    endpoint.interface_id
                    for endpoint in (source, target)
                    if isinstance(endpoint, NetworkInterfaceEndpoint)
                },
                key=str,
            )
        )
        locked_interfaces = tuple(
            self.session.scalars(
                select(NetworkInterface)
                .where(NetworkInterface.id.in_(interface_ids))
                .order_by(NetworkInterface.id)
                .with_for_update()
            )
        )
        found_ids = {interface.id for interface in locked_interfaces}
        missing_ids = [value for value in interface_ids if value not in found_ids]
        if missing_ids:
            raise ValidationError(
                "NetworkInterface does not exist",
                {"interface_ids": [str(value) for value in missing_ids]},
            )

        if interface_ids and self.session.scalar(select(HardwareInterfaceAssociation.id).where(
            HardwareInterfaceAssociation.interface_id.in_(interface_ids)
        ).limit(1)) is not None:
            raise ValidationError("Hardware interfaces require a physical transceiver binding",
                                  {"reason": "TRANSCEIVER_BINDING_REQUIRED"})

        repository = CanonicalRepository(self.session)
        owners = {
            owner.interface_id: owner
            for owner in self.session.scalars(
                select(NetworkInterfacePhysicalOwner)
                .where(NetworkInterfacePhysicalOwner.interface_id.in_(interface_ids))
                .order_by(NetworkInterfacePhysicalOwner.id).with_for_update(read=True)
            )
        }
        ownerless_ids = [value for value in interface_ids if value not in owners]
        if ownerless_ids:
            raise ValidationError(
                "NetworkInterface has no physical owner",
                {"interface_ids": [str(value) for value in ownerless_ids]},
            )

        bindings = repository.get_physical_bindings_by_interface(list(interface_ids))
        already_bound_ids = [value for value in interface_ids if bindings[value]]
        if already_bound_ids:
            raise ValidationError(
                "NetworkInterface already has a direct physical binding",
                {"interface_ids": [str(value) for value in already_bound_ids]},
            )

        point_ids = tuple(
            sorted(
                {
                    endpoint.connection_point_id
                    for endpoint in (source, target)
                    if isinstance(endpoint, ConnectionPointEndpoint)
                },
                key=str,
            )
        )
        locked_points = tuple(
            self.session.scalars(
                select(ConnectionPoint)
                .where(ConnectionPoint.id.in_(point_ids))
                .order_by(ConnectionPoint.id)
                .with_for_update()
            )
        )
        points_by_id = {point.id: point for point in locked_points}
        missing_point_ids = [value for value in point_ids if value not in points_by_id]
        if missing_point_ids:
            raise ValidationError(
                "ConnectionPoint does not exist",
                {"connection_point_ids": [str(value) for value in missing_point_ids]},
            )
        multichannel = any(point.cardinality > 1 for point in locked_points)
        if multichannel and interface_ids:
            raise ValidationError("Multichannel wiring requires two existing ConnectionPoints")

        requested_members = {}
        for endpoint in (source, target):
            if not isinstance(endpoint, ConnectionPointEndpoint):
                continue
            point = points_by_id[endpoint.connection_point_id]
            index = endpoint.member_index
            if index is None and point.cardinality == 1:
                index = 1
            if index is None or not 1 <= index <= point.cardinality:
                raise ValidationError(
                    "Select a member within the ConnectionPoint cardinality",
                    {"connection_point_id": str(point.id), "member_index": index, "cardinality": point.cardinality},
                )
            requested_members[point.id] = index
        occupied_points = [
            point.id for point in locked_points
            if self._has_external_member_connection(
                point, requested_members[point.id]
            )
        ]
        if occupied_points:
            raise ValidationError(
                "ConnectionPoint member is already occupied",
                {"reason": "CONNECTION_POINT_MEMBER_OCCUPIED", "connection_point_ids": [str(value) for value in occupied_points]},
            )

        endpoint_owners = [
            owners[end.interface_id].physical_object_id if isinstance(end, NetworkInterfaceEndpoint)
            else points_by_id[end.connection_point_id].physical_object_id
            for end in (source, target)
        ]
        if endpoint_owners[0] == endpoint_owners[1]:
            raise ValidationError("A cable requires endpoints on two different PhysicalObjects")
        endpoint_points = [
            points_by_id[end.connection_point_id] if isinstance(end, ConnectionPointEndpoint) else None
            for end in (source, target)
        ]
        generated = None
        if generate_cable_label:
            if cable_label_template_id is None:
                raise ValidationError("Cable label template is required when generation is enabled")
            generated = self._generated_label_preview(cable_label_template_id, 1)
        result = verify_compatibility(
            self.session, [(endpoint_points[0], endpoint_points[1])],
            intent=["create", self._endpoint_description(source), self._endpoint_description(target),
                    endpoint_owners, cable_label, cable_label_template_id, generate_cable_label,
                    generated, fiber_type],
            preview=preview, confirmation=compatibility, require_preview=multichannel,
            optical_lines=[OpticalPreviewLine(
                tuple(PointMember(point.id, requested_members[point.id]) if point is not None else None
                      for point in endpoint_points),
                fiber_type=fiber_type,
                interfaces=tuple(end.interface_id if isinstance(end, NetworkInterfaceEndpoint) else None
                                 for end in (source, target)),
            )] if preview else None,
        )
        if preview:
            return result

        source_materialized = self._materialize_endpoint(source, repository, owners)
        target_materialized = self._materialize_endpoint(target, repository, owners)

        member = [
            ConnectionMemberInput(
                index=1,
                point_a_member=requested_members.get(source_materialized.connection_point_id, 1),
                point_b_member=requested_members.get(target_materialized.connection_point_id, 1),
            )
        ]
        connection, _ = repository.add_connection(
            source_materialized.connection_point_id,
            target_materialized.connection_point_id,
            cardinality=1,
            members=member,
        )
        cable = self._add_cable(connection.id, fiber_type)
        CableLabelCatalog(self.session).assign_new_cable(
            cable,
            label=cable_label,
            template_id=cable_label_template_id,
            generate=generate_cable_label,
        )

        return CreatedEndpointPhysicalConnection(
            source=source_materialized,
            target=target_materialized,
            cable_id=cable.id,
            connection_id=connection.id,
        )

    def create_bulk_point_links(
        self,
        pairs: list[tuple[ConnectionPointEndpoint, ConnectionPointEndpoint]],
        *,
        template_id: uuid.UUID | None,
        expected_generated_labels: list[str],
        fiber_types: list[FiberType | None] | None = None,
        preview: bool = False,
        compatibility: PhysicalCompatibilityConfirmation | None = None,
    ) -> list[CreatedEndpointPhysicalConnection] | PhysicalCompatibilityPreview:
        if not 1 <= len(pairs) <= 256:
            raise ValidationError("Bulk pairing requires 1 to 256 pairs")
        if fiber_types is None:
            fiber_types = [None] * len(pairs)
        if len(fiber_types) != len(pairs):
            raise ValidationError("Fiber types must match the number of cable pairs")
        ids = {endpoint.connection_point_id for pair in pairs for endpoint in pair}
        by_id = {point.id: point for point in self.session.scalars(
            select(ConnectionPoint).where(ConnectionPoint.id.in_(ids))
            .order_by(ConnectionPoint.id).with_for_update()
        )}
        if by_id.keys() != ids:
            raise ValidationError("ConnectionPoint does not exist")
        source_owners = {by_id[source.connection_point_id].physical_object_id for source, _ in pairs}
        target_owners = {by_id[target.connection_point_id].physical_object_id for _, target in pairs}
        if len(source_owners) != 1 or len(target_owners) != 1 or source_owners == target_owners:
            raise ValidationError("Bulk pairing requires two different PhysicalObjects")

        def address(endpoint: ConnectionPointEndpoint) -> tuple[uuid.UUID, int]:
            point = by_id[endpoint.connection_point_id]
            index = endpoint.member_index
            if index is None and point.cardinality == 1:
                index = 1
            if index is None or not 1 <= index <= point.cardinality:
                raise ValidationError(
                    "Select a member within the ConnectionPoint cardinality",
                    {"connection_point_id": str(point.id), "member_index": index, "cardinality": point.cardinality},
                )
            return point.id, index

        addresses = [(address(source), address(target)) for source, target in pairs]
        selected = {end for pair in addresses for end in pair}
        if len(selected) != 2 * len(pairs):
            raise ValidationError("Duplicate ConnectionPoint member in bulk pairing")
        a = aliased(ConnectionPoint)
        b = aliased(ConnectionPoint)
        occupied = set()
        for a_id, a_member, b_id, b_member in self.session.execute(
            select(a.id, ConnectionMember.point_a_member, b.id, ConnectionMember.point_b_member)
            .select_from(Connection).join(ConnectionMember)
            .join(a, Connection.point_a_id == a.id).join(b, Connection.point_b_id == b.id)
            .where(a.physical_object_id != b.physical_object_id,
                   or_(tuple_(a.id, ConnectionMember.point_a_member).in_(selected),
                       tuple_(b.id, ConnectionMember.point_b_member).in_(selected)))
        ):
            occupied.update(selected.intersection(((a_id, a_member), (b_id, b_member))))
        if occupied:
            raise ValidationError("ConnectionPoint member is already occupied", {
                "reason": "CONNECTION_POINT_MEMBER_OCCUPIED",
                "members": [{"connection_point_id": str(point_id), "member_index": index}
                            for point_id, index in sorted(occupied)],
            })

        labels: list[str | None] = [None] * len(pairs)
        catalog = CableLabelCatalog(self.session)
        if template_id is None:
            if expected_generated_labels:
                raise ValidationError("Labels require a Cable label template")
        else:
            labels = self._generated_label_preview(template_id, len(pairs))
            if labels != expected_generated_labels:
                raise ValidationError("Bulk label preview is stale", {"reason": "BULK_LABEL_PREVIEW_STALE"})
        result = verify_compatibility(
            self.session, [(by_id[a.connection_point_id], by_id[b.connection_point_id]) for a, b in pairs],
            intent=["bulk", addresses, template_id, labels, fiber_types],
            preview=preview, confirmation=compatibility,
            require_preview=any(point.cardinality > 1 for point in by_id.values()),
            optical_lines=[OpticalPreviewLine((PointMember(*a), PointMember(*b)), fiber_type=fiber_type)
                           for (a, b), fiber_type in zip(addresses, fiber_types, strict=True)] if preview else None,
        )
        if preview:
            return result
        repository = CanonicalRepository(self.session)
        created: list[CreatedEndpointPhysicalConnection] = []
        for ((source_id, source_index), (target_id, target_index)), label, fiber_type in zip(addresses, labels, fiber_types, strict=True):
            connection, _ = repository.add_connection(
                source_id, target_id, cardinality=1,
                members=[ConnectionMemberInput(index=1, point_a_member=source_index, point_b_member=target_index)],
            )
            cable = self._add_cable(connection.id, fiber_type)
            catalog.assign_new_cable(cable, label=label, template_id=None, generate=False)
            created.append(CreatedEndpointPhysicalConnection(
                source=MaterializedPhysicalEndpoint(ConnectionPointEndpoint(source_id, source_index), source_id, None),
                target=MaterializedPhysicalEndpoint(ConnectionPointEndpoint(target_id, target_index), target_id, None),
                cable_id=cable.id, connection_id=connection.id,
            ))
        return created

    def _generated_label_preview(self, template_id: uuid.UUID, count: int) -> list[str]:
        catalog = CableLabelCatalog(self.session)
        catalog.settings()
        self.session.execute(
            select(CableLabelTemplate.id).where(CableLabelTemplate.id == template_id).with_for_update(read=True)
        ).all()
        return catalog.preview_batch(template_id, count)

    def _add_cable(self, connection_id: uuid.UUID, fiber_type: FiberType | None) -> Cable:
        cable = Cable(connection_id=connection_id, fiber_type=fiber_type)
        self.session.add(cable)
        self.session.flush()
        return cable

    def _reconnect_snapshot(
        self, cable_id: uuid.UUID, new_point_id: uuid.UUID | None = None, *, lock: bool = False,
    ) -> tuple[CableReconnectSnapshot, Connection, ConnectionMember, dict[uuid.UUID, ConnectionPoint]]:
        def read(statement):
            # NOWAIT also covers disconnect, which starts by locking Connection.
            return statement.with_for_update(nowait=True) if lock or new_point_id is not None else statement

        cable = self.session.scalar(read(select(Cable).where(Cable.id == cable_id)))
        if cable is None:
            raise NetMapError("CABLE_RECONNECT_STALE", "Cable no longer exists")
        connection = self.session.scalar(read(select(Connection).where(Connection.id == cable.connection_id)))
        if connection is None:
            raise NetMapError("CABLE_RECONNECT_STALE", "Connection no longer exists")
        if connection.cardinality != 1:
            raise ValidationError("Reconnect requires a cardinality=1 Connection")
        ids = {connection.point_a_id, connection.point_b_id}
        if new_point_id is not None:
            ids.add(new_point_id)
        points = {point.id: point for point in self.session.scalars(read(
            select(ConnectionPoint).where(ConnectionPoint.id.in_(ids)).order_by(ConnectionPoint.id)
        ))}
        members = list(self.session.scalars(read(
            select(ConnectionMember).where(ConnectionMember.connection_id == connection.id)
            .order_by(ConnectionMember.id).limit(2)
        )))
        a = points.get(connection.point_a_id)
        b = points.get(connection.point_b_id)
        if a is None or b is None:
            raise NetMapError("CABLE_RECONNECT_STALE", "Cable endpoints no longer exist")
        if (
            a.physical_object_id == b.physical_object_id
            or len(members) != 1
            or members[0].index != 1
            or not 1 <= members[0].point_a_member <= a.cardinality
            or not 1 <= members[0].point_b_member <= b.cardinality
        ):
            raise ValidationError("Reconnect requires one valid external Cable member mapping")
        member = members[0]
        snapshot = CableReconnectSnapshot(
            expected=CableReconnectExactExpectation(
                connection_id=connection.id, connection_member_id=member.id,
                point_a_id=a.id, point_b_id=b.id, label=cable.label,
                point_a_member=member.point_a_member, point_b_member=member.point_b_member,
            ),
            object_a_id=a.physical_object_id, object_b_id=b.physical_object_id,
            display_label=resolved_cable_label(cable)[0],
        )
        return snapshot, connection, member, points

    def preview_cable_reconnect(self, cable_id: uuid.UUID) -> CableReconnectSnapshot:
        snapshot, _, _, _ = self._reconnect_snapshot(cable_id)
        return snapshot

    def lock_cable_reconnect_snapshot(self, cable_id: uuid.UUID):
        return self._reconnect_snapshot(cable_id, lock=True)

    def reconnect_cable(
        self, cable_id: uuid.UUID, request: CableReconnectRequest, *, preview: bool = False,
    ) -> PhysicalCompatibilityPreview | None:
        try:
            snapshot, connection, member, points = self._reconnect_snapshot(cable_id, request.new_point_id)
            new_point = points.get(request.new_point_id)
            if new_point is None:
                raise ValidationError("The new ConnectionPoint must exist")
            require_preview = any(point.cardinality > 1 for point in points.values())
            expected = request.expected.model_dump(exclude_none=False)
            if not require_preview:
                for field in ("point_a_member", "point_b_member"):
                    if expected[field] is None:
                        expected[field] = 1
            if snapshot.expected.model_dump() != expected:
                raise NetMapError("CABLE_RECONNECT_STALE", "Cable or its Connection changed after preview")
            other_owner = snapshot.object_b_id if request.side == "A" else snapshot.object_a_id
            new_index = request.new_member_index
            if new_index is None and new_point.cardinality == 1:
                new_index = 1
            if new_index is None or not 1 <= new_index <= new_point.cardinality:
                raise ValidationError("Select a member within the ConnectionPoint cardinality")
            if new_point.physical_object_id == other_owner:
                raise ValidationError("A cable requires endpoints on two different PhysicalObjects")
            old_address = (
                (connection.point_a_id, member.point_a_member) if request.side == "A"
                else (connection.point_b_id, member.point_b_member)
            )
            if (new_point.id, new_index) == old_address:
                raise ValidationError("The new address must differ from the current address")
            if self._has_external_member_connection(new_point, new_index):
                raise NetMapError("CABLE_RECONNECT_OCCUPIED", "ConnectionPoint member is already occupied")
            pair = (
                new_point if request.side == "A" else points[connection.point_a_id],
                new_point if request.side == "B" else points[connection.point_b_id],
            )
            result = verify_compatibility(
                self.session, [pair],
                intent=["reconnect", cable_id, snapshot.expected.model_dump(mode="json"),
                        request.side, new_point.id, new_index],
                preview=preview, confirmation=request.compatibility,
                require_preview=require_preview,
                optical_lines=[OpticalPreviewLine(
                    (PointMember(pair[0].id, new_index if request.side == "A" else member.point_a_member),
                     PointMember(pair[1].id, new_index if request.side == "B" else member.point_b_member)),
                    cable_id=cable_id,
                    refs=(EvidenceRef(entity_type="Connection", entity_id=connection.id),
                          EvidenceRef(entity_type="ConnectionMember", entity_id=member.id)),
                )] if preview else None,
            )
            if preview:
                return result
            if request.side == "A":
                connection.point_a_id = new_point.id
                member.point_a_member = new_index
            else:
                connection.point_b_id = new_point.id
                member.point_b_member = new_index
            self.session.flush()
        except OperationalError as error:
            if getattr(error.orig, "sqlstate", None) in ("55P03", "40P01", "40001"):
                raise NetMapError("CABLE_RECONNECT_CONFLICT", "Concurrent topology or label update") from error
            raise

    def delete_external_connection(self, connection_id: uuid.UUID) -> None:
        """Atomically delete a direct Connection or its attached Cable."""
        connection = self.session.scalar(
            select(Connection).where(Connection.id == connection_id).with_for_update()
        )
        if connection is None:
            raise ValidationError(
                "Connection does not exist", {"connection_id": str(connection_id)}
            )
        points = tuple(
            self.session.scalars(
                select(ConnectionPoint)
                .where(ConnectionPoint.id.in_((connection.point_a_id, connection.point_b_id)))
                .order_by(ConnectionPoint.id)
                .with_for_update()
            )
        )
        if len(points) != 2:
            raise ValidationError(
                "Connection refers to a missing ConnectionPoint",
                {"connection_id": str(connection_id)},
            )
        if points[0].physical_object_id == points[1].physical_object_id:
            raise ValidationError(
                "Only an external physical Connection can be disconnected",
                {"connection_id": str(connection_id)},
            )
        cable = self.session.scalar(
            select(Cable).where(Cable.connection_id == connection.id).with_for_update()
        )
        if cable is not None:
            CableLabelCatalog(self.session).release_cable_label(cable)
        self.session.delete(connection)
        self.session.flush()

    def delete_cable(self, cable_id: uuid.UUID) -> None:
        cable = self.session.scalar(
            select(Cable).where(Cable.id == cable_id).with_for_update()
        )
        if cable is None:
            raise ValidationError("Cable does not exist", {"cable_id": str(cable_id)})
        connection = self.session.scalar(
            select(Connection)
            .where(Connection.id == cable.connection_id)
            .with_for_update()
        )
        if connection is None:
            raise ValidationError(
                "Cable refers to a missing Connection", {"cable_id": str(cable_id)}
            )
        self._delete_connected_cable(cable, connection)

    def preview_bulk_cable_delete(
        self, source_id: uuid.UUID, target_id: uuid.UUID,
    ) -> list[BulkCableDeleteCandidate]:
        a, b, query = self._cables_between_objects(source_id, target_id)
        rows = self.session.execute(query.options(joinedload(Connection.members))).unique().all()
        point_ids = {
            point_id for _, connection, _ in rows
            for point_id in (connection.point_a_id, connection.point_b_id)
        }
        names = EndpointNames(self.session).connection_points(point_ids)
        designations = point_member_designations(self.session, point_ids)

        def point_label(point_id: uuid.UUID) -> str:
            return names[point_id].value if point_id in names else f"ConnectionPoint {point_id}"

        result = []
        for cable, connection, owner_a in rows:
            if not connection.members:
                continue
            source_is_a = owner_a == source_id
            source, target = connection.point_a_id, connection.point_b_id
            if not source_is_a:
                source, target = target, source
            expected = self._cable_delete_expectation(cable, connection)
            a_designations = [designations.get(connection.point_a_id, {}).get(
                member.point_a_member, str(member.point_a_member)) for member in expected.members]
            b_designations = [designations.get(connection.point_b_id, {}).get(
                member.point_b_member, str(member.point_b_member)) for member in expected.members]
            result.append(BulkCableDeleteCandidate(
                expected=expected,
                source_member_designations=a_designations if source_is_a else b_designations,
                target_member_designations=b_designations if source_is_a else a_designations,
                display_label=resolved_cable_label(cable)[0],
                source_point_label=point_label(source),
                target_point_label=point_label(target),
                source_is_point_a=source_is_a,
            ))
        return result

    def bulk_delete_cables(
        self, source_id: uuid.UUID, target_id: uuid.UUID,
        expected: list[BulkCableDeleteExpectation],
    ) -> None:
        if not 1 <= len(expected) <= 256:
            raise ValidationError("Bulk Cable deletion requires 1 to 256 Cables")
        by_id = {row.cable_id: row for row in expected}
        if len(by_id) != len(expected):
            raise ValidationError("Duplicate Cable ID in bulk deletion")
        a, b, query = self._cables_between_objects(source_id, target_id)
        try:
            rows = self.session.execute(
                query.where(Cable.id.in_(by_id)).with_for_update(of=(Cable, Connection, a, b), nowait=True)
            ).all()
            # Lock the Connection before reading its members. Its FK lock prevents
            # a concurrently inserted member from committing before this deletion.
            self.session.scalars(
                select(ConnectionMember)
                .where(ConnectionMember.connection_id.in_([connection.id for _, connection, _ in rows]))
                .order_by(ConnectionMember.id)
                .with_for_update(nowait=True)
            ).all()
            missing = by_id.keys() - {cable.id for cable, _, _ in rows}
            if missing:
                raise NetMapError("BULK_CABLE_DELETE_STALE", "Cable missing or no longer connects the selected PhysicalObjects",
                                  {"cable_ids": sorted(map(str, missing))})
            for cable, connection, _ in rows:
                if not connection.members or self._cable_delete_expectation(cable, connection) != by_id[cable.id]:
                    raise NetMapError("BULK_CABLE_DELETE_STALE", "Cable or its Connection changed after preview",
                                      {"cable_ids": [str(cable.id)]})
            for cable, connection, _ in rows:
                self._delete_connected_cable(cable, connection)
        except OperationalError as error:
            if getattr(error.orig, "sqlstate", None) in ("55P03", "40P01", "40001"):
                raise NetMapError("BULK_CABLE_DELETE_CONFLICT", "Concurrent topology or label update. Reload the Cable list.") from error
            raise

    @staticmethod
    def _cables_between_objects(source_id: uuid.UUID, target_id: uuid.UUID):
        if source_id == target_id:
            raise ValidationError("Bulk Cable deletion requires two different PhysicalObjects")
        a, b = aliased(ConnectionPoint), aliased(ConnectionPoint)
        query = (
            select(Cable, Connection, a.physical_object_id)
            .join(Connection, Cable.connection_id == Connection.id)
            .join(a, a.id == Connection.point_a_id)
            .join(b, b.id == Connection.point_b_id)
            .where(or_(
                and_(a.physical_object_id == source_id, b.physical_object_id == target_id),
                and_(b.physical_object_id == source_id, a.physical_object_id == target_id),
            ))
            .order_by(Cable.id)
        )
        return a, b, query

    @staticmethod
    def _cable_delete_expectation(cable: Cable, connection: Connection) -> BulkCableDeleteExpectation:
        return BulkCableDeleteExpectation(
            cable_id=cable.id, connection_id=connection.id, label=cable.label,
            point_a_id=connection.point_a_id, point_b_id=connection.point_b_id,
            cardinality=connection.cardinality,
            members=[
                BulkCableDeleteMember(id=member.id, index=member.index,
                                      point_a_member=member.point_a_member, point_b_member=member.point_b_member)
                for member in sorted(connection.members, key=lambda member: member.index)
            ],
        )

    def _delete_connected_cable(self, cable: Cable, connection: Connection) -> None:
        CableLabelCatalog(self.session).release_cable_label(cable)
        self.session.delete(connection)
        self.session.flush()

    @staticmethod
    def _endpoint_description(endpoint: PhysicalEndpoint) -> dict[str, str | int]:
        if isinstance(endpoint, NetworkInterfaceEndpoint):
            return {
                "kind": "NETWORK_INTERFACE",
                "network_interface_id": str(endpoint.interface_id),
            }
        return {
            "kind": "CONNECTION_POINT",
            "connection_point_id": str(endpoint.connection_point_id),
            "member_index": endpoint.member_index or 1,
        }

    def _has_external_member_connection(
        self,
        point: ConnectionPoint,
        member_index: int,
    ) -> bool:
        """Return whether this exact member is attached outside its owner.

        A Connection remains an incident topology fact even when both endpoints
        belong to one PhysicalObject.  Only a member mapping which crosses that
        canonical ownership boundary consumes external endpoint capacity.
        """
        opposite_point = aliased(ConnectionPoint)
        connection_uses_member = or_(
            and_(
                Connection.point_a_id == point.id,
                ConnectionMember.point_a_member == member_index,
            ),
            and_(
                Connection.point_b_id == point.id,
                ConnectionMember.point_b_member == member_index,
            ),
        )
        opposite_endpoint = or_(
            and_(
                Connection.point_a_id == point.id,
                Connection.point_b_id == opposite_point.id,
            ),
            and_(
                Connection.point_b_id == point.id,
                Connection.point_a_id == opposite_point.id,
            ),
        )
        return self.session.scalar(
            select(Connection.id)
            .join(ConnectionMember)
            .join(opposite_point, opposite_endpoint)
            .where(
                connection_uses_member,
                opposite_point.physical_object_id != point.physical_object_id,
            )
            .limit(1)
        ) is not None

    @staticmethod
    def _materialize_endpoint(
        endpoint: PhysicalEndpoint,
        repository: CanonicalRepository,
        owners: dict[uuid.UUID, object],
    ) -> MaterializedPhysicalEndpoint:
        if isinstance(endpoint, ConnectionPointEndpoint):
            return MaterializedPhysicalEndpoint(
                endpoint=endpoint,
                connection_point_id=endpoint.connection_point_id,
                binding_id=None,
            )

        owner = owners[endpoint.interface_id]
        point = repository.add_connection_point(
            owner.physical_object_id,
            cardinality=1,
        )
        binding = repository.add_interface_physical_binding(
            endpoint.interface_id,
            point.id,
            point_member=1,
        )
        return MaterializedPhysicalEndpoint(
            endpoint=endpoint,
            connection_point_id=point.id,
            binding_id=binding.id,
        )
