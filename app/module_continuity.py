"""Resolve authored module links against canonical endpoints of one installation."""
from collections import defaultdict

from sqlalchemy import select

from app.errors import ModelError, ValidationError
from app.models import Cable, Connection, ConnectionMember


def validate_member_capacity(definition, capacities):
    by_key = {e["key"]: capacities.get(e["port_type_id"], 0) for e in definition["endpoints"]}
    for link in definition.get("internal_links", ()):
        for member in link["member_mappings"]:
            if (member["from_member_index"] > by_key[link["from_endpoint_key"]]
                    or member["to_member_index"] > by_key[link["to_endpoint_key"]]):
                raise ValidationError("Internal module member exceeds PortType capacity",
                                      {"reason": "INTERNAL_MEMBER_OUT_OF_RANGE"})


def link_signature(left, right, members):
    if left > right:
        return (right, left), frozenset((b, a) for a, b in members)
    return (left, right), frozenset(members)


def expected_links(links, points_by_key):
    return dict(link_signature(
        points_by_key[link["from_endpoint_key"]], points_by_key[link["to_endpoint_key"]],
        ((m["from_member_index"], m["to_member_index"]) for m in link["member_mappings"]),
    ) for link in links)


def preserves_internal_links(before, after):
    def signature(definition):
        return expected_links(definition.get("internal_links", ()), {e["key"]: e["key"] for e in definition["endpoints"]})

    return signature(before) == signature(after)


def require_unchanged_internal_links(before, after):
    if not preserves_internal_links(before, after):
        raise ModelError("Внутренняя разводка неизменна. Создайте новый шаблон модуля.",
                         {"reason": "PHYSICAL_STRUCTURE_IMMUTABLE"})


def matching_connections(expected, connections, members_by_connection, cabled_ids):
    """Return IDs only when every authored link has exactly one canonical match."""
    matches = {}
    for identifier, left, right, cardinality in connections:
        pair = tuple(sorted((left, right)))
        if pair not in expected:
            continue
        members = members_by_connection[identifier]
        _, actual = link_signature(left, right, ((a, b) for _, a, b in members))
        if (identifier in cabled_ids or pair in matches or actual != expected[pair]
                or len(members) != cardinality or sorted(i for i, _, _ in members) != list(range(1, cardinality + 1))):
            return None
        matches[pair] = identifier
    return tuple(matches.values()) if matches.keys() == expected.keys() else None


def installation_internal_connections(session, links, points_by_key, *, lock=False):
    if not links:
        return ()
    if any(link[key] not in points_by_key for link in links for key in ("from_endpoint_key", "to_endpoint_key")):
        return None
    expected = expected_links(links, points_by_key)
    point_ids = {point for pair in expected for point in pair}
    query = select(Connection.id, Connection.point_a_id, Connection.point_b_id, Connection.cardinality).where(
        Connection.point_a_id.in_(point_ids), Connection.point_b_id.in_(point_ids),
    ).order_by(Connection.id)
    if lock:
        query = query.with_for_update()
    connections = [row for row in session.execute(query) if tuple(sorted(row[1:3])) in expected]
    ids = [row.id for row in connections]
    member_query = select(ConnectionMember.connection_id, ConnectionMember.index,
                          ConnectionMember.point_a_member, ConnectionMember.point_b_member).where(
        ConnectionMember.connection_id.in_(ids),
    ).order_by(ConnectionMember.id)
    if lock:
        member_query = member_query.with_for_update()
    members = defaultdict(list)
    for identifier, index, left, right in session.execute(member_query):
        members[identifier].append((index, left, right))
    cabled = set(session.scalars(select(Cable.connection_id).where(Cable.connection_id.in_(ids))))
    return matching_connections(expected, connections, members, cabled)
