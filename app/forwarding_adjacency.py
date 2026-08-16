from ipaddress import IPv4Address, IPv6Address

from app.errors import ValidationError
from app.schemas import DirectEgressState


IPAddress = IPv4Address | IPv6Address


def derive_adjacency_target(
    direct_egress: DirectEgressState,
    current_destination_ip: IPAddress | None,
) -> IPAddress:
    """Interpret a forwarding decision without performing topology lookup."""
    if direct_egress.adjacency_mode == "GATEWAY":
        # The schema invariant makes this non-optional for GATEWAY mode.
        assert direct_egress.gateway_address is not None
        return direct_egress.gateway_address
    if current_destination_ip is None:
        raise ValidationError(
            "DIRECT_DESTINATION adjacency requires current destination_ip",
            {
                "egress_l3_binding_id": str(
                    direct_egress.egress_l3_binding_id
                ),
                "adjacency_mode": direct_egress.adjacency_mode,
            },
        )
    return current_destination_ip
