from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Annotated, Any, Literal
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, IPvAnyAddress, model_validator
from pydantic_core import PydanticCustomError


class PointMemberAddress(BaseModel):
    point_id: uuid.UUID
    member_index: int = Field(ge=1)


class L1TraceQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: PointMemberAddress = Field(alias="from")
    to: PointMemberAddress


class EvaluationView(BaseModel):
    mode: Literal["CONFIGURED"] = "CONFIGURED"


class ProjectionSourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ref_type: Literal["CANONICAL_FACT"]
    entity_type: str = Field(min_length=1)
    entity_id: uuid.UUID


class BlueprintLibraryRef(BaseModel):
    """Library identity, deliberately distinct from canonical topology facts."""
    model_config = ConfigDict(extra="forbid")

    ref_type: Literal["LIBRARY_RECORD"] = "LIBRARY_RECORD"
    entity_type: Literal["ObjectBlueprint", "ObjectBlueprintVersion"]
    entity_id: uuid.UUID


class PortBlockLibraryRef(BaseModel):
    """Library identity for a Port Block record or immutable version."""

    model_config = ConfigDict(extra="forbid")

    ref_type: Literal["LIBRARY_RECORD"] = "LIBRARY_RECORD"
    entity_type: Literal["PortBlock", "PortBlockVersion"]
    entity_id: uuid.UUID


class PortBlockVersionLibraryRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ref_type: Literal["LIBRARY_RECORD"] = "LIBRARY_RECORD"
    entity_type: Literal["PortBlockVersion"] = "PortBlockVersion"
    entity_id: uuid.UUID


class SavedMapRef(BaseModel):
    """Presentation identity; deliberately not a ProjectionSourceRef."""

    model_config = ConfigDict(extra="forbid")

    entity_type: Literal["SavedMap"] = "SavedMap"
    entity_id: uuid.UUID


class MapRegionRef(BaseModel):
    """SavedMap presentation identity; it is not a ProjectionSourceRef."""

    model_config = ConfigDict(extra="forbid")

    entity_type: Literal["MapRegion"] = "MapRegion"
    entity_id: uuid.UUID


class CreateSavedMapRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=255)


class CreateMapPlacementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    physical_object_id: uuid.UUID
    x: FiniteFloat
    y: FiniteFloat
    display_width: FiniteFloat | None = Field(default=None, gt=0)


class MoveMapPlacementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: FiniteFloat
    y: FiniteFloat
    display_width: FiniteFloat | None = Field(default=None, gt=0)


class SetMapViewLockRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    locked: bool


class MapViewPositionDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: FiniteFloat
    y: FiniteFloat
    locked: bool = False
    display_width: FiniteFloat | None = Field(default=None, gt=0)


class MapPlacementDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    physical_object_ref: ProjectionSourceRef
    positions: dict[Literal["L1/PHYSICAL_OBJECT", "L2/DEVICE"], MapViewPositionDocument]


class MapCableRouteWaypoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: FiniteFloat
    y: FiniteFloat


class SetMapCableRouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    view: Literal["physical"]
    waypoints: list[MapCableRouteWaypoint]


class MapCableRouteDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cable_ref: ProjectionSourceRef
    view: Literal["L1/PHYSICAL_OBJECT"]
    waypoints: list[MapCableRouteWaypoint]


class MapRegionPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: FiniteFloat
    y: FiniteFloat


class MapRegionStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fill_color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    fill_opacity: FiniteFloat = Field(ge=0, le=1)
    stroke_color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    stroke_width: FiniteFloat = Field(ge=0)
    stroke_style: Literal["solid", "dashed", "dotted"]
    label_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


def _polygon_segments_intersect(
    first_start: MapRegionPoint,
    first_end: MapRegionPoint,
    second_start: MapRegionPoint,
    second_end: MapRegionPoint,
) -> bool:
    def cross(origin: MapRegionPoint, left: MapRegionPoint, right: MapRegionPoint) -> float:
        return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x)

    def on_segment(start: MapRegionPoint, point: MapRegionPoint, end: MapRegionPoint) -> bool:
        return (
            min(start.x, end.x) <= point.x <= max(start.x, end.x)
            and min(start.y, end.y) <= point.y <= max(start.y, end.y)
        )

    first_left = cross(first_start, first_end, second_start)
    first_right = cross(first_start, first_end, second_end)
    second_left = cross(second_start, second_end, first_start)
    second_right = cross(second_start, second_end, first_end)
    if ((first_left > 0 > first_right) or (first_left < 0 < first_right)) and (
        (second_left > 0 > second_right) or (second_left < 0 < second_right)
    ):
        return True
    return (
        (first_left == 0 and on_segment(first_start, second_start, first_end))
        or (first_right == 0 and on_segment(first_start, second_end, first_end))
        or (second_left == 0 and on_segment(second_start, first_start, second_end))
        or (second_right == 0 and on_segment(second_start, first_end, second_end))
    )


