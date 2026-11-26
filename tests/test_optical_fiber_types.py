import copy
import uuid

import pytest

from tests.l1_builders import create_object_with_point, point_endpoint, post_confirmed_physical
from tests.test_hardware_configuration import board_base_payload, client, create_base, create_object, install
from tests.test_module_reconciliation import package
from tests.test_multichannel_definitions import payload as base_payload
from tests.test_passive_module_continuity import create_module, module_definition, points, trace


@pytest.mark.parametrize("kind", ["base", "module"])
def test_optical_revision_updates_only_selected_connected_instances(kind):
    variant = base_payload(4, fanout=False) if kind == "base" else module_definition([(1, 3), (2, 2), (3, 1)])
    endpoints = variant["slots" if kind == "base" else "endpoints"]
    before = package()
    mappings = variant["internal_links"][0]["member_mappings"]
    for mapping, fiber in zip(mappings, ["MM", "NO_FIBER", None], strict=True):
        if fiber is not None:
            mapping["fiber_type"] = fiber
    root = f"/v1/library/{kind}-templates"
    rejected = client.post(root, json=variant)
    assert rejected.status_code == 422 and "INTERNAL_FIBER_ON_COPPER" in rejected.text
    assert package() == before

    port_type = client.post("/v1/port-types", json={
        "name": "Optical multi-channel", "medium": "FIBER", "color": "#336699",
        "members": [str(index) for index in range(1, 5 if kind == "base" else 4)],
        "compatibility_mode": "SAME_TYPE",
    })
    assert port_type.status_code == 201, port_type.text
    for endpoint in endpoints:
        endpoint["port_type_id"] = port_type.json()["id"]
    if kind == "base":
        template, _ = create_base(variant)
        host = template
        instance_table, pin, param = "ObjectConfiguration", "base_revision_id", "object_ids"
    else:
        module = create_module(variant)
        template = module["template_id"]
        host, host_definition = create_base(board_base_payload())
        instance_table, pin, param = "ModuleInstallation", "module_revision_id", "installation_ids"
    root += f"/{template}"
    draft = client.get(root + "/draft").json()
    source_revision = draft["source_revision_id"]
    assert draft["definition"]["internal_links"][0]["member_mappings"][0]["fiber_type"] in ("MM", "NO_FIBER")

    selected = []
    traces = []
    for index in range(3):
        obj = create_object(host)
        owner = obj["physical_object_ref"]["entity_id"]
        if kind == "base":
            addresses = {slot["slot_key"]: slot["connection_point_ref"]["entity_id"] for slot in obj["slots"]}
            left, right = (addresses[variant["internal_links"][0][key]] for key in ("from_slot_key", "to_slot_key"))
            identifier = owner
        else:
            installed = install(owner, template, host_definition["bays"][0]["bay_key"])
            assert installed.status_code == 201, installed.text
            installation = installed.json()["bays"][0]["installation"]
            addresses = points(installation)
            left, right = addresses["rear"], addresses["front"]
            identifier = installation["id"]
        if index < 2:
            selected.append(identifier)
        _, peer = create_object_with_point(client, f"Peer {index}")
        first = mappings[0]
        cable = post_confirmed_physical(client, "/v1/topology/physical-connections", json={
            "source": {**point_endpoint(right), "member_index": first["to_member_index"]},
            "target": {**point_endpoint(peer), "member_index": 1}, "fiber_type": "MM",
        })
        assert cable.status_code == 201, cable.text
        traces.append((left, first["from_member_index"], peer, 1))

    definition = copy.deepcopy(draft["definition"])
    authored = definition["internal_links"][0]["member_mappings"]
    mm = next(item for item in authored if item.get("fiber_type") == "MM")
    mm["fiber_type"] = "INVALID"
    generation = {"expected_generation": draft["generation"]}
    snapshot = package()
    assert client.put(root + "/draft", params=generation, json=definition).status_code == 422
    assert package() == snapshot
    mm["fiber_type"] = "SM"
    saved = client.put(root + "/draft", params=generation, json=definition)
    assert saved.status_code == 200, saved.text
    restored = client.post(root + "/draft/restore-source", params={"expected_generation": saved.json()["generation"]})
    assert restored.status_code == 200, restored.text
    assert restored.json()["definition"] == draft["definition"]
    saved = client.put(root + "/draft", params={"expected_generation": restored.json()["generation"]}, json=definition)
    checked = client.post(root + "/draft/check", params={"expected_generation": saved.json()["generation"]})
    assert checked.status_code == 200, checked.text
    review = checked.json()["review"]
    assert [(change["section"], change["key"]) for change in review["result"]["changes"]] == [("properties", "fiber_types")]
    publish = client.post(root + f"/candidates/{review['candidate_id']}/publish")
    assert publish.status_code == 200, publish.text
    updated_revision = publish.json()["revision_id"]
    published = package()
    assert published["canonical"] == snapshot["canonical"]
    assert published["authoring"][instance_table] == snapshot["authoring"][instance_table]
    assert client.post(root + "/reconcile", params=[(param, str(uuid.uuid4()))]).status_code == 422
    assert package() == published
    applied = client.post(root + "/reconcile", params=[(param, value) for value in selected])
    assert applied.status_code == 200, applied.text
    outcomes = applied.json()["objects" if kind == "base" else "installations"]
    assert len(outcomes) == 2 and {outcome["status"] for outcome in outcomes} == {"updated"}
    after = package()
    assert after["canonical"] == snapshot["canonical"]
    old_instances = {row["id"]: row for row in snapshot["authoring"][instance_table]}
    changed = 0
    for row in after["authoring"][instance_table]:
        old = old_instances.pop(row["id"])
        assert {**row, pin: old[pin]} == old
        if row[pin] == updated_revision:
            changed += 1
        else:
            assert row[pin] == source_revision
    assert changed == 2 and not old_instances

    for args in traces:
        assert trace(*args)["verdict"] == "REACHABLE"
    assert client.delete("/v1/workspace/dataset").status_code == 204
    restored = client.post("/v1/workspace/package", json=after)
    assert restored.status_code == 204, restored.text
    assert package() == after


def test_bulk_fiber_assignment_and_cable_edit_preserve_identity():
    from tests.test_bulk_physical_connections_e2e import URL, points as external_points, request

    body = request(external_points("source", 3), external_points("target", 3))
    body["pairs"][0]["fiber_type"] = "SM"
    body["pairs"][1]["fiber_type"] = "NO_FIBER"
    before = package()
    assert client.post(URL, json=body).status_code == 422
    assert package() == before
    body["pairs"][1]["fiber_type"] = "MM"
    created = post_confirmed_physical(client, URL, json=body)
    assert created.status_code == 201, created.text
    urls = [f"/v1/cables/{row['cable_id']}/fiber-type" for row in created.json()["created"]]
    assert [client.get(url).json()["fiber_type"] for url in urls] == ["SM", "MM", None]
    before = package()["canonical"]
    assert client.put(urls[1], json={"fiber_type": "OM4"}).status_code == 422
    assert package()["canonical"] == before
    assert client.put(urls[1], json={"fiber_type": "SM"}).status_code == 204
    cables = {row["id"]: row for row in before["Cable"]}
    cables[created.json()["created"][1]["cable_id"]]["fiber_type"] = "SM"
    assert package()["canonical"] == before
