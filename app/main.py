import logging
import uuid

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.adjacency_resolver import StructuralAdjacencyResolver
from app.database import get_session
from app.device_catalog import DeviceCatalog
from app.device_details_resolver import ConfiguredDeviceDetailsResolver
from app.errors import NetMapError, ValidationError
from app.interface_resolver import InterfacePhysicalResolver
from app.l2_resolver import L2ReachabilityResolver
from app.l3_resolver import SelectedTableRouteDecisionResolver
from app.l3_reachability_resolver import ConfiguredL3ReachabilityResolver
from app.next_hop_resolver import SelectedTableNextHopResolver
from app.nat_resolver import ConfiguredNATPolicyResolver
from app.nat_evaluation_resolver import ConfiguredNATEvaluationResolver
from app.packet_processing_plan_resolver import PacketProcessingPlanValidationResolver
from app.packet_processing_plan_selection_resolver import PacketProcessingPlanSelectionResolver
from app.packet_processing_executor import PacketProcessingPlanExecutor
from app.packet_flow_resolver import ConfiguredPacketFlowResolver
from app.physical_connections import PhysicalConnectionCatalog
from app.physical_object_details_resolver import ConfiguredPhysicalObjectDetailsResolver
from app.repository import CanonicalRepository
from app.resolver import L1Resolver
from app.routing_policy_resolver import ConfiguredRoutingPolicyResolver
from app.security_resolver import ConfiguredSecurityPolicyResolver
from app.security_evaluation_resolver import ConfiguredSecurityEvaluationResolver
from app.schemas import (
    AdjacencyCandidatesArtifact,
    AdjacencyCandidatesQuery,
    CreateDeviceInterfaceRequest,
    CreateNetworkDeviceRequest,
    CreatePhysicalLinkRequest,
    CreatePhysicalObjectRequest,
    DeviceDetailsDocument,
    ErrorResponse,
    EvaluationView,
    InterfacePhysicalTraceArtifact,
    InterfacePhysicalTraceQuery,
    L1TraceQuery,
    L2ReachabilityQuery,
    L2ReachabilityTraceArtifact,
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
    PhysicalConnectionCreationDocument,
    PhysicalObjectDetailsDocument,
    NATEvaluationArtifact,
    NATEvaluationQuery,
    RouteDecisionArtifact,
    RouteDecisionQuery,
    RoutingPolicyEvaluationArtifact,
    RoutingPolicyEvaluationQuery,
    SecurityPolicyEvaluationArtifact,
    SecurityPolicyEvaluationQuery,
    SecurityEvaluationArtifact,
    SecurityEvaluationQuery,
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
        )
        return ConfiguredPhysicalObjectDetailsResolver(
            CanonicalRepository(session)
        ).resolve(created.physical_object_id)


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