class MapRegionPresentation(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    label: str = Field(min_length=1, max_length=255)
    points: list[MapRegionPoint] = Field(min_length=3)
    label_position: MapRegionPoint | None = None
    style: MapRegionStyle
    z_order: int

    @model_validator(mode="after")
    def validate_simple_polygon(self) -> "MapRegionPresentation":
        point_count = len(self.points)
        for index, point in enumerate(self.points):
            next_point = self.points[(index + 1) % point_count]
            if point.x == next_point.x and point.y == next_point.y:
                raise PydanticCustomError("map_region_polygon", "Polygon cannot contain a zero-length edge")
        if len({(point.x, point.y) for point in self.points}) != point_count:
            raise PydanticCustomError("map_region_polygon", "Polygon cannot repeat a vertex")
        for first_index in range(point_count):
            for second_index in range(first_index + 1, point_count):
                if second_index in {first_index + 1, (first_index - 1) % point_count}:
                    continue
                if _polygon_segments_intersect(
                    self.points[first_index],
                    self.points[(first_index + 1) % point_count],
                    self.points[second_index],
                    self.points[(second_index + 1) % point_count],
                ):
                    raise PydanticCustomError("map_region_polygon", "Polygon cannot self-intersect")
        return self


class CreateMapRegionRequest(MapRegionPresentation):
    pass


class ReplaceMapRegionRequest(MapRegionPresentation):
    pass


class MapRegionDocument(MapRegionPresentation):
    region_ref: MapRegionRef


class SavedMapSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    map_ref: SavedMapRef
    name: str
    created_at: datetime
    updated_at: datetime


class SavedMapDocument(SavedMapSummary):
    placements: list[MapPlacementDocument]
    cable_routes: list[MapCableRouteDocument]
    regions: list[MapRegionDocument]


class SavedMapListDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    maps: list[SavedMapSummary]


class MapPlacementsDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    map_ref: SavedMapRef
    placements: list[MapPlacementDocument]


class CatalogInventoryOccupancy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_ports: int = Field(ge=0)
    connected_ports: int = Field(ge=0)
    free_ports: int = Field(ge=0)


class CatalogInventoryMapMembership(BaseModel):
    model_config = ConfigDict(extra="forbid")

    map_ref: SavedMapRef
    name: str = Field(min_length=1)


class CatalogInventoryEquipmentItem(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    physical_object_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None
    class_: str | None = Field(default=None, alias="class", min_length=1, max_length=255)
    occupancy: CatalogInventoryOccupancy | None = None
    map_memberships: list[CatalogInventoryMapMembership]


class CatalogInventoryCableEndpoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remote_physical_object_ref: ProjectionSourceRef
    remote_physical_object_label: str = Field(min_length=1)
    remote_connection_point_ref: ProjectionSourceRef
    remote_connection_point_label: str = Field(min_length=1)
    evidence_refs: list[ProjectionSourceRef]


class CatalogInventoryCableItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cable_ref: ProjectionSourceRef
    connection_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None
    resolution: Literal["RESOLVED"] = "RESOLVED"
    endpoint_a: CatalogInventoryCableEndpoint
    endpoint_b: CatalogInventoryCableEndpoint
    gaps: list[str]
    warnings: list[str]


class CatalogInventoryDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    equipment: list[CatalogInventoryEquipmentItem]
    cables: list[CatalogInventoryCableItem]
    gaps: list[str]
    warnings: list[str]


class TopologyProjectionScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_location_subtrees: list[ProjectionSourceRef]
    include_entities: list[ProjectionSourceRef]


class TopologyProjectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layer: Literal["L1", "L2", "L3"]
    detail_level: Literal["DEVICE", "PHYSICAL_OBJECT"]
    scope: TopologyProjectionScope
    include_cable_continuations: bool = False
    grouping: dict[str, Any] | None = None
    filters: dict[str, Any] | None = None


class PhysicalInternalL1Link(BaseModel):
    """Canonical same-object L1 continuity carried by a physical node."""

    model_config = ConfigDict(extra="forbid")

    from_connection_point_id: uuid.UUID
    from_member_index: int = Field(ge=1)
    to_connection_point_id: uuid.UUID
    to_member_index: int = Field(ge=1)
    connection_id: uuid.UUID
    connection_member_id: uuid.UUID
    source_refs: list[ProjectionSourceRef]


class TopologyProjectionNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: str
    label: str
    source_refs: list[ProjectionSourceRef]
    attributes: dict[str, Any]
    status: str | None = None


class TopologyProjectionEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    from_node_id: str
    to_node_id: str
    kind: str
    aggregate: bool
    source_refs: list[ProjectionSourceRef]
    attributes: dict[str, Any]
    status: str | None = None


class L1OffMapContinuation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    local_node_id: str
    local_physical_object_ref: ProjectionSourceRef
    local_connection_point_ref: ProjectionSourceRef
    local_connection_point_display_name: str
    cable_ref: ProjectionSourceRef
    cable_display_name: str
    remote_physical_object_ref: ProjectionSourceRef
    remote_display_name: str
    remote_connection_point_ref: ProjectionSourceRef
    remote_connection_point_display_name: str
    source_refs: list[ProjectionSourceRef]


class TopologyProjectionDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    layer: Literal["L1", "L2", "L3"]
    detail_level: Literal["DEVICE", "PHYSICAL_OBJECT"]
    nodes: list[TopologyProjectionNode]
    edges: list[TopologyProjectionEdge]
    gaps: list[str]
    warnings: list[str]
    l1_off_map_continuations: list[L1OffMapContinuation] | None = None


class InterfaceAddressDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    address: IPvAnyAddress
    prefix_length: int = Field(ge=0, le=128)
    source_refs: list[ProjectionSourceRef]


class InterfacePhysicalBindingDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_point_ref: ProjectionSourceRef
    member_index: int = Field(ge=1)
    source_refs: list[ProjectionSourceRef]


class DeviceInterfaceDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interface_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None
    addresses: list[InterfaceAddressDetails]
    l2_binding_count: int = Field(ge=0)
    l3_binding_count: int = Field(ge=0)
    direct_physical_bindings: list[InterfacePhysicalBindingDetails]
    realization_down_count: int = Field(ge=0)
    realization_up_count: int = Field(ge=0)
    source_refs: list[ProjectionSourceRef]


class DeviceDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None


class DeviceDetailsDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    device: DeviceDetails
    interfaces: list[DeviceInterfaceDetails]
    gaps: list[str]
    warnings: list[str]


class PhysicalObjectDetails(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    source_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None
    class_: str | None = Field(default=None, alias="class", min_length=1, max_length=255)


class BlueprintInstanceProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blueprint_ref: BlueprintLibraryRef
    version_ref: BlueprintLibraryRef
    version_number: int = Field(ge=1)


class BlueprintSlotMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slot_key: str = Field(min_length=1)
    kind: Literal["CONNECTION_POINT", "NETWORK_PORT"]


class DirectInterfaceBindingDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interface_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None
    evidence_refs: list[ProjectionSourceRef]


class InternalPhysicalCounterpartDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_point_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None
    connection_ref: ProjectionSourceRef
    evidence_refs: list[ProjectionSourceRef]


class ExternalPhysicalAttachmentDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["DIRECT_CONNECTION", "CABLE"]
    connection_ref: ProjectionSourceRef
    evidence_refs: list[ProjectionSourceRef]
    remote_physical_object_ref: ProjectionSourceRef | None = None
    remote_physical_object_label: str | None = None
    remote_connection_point_ref: ProjectionSourceRef | None = None
    remote_connection_point_label: str | None = None
    cable_ref: ProjectionSourceRef | None = None
    cable_label: str | None = None


class ConnectionPointDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_point_ref: ProjectionSourceRef
    label: str = Field(min_length=1)
    label_source: Literal["TECHNICAL_FALLBACK"] | None = None
    cardinality: int = Field(ge=1)
    incident_connection_count: int = Field(ge=0)
    external_connection_count: int = Field(ge=0)
    direct_interface_binding_count: int = Field(ge=0)
    ordering_key: str = Field(min_length=1)
    blueprint_slot: BlueprintSlotMetadata | None = None
    direct_interface_bindings: list[DirectInterfaceBindingDetails]
    internal_physical_counterparts: list[InternalPhysicalCounterpartDetails]
    external_physical_attachments: list[ExternalPhysicalAttachmentDetails]
    source_refs: list[ProjectionSourceRef]


class PhysicalObjectDetailsDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    physical_object: PhysicalObjectDetails
    blueprint_provenance: BlueprintInstanceProvenance | None = None
    connection_points: list[ConnectionPointDetails]
    owned_interface_count: int = Field(ge=0)
    gaps: list[str]
    warnings: list[str]


class CreateNetworkInterfaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)


class CreateNetworkDeviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)
    initial_interface: CreateNetworkInterfaceRequest


class CreateDeviceInterfaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)


class CreatePhysicalObjectConnectionPointRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)


class CreateConnectionPointRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)


class CreatePhysicalObjectRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, populate_by_name=True
    )

    display_name: str = Field(min_length=1, max_length=255)
    initial_connection_point: CreatePhysicalObjectConnectionPointRequest
    class_: str | None = Field(default=None, alias="class", min_length=1, max_length=255)


class SetPhysicalObjectClassRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    value: str = Field(min_length=1, max_length=255)


class SetPhysicalObjectDisplayNameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)


class BlueprintAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    side: Literal["LEFT", "RIGHT", "TOP", "BOTTOM"]
    offset: float = Field(ge=0, le=1)


class BlueprintBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["RECTANGLE"]
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    fill_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class BlueprintEndpointSlotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    key: str = Field(min_length=1, max_length=255)
    display_name: str = Field(min_length=1, max_length=255)
    kind: Literal["CONNECTION_POINT", "NETWORK_PORT"]
    anchor: BlueprintAnchor


class BlueprintInternalLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    from_slot_key: str = Field(min_length=1, max_length=255)
    to_slot_key: str = Field(min_length=1, max_length=255)


class BlueprintCompositionInstanceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    instance_key: str = Field(min_length=1, max_length=255)
    port_block_version_ref: PortBlockVersionLibraryRef
    face: Literal["FRONT", "REAR"]
    placement: "BlueprintPortBlockPlacement"


class BlueprintPortBlockPlacement(BaseModel):
    """Face-local normalized composition rectangle, unrelated to topology anchors."""
    model_config = ConfigDict(extra="forbid")
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def validate_bounds(self) -> "BlueprintPortBlockPlacement":
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise PydanticCustomError("blueprint_port_block_placement_out_of_bounds", "Blueprint Port Block placement must fit within the body")
        return self


class BlueprintCompositionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instances: list[BlueprintCompositionInstanceRequest] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_instance_keys(self) -> "BlueprintCompositionRequest":
        keys = [item.instance_key for item in self.instances]
        if len(keys) != len(set(keys)):
            raise PydanticCustomError("blueprint_duplicate_block_instance_key", "Blueprint Port Block instance keys must be unique")
        return self


class CreateObjectBlueprintRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=255)
    default_physical_object_class: str | None = Field(default=None, min_length=1, max_length=255)
    body: BlueprintBody
    composition: BlueprintCompositionRequest
    internal_links: list[BlueprintInternalLinkRequest] = Field(default_factory=list)



class CreateObjectBlueprintVersionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    default_physical_object_class: str | None = Field(default=None, min_length=1, max_length=255)
    blueprint_name: str | None = Field(default=None, min_length=1, max_length=255)
    body: BlueprintBody
    composition: BlueprintCompositionRequest
    internal_links: list[BlueprintInternalLinkRequest] = Field(default_factory=list)



class InstantiateObjectBlueprintRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)


class PortBlockPortRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    local_id: str = Field(min_length=1, max_length=255)
    display_label: str = Field(min_length=1, max_length=255)
    kind: Literal["CONNECTION_POINT", "NETWORK_PORT"]
    row: int = Field(ge=1, le=2)
    column: int = Field(ge=1)
    layout_order: int = Field(ge=1)


class _PortBlockVersionSnapshotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    ports: list[PortBlockPortRequest] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_port_snapshot(self) -> "_PortBlockVersionSnapshotRequest":
        local_ids = [port.local_id for port in self.ports]
        positions = [(port.row, port.column) for port in self.ports]
        orders = [port.layout_order for port in self.ports]
        if len(local_ids) != len(set(local_ids)):
            raise PydanticCustomError("port_block_duplicate_local_id", "Port Block local ids must be unique")
        if len(positions) != len(set(positions)):
            raise PydanticCustomError("port_block_duplicate_position", "Port Block port positions must be unique")
        if len(orders) != len(set(orders)):
            raise PydanticCustomError("port_block_duplicate_layout_order", "Port Block layout order values must be unique")
        if sorted(orders) != list(range(1, len(orders) + 1)):
            raise PydanticCustomError(
                "port_block_non_contiguous_layout_order",
                "Port Block layout order must be contiguous starting at 1",
            )
        rows = {port.row for port in self.ports}
        if rows not in ({1}, {1, 2}):
            raise PydanticCustomError("port_block_invalid_rows", "Port Block rows must be one row or rows 1 and 2")
        return self


class CreatePortBlockRequest(_PortBlockVersionSnapshotRequest):
    name: str = Field(min_length=1, max_length=255)


class CreatePortBlockVersionRequest(_PortBlockVersionSnapshotRequest):
    port_block_name: str | None = Field(default=None, min_length=1, max_length=255)


class PortBlockCreationDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    port_block_ref: PortBlockLibraryRef
    version_ref: PortBlockLibraryRef


class PortBlockListItemDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    port_block_ref: PortBlockLibraryRef
    name: str = Field(min_length=1)
    version_ref: PortBlockLibraryRef
    version_number: int = Field(ge=1)
    port_count: int = Field(ge=1)
    version_count: int = Field(ge=1)


class PortBlockListDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    port_blocks: list[PortBlockListItemDocument]

class PortBlockVersionSummaryDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    port_block_ref: PortBlockLibraryRef
    version_ref: PortBlockVersionLibraryRef
    version_number: int = Field(ge=1)
    port_count: int = Field(ge=1)

class PortBlockVersionListDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = "1.0"
    versions: list[PortBlockVersionSummaryDocument]


class PortBlockPortDocument(PortBlockPortRequest):
    pass


class PortBlockVersionDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    port_block_ref: PortBlockLibraryRef
    name: str = Field(min_length=1)
    version_ref: PortBlockLibraryRef
    version_number: int = Field(ge=1)
    ports: list[PortBlockPortDocument] = Field(min_length=1)


class ObjectBlueprintCreationDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    blueprint_ref: BlueprintLibraryRef
    version_ref: BlueprintLibraryRef


class ObjectBlueprintInstantiationSlot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slot_key: str = Field(min_length=1)
    connection_point_ref: ProjectionSourceRef
    network_interface_ref: ProjectionSourceRef | None = None


class ObjectBlueprintInstantiationDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    blueprint_ref: BlueprintLibraryRef
    version_ref: BlueprintLibraryRef
    physical_object_ref: ProjectionSourceRef
    slots: list[ObjectBlueprintInstantiationSlot]


class ObjectBlueprintBodyDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["RECTANGLE"]
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    fill_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class ObjectBlueprintListItemDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blueprint_ref: BlueprintLibraryRef
    name: str = Field(min_length=1)
    version_ref: BlueprintLibraryRef
    version_number: int = Field(ge=1)
    default_physical_object_class: str | None = None
    body: ObjectBlueprintBodyDocument
    slot_count: int = Field(ge=0)
    internal_link_count: int = Field(ge=0)
    version_count: int = Field(ge=1)


class ObjectBlueprintListDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    blueprints: list[ObjectBlueprintListItemDocument]


class ObjectBlueprintSlotDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    kind: Literal["CONNECTION_POINT", "NETWORK_PORT"]
    face: Literal["FRONT", "REAR"]
    rendered_position: dict[str, float]


class ObjectBlueprintInternalLinkDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_slot_key: str = Field(min_length=1)
    to_slot_key: str = Field(min_length=1)


class BlueprintCompositionInstanceDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instance_key: str = Field(min_length=1)
    port_block_ref: PortBlockLibraryRef
    port_block_version_ref: PortBlockVersionLibraryRef
    face: Literal["FRONT", "REAR"]
    placement: BlueprintPortBlockPlacement | None = None


class BlueprintCompositionDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instances: list[BlueprintCompositionInstanceDocument]


class ObjectBlueprintVersionDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    blueprint_ref: BlueprintLibraryRef
    name: str = Field(min_length=1)
    version_ref: BlueprintLibraryRef
    version_number: int = Field(ge=1)
    default_physical_object_class: str | None = None
    body: ObjectBlueprintBodyDocument
    slots: list[ObjectBlueprintSlotDocument]
    internal_links: list[ObjectBlueprintInternalLinkDocument]
    composition: BlueprintCompositionDocument | None = None


class BlueprintUpgradeChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    slot_key: str | None = None
    slot_keys: list[str] | None = None
    kind: str | None = None
    current_kind: str | None = None
    target_kind: str | None = None
    details: str | None = None


class BlueprintUpgradeAnalysisDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = "1.0"
    status: Literal["NOT_APPLICABLE", "UP_TO_DATE", "OUTDATED", "MODEL_INCONSISTENT"]
    blueprint_ref: BlueprintLibraryRef | None = None
    current_version_ref: BlueprintLibraryRef | None = None
    current_version_number: int | None = Field(default=None, ge=1)
    target_version_ref: BlueprintLibraryRef | None = None
    target_version_number: int | None = Field(default=None, ge=1)
    compatible_changes: list[BlueprintUpgradeChange]
    blockers: list[BlueprintUpgradeChange]


class ApplyBlueprintUpgradeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_version_id: uuid.UUID


class CreatePhysicalLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    source_interface_id: uuid.UUID
    target_interface_id: uuid.UUID


class PhysicalConnectionCreationDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    source_interface_ref: ProjectionSourceRef
    target_interface_ref: ProjectionSourceRef
    cable_ref: ProjectionSourceRef
    source_binding_ref: ProjectionSourceRef
    target_binding_ref: ProjectionSourceRef
    connection_ref: ProjectionSourceRef


class NetworkInterfacePhysicalEndpointRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["NETWORK_INTERFACE"]
    network_interface_id: uuid.UUID


class ConnectionPointPhysicalEndpointRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["CONNECTION_POINT"]
    connection_point_id: uuid.UUID
    member_index: Literal[1] = 1


PhysicalEndpointRequest = Annotated[
    NetworkInterfacePhysicalEndpointRequest | ConnectionPointPhysicalEndpointRequest,
    Field(discriminator="kind"),
]


class CreatePhysicalEndpointConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    source: PhysicalEndpointRequest
    target: PhysicalEndpointRequest


