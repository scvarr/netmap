import logging
import uuid
from typing import Literal

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.adjacency_resolver import StructuralAdjacencyResolver
from app.blueprint_catalog import ObjectBlueprintCatalog
from app.blueprint_upgrade_analysis import BlueprintUpgradeAnalyzer
from app.catalog_inventory_resolver import CatalogInventoryResolver
from app.database import engine, get_session
from app.perf_instrumentation import instrument_request, install_listener
from app.device_catalog import DeviceCatalog
from app.device_details_resolver import ConfiguredDeviceDetailsResolver
from app.errors import NetMapError, ValidationError
from app.interface_resolver import InterfacePhysicalResolver
from app.l2_resolver import L2ReachabilityResolver
from app.l2_catalog import L2Catalog, L2ForwardingContextBindingInput
from app.l3_resolver import SelectedTableRouteDecisionResolver
from app.models import MapViewKey, PortBlockVersion
from app.l3_reachability_resolver import ConfiguredL3ReachabilityResolver
from app.next_hop_resolver import SelectedTableNextHopResolver
from app.nat_resolver import ConfiguredNATPolicyResolver
from app.nat_evaluation_resolver import ConfiguredNATEvaluationResolver
from app.packet_processing_plan_resolver import PacketProcessingPlanValidationResolver
from app.packet_processing_plan_selection_resolver import PacketProcessingPlanSelectionResolver
from app.packet_processing_executor import PacketProcessingPlanExecutor
from app.packet_flow_resolver import ConfiguredPacketFlowResolver
from app.physical_connections import (
    ConnectionPointEndpoint,
    NetworkInterfaceEndpoint,
    PhysicalConnectionCatalog,
)
from app.physical_object_details_resolver import ConfiguredPhysicalObjectDetailsResolver
from app.physical_object_l1_resolver import PhysicalObjectL1Resolver
from app.physical_object_deletion import PhysicalObjectDeletionCatalog
from app.port_block_catalog import PortBlockCatalog
from app.repository import CanonicalRepository
from app.resolver import L1Resolver
from app.saved_map_catalog import SavedMapCatalog
from app.routing_policy_resolver import ConfiguredRoutingPolicyResolver
from app.security_resolver import ConfiguredSecurityPolicyResolver
from app.security_evaluation_resolver import ConfiguredSecurityEvaluationResolver
from app.schemas import (
    AdjacencyCandidatesArtifact,
    AdjacencyCandidatesQuery,
    CreateConnectionPointRequest,
    CreateMapPlacementRequest,
    CreateObjectBlueprintRequest,
    CreateObjectBlueprintVersionRequest,
    CreateDeviceInterfaceRequest,
    CreateNetworkDeviceRequest,
    CreatePhysicalEndpointConnectionRequest,
    CreatePhysicalLinkRequest,
    CreatePhysicalObjectRequest,
    CreatePortBlockRequest,
    CreatePortBlockVersionRequest,
    CreateSavedMapRequest,
    CreateL2ForwardingContextRequest,
    CatalogInventoryDocument,
    DeviceDetailsDocument,
    ErrorResponse,
    EvaluationView,
    InterfacePhysicalTraceArtifact,
    InterfacePhysicalTraceQuery,
    InstantiateObjectBlueprintRequest,
    L1TraceQuery,
    PhysicalObjectL1TraceArtifact,
    PhysicalObjectL1TraceQuery,
    L2ReachabilityQuery,
    L2ReachabilityTraceArtifact,
    L2ForwardingContextCreationDocument,
    MapPlacementsDocument,
    L3ReachabilityArtifact,
    L3ReachabilityQuery,
    NextHopResolutionArtifact,
    NextHopResolutionQuery,
    NATPolicyEvaluationArtifact,
    NATPolicyEvaluationQuery,
    PacketProcessingPlanValidationArtifact,
    PacketProcessingPlanValidationQuery,
    PacketProcessingPlanSelectionArtifact,
    PacketProcessingPlanSelectionQuery,
    PacketProcessingEvaluationArtifact,
    PacketProcessingEvaluationQuery,
    PacketFlowEvaluationArtifact,
    PacketFlowEvaluationQuery,
    ObjectBlueprintCreationDocument,
    ObjectBlueprintInstantiationDocument,
    ObjectBlueprintListDocument,
    ObjectBlueprintVersionDocument,
    PortBlockCreationDocument,
    PortBlockListDocument,
    PortBlockVersionDocument,
    PortBlockVersionListDocument,
    BlueprintUpgradeAnalysisDocument,
    ApplyBlueprintUpgradeRequest,
    PhysicalConnectionCreationDocument,
    PhysicalEndpointConnectionCreationDocument,
    PhysicalEndpointMaterialization,
    PhysicalObjectDetailsDocument,
    NATEvaluationArtifact,
    NATEvaluationQuery,
    MoveMapPlacementRequest,
    SetMapCableRouteRequest,
    SetMapViewLockRequest,
    RouteDecisionArtifact,
    RouteDecisionQuery,
    RoutingPolicyEvaluationArtifact,
    RoutingPolicyEvaluationQuery,
    SecurityPolicyEvaluationArtifact,
    SecurityPolicyEvaluationQuery,
    SecurityEvaluationArtifact,
    SecurityEvaluationQuery,
    SetPhysicalObjectClassRequest,
    SetPhysicalObjectDisplayNameRequest,
    SavedMapDocument,
    SavedMapListDocument,
    StructuralAdjacencyArtifact,
    StructuralAdjacencyQuery,
    TopologyProjectionDocument,
    TopologyProjectionRequest,
    TraceArtifact,
)
from app.structural_adjacency_resolver import StructuralAdjacencyProofResolver
from app.topology_projection_resolver import ConfiguredTopologyProjectionResolver

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("netmap")

