import uuid
from threading import Event, Thread

import pytest

from sqlalchemy import delete, func, select

from app.database import SessionLocal
from app.blueprint_catalog import ObjectBlueprintCatalog
from app.blueprint_upgrade_analysis import BlueprintUpgradeAnalyzer
from app.errors import ModelError
from app.models import BlueprintEndpointSlot, BlueprintInstance, BlueprintInstanceSlot, Connection, ConnectionMember, ConnectionPoint, EntityMetadata, InterfacePhysicalBinding, NetworkInterface, NetworkInterfacePhysicalOwner
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.test_object_blueprints_e2e import client, create_blueprint, instantiate, slot


def analysis(object_id):
    response = client.get(f"/v1/topology/physical-objects/{object_id}/blueprint-upgrade-analysis")
    assert response.status_code == 200, response.text
    return response.json()


def next_version(blueprint_id, slots, links=(), body=None):
    response = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={"body": body or {"kind": "RECTANGLE", "width": 100, "height": 40}, "slots": slots, "internal_links": list(links)})
    assert response.status_code == 201, response.text
    return response.json()["version_ref"]["entity_id"]


def apply(object_id, target_version_id):
    return client.post(f"/v1/topology/physical-objects/{object_id}/blueprint-upgrade", json={"target_version_id": target_version_id})


def point_ids(instance):
    return {item["slot_key"]: uuid.UUID(item["connection_point_ref"]["entity_id"]) for item in instance["slots"]}


def erase_links(*points):
    with SessionLocal.begin() as session:
        ids = tuple(session.scalars(select(Connection.id).where(Connection.point_a_id.in_(points), Connection.point_b_id.in_(points))))
        session.execute(delete(ConnectionMember).where(ConnectionMember.connection_id.in_(ids)))
        session.execute(delete(Connection).where(Connection.id.in_(ids)))


def test_manual_instance_is_not_applicable_and_analysis_does_not_write():
    created = client.post("/v1/topology/physical-objects", json={"display_name": "manual", "initial_connection_point": {"display_name": "P"}}).json()
    object_id = created["physical_object"]["source_ref"]["entity_id"]
    with SessionLocal() as session:
        before = tuple(session.scalar(select(func.count()).select_from(model)) for model in (ConnectionPoint, Connection, BlueprintInstance, BlueprintInstanceSlot, NetworkInterface, EntityMetadata))
    assert analysis(object_id)["status"] == "NOT_APPLICABLE"
    with SessionLocal() as session:
        after = tuple(session.scalar(select(func.count()).select_from(model)) for model in (ConnectionPoint, Connection, BlueprintInstance, BlueprintInstanceSlot, NetworkInterface, EntityMetadata))
    assert after == before


def test_upgrade_analysis_reports_version_and_all_compatibility_and_blocker_codes():
    blueprint_id, v1 = create_blueprint([slot("A"), slot("B")], [{"from_slot_key": "A", "to_slot_key": "B"}])
    instance = instantiate(blueprint_id, v1, "old")
    object_id = instance["physical_object_ref"]["entity_id"]
    assert analysis(object_id)["status"] == "UP_TO_DATE"
    v2 = next_version(blueprint_id, [slot("A"), slot("B"), slot("C")], [{"from_slot_key": "A", "to_slot_key": "B"}, {"from_slot_key": "B", "to_slot_key": "C"}], {"kind": "RECTANGLE", "width": 120, "height": 40})
    document = analysis(object_id)
    assert document["status"] == "OUTDATED" and document["current_version_number"] == 1 and document["target_version_number"] == 2
    assert {item["code"] for item in document["compatible_changes"]} >= {"SLOT_PRESERVED", "SLOT_ADDED", "PRESENTATION_CHANGED", "INTERNAL_LINK_ADDED"}
    assert not document["blockers"]
    v3 = next_version(blueprint_id, [slot("A", "NETWORK_PORT"), slot("C")], [], {"kind": "RECTANGLE", "width": 120, "height": 40})
    document = analysis(object_id)
    assert document["target_version_ref"]["entity_id"] == v3
    assert {item["code"] for item in document["blockers"]} == {"SLOT_REMOVED", "SLOT_KIND_CHANGED", "INTERNAL_LINK_REMOVED"}