class PhysicalEndpointMaterialization(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["NETWORK_INTERFACE", "CONNECTION_POINT"]
    endpoint_ref: ProjectionSourceRef
    connection_point_ref: ProjectionSourceRef
    interface_binding_ref: ProjectionSourceRef | None = None
    member_index: Literal[1] = 1


class PhysicalEndpointConnectionCreationDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    source: PhysicalEndpointMaterialization
    target: PhysicalEndpointMaterialization
    cable_ref: ProjectionSourceRef
    connection_ref: ProjectionSourceRef


class EvidenceRef(BaseModel):
    ref_type: Literal["CANONICAL_FACT"] = "CANONICAL_FACT"
    entity_type: Literal[
        "ConnectionPoint",
        "Connection",
        "ConnectionMember",
        "NetworkInterface",
        "InterfacePhysicalBinding",
        "NetworkInterfaceRealization",
        "L2ForwardingContext",
        "L2Binding",
        "L2IngressRule",
        "L2EgressRule",
        "RoutingContext",
        "L3Binding",
        "InterfaceAddress",
        "RoutingTable",
        "RoutingPolicy",
        "RoutingPolicyRule",
        "Route",
        "RouteNextHop",
        "SecurityPolicy",
        "SecurityRule",
        "SecurityPolicyAttachment",
        "NATPolicy",
        "NATRule",
        "NATPolicyAttachment",
        "NATPool",
        "PacketProcessingPlan",
        "ProcessingStage",
        "ProcessingTransition",
        "ProcessingEntryPoint",
        "PacketProcessingPlanAttachmentSet",
        "PacketProcessingPlanAttachment",
    ]
    entity_id: uuid.UUID


class EvidenceNode(BaseModel):
    id: str
    kind: Literal["STATE"] = "STATE"
    layer: Literal["L1"] = "L1"
    payload: PointMemberAddress
    canonical_refs: list[EvidenceRef]


class EvidenceEdge(BaseModel):
    id: str
    from_node_id: str
    to_node_id: str
    transition_kind: Literal["L1_TRAVERSE"] = "L1_TRAVERSE"
    layer: Literal["L1"] = "L1"
    evidence_refs: list[EvidenceRef]


class TraceGap(BaseModel):
    code: Literal["L1_TOPOLOGY_INCOMPLETE"]
    node_id: str | None = None
    evidence_refs: list[EvidenceRef]


class TraceArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: L1TraceQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l1-traversal/1.0"] = "l1-traversal/1.0"
    verdict: Literal["REACHABLE", "UNREACHABLE", "UNKNOWN"]
    nodes: list[EvidenceNode]
    edges: list[EvidenceEdge]
    evidence_refs: list[EvidenceRef]
    gaps: list[TraceGap]
    warnings: list[dict[str, Any]]


class InterfacePhysicalTraceQuery(BaseModel):
    from_interface_id: uuid.UUID
    to_interface_id: uuid.UUID


class PhysicalObjectL1TraceQuery(BaseModel):
    from_physical_object_id: uuid.UUID
    to_physical_object_id: uuid.UUID
    from_connection_point_id: uuid.UUID | None = None
    to_connection_point_id: uuid.UUID | None = None


class PhysicalObjectL1TraceBranch(BaseModel):
    branch_id: str
    source: PointMemberAddress
    target: PointMemberAddress
    edge_ids: list[str]
    evidence_refs: list[EvidenceRef]


class PhysicalObjectL1TraceCycle(BaseModel):
    cycle_id: str
    state_node_ids: list[str]
    edge_ids: list[str]
    evidence_refs: list[EvidenceRef]


class PhysicalObjectL1TraceArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: PhysicalObjectL1TraceQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["physical-object-l1/1.0"] = "physical-object-l1/1.0"
    verdict: Literal["REACHABLE", "UNKNOWN"]
    source_candidates: list[PointMemberAddress]
    target_candidates: list[PointMemberAddress]
    branches: list[PhysicalObjectL1TraceBranch]
    cycles: list[PhysicalObjectL1TraceCycle]
    nodes: list[EvidenceNode]
    edges: list[EvidenceEdge]
    evidence_refs: list[EvidenceRef]
    gaps: list[TraceGap]
    warnings: list[dict[str, Any]]


class RealizationCandidateStep(BaseModel):
    realization_id: uuid.UUID
    upper_interface_id: uuid.UUID
    lower_interface_id: uuid.UUID


class PhysicalBindingCandidate(BaseModel):
    candidate_id: str
    root_interface_id: uuid.UUID
    binding_id: uuid.UUID
    interface_id: uuid.UUID
    point: PointMemberAddress
    realization_path: list[RealizationCandidateStep]


class InterfaceStatePayload(BaseModel):
    interface_id: uuid.UUID


class InterfaceTraceNode(BaseModel):
    id: str
    kind: Literal["STATE"] = "STATE"
    layer: Literal["INTERFACE", "L1"]
    payload: InterfaceStatePayload | PointMemberAddress
    canonical_refs: list[EvidenceRef]


class InterfaceTraceEdge(BaseModel):
    id: str
    from_node_id: str
    to_node_id: str
    transition_kind: Literal[
        "INTERFACE_REALIZATION_DOWN",
        "INTERFACE_REALIZATION_UP",
        "INTERFACE_PHYSICAL_BIND",
        "L1_TRAVERSE",
    ]
    layer: Literal["INTERFACE", "BRIDGE", "L1"]
    evidence_refs: list[EvidenceRef]


class InterfaceTraceGap(BaseModel):
    code: Literal[
        "INTERFACE_PHYSICAL_BINDING_UNKNOWN",
        "INTERFACE_PHYSICAL_REALIZATION_UNKNOWN",
        "L1_TOPOLOGY_INCOMPLETE",
    ]
    node_id: str | None = None
    evidence_refs: list[EvidenceRef]


class InterfacePhysicalTraceBranch(BaseModel):
    branch_id: str
    source_candidate_id: str
    target_candidate_id: str
    edge_ids: list[str]
    evidence_refs: list[EvidenceRef]


class InterfacePhysicalTraceArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: InterfacePhysicalTraceQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["interface-physical/2.0"] = "interface-physical/2.0"
    verdict: Literal["REACHABLE", "UNKNOWN"]
    source_binding_candidates: list[PhysicalBindingCandidate]
    target_binding_candidates: list[PhysicalBindingCandidate]
    branches: list[InterfacePhysicalTraceBranch]
    nodes: list[InterfaceTraceNode]
    edges: list[InterfaceTraceEdge]
    evidence_refs: list[EvidenceRef]
    gaps: list[InterfaceTraceGap]
    warnings: list[dict[str, Any]]


class EncapsulationLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1)
    value: int


class CreateL2ForwardingContextBindingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interface_id: uuid.UUID
    ingress_exact_stacks: list[list[EncapsulationLabel]] = Field(default_factory=list)
    egress_emit_stack: list[EncapsulationLabel] | None = None


class CreateL2ForwardingContextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bindings: list[CreateL2ForwardingContextBindingRequest] = Field(min_length=1)


class L2ForwardingContextBindingCreationDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interface_ref: ProjectionSourceRef
    binding_ref: ProjectionSourceRef
    ingress_rule_refs: list[ProjectionSourceRef]
    egress_rule_ref: ProjectionSourceRef | None = None


class L2ForwardingContextCreationDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    forwarding_context_ref: ProjectionSourceRef
    bindings: list[L2ForwardingContextBindingCreationDocument]


class L2BoundaryQuery(BaseModel):
    interface_id: uuid.UUID
    encapsulation_stack: list[EncapsulationLabel]


class L2ReachabilityQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: L2BoundaryQuery = Field(alias="from")
    to: L2BoundaryQuery


class L2BoundaryPayload(BaseModel):
    interface_id: uuid.UUID
    direction: Literal["INGRESS", "EGRESS"]
    encapsulation_stack: list[EncapsulationLabel]


class L2InternalInterfacePayload(BaseModel):
    interface_id: uuid.UUID
    direction: Literal["INGRESS", "EGRESS"]


class L2ContextPayload(BaseModel):
    forwarding_context_id: uuid.UUID
    ingress_binding_id: uuid.UUID


class L2BindingPayload(BaseModel):
    binding_id: uuid.UUID
    interface_id: uuid.UUID
    forwarding_context_id: uuid.UUID


class L2TraceNode(BaseModel):
    id: str
    kind: Literal["STATE"] = "STATE"
    layer: Literal["L2"] = "L2"
    payload: (
        L2BoundaryPayload
        | L2InternalInterfacePayload
        | L2ContextPayload
        | L2BindingPayload
    )
    canonical_refs: list[EvidenceRef]


class L2TraceEdge(BaseModel):
    id: str
    from_node_id: str
    to_node_id: str
    transition_kind: Literal[
        "INGRESS_DECODE",
        "LOCAL_FORWARD",
        "EGRESS_ENCODE",
        "REALIZATION_DOWN",
        "PHYSICAL_TRANSPORT",
        "REALIZATION_UP",
        "INTERNAL_ATTACH",
    ]
    layer: Literal["L2", "INTERFACE", "L1"] = "L2"
    evidence_refs: list[EvidenceRef]


class L2TraceGap(BaseModel):
    code: Literal[
        "L2_INGRESS_RULE_UNKNOWN",
        "L2_INGRESS_AMBIGUOUS",
        "L2_EGRESS_RULE_UNKNOWN",
        "L2_TARGET_CONTEXT_PATH_UNKNOWN",
        "L2_PHYSICAL_TRANSPORT_UNKNOWN",
        "L2_INTERNAL_ATTACHMENT_UNKNOWN",
    ]
    node_id: str | None = None
    evidence_refs: list[EvidenceRef]


class L2ReachabilityTraceBranch(BaseModel):
    branch_id: str
    edge_ids: list[str]
    evidence_refs: list[EvidenceRef]


class L2ReachabilityTraceArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: L2ReachabilityQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l2-configured-multihop/3.0"] = (
        "l2-configured-multihop/3.0"
    )
    verdict: Literal["REACHABLE", "UNKNOWN"]
    branches: list[L2ReachabilityTraceBranch] = Field(default_factory=list)
    nodes: list[L2TraceNode]
    edges: list[L2TraceEdge]
    evidence_refs: list[EvidenceRef]
    gaps: list[L2TraceGap]
    warnings: list[dict[str, Any]]