app = FastAPI(title="NetMap", version="0.1.0")
install_listener(engine)
app.middleware("http")(instrument_request)


@app.get(
    "/v1/catalog/inventory",
    response_model=CatalogInventoryDocument,
    response_model_exclude_none=True,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def get_catalog_inventory(session: Session = Depends(get_session)) -> CatalogInventoryDocument:
    return CatalogInventoryResolver(CanonicalRepository(session)).resolve()


def _saved_map_document(detail) -> dict[str, object]:
    saved_map = detail.saved_map
    return {
        "map_ref": {"entity_type": "SavedMap", "entity_id": saved_map.id},
        "name": saved_map.name,
        "created_at": saved_map.created_at,
        "updated_at": saved_map.updated_at,
        "placements": [
            {
                "physical_object_ref": {
                    "ref_type": "CANONICAL_FACT",
                    "entity_type": "PhysicalObject",
                    "entity_id": placement.physical_object_id,
                },
                "positions": {
                    str(position.view_key): {
                        "x": position.x,
                        "y": position.y,
                        "locked": position.locked,
                        **({"display_width": position.display_width} if position.display_width is not None else {}),
                    }
                    for position in placement.view_positions
                },
            }
            for placement in detail.placements
        ],
        "cable_routes": [
            {
                "cable_ref": {
                    "ref_type": "CANONICAL_FACT",
                    "entity_type": "PhysicalObject",
                    "entity_id": route.cable_physical_object_id,
                },
                "view": str(route.view_key),
                "waypoints": route.waypoints,
            }
            for route in detail.cable_routes
        ],
    }


@app.exception_handler(NetMapError)
async def netmap_error_handler(_request: Request, exc: NetMapError) -> JSONResponse:
    logger.warning("netmap_error code=%s details=%s", exc.code, exc.details)
    status_code = 422 if exc.code == "VALIDATION_ERROR" else 409
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
    )


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    error = ValidationError("Request validation failed", {"errors": exc.errors()})
    return JSONResponse(
        status_code=422,
        content={"error": {"code": error.code, "message": error.message, "details": error.details}},
    )


@app.get("/health")
def health(session: Session = Depends(get_session)) -> dict[str, str]:
    session.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/v1/maps", response_model=SavedMapListDocument)
def list_saved_maps(session: Session = Depends(get_session)) -> SavedMapListDocument:
    maps = SavedMapCatalog(session).list()
    return {"maps": [
        {"map_ref": {"entity_type": "SavedMap", "entity_id": saved_map.id}, "name": saved_map.name,
         "created_at": saved_map.created_at, "updated_at": saved_map.updated_at}
        for saved_map in maps
    ]}


@app.post("/v1/maps", response_model=SavedMapDocument, response_model_exclude_none=True, status_code=201, responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}})
def create_saved_map(query: CreateSavedMapRequest, session: Session = Depends(get_session)) -> SavedMapDocument:
    with session.begin():
        catalog = SavedMapCatalog(session)
        saved_map = catalog.create(query.name)
        return _saved_map_document(catalog.detail(saved_map.id))


@app.get("/v1/maps/{map_id}", response_model=SavedMapDocument, response_model_exclude_none=True, responses={422: {"model": ErrorResponse}})
def get_saved_map(map_id: uuid.UUID, session: Session = Depends(get_session)) -> SavedMapDocument:
    return _saved_map_document(SavedMapCatalog(session).detail(map_id))


@app.delete("/v1/maps/{map_id}", status_code=204, responses={422: {"model": ErrorResponse}})
def delete_saved_map(map_id: uuid.UUID, session: Session = Depends(get_session)) -> None:
    with session.begin():
        SavedMapCatalog(session).delete(map_id)


def _map_placements_document(detail) -> dict[str, object]:
    document = _saved_map_document(detail)
    return {"map_ref": document["map_ref"], "placements": document["placements"]}


@app.get("/v1/maps/{map_id}/placements", response_model=MapPlacementsDocument, response_model_exclude_none=True, responses={422: {"model": ErrorResponse}})
def list_map_placements(map_id: uuid.UUID, session: Session = Depends(get_session)) -> MapPlacementsDocument:
    return _map_placements_document(SavedMapCatalog(session).placements(map_id))


@app.post("/v1/maps/{map_id}/placements", response_model=MapPlacementsDocument, response_model_exclude_none=True, status_code=201, responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}})
def add_map_placement(map_id: uuid.UUID, query: CreateMapPlacementRequest, session: Session = Depends(get_session)) -> MapPlacementsDocument:
    with session.begin():
        catalog = SavedMapCatalog(session)
        catalog.add_placement(map_id, query.physical_object_id, query.x, query.y)
        return _map_placements_document(catalog.placements(map_id))


