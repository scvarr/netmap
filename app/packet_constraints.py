from dataclasses import dataclass
from ipaddress import IPv4Address, IPv6Address
from itertools import product

from app.schemas import NATIPAddressRange, NATPacketConstraint, NATPortRange, PacketState


MAX_PACKET_CONSTRAINT_EXPANSION = 64


@dataclass(frozen=True)
class PacketConstraintExpansion:
    packets: tuple[PacketState, ...]
    total_cardinality: int
    limit_exceeded: bool


def expand_packet_constraint(
    constraint: NATPacketConstraint,
    *,
    limit: int = MAX_PACKET_CONSTRAINT_EXPANSION,
) -> PacketConstraintExpansion:
    """Materialize every semantic packet value, or none when the limit is exceeded."""
    if limit < 1:
        raise ValueError("packet constraint expansion limit must be positive")

    fields = (
        (
            "source_ip",
            _ip_intervals(constraint.source_ip_ranges),
            constraint.packet_base.source_ip,
        ),
        (
            "destination_ip",
            _ip_intervals(constraint.destination_ip_ranges),
            constraint.packet_base.destination_ip,
        ),
        (
            "source_port",
            _port_intervals(constraint.source_port_ranges),
            constraint.packet_base.source_port,
        ),
        (
            "destination_port",
            _port_intervals(constraint.destination_port_ranges),
            constraint.packet_base.destination_port,
        ),
    )
    total = 1
    for _field, intervals, _base_value in fields:
        total *= _interval_cardinality(intervals) if intervals else 1
    if total > limit:
        return PacketConstraintExpansion((), total, True)

    values = [
        tuple(_interval_values(intervals)) if intervals else (base_value,)
        for _field, intervals, base_value in fields
    ]
    base = constraint.packet_base.model_dump(mode="json")
    packets = tuple(
        PacketState.model_validate(
            {**base, **dict(zip((field for field, *_ in fields), combination))}
        )
        for combination in product(*values)
    )
    return PacketConstraintExpansion(packets, total, False)


def _ip_intervals(
    ranges: list[NATIPAddressRange] | None,
) -> tuple[tuple[int, int, int], ...]:
    if not ranges:
        return ()
    grouped = sorted(
        ((item.start.version, int(item.start), int(item.end)) for item in ranges)
    )
    merged: list[tuple[int, int, int]] = []
    for version, start, end in grouped:
        if merged and merged[-1][0] == version and start <= merged[-1][2] + 1:
            previous_version, previous_start, previous_end = merged[-1]
            merged[-1] = (
                previous_version,
                previous_start,
                max(previous_end, end),
            )
        else:
            merged.append((version, start, end))
    return tuple(merged)


def _port_intervals(
    ranges: list[NATPortRange] | None,
) -> tuple[tuple[int, int, int], ...]:
    if not ranges:
        return ()
    merged: list[tuple[int, int, int]] = []
    for start, end in sorted((item.start, item.end) for item in ranges):
        if merged and start <= merged[-1][2] + 1:
            _version, previous_start, previous_end = merged[-1]
            merged[-1] = (0, previous_start, max(previous_end, end))
        else:
            merged.append((0, start, end))
    return tuple(merged)


def _interval_cardinality(intervals: tuple[tuple[int, int, int], ...]) -> int:
    return sum(end - start + 1 for _version, start, end in intervals)


def _interval_values(intervals: tuple[tuple[int, int, int], ...]):
    for version, start, end in intervals:
        for value in range(start, end + 1):
            if version == 4:
                yield IPv4Address(value)
            elif version == 6:
                yield IPv6Address(value)
            else:
                yield value