class RouteDecisionQuery(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID
    destination_ip: IPvAnyAddress


class RouteDecisionBasis(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID
    destination_ip: IPvAnyAddress
    address_family: Literal["IPv4", "IPv6"]
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]


class RouteNextHopCandidate(BaseModel):
    route_next_hop_id: uuid.UUID
    gateway_address: IPvAnyAddress | None = None
    egress_l3_binding_id: uuid.UUID | None = None


class RouteDecisionGap(BaseModel):
    code: Literal["ROUTING_TABLE_INCOMPLETE", "ROUTE_CONFLICTING"]
    evidence_refs: list[EvidenceRef]


class RouteDecisionArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: RouteDecisionQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-selected-table-route-decision/1.0"] = (
        "l3-selected-table-route-decision/1.0"
    )
    result: Literal[
        "FORWARD", "LOCAL", "DISCARD", "NO_ROUTE", "UNKNOWN", "CONFLICTING"
    ]
    decision_basis: RouteDecisionBasis
    selected_route_id: uuid.UUID | None = None
    next_hop_candidates: list[RouteNextHopCandidate]
    evidence_refs: list[EvidenceRef]
    gaps: list[RouteDecisionGap]
    warnings: list[dict[str, Any]]


class NextHopResolutionQuery(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID
    destination_ip: IPvAnyAddress


class L3LookupState(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID
    lookup_address: IPvAnyAddress
    original_destination: IPvAnyAddress
    purpose: Literal["PACKET_DESTINATION", "NEXT_HOP_RESOLUTION"]
    egress_constraint: uuid.UUID | None = None


class L3LookupStep(BaseModel):
    state: L3LookupState
    route_decision_result: Literal[
        "FORWARD",
        "LOCAL",
        "DISCARD",
        "NO_ROUTE",
        "UNKNOWN",
        "CONFLICTING",
        "LOOP_DETECTED",
    ]
    selected_route_id: uuid.UUID | None = None
    selected_route_next_hop_id: uuid.UUID | None = None
    gateway_address: IPvAnyAddress | None = None
    egress_l3_binding_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class DirectEgressState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    egress_l3_binding_id: uuid.UUID
    adjacency_mode: Literal["GATEWAY", "DIRECT_DESTINATION"]
    gateway_address: IPvAnyAddress | None = None
    original_destination: IPvAnyAddress

    @model_validator(mode="after")
    def validate_adjacency_target(self) -> "DirectEgressState":
        if self.adjacency_mode == "GATEWAY" and self.gateway_address is None:
            raise ValueError("GATEWAY direct egress requires gateway_address")
        if (
            self.adjacency_mode == "DIRECT_DESTINATION"
            and self.gateway_address is not None
        ):
            raise ValueError(
                "DIRECT_DESTINATION direct egress forbids gateway_address"
            )
        return self


class NextHopResolutionBranch(BaseModel):
    outcome: Literal[
        "RESOLVED",
        "LOCAL_TERMINAL",
        "DISCARD",
        "NO_ROUTE",
        "UNKNOWN",
        "CONFLICTING",
        "LOOP_DETECTED",
    ]
    lookup_steps: list[L3LookupStep]
    direct_egress: DirectEgressState | None = None
    evidence_refs: list[EvidenceRef]


class NextHopResolutionArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: NextHopResolutionQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-selected-table-next-hop-resolution/1.1"] = (
        "l3-selected-table-next-hop-resolution/1.1"
    )
    result: Literal[
        "RESOLVED",
        "LOCAL_TERMINAL",
        "DISCARD",
        "NO_ROUTE",
        "UNKNOWN",
        "CONFLICTING",
        "LOOP_DETECTED",
    ]
    branches: list[NextHopResolutionBranch]
    evidence_refs: list[EvidenceRef]
    warnings: list[dict[str, Any]]


class AdjacencyCandidatesQuery(BaseModel):
    egress_l3_binding_id: uuid.UUID
    neighbor_target_ip: IPvAnyAddress


class AdjacencyCandidate(BaseModel):
    interface_address_id: uuid.UUID
    target_l3_binding_id: uuid.UUID
    target_network_interface_id: uuid.UUID
    ip_address: IPvAnyAddress


class AdjacencyCandidatesGap(BaseModel):
    code: Literal["INTERFACE_ADDRESS_UNKNOWN"]
    evidence_refs: list[EvidenceRef]


class AdjacencyCandidatesArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: AdjacencyCandidatesQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-structural-adjacency-candidates/1.0"] = (
        "l3-structural-adjacency-candidates/1.0"
    )
    result: Literal["CANDIDATES_FOUND", "UNKNOWN"]
    routing_context_id: uuid.UUID
    candidates: list[AdjacencyCandidate]
    evidence_refs: list[EvidenceRef]
    gaps: list[AdjacencyCandidatesGap]
    warnings: list[dict[str, Any]]


class StructuralAdjacencyQuery(BaseModel):
    egress_l3_binding_id: uuid.UUID
    neighbor_target_ip: IPvAnyAddress


class StructuralL2TraversalArtifact(BaseModel):
    verdict: Literal["REACHABLE", "UNKNOWN"]
    source: L2InternalInterfacePayload
    target: L2InternalInterfacePayload
    branches: list[L2ReachabilityTraceBranch]
    nodes: list[L2TraceNode]
    edges: list[L2TraceEdge]
    evidence_refs: list[EvidenceRef]
    gaps: list[L2TraceGap]


class StructuralAdjacencyCandidateResult(BaseModel):
    identity_candidate: AdjacencyCandidate
    result: Literal["REACHABLE", "UNKNOWN"]
    l2_traversal: StructuralL2TraversalArtifact
    evidence_refs: list[EvidenceRef]


class StructuralAdjacencyArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: StructuralAdjacencyQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-structural-adjacency-proof/1.0"] = (
        "l3-structural-adjacency-proof/1.0"
    )
    result: Literal["REACHABLE", "UNKNOWN"]
    identity_resolution: AdjacencyCandidatesArtifact
    candidate_results: list[StructuralAdjacencyCandidateResult]
    evidence_refs: list[EvidenceRef]
    warnings: list[dict[str, Any]]


class L3ReachabilityTableSelection(BaseModel):
    routing_context_id: uuid.UUID
    routing_table_id: uuid.UUID


class L3ReachabilityQuery(BaseModel):
    origin_l3_binding_id: uuid.UUID
    destination_ip: IPvAnyAddress
    table_selections: list[L3ReachabilityTableSelection]


class L3RoutingState(BaseModel):
    routing_context_id: uuid.UUID
    ingress_l3_binding_id: uuid.UUID | None = None
    destination_ip: IPvAnyAddress


class L3ReachabilityHop(BaseModel):
    routing_state: L3RoutingState
    selected_routing_table_id: uuid.UUID | None = None
    next_hop_resolution: NextHopResolutionArtifact | None = None
    next_hop_branch: NextHopResolutionBranch | None = None
    structural_adjacency: StructuralAdjacencyArtifact | None = None
    adjacency_candidate: StructuralAdjacencyCandidateResult | None = None
    l2_branch_id: str | None = None
    reached_l3_binding_id: uuid.UUID | None = None
    next_routing_context_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class L3ReachabilityBranch(BaseModel):
    branch_id: str
    termination: Literal[
        "TARGET_REACHED",
        "LOCAL_DELIVERY",
        "TABLE_SELECTION_UNKNOWN",
        "ROUTE_DISCARD",
        "NO_ROUTE",
        "ROUTE_UNKNOWN",
        "ROUTE_CONFLICTING",
        "NEXT_HOP_UNRESOLVED",
        "LOOP_DETECTED",
        "STRUCTURAL_ADJACENCY_UNKNOWN",
        "FORWARDING_LOOP",
    ]
    hops: list[L3ReachabilityHop]
    evidence_refs: list[EvidenceRef]


class L3ReachabilityArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: L3ReachabilityQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["l3-configured-multirouter/1.1"] = (
        "l3-configured-multirouter/1.1"
    )
    verdict: Literal["REACHABLE", "UNREACHABLE", "UNKNOWN"]
    branches: list[L3ReachabilityBranch]
    evidence_refs: list[EvidenceRef]
    warnings: list[dict[str, Any]]


