import pytest
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.repository import CanonicalRepository


def test_duplicate_l2_binding_is_forbidden_by_postgresql():
    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            repository = CanonicalRepository(session)
            interface = repository.add_network_interface()
            context = repository.add_l2_forwarding_context()
            repository.add_l2_binding(interface.id, context.id)
            repository.add_l2_binding(interface.id, context.id)

    assert error.value.orig.diag.constraint_name == "uq_l2_bindings_interface_context"


def test_only_one_effective_egress_rule_is_allowed_per_binding():
    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            repository = CanonicalRepository(session)
            interface = repository.add_network_interface()
            context = repository.add_l2_forwarding_context()
            binding = repository.add_l2_binding(interface.id, context.id)
            repository.add_l2_egress_rule(binding.id, [])
            repository.add_l2_egress_rule(binding.id, [{"kind": "dot1q", "value": 100}])

    assert error.value.orig.diag.constraint_name == "uq_l2_egress_rules_binding"


def test_encapsulation_stack_order_is_significant_for_exact_lookup():
    outer_inner = [
        {"kind": "dot1ad", "value": 500},
        {"kind": "dot1q", "value": 100},
    ]
    reversed_stack = list(reversed(outer_inner))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        context = repository.add_l2_forwarding_context()
        binding = repository.add_l2_binding(interface.id, context.id)
        rule = repository.add_l2_ingress_rule(binding.id, outer_inner)
        interface_id = interface.id
        rule_id = rule.id

    with SessionLocal() as session:
        repository = CanonicalRepository(session)
        exact = repository.get_l2_ingress_exact(interface_id, outer_inner)
        reversed_result = repository.get_l2_ingress_exact(interface_id, reversed_stack)

    assert [candidate.rule_id for candidate in exact] == [rule_id]
    assert reversed_result == []
