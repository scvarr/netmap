import logging

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.adjacency_resolver import StructuralAdjacencyResolver
from app.database import get_session
from app.errors import NetMapError, ValidationError
from app.interface_resolver import InterfacePhysicalResolver
from app.l2_resolver import L2ReachabilityResolver
from app.l3_resolver import SelectedTableRouteDecisionResolver
from app.l3_reachability_resolver import ConfiguredL3ReachabilityResolver
from app.next_hop_resolver import SelectedTableNextHopResolver
from app.nat_resolver import ConfiguredNATPolicyResolver
from app.nat_evaluation_resolver import ConfiguredNATEvaluationResolver
from app.packet_processing_plan_resolver import PacketProcessingPlanValidationResolver
from app.repository import CanonicalRepository
from app.resolver import L1Resolver
from app.routing_policy_resolver import ConfiguredRoutingPolicyResolver
from app.security_resolver import ConfiguredSecurityPolicyResolver
from app.security_evaluation_resolver import ConfiguredSecurityEvaluationResolver
from app.schemas import (
    AdjacencyCandidatesArtifact,
    AdjacencyCandidatesQuery,
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
    TraceArtifact,
)
from app.structural_adjacency_resolver import StructuralAdjacencyProofResolver

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
