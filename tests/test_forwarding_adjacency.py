import uuid
from ipaddress import ip_address

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.errors import ValidationError
from app.forwarding_adjacency import derive_adjacency_target
from app.schemas import DirectEgressState


def direct_egress(**overrides):
    values = {
        "egress_l3_binding_id": uuid.uuid4(),
        "adjacency_mode": "DIRECT_DESTINATION",
        "original_destination": "203.0.113.10",
    }
    values.update(overrides)
    return DirectEgressState(**values)


def test_gateway_mode_requires_gateway_address():
    with pytest.raises(PydanticValidationError):
        direct_egress(adjacency_mode="GATEWAY")


def test_direct_destination_mode_forbids_gateway_address():
    with pytest.raises(PydanticValidationError):
        direct_egress(gateway_address="192.0.2.1")


def test_gateway_target_ignores_current_destination():
    decision = direct_egress(
        adjacency_mode="GATEWAY", gateway_address="192.0.2.1"
    )

    assert str(
        derive_adjacency_target(decision, ip_address("10.0.0.10"))
    ) == "192.0.2.1"


def test_direct_target_uses_current_destination():
    assert str(
        derive_adjacency_target(direct_egress(), ip_address("10.0.0.10"))
    ) == "10.0.0.10"


def test_direct_target_requires_current_destination():
    with pytest.raises(ValidationError):
        derive_adjacency_target(direct_egress(), None)
