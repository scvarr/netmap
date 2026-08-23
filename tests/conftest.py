import os

import pytest
from sqlalchemy import delete
from sqlalchemy.engine import make_url

from app.database import SessionLocal
from app.models import (
    Connection,
    ConnectionMember,
    ConnectionPoint,
    BlueprintEndpointSlot,
    BlueprintInstance,
    BlueprintInstanceSlot,
    BlueprintInternalLink,
    InterfaceAddress,
    InterfacePhysicalBinding,
    NetworkInterface,
    NetworkInterfacePhysicalOwner,
    NetworkInterfaceRealization,
    NATPolicy,
    NATPolicyAttachment,
    NATPool,
    NATRule,
    PacketProcessingPlan,
    PacketProcessingPlanAttachment,
    PacketProcessingPlanAttachmentSet,
    ObjectBlueprint,
    ObjectBlueprintVersion,
    PhysicalObject,
    ProcessingEntryPoint,
    ProcessingStage,
    ProcessingTransition,
    L2Binding,
    L2EgressRule,
    L2ForwardingContext,
    L2IngressRule,
    L3Binding,
    Route,
    RouteNextHop,
    RoutingContext,
    RoutingPolicy,
    RoutingPolicyRule,
    RoutingTable,
    SecurityPolicy,
    SecurityPolicyAttachment,
    SecurityRule,
)


TEST_DATABASE_NAME = "netmap_test"
TEST_DATABASE_MARKER = "NETMAP_TEST_DATABASE"


def require_confirmed_test_database(
    database_url: str | None = None,
    test_database_marker: str | None = None,
) -> None:
    """Reject destructive test cleanup unless the process targets netmap_test."""
    marker = test_database_marker if test_database_marker is not None else os.environ.get(TEST_DATABASE_MARKER)
    url_value = database_url if database_url is not None else os.environ.get("DATABASE_URL")
    if marker != "1":
        raise pytest.UsageError(
            f"Refusing destructive tests: set {TEST_DATABASE_MARKER}=1 for the isolated test database."
        )
    if not url_value:
        raise pytest.UsageError("Refusing destructive tests: DATABASE_URL is not configured.")
    try:
        url = make_url(url_value)
    except Exception as error:
        raise pytest.UsageError("Refusing destructive tests: DATABASE_URL is invalid.") from error
    if url.database != TEST_DATABASE_NAME:
        raise pytest.UsageError(
            f"Refusing destructive tests: DATABASE_URL must target {TEST_DATABASE_NAME!r}, not {url.database!r}."
        )


def pytest_sessionstart(session: pytest.Session) -> None:
    require_confirmed_test_database()


@pytest.fixture(autouse=True)
def clean_database():
    require_confirmed_test_database()
    with SessionLocal.begin() as session:
        session.execute(delete(BlueprintInstanceSlot))
        session.execute(delete(BlueprintInstance))
        session.execute(delete(BlueprintInternalLink))
        session.execute(delete(BlueprintEndpointSlot))
        session.execute(delete(ObjectBlueprintVersion))
        session.execute(delete(ObjectBlueprint))
        session.execute(delete(PacketProcessingPlanAttachment))
        session.execute(delete(PacketProcessingPlanAttachmentSet))
        session.execute(delete(ProcessingEntryPoint))
        session.execute(delete(ProcessingTransition))
        session.execute(delete(ProcessingStage))
        session.execute(delete(PacketProcessingPlan))
        session.execute(delete(RoutingPolicyRule))
        session.execute(delete(RoutingPolicy))
        session.execute(delete(NATPolicyAttachment))
        session.execute(delete(NATRule))
        session.execute(delete(NATPolicy))
        session.execute(delete(NATPool))
        session.execute(delete(SecurityPolicyAttachment))
        session.execute(delete(SecurityRule))
        session.execute(delete(SecurityPolicy))
        session.execute(delete(InterfaceAddress))
        session.execute(delete(RouteNextHop))
        session.execute(delete(Route))
        session.execute(delete(RoutingTable))
        session.execute(delete(L3Binding))
        session.execute(delete(RoutingContext))
        session.execute(delete(L2EgressRule))
        session.execute(delete(L2IngressRule))
        session.execute(delete(L2Binding))
        session.execute(delete(L2ForwardingContext))
        session.execute(delete(NetworkInterfaceRealization))
        session.execute(delete(InterfacePhysicalBinding))
        session.execute(delete(NetworkInterfacePhysicalOwner))
        session.execute(delete(NetworkInterface))
        session.execute(delete(ConnectionMember))
        session.execute(delete(Connection))
        session.execute(delete(ConnectionPoint))
        session.execute(delete(PhysicalObject))
    yield