class PacketState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    source_ip: IPvAnyAddress | None = None
    destination_ip: IPvAnyAddress | None = None
    ip_protocol: int | None = Field(default=None, ge=0, le=255)
    source_port: int | None = Field(default=None, ge=0, le=65535)
    destination_port: int | None = Field(default=None, ge=0, le=65535)
    icmp_type: int | None = Field(default=None, ge=0, le=255)
    icmp_code: int | None = Field(default=None, ge=0, le=255)


class RoutingTableSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    op: Literal["SELECT_TABLE"]
    routing_table_id: uuid.UUID


class PacketProcessingPlanValidationQuery(BaseModel):
    plan_id: uuid.UUID


class ProcessingStageArtifact(BaseModel):
    stage_id: uuid.UUID
    kind: Literal[
        "ROUTING_POLICY",
        "ROUTE_DECISION",
        "SECURITY",
        "NAT",
        "ADJACENCY_L2",
        "LOCAL_DELIVERY",
        "TERMINATE",
    ]
    payload: dict[str, str]


class ProcessingTransitionArtifact(BaseModel):
    transition_id: uuid.UUID
    from_stage_id: uuid.UUID
    outcome: str
    to_stage_id: uuid.UUID


class ProcessingEntryPointArtifact(BaseModel):
    entry_point_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    stage_id: uuid.UUID


class PacketProcessingPlanValidationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: PacketProcessingPlanValidationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["packet-processing-plan-validation/1.0"] = (
        "packet-processing-plan-validation/1.0"
    )
    result: Literal["VALID"] = "VALID"
    plan_id: uuid.UUID
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    entry_points: list[ProcessingEntryPointArtifact]
    stages: list[ProcessingStageArtifact]
    transitions: list[ProcessingTransitionArtifact]
    evidence_refs: list[EvidenceRef]
    warnings: list[dict[str, Any]]


class PacketProcessingPlanSelectionQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None


class PacketProcessingPlanAttachmentEvaluation(BaseModel):
    attachment_id: uuid.UUID
    plan_id: uuid.UUID
    scope: dict[str, list[str]]
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    evidence_refs: list[EvidenceRef]


class PacketProcessingPlanSelectionGap(BaseModel):
    code: Literal[
        "PLAN_ATTACHMENT_SET_UNKNOWN",
        "PLAN_ATTACHMENT_COVERAGE_INCOMPLETE",
        "PLAN_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "PLAN_SELECTION_CONFLICT",
    ]
    evidence_refs: list[EvidenceRef]


class PacketProcessingPlanSelectionArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: PacketProcessingPlanSelectionQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["packet-processing-plan-selection/1.0"] = (
        "packet-processing-plan-selection/1.0"
    )
    result: Literal[
        "PLAN_SELECTED", "NO_PLAN_CONFIRMED", "UNKNOWN", "CONFLICTING"
    ]
    attachment_set_id: uuid.UUID | None = None
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"] | None = None
    selected_plan_id: uuid.UUID | None = None
    selected_plan_configured_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ] | None = None
    attachment_evaluations: list[PacketProcessingPlanAttachmentEvaluation]
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketProcessingPlanSelectionGap]
    warnings: list[dict[str, Any]]


class RoutingPolicyEvaluationQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    policy_id: uuid.UUID
    routing_context_id: uuid.UUID
    packet_state: PacketState
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"] | None = None
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None


class RoutingPolicyRuleEvaluationStep(BaseModel):
    rule_id: uuid.UUID
    order_key: int
    predicate_result: Literal["TRUE", "FALSE", "UNKNOWN"]
    branch_assumption: Literal["MATCH", "NO_MATCH"]
    evidence_refs: list[EvidenceRef]


class RoutingPolicyEvaluationBranch(BaseModel):
    branch_id: str
    steps: list[RoutingPolicyRuleEvaluationStep]
    terminal_source: Literal["RULE", "DEFAULT"]
    terminal_rule_id: uuid.UUID | None = None
    selection: RoutingTableSelection
    selected_routing_table_id: uuid.UUID
    evidence_refs: list[EvidenceRef]


class RoutingPolicyEvaluationGap(BaseModel):
    code: Literal[
        "ROUTING_POLICY_INCOMPLETE",
        "ROUTING_TABLE_SELECTION_UNKNOWN",
    ]
    evidence_refs: list[EvidenceRef]


class RoutingPolicyEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: RoutingPolicyEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["routing-policy-configured/1.1"] = (
        "routing-policy-configured/1.1"
    )
    result: Literal["TABLE_SELECTED", "TABLE_SELECTION_UNKNOWN"]
    policy_id: uuid.UUID
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    routing_context_id: uuid.UUID
    address_family: Literal["IPv4", "IPv6"]
    selected_routing_table_id: uuid.UUID | None = None
    branches: list[RoutingPolicyEvaluationBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[RoutingPolicyEvaluationGap]
    warnings: list[dict[str, Any]]


class PacketProcessingEvaluationQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    plan_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    routing_context_id: uuid.UUID
    packet_state: PacketState
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None


class PacketProcessingFlowState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    original_packet_state: PacketState
    current_packet_state: PacketState | None = None
    current_packet_constraint: NATPacketConstraint | None = None
    current_packet_unknown: bool = False
    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None
    selected_routing_table_id: uuid.UUID | None = None
    current_route_resolution_branch: NextHopResolutionBranch | None = None
    direct_egress: DirectEgressState | None = None
    current_stage_id: uuid.UUID

    @model_validator(mode="after")
    def validate_packet_value(self) -> "PacketProcessingFlowState":
        active = sum(
            (
                self.current_packet_state is not None,
                self.current_packet_constraint is not None,
                self.current_packet_unknown,
            )
        )
        if active != 1:
            raise ValueError("Flow state requires exactly one current packet value")
        return self


class PacketProcessingExecutionGap(BaseModel):
    code: Literal[
        "PROCESSING_PLAN_INCOMPLETE",
        "STAGE_PRECONDITION_UNKNOWN",
        "NEXT_HOP_RESOLUTION_LOOP",
        "SECURITY_STAGE_UNKNOWN",
        "NAT_STAGE_UNKNOWN",
        "PACKET_CONSTRAINT_UNSUPPORTED",
        "PACKET_CONSTRAINT_EXPANSION_LIMIT",
        "PACKET_STATE_UNKNOWN",
        "STRUCTURAL_ADJACENCY_UNKNOWN",
    ]
    stage_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class PacketProcessingHandoff(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    outcome: Literal["NEXT_PROCESSING_POINT", "TARGET_ATTACHMENT_REACHED"]
    receiving_network_interface_id: uuid.UUID
    receiving_l3_binding_id: uuid.UUID
    receiving_routing_context_id: uuid.UUID


class PacketProcessingLocalDelivery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    result: Literal["DELIVERED", "UNKNOWN"]
    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    reason: Literal["LOCAL_INPUT_CONTEXT", "STAGE_PRECONDITION_UNKNOWN"]


class PacketProcessingStageExecution(BaseModel):
    stage_id: uuid.UUID
    stage_kind: Literal[
        "ROUTING_POLICY",
        "ROUTE_DECISION",
        "SECURITY",
        "NAT",
        "ADJACENCY_L2",
        "LOCAL_DELIVERY",
        "TERMINATE",
    ]
    packet_before: PacketState | None = None
    packet_before_constraint: NATPacketConstraint | None = None
    packet_before_unknown: bool = False
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    packet_after_unknown: bool = False
    traffic_class_before: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    traffic_class_after: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    selected_routing_table_id_before: uuid.UUID | None = None
    selected_routing_table_id_after: uuid.UUID | None = None
    stage_outcome: str
    transition_id: uuid.UUID | None = None
    next_stage_id: uuid.UUID | None = None
    routing_policy_evaluation: RoutingPolicyEvaluationArtifact | None = None
    next_hop_resolution: NextHopResolutionArtifact | None = None
    selected_next_hop_branch_index: int | None = None
    direct_egress: DirectEgressState | None = None
    security_attachment_evaluation: SecurityAttachmentStageArtifact | None = None
    nat_attachment_evaluation: NATAttachmentStageArtifact | None = None
    adjacency_target_ip: IPvAnyAddress | None = None
    structural_adjacency_evaluation: StructuralAdjacencyArtifact | None = None
    selected_adjacency_candidate: AdjacencyCandidate | None = None
    selected_l2_branch_id: str | None = None
    handoff: PacketProcessingHandoff | None = None
    local_delivery: PacketProcessingLocalDelivery | None = None
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketProcessingExecutionGap]

    @model_validator(mode="after")
    def validate_packet_values(self) -> "PacketProcessingStageExecution":
        before_active = sum(
            (
                self.packet_before is not None,
                self.packet_before_constraint is not None,
                self.packet_before_unknown,
            )
        )
        after_active = sum(
            (
                self.packet_after is not None,
                self.packet_after_constraint is not None,
                self.packet_after_unknown,
            )
        )
        if before_active != 1 or after_active != 1:
            raise ValueError("Stage execution requires one before/after packet value")
        return self


class PacketProcessingExecutionBranch(BaseModel):
    branch_id: str
    initial_state: PacketProcessingFlowState
    stage_executions: list[PacketProcessingStageExecution]
    final_state: PacketProcessingFlowState
    terminal_outcome: Literal[
        "CONTINUE_TO_NEXT_HOP",
        "NETWORK_DELIVERY",
        "NOT_DELIVERED",
        "UNKNOWN",
    ]
    evidence_refs: list[EvidenceRef]


class PacketProcessingEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: PacketProcessingEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["packet-processing-full-local/1.6"] = (
        "packet-processing-full-local/1.6"
    )
    result: Literal[
        "CONTINUE_TO_NEXT_HOP",
        "NETWORK_DELIVERY",
        "NOT_DELIVERED",
        "UNKNOWN",
    ]
    plan_id: uuid.UUID
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    original_packet_state: PacketState
    branches: list[PacketProcessingExecutionBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketProcessingExecutionGap]
    warnings: list[dict[str, Any]]


class PacketFlowEvaluationQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    packet_state: PacketState
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None
    analysis_mode: Literal["EXACT"] = "EXACT"
    max_processing_points: int = Field(default=32, ge=1, le=256)


class PacketFlowContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_state: PacketState
    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None


class PacketFlowGap(BaseModel):
    code: Literal[
        "PLAN_SELECTION_UNRESOLVED",
        "NO_PROCESSING_PLAN_APPLICABLE",
        "PROCESSING_HANDOFF_UNKNOWN",
        "PROCESSING_HANDOFF_PACKET_UNKNOWN",
        "PACKET_FLOW_LOOP_DETECTED",
        "PACKET_FLOW_SEARCH_LIMIT",
    ]
    local_step_sequence: int | None = None
    evidence_refs: list[EvidenceRef]


class PacketFlowLocalStep(BaseModel):
    sequence: int
    context_before: PacketFlowContext
    plan_selection: PacketProcessingPlanSelectionArtifact
    selected_plan_id: uuid.UUID | None = None
    packet_processing_evaluation: PacketProcessingEvaluationArtifact | None = None
    selected_execution_branch_id: str | None = None
    context_after: PacketFlowContext | None = None
    handoff: PacketProcessingHandoff | None = None
    evidence_refs: list[EvidenceRef]


class PacketFlowExecutionBranch(BaseModel):
    branch_id: str
    local_steps: list[PacketFlowLocalStep]
    verdict: Literal["DELIVERED", "NOT_DELIVERED", "UNKNOWN"]
    termination_reason: Literal[
        "NETWORK_DELIVERY",
        "NOT_DELIVERED",
        "LOCAL_EXECUTION_UNKNOWN",
        "PLAN_SELECTION_UNKNOWN",
        "PLAN_SELECTION_CONFLICTING",
        "NO_PROCESSING_PLAN_APPLICABLE",
        "PROCESSING_HANDOFF_UNKNOWN",
        "PROCESSING_HANDOFF_PACKET_UNKNOWN",
        "PACKET_FLOW_LOOP_DETECTED",
        "PACKET_FLOW_SEARCH_LIMIT",
    ]
    final_context: PacketFlowContext | None = None
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketFlowGap]


class PacketFlowEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: PacketFlowEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["packet-flow-configured/1.0"] = (
        "packet-flow-configured/1.0"
    )
    result: Literal["DELIVERED", "NOT_DELIVERED", "UNKNOWN"]
    original_packet_state: PacketState
    branches: list[PacketFlowExecutionBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[PacketFlowGap]
    warnings: list[dict[str, Any]]


class ConnectionState(StrEnum):
    NEW = "NEW"
    ESTABLISHED = "ESTABLISHED"
    RELATED = "RELATED"
    INVALID = "INVALID"
    UNKNOWN = "UNKNOWN"


class SecurityPolicyEvaluationQuery(BaseModel):
    policy_id: uuid.UUID
    packet_state: PacketState


class SecurityRuleEvaluationStep(BaseModel):
    rule_id: uuid.UUID
    order_key: int
    predicate_result: Literal["TRUE", "FALSE", "UNKNOWN"]
    branch_assumption: Literal["MATCH", "NO_MATCH"]
    evidence_refs: list[EvidenceRef]


class SecurityEvaluationBranch(BaseModel):
    branch_id: str
    steps: list[SecurityRuleEvaluationStep]
    terminal_action: Literal["PERMIT", "DROP", "REJECT"]
    terminal_source: Literal["RULE", "DEFAULT"]
    terminal_rule_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class SecurityEvaluationGap(BaseModel):
    code: Literal["SECURITY_POLICY_INCOMPLETE"]
    evidence_refs: list[EvidenceRef]


class SecurityPolicyEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: SecurityPolicyEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["security-configured-policy/1.0"] = (
        "security-configured-policy/1.0"
    )
    result: Literal["PERMIT", "DROP", "REJECT", "UNKNOWN"]
    policy_id: uuid.UUID
    default_action: Literal["PERMIT", "DROP", "REJECT"]
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    branches: list[SecurityEvaluationBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[SecurityEvaluationGap]
    warnings: list[dict[str, Any]]


class SecurityAttachmentStageGap(BaseModel):
    code: Literal[
        "SECURITY_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "SECURITY_POLICY_EVALUATION_UNKNOWN",
    ]
    evidence_refs: list[EvidenceRef]


class SecurityAttachmentStageArtifact(BaseModel):
    schema_version: Literal[1] = 1
    evaluation_view: EvaluationView
    resolver_version: Literal["security-configured-attachment/1.0"] = (
        "security-configured-attachment/1.0"
    )
    context: SecurityEvaluationContext
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    stage_order: int
    scope: dict[str, list[str]]
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    result: Literal["PASS", "BLOCKED", "UNKNOWN"]
    reason: Literal[
        "ATTACHMENT_NOT_APPLICABLE",
        "POLICY_PERMIT",
        "POLICY_DROP",
        "POLICY_REJECT",
        "ATTACHMENT_APPLICABILITY_COLLAPSED_PERMIT",
        "SECURITY_UNCERTAINTY",
    ]
    policy_evaluation: SecurityPolicyEvaluationArtifact | None = None
    evidence_refs: list[EvidenceRef]
    gaps: list[SecurityAttachmentStageGap]
    warnings: list[dict[str, Any]]


class SecurityEvaluationContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_state: PacketState
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    routing_context_id: uuid.UUID | None = None
    ingress_network_interface_id: uuid.UUID | None = None
    egress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    egress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None


class SecurityEvaluationQuery(BaseModel):
    context: SecurityEvaluationContext
    configured_attachment_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ]


class SecurityAttachmentEvaluation(BaseModel):
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    stage_order: int
    scope: dict[str, list[str]]
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    policy_evaluation: SecurityPolicyEvaluationArtifact | None = None
    evidence_refs: list[EvidenceRef]


class SecurityStageEvaluationGap(BaseModel):
    code: Literal[
        "SECURITY_ATTACHMENT_COVERAGE_INCOMPLETE",
        "SECURITY_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "SECURITY_POLICY_EVALUATION_UNKNOWN",
    ]
    attachment_id: uuid.UUID | None = None
    evidence_refs: list[EvidenceRef]


class SecurityEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: SecurityEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["security-configured-stages/1.0"] = (
        "security-configured-stages/1.0"
    )
    context: SecurityEvaluationContext
    configured_attachment_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ]
    result: Literal["PASS", "BLOCKED", "UNKNOWN"]
    reason: Literal[
        "NO_POLICY_APPLICABLE",
        "ALL_APPLICABLE_POLICIES_PERMIT",
        "POLICY_DROP",
        "POLICY_REJECT",
        "SECURITY_UNCERTAINTY",
    ]
    attachment_evaluations: list[SecurityAttachmentEvaluation]
    evidence_refs: list[EvidenceRef]
    gaps: list[SecurityStageEvaluationGap]
    warnings: list[dict[str, Any]]


