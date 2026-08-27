import uuid

from sqlalchemy import select

from app.database import SessionLocal
from app.models import BlueprintInstance, BlueprintInstanceSlot
from tests.test_object_blueprints_e2e import client, create_blueprint, create_port_block, instantiate, slot


def test_additive_composed_upgrade_preserves_canonical_identity_for_shared_instance_local_ids():
    block_id, v1_block_version = create_port_block([slot("p1"), slot("p2", "NETWORK_PORT")], "Upgradeable")
    blueprint_id, v1 = create_blueprint([slot("p1"), slot("p2", "NETWORK_PORT")], instance_key="K", port_block=(block_id, v1_block_version), name="Upgradeable blueprint")
    v2_ports = [{**item, "column": index + 1, "layout_order": index + 1} for index, item in enumerate([slot("p1"), slot("p2", "NETWORK_PORT"), slot("p3")])]
    created_block_version = client.post(f"/v1/library/port-blocks/{block_id}/versions", json={"ports": v2_ports})
    assert created_block_version.status_code == 201, created_block_version.text
    v2_block_version = created_block_version.json()["version_ref"]["entity_id"]
    v2 = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={"body": {"kind": "RECTANGLE", "width": 100, "height": 40}, "composition": {"instances": [{"instance_key": "K", "port_block_version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": v2_block_version}, "face": "FRONT"}]}, "internal_links": []})
    assert v2.status_code == 201, v2.text
    v2_id = v2.json()["version_ref"]["entity_id"]
    instance = instantiate(blueprint_id, v1, "upgradable object")
    object_id = instance["physical_object_ref"]["entity_id"]
    before = {item["slot_key"]: (item["connection_point_ref"]["entity_id"], item.get("network_interface_ref", {}).get("entity_id")) for item in instance["slots"]}
    analysis = client.get(f"/v1/topology/physical-objects/{object_id}/blueprint-upgrade-analysis")
    assert analysis.status_code == 200 and analysis.json()["status"] == "OUTDATED"
    upgraded = client.post(f"/v1/topology/physical-objects/{object_id}/blueprint-upgrade", json={"target_version_id": v2_id})
    assert upgraded.status_code == 200, upgraded.text
    after = {item["slot_key"]: (item["connection_point_ref"]["entity_id"], item.get("network_interface_ref", {}).get("entity_id")) for item in upgraded.json()["slots"]}
    assert set(before).issubset(after)
    for key in before:
        assert after[key] == before[key]
    assert len(after) == 3
    with SessionLocal() as session:
        provenance = session.scalar(select(BlueprintInstance).where(BlueprintInstance.physical_object_id == uuid.UUID(object_id)))
        mappings = tuple(session.scalars(select(BlueprintInstanceSlot).where(BlueprintInstanceSlot.blueprint_instance_id == provenance.id)))
    assert str(provenance.blueprint_version_id) == v2_id and len(mappings) == 3