def test_network_port_owner_mismatch_is_model_inconsistency():
    blueprint_id, v1 = create_blueprint([slot("P", "NETWORK_PORT")])
    instance = instantiate(blueprint_id, v1, "port")
    object_id = instance["physical_object_ref"]["entity_id"]
    manual = client.post("/v1/topology/physical-objects", json={"display_name": "other", "initial_connection_point": {"display_name": "P"}}).json()
    with SessionLocal.begin() as session:
        mapping = session.scalar(select(BlueprintInstanceSlot).join(BlueprintInstance).where(BlueprintInstance.physical_object_id == object_id))
        owner = session.scalar(select(NetworkInterfacePhysicalOwner).where(NetworkInterfacePhysicalOwner.interface_id == mapping.network_interface_id))
        owner.physical_object_id = manual["physical_object"]["source_ref"]["entity_id"]
    document = analysis(object_id)
    assert document["status"] == "MODEL_INCONSISTENT" and document["blockers"] == [{"code": "INSTANCE_MAPPING_INCONSISTENT", "details": "NETWORK_PORT_OWNER_MISMATCH"}]
    v2 = next_version(blueprint_id, [slot("P", "NETWORK_PORT"), slot("Q")])
    assert apply(object_id, v2).status_code == 409


def test_added_internal_link_uses_canonical_runtime_evidence():
    blueprint_id, v1 = create_blueprint([slot("A"), slot("B")])
    instance = instantiate(blueprint_id, v1, "panel")
    object_id = instance["physical_object_ref"]["entity_id"]
    points = {item["slot_key"]: uuid.UUID(item["connection_point_ref"]["entity_id"]) for item in instance["slots"]}
    next_version(blueprint_id, [slot("A"), slot("B")], [{"from_slot_key": "A", "to_slot_key": "B"}])
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_connection(points["A"], points["B"], 1, [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
    document = analysis(object_id)
    assert {item["code"] for item in document["compatible_changes"]} >= {"INTERNAL_LINK_ALREADY_SATISFIED"}
    assert "INTERNAL_LINK_ADDED" not in {item["code"] for item in document["compatible_changes"]}
    with SessionLocal.begin() as session:
        connection = Connection(point_a_id=points["A"], point_b_id=points["B"], cardinality=1)
        session.add(connection)
        session.flush()
        session.add(ConnectionMember(connection_id=connection.id, index=1, point_a_member=1, point_b_member=1))
    document = analysis(object_id)
    assert {item["code"] for item in document["blockers"]} >= {"INTERNAL_LINK_RUNTIME_CONFLICT"}


def test_apply_upgrade_preserves_existing_identity_and_materializes_additions():
    blueprint_id, v1 = create_blueprint([slot("A"), slot("N", "NETWORK_PORT")], default_physical_object_class="switch")
    instance = instantiate(blueprint_id, v1, "old")
    object_id = instance["physical_object_ref"]["entity_id"]
    before = {item["slot_key"]: item for item in instance["slots"]}
    with SessionLocal.begin() as session:
        session.scalar(select(EntityMetadata).where(EntityMetadata.physical_object_id == uuid.UUID(object_id), EntityMetadata.key == "alias.display")).value = "custom object"
        session.scalar(select(EntityMetadata).where(EntityMetadata.physical_object_id == uuid.UUID(object_id), EntityMetadata.key == "class")).value = "custom class"
        session.scalar(select(EntityMetadata).where(EntityMetadata.connection_point_id == uuid.UUID(before["A"]["connection_point_ref"]["entity_id"]), EntityMetadata.key == "alias.display")).value = "custom A"
        session.scalar(select(EntityMetadata).where(EntityMetadata.network_interface_id == uuid.UUID(before["N"]["network_interface_ref"]["entity_id"]), EntityMetadata.key == "alias.display")).value = "custom N"
    v2 = next_version(blueprint_id, [slot("A"), slot("N", "NETWORK_PORT"), slot("C"), slot("P", "NETWORK_PORT")], [{"from_slot_key": "A", "to_slot_key": "C"}])
    reviewed = analysis(object_id)
    assert reviewed["target_version_ref"]["entity_id"] == v2 and not reviewed["blockers"]
    response = client.post(f"/v1/topology/physical-objects/{object_id}/blueprint-upgrade", json={"target_version_id": v2})
    assert response.status_code == 200, response.text
    after = {item["slot_key"]: item for item in response.json()["slots"]}
    assert response.json()["physical_object_ref"]["entity_id"] == object_id
    assert after["A"]["connection_point_ref"]["entity_id"] == before["A"]["connection_point_ref"]["entity_id"]
    assert after["N"]["network_interface_ref"]["entity_id"] == before["N"]["network_interface_ref"]["entity_id"]
    assert {"C", "P"} <= set(after)
    with SessionLocal() as session:
        upgraded = session.scalar(select(BlueprintInstance).where(BlueprintInstance.physical_object_id == object_id))
        assert str(upgraded.blueprint_version_id) == v2
        mappings = tuple(session.scalars(select(BlueprintInstanceSlot).where(BlueprintInstanceSlot.blueprint_instance_id == upgraded.id)))
        assert len(mappings) == 4
        target_slot_ids = set(session.scalars(select(BlueprintEndpointSlot.id).where(BlueprintEndpointSlot.blueprint_version_id == uuid.UUID(v2))))
        assert {mapping.blueprint_slot_id for mapping in mappings} == target_slot_ids
        added_port = next(mapping for mapping in mappings if mapping.connection_point_id == uuid.UUID(after["P"]["connection_point_ref"]["entity_id"]))
        assert added_port.network_interface_id == uuid.UUID(after["P"]["network_interface_ref"]["entity_id"])
        assert session.scalar(select(NetworkInterfacePhysicalOwner.id).where(NetworkInterfacePhysicalOwner.interface_id == added_port.network_interface_id, NetworkInterfacePhysicalOwner.physical_object_id == uuid.UUID(object_id))) is not None
        assert session.scalar(select(InterfacePhysicalBinding.id).where(InterfacePhysicalBinding.interface_id == added_port.network_interface_id, InterfacePhysicalBinding.point_id == added_port.connection_point_id)) is not None
        metadata = {(
            item.physical_object_id or item.connection_point_id or item.network_interface_id, item.key
        ): item.value for item in session.scalars(select(EntityMetadata))}
        assert metadata[(uuid.UUID(object_id), "alias.display")] == "custom object"
        assert metadata[(uuid.UUID(object_id), "class")] == "custom class"
        assert metadata[(uuid.UUID(before["A"]["connection_point_ref"]["entity_id"]), "alias.display")] == "custom A"
        assert metadata[(uuid.UUID(before["N"]["network_interface_ref"]["entity_id"]), "alias.display")] == "custom N"
        assert session.scalar(select(func.count()).select_from(Connection).where(
            Connection.point_a_id.in_([uuid.UUID(after["A"]["connection_point_ref"]["entity_id"]), uuid.UUID(after["C"]["connection_point_ref"]["entity_id"])]),
            Connection.point_b_id.in_([uuid.UUID(after["A"]["connection_point_ref"]["entity_id"]), uuid.UUID(after["C"]["connection_point_ref"]["entity_id"])]),
        )) == 1


def test_apply_requires_the_exact_reviewed_target_and_rolls_back_blockers():
    blueprint_id, v1 = create_blueprint([slot("A")])
    instance = instantiate(blueprint_id, v1, "old")
    object_id = instance["physical_object_ref"]["entity_id"]
    v2 = next_version(blueprint_id, [slot("A"), slot("B")])
    v3 = next_version(blueprint_id, [slot("A"), slot("B"), slot("C")])
    response = apply(object_id, v2)
    assert response.status_code == 409
    with SessionLocal() as session:
        upgraded = session.scalar(select(BlueprintInstance).where(BlueprintInstance.physical_object_id == object_id))
        assert str(upgraded.blueprint_version_id) == v1
        assert session.scalar(select(func.count()).select_from(BlueprintInstanceSlot).where(BlueprintInstanceSlot.blueprint_instance_id == upgraded.id)) == 1
    assert apply(object_id, v3).status_code == 200


def test_unchanged_blueprint_links_do_not_repair_or_block_runtime_topology():
    blueprint_id, v1 = create_blueprint([slot("A"), slot("B")], [{"from_slot_key": "A", "to_slot_key": "B"}])
    instance = instantiate(blueprint_id, v1, "panel")
    object_id, points = instance["physical_object_ref"]["entity_id"], point_ids(instance)
    v2 = next_version(blueprint_id, [slot("A"), slot("B"), slot("C")], [{"from_slot_key": "A", "to_slot_key": "B"}])
    erase_links(points["A"], points["B"])
    assert apply(object_id, v2).status_code == 200
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection).where(Connection.point_a_id.in_([points["A"], points["B"]]), Connection.point_b_id.in_([points["A"], points["B"]]))) == 0
    # A conflicting duplicate on the unchanged provenance link is equally irrelevant.
    instance = instantiate(blueprint_id, v1, "panel-2")
    other_id, other_points = instance["physical_object_ref"]["entity_id"], point_ids(instance)
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_connection(other_points["A"], other_points["B"], 1, [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
    assert apply(other_id, v2).status_code == 200


def test_new_internal_link_states_create_skip_or_rollback():
    blueprint_id, v1 = create_blueprint([slot("A"), slot("B")])
    instance = instantiate(blueprint_id, v1, "panel")
    object_id, points = instance["physical_object_ref"]["entity_id"], point_ids(instance)
    v2 = next_version(blueprint_id, [slot("A"), slot("B")], [{"from_slot_key": "A", "to_slot_key": "B"}])
    assert apply(object_id, v2).status_code == 200
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection).where(Connection.point_a_id.in_([points["A"], points["B"]]), Connection.point_b_id.in_([points["A"], points["B"]]))) == 1
    instance = instantiate(blueprint_id, v1, "panel-2")
    other_id, other_points = instance["physical_object_ref"]["entity_id"], point_ids(instance)
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_connection(other_points["A"], other_points["B"], 1, [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
    assert apply(other_id, v2).status_code == 200
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection).where(Connection.point_a_id.in_([other_points["A"], other_points["B"]]), Connection.point_b_id.in_([other_points["A"], other_points["B"]]))) == 1
    instance = instantiate(blueprint_id, v1, "panel-3")
    conflict_id, conflict_points = instance["physical_object_ref"]["entity_id"], point_ids(instance)
    with SessionLocal.begin() as session:
        for _ in range(2): CanonicalRepository(session).add_connection(conflict_points["A"], conflict_points["B"], 1, [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
    assert apply(conflict_id, v2).status_code == 409
    with SessionLocal() as session:
        assert str(session.scalar(select(BlueprintInstance).where(BlueprintInstance.physical_object_id == conflict_id)).blueprint_version_id) == v1


def test_apply_upgrade_serializes_new_internal_link_with_canonical_wiring(monkeypatch):
    blueprint_id, v1 = create_blueprint([slot("A"), slot("B")])
    instance = instantiate(blueprint_id, v1, "panel")
    object_id, points = instance["physical_object_ref"]["entity_id"], point_ids(instance)
    v2 = next_version(blueprint_id, [slot("A"), slot("B")], [{"from_slot_key": "A", "to_slot_key": "B"}])

    upgrade_at_state_check = Event()
    wiring_attempted = Event()
    original_state = BlueprintUpgradeAnalyzer._canonical_link_state
    state_checks = 0
    wiring_error: list[Exception] = []

    def pause_upgrade_state_check(self, point_a_id, point_b_id):
        nonlocal state_checks
        state_checks += 1
        if state_checks == 2:
            upgrade_at_state_check.set()
            assert wiring_attempted.wait(timeout=5)
        return original_state(self, point_a_id, point_b_id)

    def canonical_wiring():
        try:
            assert upgrade_at_state_check.wait(timeout=5)
            with SessionLocal.begin() as session:
                point_ids_in_order = tuple(sorted(points.values(), key=str))
                wiring_attempted.set()
                session.scalars(
                    select(ConnectionPoint)
                    .where(ConnectionPoint.id.in_(point_ids_in_order))
                    .order_by(ConnectionPoint.id)
                    .with_for_update()
                ).all()
                state = original_state(BlueprintUpgradeAnalyzer(session), points["A"], points["B"])
                if state != "MISSING":
                    raise ModelError("Canonical internal link is conflicting", {"reason": "INTERNAL_LINK_RUNTIME_CONFLICT"})
                CanonicalRepository(session).add_connection(
                    points["A"], points["B"], 1,
                    [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
                )
        except Exception as error:
            wiring_error.append(error)

    monkeypatch.setattr(BlueprintUpgradeAnalyzer, "_canonical_link_state", pause_upgrade_state_check)
    wiring = Thread(target=canonical_wiring)
    wiring.start()
    with SessionLocal.begin() as session:
        ObjectBlueprintCatalog(session).apply_upgrade(uuid.UUID(object_id), uuid.UUID(v2))
    wiring.join(timeout=5)
    assert not wiring.is_alive()
    assert len(wiring_error) == 1
    assert isinstance(wiring_error[0], ModelError)

    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection).where(
            Connection.point_a_id.in_(points.values()), Connection.point_b_id.in_(points.values())
        )) == 1
        assert str(session.scalar(select(BlueprintInstance).where(
            BlueprintInstance.physical_object_id == object_id
        )).blueprint_version_id) == v2


@pytest.mark.parametrize("initial,target,links", [
    ([slot("A"), slot("B")], [slot("A")], []),
    ([slot("A")], [slot("A", "NETWORK_PORT")], []),
    ([slot("A"), slot("B")], [slot("A"), slot("B")], []),
])
def test_l1s6a_blockers_prevent_apply(initial, target, links):
    blueprint_id, v1 = create_blueprint(initial, [{"from_slot_key": "A", "to_slot_key": "B"}] if len(initial) == 2 and links == [] and target == initial else [])
    instance = instantiate(blueprint_id, v1, "old")
    v2 = next_version(blueprint_id, target, links)
    response = apply(instance["physical_object_ref"]["entity_id"], v2)
    assert response.status_code == 409


def test_materialization_failure_rolls_back_all_added_slots(monkeypatch):
    blueprint_id, v1 = create_blueprint([slot("A")])
    instance = instantiate(blueprint_id, v1, "old")
    object_id = instance["physical_object_ref"]["entity_id"]
    v2 = next_version(blueprint_id, [slot("A"), slot("B"), slot("C")])
    original = CanonicalRepository.add_connection_point
    calls = 0
    def fail_on_second(self, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2: raise RuntimeError("injected materialization failure")
        return original(self, *args, **kwargs)
    monkeypatch.setattr(CanonicalRepository, "add_connection_point", fail_on_second)
    with pytest.raises(RuntimeError):
        apply(object_id, v2)
    with SessionLocal() as session:
        instance_row = session.scalar(select(BlueprintInstance).where(BlueprintInstance.physical_object_id == object_id))
        assert str(instance_row.blueprint_version_id) == v1
        assert session.scalar(select(func.count()).select_from(BlueprintInstanceSlot).where(BlueprintInstanceSlot.blueprint_instance_id == instance_row.id)) == 1