@app.put("/v1/maps/{map_id}/placements/{physical_object_id}", response_model=MapPlacementsDocument, response_model_exclude_none=True, responses={422: {"model": ErrorResponse}})
def move_map_placement(map_id: uuid.UUID, physical_object_id: uuid.UUID, query: MoveMapPlacementRequest, session: Session = Depends(get_session)) -> MapPlacementsDocument:
    """Compatibility alias for the physical (`L1/PHYSICAL_OBJECT`) position."""
    with session.begin():
        catalog = SavedMapCatalog(session)
        catalog.move_placement(map_id, physical_object_id, query.x, query.y, query.display_width)
        return _map_placements_document(catalog.placements(map_id))


@app.put("/v1/maps/{map_id}/placements/{physical_object_id}/positions/{view_key}", response_model=MapPlacementsDocument, response_model_exclude_none=True, responses={422: {"model": ErrorResponse}})
def set_map_view_position(map_id: uuid.UUID, physical_object_id: uuid.UUID, view_key: Literal["physical", "logical"], query: MoveMapPlacementRequest, session: Session = Depends(get_session)) -> MapPlacementsDocument:
    with session.begin():
        catalog = SavedMapCatalog(session)
        catalog.set_view_position(
            map_id,
            physical_object_id,
            MapViewKey.PHYSICAL if view_key == "physical" else MapViewKey.LOGICAL,
            query.x, query.y, query.display_width,
        )
        return _map_placements_document(catalog.placements(map_id))


@app.put("/v1/maps/{map_id}/placements/{physical_object_id}/locks/{view_key}", response_model=MapPlacementsDocument, response_model_exclude_none=True, responses={422: {"model": ErrorResponse}})
def set_map_view_lock(map_id: uuid.UUID, physical_object_id: uuid.UUID, view_key: Literal["physical", "logical"], query: SetMapViewLockRequest, session: Session = Depends(get_session)) -> MapPlacementsDocument:
    with session.begin():
        catalog = SavedMapCatalog(session)
        catalog.set_view_lock(
            map_id,
            physical_object_id,
            MapViewKey.PHYSICAL if view_key == "physical" else MapViewKey.LOGICAL,
            query.locked,
        )
        return _map_placements_document(catalog.placements(map_id))


@app.delete("/v1/maps/{map_id}/placements/{physical_object_id}", status_code=204, responses={422: {"model": ErrorResponse}})
def delete_map_placement(map_id: uuid.UUID, physical_object_id: uuid.UUID, session: Session = Depends(get_session)) -> None:
    with session.begin():
        SavedMapCatalog(session).remove_placement(map_id, physical_object_id)


@app.put("/v1/maps/{map_id}/cable-routes/{cable_physical_object_id}", response_model=SavedMapDocument, responses={422: {"model": ErrorResponse}})
def set_map_cable_route(
    map_id: uuid.UUID,
    cable_physical_object_id: uuid.UUID,
    query: SetMapCableRouteRequest,
    session: Session = Depends(get_session),
) -> SavedMapDocument:
    with session.begin():
        catalog = SavedMapCatalog(session)
        catalog.set_cable_route(
            map_id,
            cable_physical_object_id,
            [waypoint.model_dump() for waypoint in query.waypoints],
        )
        return _saved_map_document(catalog.detail(map_id))


