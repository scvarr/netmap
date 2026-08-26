from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from app.perf_instrumentation import PERF_REQUEST_HEADER, PERF_RESPONSE_HEADER, install_listener


def test_perf_instrumentation_is_opt_in(monkeypatch):
    monkeypatch.delenv("NETMAP_PERF_INSTRUMENTATION", raising=False)
    response = TestClient(app).get("/health", headers={PERF_REQUEST_HEADER: "1"})
    assert response.status_code == 200
    assert PERF_RESPONSE_HEADER not in response.headers


def test_measured_requests_are_request_local(monkeypatch):
    monkeypatch.setenv("NETMAP_PERF_INSTRUMENTATION", "1")
    install_listener(engine)
    client = TestClient(app)
    first = client.get("/health", headers={PERF_REQUEST_HEADER: "1"})
    unmeasured = client.get("/health")
    second = client.get("/health", headers={PERF_REQUEST_HEADER: "1"})
    assert int(first.headers[PERF_RESPONSE_HEADER]) > 0
    assert PERF_RESPONSE_HEADER not in unmeasured.headers
    assert int(second.headers[PERF_RESPONSE_HEADER]) == int(first.headers[PERF_RESPONSE_HEADER])
