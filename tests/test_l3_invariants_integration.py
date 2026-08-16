import pytest
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import Route
from app.repository import CanonicalRepository, RouteNextHopInput


def test_l3_binding_is_unique_per_interface_and_context():
    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            repository = CanonicalRepository(session)
            interface = repository.add_network_interface()
            context = repository.add_routing_context()
            repository.add_l3_binding(interface.id, context.id)
            repository.add_l3_binding(interface.id, context.id)

    assert error.value.orig.diag.constraint_name == "uq_l3_bindings_interface_context"


def test_route_prefix_is_canonicalized_on_repository_write():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        route = repository.add_route(table.id, "192.0.2.17/24", "LOCAL")
        route_id = route.id

    with SessionLocal() as session:
        route = session.get(Route, route_id)
        assert route is not None
        assert str(route.destination_prefix) == "192.0.2.0/24"


def test_repository_rejects_forward_without_next_hops():
    with pytest.raises(ValidationError):
        with SessionLocal.begin() as session:
            repository = CanonicalRepository(session)
            context = repository.add_routing_context()
            table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
            repository.add_route(table.id, "0.0.0.0/0", "FORWARD")


def test_repository_rejects_route_and_gateway_family_mismatch():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_route(table.id, "2001:db8::/32", "LOCAL")
        with pytest.raises(ValidationError):
            repository.add_route(
                table.id,
                "192.0.2.0/24",
                "FORWARD",
                next_hops=[RouteNextHopInput(gateway_address="2001:db8::1")],
            )


def test_repository_rejects_cross_context_egress_binding():
    with pytest.raises(ValidationError):
        with SessionLocal.begin() as session:
            repository = CanonicalRepository(session)
            context = repository.add_routing_context()
            other_context = repository.add_routing_context()
            table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
            interface = repository.add_network_interface()
            binding = repository.add_l3_binding(interface.id, other_context.id)
            repository.add_route(
                table.id,
                "192.0.2.0/24",
                "FORWARD",
                next_hops=[RouteNextHopInput(egress_l3_binding_id=binding.id)],
            )
