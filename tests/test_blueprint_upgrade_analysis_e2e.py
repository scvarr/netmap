from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import BlueprintInstance, BlueprintInstanceSlot, Connection, ConnectionPoint, EntityMetadata, NetworkInterface
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