class NATPolicyEvaluationQuery(BaseModel):
    policy_id: uuid.UUID
    packet_state: PacketState


class NATIPAddressRange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    start: IPvAnyAddress
    end: IPvAnyAddress

    @model_validator(mode="after")
    def validate_range(self) -> "NATIPAddressRange":
        if self.start.version != self.end.version or int(self.start) > int(self.end):
            raise ValueError("NAT IP constraint range is invalid")
        return self


class NATPortRange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    start: int = Field(ge=0, le=65535, strict=True)
    end: int = Field(ge=0, le=65535, strict=True)

    @model_validator(mode="after")
    def validate_range(self) -> "NATPortRange":
        if self.start > self.end:
            raise ValueError("NAT port constraint range is invalid")
        return self


class NATPacketConstraint(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_base: PacketState
    source_ip_ranges: list[NATIPAddressRange] | None = None
    destination_ip_ranges: list[NATIPAddressRange] | None = None
    source_port_ranges: list[NATPortRange] | None = None
    destination_port_ranges: list[NATPortRange] | None = None

    @model_validator(mode="after")
    def validate_has_constraint(self) -> "NATPacketConstraint":
        if not any(
            (
                self.source_ip_ranges,
                self.destination_ip_ranges,
                self.source_port_ranges,
                self.destination_port_ranges,
            )
        ):
            raise ValueError("NATPacketConstraint requires a constrained field")
        return self


class NATTransformApplication(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    result: Literal["IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED"]
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    nat_pool_ids: list[uuid.UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_output_shape(self) -> "NATTransformApplication":
        if self.result == "TRANSFORMED_CONSTRAINED":
            if self.packet_after is not None or self.packet_after_constraint is None:
                raise ValueError("Constrained NAT application requires only a constraint")
        elif self.packet_after is None or self.packet_after_constraint is not None:
            raise ValueError("Exact NAT application requires only packet_after")
        return self


class NATRuleEvaluationStep(BaseModel):
    rule_id: uuid.UUID
    order_key: int
    predicate_result: Literal["TRUE", "FALSE", "UNKNOWN"]
    branch_assumption: Literal["MATCH", "NO_MATCH"]
    evidence_refs: list[EvidenceRef]


class NATPolicyEvaluationBranch(BaseModel):
    branch_id: str
    steps: list[NATRuleEvaluationStep]
    terminal_source: Literal["RULE", "DEFAULT"]
    terminal_rule_id: uuid.UUID | None = None
    selected_transform: dict[str, Any]
    transform_result: Literal[
        "IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED"
    ]
    packet_before: PacketState
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    evidence_refs: list[EvidenceRef]


class NATPolicyEvaluationGap(BaseModel):
    code: Literal["NAT_POLICY_INCOMPLETE", "NAT_TRANSLATION_UNKNOWN"]
    evidence_refs: list[EvidenceRef]


class NATPolicyEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: NATPolicyEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["nat-configured-policy/1.0"] = (
        "nat-configured-policy/1.0"
    )
    result: Literal[
        "IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED", "UNKNOWN"
    ]
    policy_id: uuid.UUID
    configured_completeness: Literal["COMPLETE", "PARTIAL", "UNKNOWN"]
    packet_before: PacketState
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    branches: list[NATPolicyEvaluationBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[NATPolicyEvaluationGap]
    warnings: list[dict[str, Any]]


class NATAttachmentStageGap(BaseModel):
    code: Literal[
        "NAT_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "NAT_POLICY_EVALUATION_UNKNOWN",
        "NAT_TRANSLATION_UNKNOWN",
    ]
    evidence_refs: list[EvidenceRef]


class NATAttachmentStageArtifact(BaseModel):
    schema_version: Literal[1] = 1
    evaluation_view: EvaluationView
    resolver_version: Literal["nat-configured-attachment/1.0"] = (
        "nat-configured-attachment/1.0"
    )
    context: NATEvaluationContext
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    local_stage_order: int
    scope: dict[str, list[str]]
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    result: Literal[
        "IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED", "UNKNOWN"
    ]
    reason: Literal[
        "ATTACHMENT_NOT_APPLICABLE",
        "POLICY_IDENTITY",
        "POLICY_TRANSFORMED_EXACT",
        "POLICY_TRANSFORMED_CONSTRAINED",
        "ATTACHMENT_APPLICABILITY_COLLAPSED_IDENTITY",
        "NAT_UNCERTAINTY",
    ]
    packet_before: PacketState
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    policy_evaluation: NATPolicyEvaluationArtifact | None = None
    evidence_refs: list[EvidenceRef]
    gaps: list[NATAttachmentStageGap]
    warnings: list[dict[str, Any]]

    @model_validator(mode="after")
    def validate_output(self) -> "NATAttachmentStageArtifact":
        if self.result in {"IDENTITY", "TRANSFORMED_EXACT"}:
            if self.packet_after is None or self.packet_after_constraint is not None:
                raise ValueError("Exact NAT stage result requires only packet_after")
        elif self.result == "TRANSFORMED_CONSTRAINED":
            if self.packet_after is not None or self.packet_after_constraint is None:
                raise ValueError("Constrained NAT stage requires only constraint output")
        elif self.packet_after is not None or self.packet_after_constraint is not None:
            raise ValueError("Unknown NAT stage must not expose an output representative")
        if self.result == "IDENTITY" and self.packet_after != self.packet_before:
            raise ValueError("Identity NAT stage must preserve packet")
        return self


class NATEvaluationContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_state: PacketState
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"]
    routing_context_id: uuid.UUID | None = None
    ingress_network_interface_id: uuid.UUID | None = None
    egress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    egress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None


class NATEvaluationQuery(BaseModel):
    context: NATEvaluationContext
    configured_attachment_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ]


class NATStageExecution(BaseModel):
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    local_stage_order: int
    applicability: Literal["TRUE", "FALSE", "UNKNOWN"]
    branch_assumption: Literal["APPLY", "SKIP"]
    executed: bool
    policy_evaluation: NATPolicyEvaluationArtifact | None = None
    packet_before: PacketState
    packet_after: PacketState | None = None
    packet_after_constraint: NATPacketConstraint | None = None
    evidence_refs: list[EvidenceRef]


class NATExecutionBranch(BaseModel):
    branch_id: str
    initial_packet: PacketState
    stage_executions: list[NATStageExecution]
    final_packet: PacketState | None = None
    termination: Literal[
        "COMPLETED",
        "NAT_POLICY_EVALUATION_UNKNOWN",
        "NAT_STAGE_ORDER_AMBIGUOUS",
        "NAT_CONSTRAINED_OUTPUT",
    ]
    evidence_refs: list[EvidenceRef]


class NATEvaluationGap(BaseModel):
    code: Literal[
        "NAT_ATTACHMENT_COVERAGE_INCOMPLETE",
        "NAT_ATTACHMENT_APPLICABILITY_UNKNOWN",
        "NAT_POLICY_EVALUATION_UNKNOWN",
        "NAT_STAGE_ORDER_AMBIGUOUS",
        "NAT_TRANSLATION_UNKNOWN",
        "NAT_CONSTRAINED_OUTPUT",
    ]
    attachment_id: uuid.UUID | None = None
    competing_attachment_ids: list[uuid.UUID] = Field(default_factory=list)
    evidence_refs: list[EvidenceRef]


class NATEvaluationArtifact(BaseModel):
    schema_version: Literal[1] = 1
    query: NATEvaluationQuery
    evaluation_view: EvaluationView
    resolver_version: Literal["nat-configured-stages/1.0"] = (
        "nat-configured-stages/1.0"
    )
    context: NATEvaluationContext
    configured_attachment_completeness: Literal[
        "COMPLETE", "PARTIAL", "UNKNOWN"
    ]
    result: Literal["IDENTITY", "TRANSFORMED_EXACT", "UNKNOWN"]
    reason: Literal[
        "NO_NAT_POLICY_APPLICABLE",
        "NAT_STAGES_IDENTITY",
        "NAT_STAGES_TRANSFORMED",
        "NAT_UNCERTAINTY",
    ]
    packet_before: PacketState
    packet_after: PacketState | None = None
    branches: list[NATExecutionBranch]
    evidence_refs: list[EvidenceRef]
    gaps: list[NATEvaluationGap]
    warnings: list[dict[str, Any]]


class ErrorBody(BaseModel):
    code: Literal["VALIDATION_ERROR", "MODEL_ERROR"]
    message: str
    details: dict[str, Any]


class ErrorResponse(BaseModel):
    error: ErrorBody
