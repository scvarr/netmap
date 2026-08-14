import logging

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_session
from app.errors import NetMapError, ValidationError
from app.repository import CanonicalRepository
from app.resolver import L1Resolver
from app.schemas import ErrorResponse, EvaluationView, L1TraceQuery, TraceArtifact

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
