import uuid

from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import BlueprintInstance, BlueprintInstanceSlot, Connection, ConnectionMember, ConnectionPoint, EntityMetadata, NetworkInterface, NetworkInterfacePhysicalOwner
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
        session.add(Connection(point_a_id=points["A"], point_b_id=points["B"], cardinality=1))
        session.flush()
        connection = session.scalar(select(Connection).where(Connection.point_a_id == points["A"], Connection.point_b_id == points["B"]).order_by(Connection.id.desc()))
        session.add(ConnectionMember(connection_id=connection.id, index=1, point_a_member=1, point_b_member=1))
    document = analysis(object_id)
    assert {item["code"] for item in document["blockers"]} >= {"INTERNAL_LINK_RUNTIME_CONFLICT"}


def test_apply_upgrade_preserves_existing_identity_and_materializes_additions():
    blueprint_id, v1 = create_blueprint([slot("A"), slot("N", "NETWORK_PORT")])
    instance = instantiate(blueprint_id, v1, "old")
    object_id = instance["physical_object_ref"]["entity_id"]
    before = {item["slot_key"]: item for item in instance["slots"]}
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
    response = client.post(f"/v1/topology/physical-objects/{object_id}/blueprint-upgrade", json={"target_version_id": v2})
    assert response.status_code == 409
    with SessionLocal() as session:
        upgraded = session.scalar(select(BlueprintInstance).where(BlueprintInstance.physical_object_id == object_id))
        assert str(upgraded.blueprint_version_id) == v1
        assert session.scalar(select(func.count()).select_from(BlueprintInstanceSlot).where(BlueprintInstanceSlot.blueprint_instance_id == upgraded.id)) == 1
    assert client.post(f"/v1/topology/physical-objects/{object_id}/blueprint-upgrade", json={"target_version_id": v3}).status_code == 200
