import logging

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_session
from app.errors import NetMapError, ValidationError
from app.interface_resolver import InterfacePhysicalResolver
from app.l2_resolver import L2ReachabilityResolver
from app.l3_resolver import SelectedTableRouteDecisionResolver
from app.next_hop_resolver import SelectedTableNextHopResolver
from app.repository import CanonicalRepository
from app.resolver import L1Resolver
from app.schemas import (
    ErrorResponse,
    EvaluationView,
    InterfacePhysicalTraceArtifact,
    InterfacePhysicalTraceQuery,
    L1TraceQuery,
    L2ReachabilityQuery,
    L2ReachabilityTraceArtifact,
    NextHopResolutionArtifact,
    NextHopResolutionQuery,
    RouteDecisionArtifact,
    RouteDecisionQuery,
    TraceArtifact,
)

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
