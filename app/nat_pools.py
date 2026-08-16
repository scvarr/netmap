import uuid
from dataclasses import dataclass
from ipaddress import IPv4Address, IPv6Address, ip_address
from typing import TypeAlias

from app.errors import ModelError, ValidationError


IPAddress = IPv4Address | IPv6Address
IPAddressRange: TypeAlias = dict[str, str]
PortRange: TypeAlias = dict[str, int]


@dataclass(frozen=True)
class NATPoolRangeSet:
    pool_id: uuid.UUID
    address_ranges: tuple[IPAddressRange, ...]
    port_ranges: tuple[PortRange, ...]


def normalize_nat_pool_ranges(
    address_ranges: object,
    port_ranges: object,
    *,
    model_error: bool,
    details: dict[str, object] | None = None,
) -> tuple[list[IPAddressRange], list[PortRange]]:
    error_type = ModelError if model_error else ValidationError
    context = details or {}

    def fail(message: str, field: str) -> None:
        raise error_type(message, {**context, "pool_field": field})

    if not isinstance(address_ranges, list):
        fail("NATPool address_ranges must be an array", "address_ranges")
    if not isinstance(port_ranges, list):
        fail("NATPool port_ranges must be an array", "port_ranges")

    parsed_addresses: list[tuple[IPAddress, IPAddress]] = []
    for item in address_ranges:
        if (
            not isinstance(item, dict)
            or set(item) != {"start", "end"}
            or not isinstance(item["start"], str)
            or not isinstance(item["end"], str)
        ):
            fail(
                "NATPool address range must contain string start and end",
                "address_ranges",
            )
        try:
            start = ip_address(item["start"])
            end = ip_address(item["end"])
        except ValueError as exc:
            raise error_type(
                "NATPool address range contains an invalid IP address",
                {**context, "pool_field": "address_ranges"},
            ) from exc
        if start.version != end.version:
            fail(
                "NATPool address range endpoints must use one address family",
                "address_ranges",
            )
        if int(start) > int(end):
            fail("NATPool address range start must not exceed end", "address_ranges")
        parsed_addresses.append((start, end))

    merged_addresses: list[tuple[IPAddress, IPAddress]] = []
    for start, end in sorted(
        parsed_addresses, key=lambda pair: (pair[0].version, int(pair[0]), int(pair[1]))
    ):
        if not merged_addresses:
            merged_addresses.append((start, end))
            continue
        previous_start, previous_end = merged_addresses[-1]
        if start.version == previous_start.version and int(start) <= int(previous_end) + 1:
            merged_addresses[-1] = (
                previous_start,
                end if int(end) > int(previous_end) else previous_end,
            )
        else:
            merged_addresses.append((start, end))
    normalized_addresses = [
        {"start": str(start), "end": str(end)}
        for start, end in merged_addresses
    ]

    parsed_ports: list[tuple[int, int]] = []
    for item in port_ranges:
        if not isinstance(item, dict) or set(item) != {"start", "end"}:
            fail(
                "NATPool port range must contain start and end",
                "port_ranges",
            )
        start = item["start"]
        end = item["end"]
        if (
            not isinstance(start, int)
            or isinstance(start, bool)
            or not isinstance(end, int)
            or isinstance(end, bool)
            or not 0 <= start <= end <= 65535
        ):
            fail(
                "NATPool port range must satisfy 0 <= start <= end <= 65535",
                "port_ranges",
            )
        parsed_ports.append((start, end))

    merged_ports: list[tuple[int, int]] = []
    for start, end in sorted(parsed_ports):
        if not merged_ports or start > merged_ports[-1][1] + 1:
            merged_ports.append((start, end))
        else:
            previous_start, previous_end = merged_ports[-1]
            merged_ports[-1] = (previous_start, max(previous_end, end))
    normalized_ports = [
        {"start": start, "end": end} for start, end in merged_ports
    ]

    if not normalized_addresses and not normalized_ports:
        raise error_type("NATPool must contain at least one configured range", context)
    if model_error and (
        address_ranges != normalized_addresses or port_ranges != normalized_ports
    ):
        raise ModelError(
            "NATPool ranges are not canonical",
            {
                **context,
                "canonical_address_ranges": normalized_addresses,
                "canonical_port_ranges": normalized_ports,
            },
        )
    return normalized_addresses, normalized_ports
