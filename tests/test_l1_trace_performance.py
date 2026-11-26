from fastapi.testclient import TestClient
import pytest
from sqlalchemy import delete

from app.database import SessionLocal
from app.main import app
from app.models import Connection, ConnectionMember
from app.repository import CanonicalRepository, ConnectionMemberInput
from perf.l1_trace import INTERFACE, OBJECT, profile, seed


def test_many_candidates_share_walks_and_limit_sql():
    with TestClient(app) as client:
        cases = seed(client, 12)
        for name, expected in {
            "object-12": (48, 48, 48, 96),
            "interface-12": (24, 12, 12, 20),
        }.items():
            path, query = cases[name]
            with profile() as (counts, _):
                response = client.post(path, json=query)
            assert response.status_code == 200, response.text
            document = response.json()
            source = document.get("source_candidates", document.get("source_binding_candidates"))
            target = document.get("target_candidates", document.get("target_binding_candidates"))
            assert (len(source), len(target), counts["walks"], len(document["branches"])) == expected
            assert counts["exact_resolve"] == 0
            assert counts["batch_member_reads"] >= 1
            assert counts["sql"] < 150


@pytest.mark.parametrize("route", [OBJECT, INTERFACE])
def test_composed_trace_uses_one_snapshot_then_reads_new_topology(monkeypatch, route):
    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        source, target = repo.add_physical_object(), repo.add_physical_object()
        left = repo.add_connection_point(source.id, 1)
        right = repo.add_connection_point(target.id, 1)
        connection, _ = repo.add_connection(left.id, right.id, 1, [ConnectionMemberInput(1, 1, 1)])
        connection_id = connection.id
        if route == OBJECT:
            query = {"from_physical_object_id": str(source.id), "to_physical_object_id": str(target.id)}
        else:
            left_binding, right_binding = repo.add_network_interface(), repo.add_network_interface()
            repo.add_interface_physical_binding(left_binding.id, left.id, 1)
            repo.add_interface_physical_binding(right_binding.id, right.id, 1)
            query = {"from_interface_id": str(left_binding.id), "to_interface_id": str(right_binding.id)}

    load = CanonicalRepository.get_l1_member_links_batch
    committed = False

    def change_before_read(self, addresses):
        nonlocal committed
        if not committed:
            committed = True
            with SessionLocal.begin() as writer:
                writer.execute(delete(ConnectionMember).where(ConnectionMember.connection_id == connection_id))
                writer.execute(delete(Connection).where(Connection.id == connection_id))
        return load(self, addresses)

    monkeypatch.setattr(CanonicalRepository, "get_l1_member_links_batch", change_before_read)
    with TestClient(app) as client:
        before = client.post(route, json=query)
        after = client.post(route, json=query)
    assert committed
    assert before.status_code == after.status_code == 200
    assert before.json()["verdict"] == "REACHABLE"
    assert after.json()["verdict"] == "UNKNOWN"
    assert after.json()["branches"] == []


def test_coincident_targets_stop_interface_walk_but_object_cycle_scan_still_checks_peers():
    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        source, damaged, other = [repo.add_physical_object() for _ in range(3)]
        start, fault, third = [repo.add_connection_point(owner.id, 1) for owner in (source, damaged, other)]
        for left, right in ((start, fault), (fault, third)):
            repo.add_connection(left.id, right.id, 1, [ConnectionMemberInput(1, 1, 1)])
        interface = repo.add_network_interface()
        repo.add_interface_physical_binding(interface.id, start.id, 1)

    with TestClient(app) as client:
        interface_trace = client.post(INTERFACE, json={
            "from_interface_id": str(interface.id), "to_interface_id": str(interface.id),
        })
        object_trace = client.post(OBJECT, json={
            "from_physical_object_id": str(source.id), "to_physical_object_id": str(source.id),
        })
    assert interface_trace.status_code == 200
    body = interface_trace.json()
    assert body["verdict"] == "REACHABLE"
    assert len(body["branches"]) == 1
    assert [edge["transition_kind"] for edge in body["edges"]] == ["INTERFACE_PHYSICAL_BIND"] * 2
    assert object_trace.status_code == 409
    assert object_trace.json()["error"]["code"] == "MODEL_ERROR"
