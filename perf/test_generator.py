from perf.generate import PROFILES, port_plan, stable_id


def test_profile_port_plans_are_exact_and_deterministic():
    for profile in PROFILES.values():
        assert sum(port_plan(profile)) == profile.ports
        assert port_plan(profile) == port_plan(profile)


def test_seeded_ids_are_stable():
    assert stable_id(7, "object", 2) == stable_id(7, "object", 2)
    assert stable_id(7, "object", 2) != stable_id(8, "object", 2)


def test_small_materialization_matches_network_port_runtime_shape():
    import os
    import pytest
    from sqlalchemy import select
    if os.environ.get("NETMAP_PERF_DATABASE") != "1":
        pytest.skip("requires the isolated netmap_perf database")
    from app.database import SessionLocal
    from app.models import BlueprintInstanceSlot, Connection, ConnectionPoint, InterfacePhysicalBinding, NetworkInterfacePhysicalOwner
    from perf.generate import generate

    result = generate("small", 20260826)
    with SessionLocal() as session:
        network_slots = list(session.scalars(select(BlueprintInstanceSlot).where(BlueprintInstanceSlot.network_interface_id.is_not(None))))
        assert network_slots
        interface_ids = {row.network_interface_id for row in network_slots}
        assert session.query(NetworkInterfacePhysicalOwner).filter(NetworkInterfacePhysicalOwner.interface_id.in_(interface_ids)).count() == len(interface_ids)
        assert session.query(InterfacePhysicalBinding).filter(InterfacePhysicalBinding.interface_id.in_(interface_ids)).count() == len(interface_ids)
        source, target = result["anchors"]["trace_source_physical_object_id"], result["anchors"]["trace_target_physical_object_id"]
        assert session.query(Connection).join(ConnectionPoint, Connection.point_a_id == ConnectionPoint.id).filter(ConnectionPoint.physical_object_id == source).count() > 0
        assert source != target
        objects_by_point = dict(session.execute(select(ConnectionPoint.id, ConnectionPoint.physical_object_id)))
        external_incidents: dict[object, int] = {}
        for connection in session.scalars(select(Connection)):
            if objects_by_point[connection.point_a_id] == objects_by_point[connection.point_b_id]:
                continue
            external_incidents[connection.point_a_id] = external_incidents.get(connection.point_a_id, 0) + 1
            external_incidents[connection.point_b_id] = external_incidents.get(connection.point_b_id, 0) + 1
        assert all(count <= 1 for count in external_incidents.values())