@app.delete("/v1/maps/{map_id}/cable-routes/{cable_physical_object_id}", status_code=204, responses={422: {"model": ErrorResponse}})
def delete_map_cable_route(
    map_id: uuid.UUID,
    cable_physical_object_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> None:
    with session.begin():
        SavedMapCatalog(session).delete_cable_route(map_id, cable_physical_object_id)


@app.post(
    "/v1/topology/projection",
    response_model=TopologyProjectionDocument,
    response_model_exclude_none=True,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def project_topology(
    query: TopologyProjectionRequest,
    session: Session = Depends(get_session),
) -> TopologyProjectionDocument:
    repository = CanonicalRepository(session)
    return ConfiguredTopologyProjectionResolver(repository).resolve(
        query, EvaluationView()
    )


@app.get(
    "/v1/topology/devices/{physical_object_id}",
    response_model=DeviceDetailsDocument,
    response_model_exclude_none=True,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def get_device_details(
    physical_object_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> DeviceDetailsDocument:
    return ConfiguredDeviceDetailsResolver(CanonicalRepository(session)).resolve(
        physical_object_id
    )


@app.get(
    "/v1/topology/physical-objects/{physical_object_id}",
    response_model=PhysicalObjectDetailsDocument,
    response_model_exclude_none=True,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def get_physical_object_details(
    physical_object_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> PhysicalObjectDetailsDocument:
    return ConfiguredPhysicalObjectDetailsResolver(CanonicalRepository(session)).resolve(
        physical_object_id
    )


@app.get(
    "/v1/topology/physical-objects/{physical_object_id}/blueprint-upgrade-analysis",
    response_model=BlueprintUpgradeAnalysisDocument,
    response_model_exclude_none=True,
    responses={422: {"model": ErrorResponse}},
)
def analyze_physical_object_blueprint_upgrade(
    physical_object_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> BlueprintUpgradeAnalysisDocument:
    CanonicalRepository(session).require_physical_objects([physical_object_id])
    analysis = BlueprintUpgradeAnalyzer(session).analyze(physical_object_id)
    return {
        "status": analysis.status,
        **({"blueprint_ref": {"entity_type": "ObjectBlueprint", "entity_id": analysis.blueprint_id}} if analysis.blueprint_id else {}),
        **({"current_version_ref": {"entity_type": "ObjectBlueprintVersion", "entity_id": analysis.current_version_id}, "current_version_number": analysis.current_version_number} if analysis.current_version_id else {}),
        **({"target_version_ref": {"entity_type": "ObjectBlueprintVersion", "entity_id": analysis.target_version_id}, "target_version_number": analysis.target_version_number} if analysis.target_version_id else {}),
        "compatible_changes": list(analysis.compatible_changes),
        "blockers": list(analysis.blockers),
    }


@app.post(
    "/v1/topology/physical-objects/{physical_object_id}/blueprint-upgrade",
    response_model=ObjectBlueprintInstantiationDocument,
    response_model_exclude_none=True,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def apply_physical_object_blueprint_upgrade(
    physical_object_id: uuid.UUID,
    query: ApplyBlueprintUpgradeRequest,
    session: Session = Depends(get_session),
) -> ObjectBlueprintInstantiationDocument:
    with session.begin():
        created = ObjectBlueprintCatalog(session).apply_upgrade(physical_object_id, query.target_version_id)
        return {
            "blueprint_ref": {"entity_type": "ObjectBlueprint", "entity_id": created.blueprint_id},
            "version_ref": {"entity_type": "ObjectBlueprintVersion", "entity_id": created.version_id},
            "physical_object_ref": {"ref_type": "CANONICAL_FACT", "entity_type": "PhysicalObject", "entity_id": created.physical_object_id},
            "slots": [{
                "slot_key": slot.slot_key,
                "connection_point_ref": {"ref_type": "CANONICAL_FACT", "entity_type": "ConnectionPoint", "entity_id": slot.connection_point_id},
                **({"network_interface_ref": {"ref_type": "CANONICAL_FACT", "entity_type": "NetworkInterface", "entity_id": slot.network_interface_id}} if slot.network_interface_id else {}),
            } for slot in created.slots],
        }


@app.delete(
    "/v1/topology/physical-objects/{physical_object_id}",
    status_code=204,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def delete_physical_object(
    physical_object_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> None:
    with session.begin():
        PhysicalObjectDeletionCatalog(session).delete(physical_object_id)


@app.put(
    "/v1/topology/physical-objects/{physical_object_id}/display-name",
    response_model=PhysicalObjectDetailsDocument,
    response_model_exclude_none=True,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def set_physical_object_display_name(
    physical_object_id: uuid.UUID,
    query: SetPhysicalObjectDisplayNameRequest,
    session: Session = Depends(get_session),
) -> PhysicalObjectDetailsDocument:
    with session.begin():
        DeviceCatalog(session).set_physical_object_display_alias(
            physical_object_id, query.display_name
        )
        return ConfiguredPhysicalObjectDetailsResolver(
            CanonicalRepository(session)
        ).resolve(physical_object_id)


@app.put(
    "/v1/topology/physical-objects/{physical_object_id}/class",
    response_model=PhysicalObjectDetailsDocument,
    response_model_exclude_none=True,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def set_physical_object_class(
    physical_object_id: uuid.UUID,
    query: SetPhysicalObjectClassRequest,
    session: Session = Depends(get_session),
) -> PhysicalObjectDetailsDocument:
    with session.begin():
        DeviceCatalog(session).set_physical_object_class(
            physical_object_id, query.value
        )
        return ConfiguredPhysicalObjectDetailsResolver(
            CanonicalRepository(session)
        ).resolve(physical_object_id)


@app.post(
    "/v1/topology/physical-objects",
    response_model=PhysicalObjectDetailsDocument,
    response_model_exclude_none=True,
    status_code=201,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def create_physical_object(
    query: CreatePhysicalObjectRequest,
    session: Session = Depends(get_session),
) -> PhysicalObjectDetailsDocument:
    with session.begin():
        created = DeviceCatalog(session).create_physical_object(
            query.display_name,
            query.initial_connection_point.display_name,
            query.class_,
        )
        return ConfiguredPhysicalObjectDetailsResolver(
            CanonicalRepository(session)
        ).resolve(created.physical_object_id)


@app.post(
    "/v1/library/port-blocks",
    response_model=PortBlockCreationDocument,
    status_code=201,
    responses={422: {"model": ErrorResponse}},
)
def create_port_block(
    query: CreatePortBlockRequest,
    session: Session = Depends(get_session),
) -> PortBlockCreationDocument:
    with session.begin():
        created = PortBlockCatalog(session).create_initial_version(query)
        return {
            "port_block_ref": {"entity_type": "PortBlock", "entity_id": created.port_block_id},
            "version_ref": {"entity_type": "PortBlockVersion", "entity_id": created.version_id},
        }


@app.get(
    "/v1/library/port-blocks",
    response_model=PortBlockListDocument,
)
def list_port_blocks(session: Session = Depends(get_session)) -> PortBlockListDocument:
    port_blocks = PortBlockCatalog(session).list_port_blocks()
    return {
        "port_blocks": [
            {
                "port_block_ref": {"entity_type": "PortBlock", "entity_id": item.port_block_id},
                "name": item.name,
                "version_ref": {"entity_type": "PortBlockVersion", "entity_id": item.version_id},
                "version_number": item.version_number,
                "port_count": item.port_count,
                "version_count": item.version_count,
            }
            for item in port_blocks
        ]
    }

@app.get("/v1/library/port-blocks/{port_block_id}/versions", response_model=PortBlockVersionListDocument)
def list_port_block_versions(port_block_id: uuid.UUID, session: Session = Depends(get_session)) -> PortBlockVersionListDocument:
    return {"versions": [{"port_block_ref": {"entity_type": "PortBlock", "entity_id": item.port_block_id}, "version_ref": {"entity_type": "PortBlockVersion", "entity_id": item.version_id}, "version_number": item.version_number, "port_count": item.port_count} for item in PortBlockCatalog(session).list_versions(port_block_id)]}


@app.post(
    "/v1/library/port-blocks/{port_block_id}/versions",
    response_model=PortBlockCreationDocument,
    status_code=201,
    responses={422: {"model": ErrorResponse}},
)
def create_port_block_version(
    port_block_id: uuid.UUID,
    query: CreatePortBlockVersionRequest,
    session: Session = Depends(get_session),
) -> PortBlockCreationDocument:
    with session.begin():
        created = PortBlockCatalog(session).create_next_version(port_block_id, query)
        return {
            "port_block_ref": {"entity_type": "PortBlock", "entity_id": created.port_block_id},
            "version_ref": {"entity_type": "PortBlockVersion", "entity_id": created.version_id},
        }


@app.get(
    "/v1/library/port-blocks/{port_block_id}/versions/{version_id}",
    response_model=PortBlockVersionDocument,
    responses={422: {"model": ErrorResponse}},
)
def get_port_block_version(
    port_block_id: uuid.UUID,
    version_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> PortBlockVersionDocument:
    version = PortBlockCatalog(session).get_version_detail(port_block_id, version_id)
    return {
        "port_block_ref": {"entity_type": "PortBlock", "entity_id": version.port_block_id},
        "name": version.name,
        "version_ref": {"entity_type": "PortBlockVersion", "entity_id": version.version_id},
        "version_number": version.version_number,
        "ports": [
            {
                "local_id": port.local_id,
                "display_label": port.display_label,
                "kind": port.kind,
                "row": port.row,
                "column": port.layout_column,
                "layout_order": port.layout_order,
            }
            for port in version.ports
        ],
    }


@app.post(
    "/v1/library/object-blueprints",
    response_model=ObjectBlueprintCreationDocument,
    status_code=201,
    responses={422: {"model": ErrorResponse}},
)
def create_object_blueprint(
    query: CreateObjectBlueprintRequest,
    session: Session = Depends(get_session),
) -> ObjectBlueprintCreationDocument:
    with session.begin():
        created = ObjectBlueprintCatalog(session).create_initial_version(query)
        return {
            "blueprint_ref": {"entity_type": "ObjectBlueprint", "entity_id": created.blueprint_id},
            "version_ref": {"entity_type": "ObjectBlueprintVersion", "entity_id": created.version_id},
        }


@app.get(
    "/v1/library/object-blueprints",
    response_model=ObjectBlueprintListDocument,
)
def list_object_blueprints(
    session: Session = Depends(get_session),
) -> ObjectBlueprintListDocument:
    blueprints = ObjectBlueprintCatalog(session).list_blueprints()
    return {
        "blueprints": [
            {
                "blueprint_ref": {"entity_type": "ObjectBlueprint", "entity_id": item.blueprint_id},
                "name": item.name,
                "version_ref": {"entity_type": "ObjectBlueprintVersion", "entity_id": item.version_id},
                "version_number": item.version_number,
                "default_physical_object_class": item.default_physical_object_class,
                "body": {
                    "kind": item.body_kind, "width": item.width,
                    "height": item.height, "fill_color": item.fill_color,
                },
                "slot_count": item.slot_count,
                "internal_link_count": item.internal_link_count,
                "version_count": item.version_count,
            }
            for item in blueprints
        ],
    }


@app.post(
    "/v1/library/object-blueprints/{blueprint_id}/versions",
    response_model=ObjectBlueprintCreationDocument,
    status_code=201,
    responses={422: {"model": ErrorResponse}},
)
def create_object_blueprint_version(
    blueprint_id: uuid.UUID,
    query: CreateObjectBlueprintVersionRequest,
    session: Session = Depends(get_session),
) -> ObjectBlueprintCreationDocument:
    with session.begin():
        created = ObjectBlueprintCatalog(session).create_next_version(blueprint_id, query)
        return {
            "blueprint_ref": {"entity_type": "ObjectBlueprint", "entity_id": created.blueprint_id},
            "version_ref": {"entity_type": "ObjectBlueprintVersion", "entity_id": created.version_id},
        }


@app.get(
    "/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}",
    response_model=ObjectBlueprintVersionDocument,
    responses={422: {"model": ErrorResponse}},
)
def get_object_blueprint_version(
    blueprint_id: uuid.UUID,
    version_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> ObjectBlueprintVersionDocument:
    version = ObjectBlueprintCatalog(session).get_version_detail(blueprint_id, version_id)
    faces_by_instance = {item.id: item.face or "FRONT" for item in (version.composition or ())}
    return {
        "blueprint_ref": {"entity_type": "ObjectBlueprint", "entity_id": version.blueprint_id},
        "name": version.name,
        "version_ref": {"entity_type": "ObjectBlueprintVersion", "entity_id": version.version_id},
        "version_number": version.version_number,
        "default_physical_object_class": version.default_physical_object_class,
        "body": {
            "kind": version.body_kind, "width": version.width,
            "height": version.height, "fill_color": version.fill_color,
        },
        "slots": [
            {
                "key": slot.slot_key, "display_name": slot.display_name, "kind": slot.kind,
                "anchor": {"side": slot.anchor_side, "offset": slot.anchor_offset},
                "face": faces_by_instance.get(slot.port_block_instance_id, "FRONT"),
            }
            for slot in version.slots
        ],
        "internal_links": [
            {"from_slot_key": left, "to_slot_key": right}
            for left, right in version.internal_links
        ],
        "composition": None if version.composition is None else {"instances": [
            {"instance_key": item.instance_key,
             "port_block_ref": {"entity_type": "PortBlock", "entity_id": session.get(PortBlockVersion, item.port_block_version_id).port_block_id},
             "port_block_version_ref": {"entity_type": "PortBlockVersion", "entity_id": item.port_block_version_id},
             "face": item.face or "FRONT",
             "placement": (
                 {"x": item.placement_x, "y": item.placement_y, "width": item.placement_width, "height": item.placement_height}
                 if None not in (item.placement_x, item.placement_y, item.placement_width, item.placement_height) else None
             )}
            for item in version.composition
        ]},
    }


@app.delete(
    "/v1/library/object-blueprints/{blueprint_id}",
    status_code=204,
    responses={409: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def delete_object_blueprint(
    blueprint_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> None:
    with session.begin():
        ObjectBlueprintCatalog(session).delete_blueprint(blueprint_id)


@app.post(
    "/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}/instantiate",
    response_model=ObjectBlueprintInstantiationDocument,
    response_model_exclude_none=True,
    status_code=201,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def instantiate_object_blueprint(
    blueprint_id: uuid.UUID,
    version_id: uuid.UUID,
    query: InstantiateObjectBlueprintRequest,
    session: Session = Depends(get_session),
) -> ObjectBlueprintInstantiationDocument:
    with session.begin():
        created = ObjectBlueprintCatalog(session).instantiate(blueprint_id, version_id, query.display_name)
        return {
            "blueprint_ref": {"entity_type": "ObjectBlueprint", "entity_id": created.blueprint_id},
            "version_ref": {"entity_type": "ObjectBlueprintVersion", "entity_id": created.version_id},
            "physical_object_ref": {
                "ref_type": "CANONICAL_FACT", "entity_type": "PhysicalObject", "entity_id": created.physical_object_id,
            },
            "slots": [
                {
                    "slot_key": slot.slot_key,
                    "connection_point_ref": {
                        "ref_type": "CANONICAL_FACT", "entity_type": "ConnectionPoint", "entity_id": slot.connection_point_id,
                    },
                    **({"network_interface_ref": {
                        "ref_type": "CANONICAL_FACT", "entity_type": "NetworkInterface", "entity_id": slot.network_interface_id,
                    }} if slot.network_interface_id is not None else {}),
                }
                for slot in created.slots
            ],
        }


@app.post(
    "/v1/topology/physical-objects/{physical_object_id}/connection-points",
    response_model=PhysicalObjectDetailsDocument,
    response_model_exclude_none=True,
    status_code=201,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def create_connection_point(
    physical_object_id: uuid.UUID,
    query: CreateConnectionPointRequest,
    session: Session = Depends(get_session),
) -> PhysicalObjectDetailsDocument:
    with session.begin():
        DeviceCatalog(session).create_connection_point(
            physical_object_id,
            query.display_name,
        )
        return ConfiguredPhysicalObjectDetailsResolver(
            CanonicalRepository(session)
        ).resolve(physical_object_id)


@app.post(
    "/v1/topology/devices",
    response_model=DeviceDetailsDocument,
    response_model_exclude_none=True,
    status_code=201,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def create_network_device(
    query: CreateNetworkDeviceRequest,
    session: Session = Depends(get_session),
) -> DeviceDetailsDocument:
    with session.begin():
        created = DeviceCatalog(session).create_network_device(
            query.display_name,
            query.initial_interface.display_name,
        )
        return ConfiguredDeviceDetailsResolver(CanonicalRepository(session)).resolve(
            created.physical_object_id
        )


@app.post(
    "/v1/topology/devices/{physical_object_id}/interfaces",
    response_model=DeviceDetailsDocument,
    response_model_exclude_none=True,
    status_code=201,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def create_device_interface(
    physical_object_id: uuid.UUID,
    query: CreateDeviceInterfaceRequest,
    session: Session = Depends(get_session),
) -> DeviceDetailsDocument:
    with session.begin():
        DeviceCatalog(session).create_device_interface(
            physical_object_id,
            query.display_name,
        )
        return ConfiguredDeviceDetailsResolver(CanonicalRepository(session)).resolve(
            physical_object_id
        )


@app.post(
    "/v1/l2/forwarding-contexts",
    response_model=L2ForwardingContextCreationDocument,
    response_model_exclude_none=True,
    status_code=201,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def create_l2_forwarding_context(
    query: CreateL2ForwardingContextRequest,
    session: Session = Depends(get_session),
) -> L2ForwardingContextCreationDocument:
    def ref(entity_type: str, entity_id: uuid.UUID) -> dict[str, object]:
        return {"ref_type": "CANONICAL_FACT", "entity_type": entity_type, "entity_id": entity_id}

    try:
        with session.begin():
            created = L2Catalog(session).create_forwarding_context([
                L2ForwardingContextBindingInput(
                    interface_id=binding.interface_id,
                    ingress_exact_stacks=[
                        [label.model_dump() for label in stack]
                        for stack in binding.ingress_exact_stacks
                    ],
                    egress_emit_stack=(
                        [label.model_dump() for label in binding.egress_emit_stack]
                        if binding.egress_emit_stack is not None
                        else None
                    ),
                )
                for binding in query.bindings
            ])
            return L2ForwardingContextCreationDocument(
                forwarding_context_ref=ref("L2ForwardingContext", created.forwarding_context_id),
                bindings=[
                    {
                        "interface_ref": ref("NetworkInterface", binding.interface_id),
                        "binding_ref": ref("L2Binding", binding.binding_id),
                        "ingress_rule_refs": [ref("L2IngressRule", rule_id) for rule_id in binding.ingress_rule_ids],
                        "egress_rule_ref": (
                            ref("L2EgressRule", binding.egress_rule_id)
                            if binding.egress_rule_id is not None
                            else None
                        ),
                    }
                    for binding in created.bindings
                ],
            )
    except IntegrityError as exc:
        raise ValidationError(
            "L2 forwarding context violates canonical uniqueness constraints"
        ) from exc


@app.post(
    "/v1/topology/physical-links",
    response_model=PhysicalConnectionCreationDocument,
    status_code=201,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def create_physical_link(
    query: CreatePhysicalLinkRequest,
    session: Session = Depends(get_session),
) -> PhysicalConnectionCreationDocument:
    with session.begin():
        created = PhysicalConnectionCatalog(session).create_atomic_link(
            query.source_interface_id,
            query.target_interface_id,
            query.cable_display_name,
        )

        def ref(entity_type: str, entity_id: uuid.UUID) -> dict[str, object]:
            return {
                "ref_type": "CANONICAL_FACT",
                "entity_type": entity_type,
                "entity_id": entity_id,
            }

        return PhysicalConnectionCreationDocument(
            source_interface_ref=ref("NetworkInterface", created.source_interface_id),
            target_interface_ref=ref("NetworkInterface", created.target_interface_id),
            cable_ref=ref("PhysicalObject", created.cable_id),
            source_binding_ref=ref(
                "InterfacePhysicalBinding", created.source_binding_id
            ),
            target_binding_ref=ref(
                "InterfacePhysicalBinding", created.target_binding_id
            ),
            connection_refs=[
                ref("Connection", connection_id)
                for connection_id in created.connection_ids
            ],
        )


@app.post(
    "/v1/topology/physical-connections",
    response_model=PhysicalEndpointConnectionCreationDocument,
    response_model_exclude_none=True,
    status_code=201,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def create_physical_endpoint_connection(
    query: CreatePhysicalEndpointConnectionRequest,
    session: Session = Depends(get_session),
) -> PhysicalEndpointConnectionCreationDocument:
    def endpoint(value: object) -> NetworkInterfaceEndpoint | ConnectionPointEndpoint:
        if value.kind == "NETWORK_INTERFACE":
            return NetworkInterfaceEndpoint(value.network_interface_id)
        return ConnectionPointEndpoint(value.connection_point_id, value.member_index)

    def ref(entity_type: str, entity_id: uuid.UUID) -> dict[str, object]:
        return {
            "ref_type": "CANONICAL_FACT",
            "entity_type": entity_type,
            "entity_id": entity_id,
        }

    def materialization(value: object) -> PhysicalEndpointMaterialization:
        original = value.endpoint
        if isinstance(original, NetworkInterfaceEndpoint):
            kind = "NETWORK_INTERFACE"
            endpoint_ref = ref("NetworkInterface", original.interface_id)
        else:
            kind = "CONNECTION_POINT"
            endpoint_ref = ref("ConnectionPoint", original.connection_point_id)
        return PhysicalEndpointMaterialization(
            kind=kind,
            endpoint_ref=endpoint_ref,
            connection_point_ref=ref(
                "ConnectionPoint", value.connection_point_id
            ),
            interface_binding_ref=(
                ref("InterfacePhysicalBinding", value.binding_id)
                if value.binding_id is not None
                else None
            ),
            member_index=1,
        )

    with session.begin():
        created = PhysicalConnectionCatalog(session).create_endpoint_link(
            endpoint(query.source),
            endpoint(query.target),
            query.cable_display_name,
            (query.cable_blueprint.blueprint_id, query.cable_blueprint.version_id) if query.cable_blueprint else None,
        )
        return PhysicalEndpointConnectionCreationDocument(
            source=materialization(created.source),
            target=materialization(created.target),
            cable_ref=ref("PhysicalObject", created.cable_id),
            connection_refs=[
                ref("Connection", connection_id)
                for connection_id in created.connection_ids
            ],
        )


@app.post(
    "/v1/traces/packet-processing/plan-validation",
    response_model=PacketProcessingPlanValidationArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def validate_packet_processing_plan(
    query: PacketProcessingPlanValidationQuery,
    session: Session = Depends(get_session),
) -> PacketProcessingPlanValidationArtifact:
    repository = CanonicalRepository(session)
    return PacketProcessingPlanValidationResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/packet-processing/plan-selection",
    response_model=PacketProcessingPlanSelectionArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def select_packet_processing_plan(
    query: PacketProcessingPlanSelectionQuery,
    session: Session = Depends(get_session),
) -> PacketProcessingPlanSelectionArtifact:
    repository = CanonicalRepository(session)
    return PacketProcessingPlanSelectionResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/packet-processing/evaluation",
    response_model=PacketProcessingEvaluationArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def evaluate_packet_processing_plan(
    query: PacketProcessingEvaluationQuery,
    session: Session = Depends(get_session),
) -> PacketProcessingEvaluationArtifact:
    repository = CanonicalRepository(session)
    return PacketProcessingPlanExecutor(repository).resolve(query, EvaluationView())


@app.post(
    "/v1/traces/packet-flow/evaluation",
    response_model=PacketFlowEvaluationArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def evaluate_packet_flow(
    query: PacketFlowEvaluationQuery,
    session: Session = Depends(get_session),
) -> PacketFlowEvaluationArtifact:
    repository = CanonicalRepository(session)
    return ConfiguredPacketFlowResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/l1",
    response_model=TraceArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def trace_l1(
    query: L1TraceQuery, session: Session = Depends(get_session)
) -> TraceArtifact:
    repository = CanonicalRepository(session)
    return L1Resolver(repository).resolve(query, EvaluationView())


@app.post(
    "/v1/traces/interfaces/physical",
    response_model=InterfacePhysicalTraceArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def trace_interface_physical(
    query: InterfacePhysicalTraceQuery,
    session: Session = Depends(get_session),
) -> InterfacePhysicalTraceArtifact:
    repository = CanonicalRepository(session)
    return InterfacePhysicalResolver(repository).resolve(query, EvaluationView())


@app.post(
    "/v1/traces/physical-objects/l1",
    response_model=PhysicalObjectL1TraceArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def trace_physical_objects_l1(
    query: PhysicalObjectL1TraceQuery,
    session: Session = Depends(get_session),
) -> PhysicalObjectL1TraceArtifact:
    return PhysicalObjectL1Resolver(CanonicalRepository(session)).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/l2/reachability",
    response_model=L2ReachabilityTraceArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def trace_l2_reachability(
    query: L2ReachabilityQuery,
    session: Session = Depends(get_session),
) -> L2ReachabilityTraceArtifact:
    repository = CanonicalRepository(session)
    return L2ReachabilityResolver(repository).resolve(query, EvaluationView())


@app.post(
    "/v1/traces/l3/route-decision",
    response_model=RouteDecisionArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def trace_l3_route_decision(
    query: RouteDecisionQuery,
    session: Session = Depends(get_session),
) -> RouteDecisionArtifact:
    repository = CanonicalRepository(session)
    return SelectedTableRouteDecisionResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/l3/next-hop-resolution",
    response_model=NextHopResolutionArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def trace_l3_next_hop_resolution(
    query: NextHopResolutionQuery,
    session: Session = Depends(get_session),
) -> NextHopResolutionArtifact:
    repository = CanonicalRepository(session)
    return SelectedTableNextHopResolver(repository).resolve(query, EvaluationView())


@app.post(
    "/v1/traces/l3/adjacency-candidates",
    response_model=AdjacencyCandidatesArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def trace_l3_adjacency_candidates(
    query: AdjacencyCandidatesQuery,
    session: Session = Depends(get_session),
) -> AdjacencyCandidatesArtifact:
    repository = CanonicalRepository(session)
    return StructuralAdjacencyResolver(repository).resolve(query, EvaluationView())


@app.post(
    "/v1/traces/l3/structural-adjacency",
    response_model=StructuralAdjacencyArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def trace_l3_structural_adjacency(
    query: StructuralAdjacencyQuery,
    session: Session = Depends(get_session),
) -> StructuralAdjacencyArtifact:
    repository = CanonicalRepository(session)
    return StructuralAdjacencyProofResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/l3/reachability",
    response_model=L3ReachabilityArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def trace_l3_reachability(
    query: L3ReachabilityQuery,
    session: Session = Depends(get_session),
) -> L3ReachabilityArtifact:
    repository = CanonicalRepository(session)
    return ConfiguredL3ReachabilityResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/routing/policy-evaluation",
    response_model=RoutingPolicyEvaluationArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def evaluate_routing_policy(
    query: RoutingPolicyEvaluationQuery,
    session: Session = Depends(get_session),
) -> RoutingPolicyEvaluationArtifact:
    repository = CanonicalRepository(session)
    return ConfiguredRoutingPolicyResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/security/policy-evaluation",
    response_model=SecurityPolicyEvaluationArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def evaluate_security_policy(
    query: SecurityPolicyEvaluationQuery,
    session: Session = Depends(get_session),
) -> SecurityPolicyEvaluationArtifact:
    repository = CanonicalRepository(session)
    return ConfiguredSecurityPolicyResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/security/evaluation",
    response_model=SecurityEvaluationArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def evaluate_security_stages(
    query: SecurityEvaluationQuery,
    session: Session = Depends(get_session),
) -> SecurityEvaluationArtifact:
    repository = CanonicalRepository(session)
    return ConfiguredSecurityEvaluationResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/nat/policy-evaluation",
    response_model=NATPolicyEvaluationArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def evaluate_nat_policy(
    query: NATPolicyEvaluationQuery,
    session: Session = Depends(get_session),
) -> NATPolicyEvaluationArtifact:
    repository = CanonicalRepository(session)
    return ConfiguredNATPolicyResolver(repository).resolve(
        query, EvaluationView()
    )


@app.post(
    "/v1/traces/nat/evaluation",
    response_model=NATEvaluationArtifact,
    responses={422: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def evaluate_nat_stages(
    query: NATEvaluationQuery,
    session: Session = Depends(get_session),
) -> NATEvaluationArtifact:
    repository = CanonicalRepository(session)
    return ConfiguredNATEvaluationResolver(repository).resolve(
        query, EvaluationView()
    )
