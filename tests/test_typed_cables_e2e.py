import copy
import uuid

import pytest

from app.database import SessionLocal
from app.device_catalog import DeviceCatalog
from app.repository import CanonicalRepository
from tests.l1_builders import create_object_with_point, point_endpoint, post_confirmed_physical
from tests.test_workspace_portability import client, isolated_workspace, snapshot


pytestmark = pytest.mark.no_database
CREATE = "/v1/topology/physical-connections"
PACKAGE = "/v1/workspace/package"


def catalog_item(path, **fields):
    response = client.post(f"/v1/{path}", json={"color": "#385890", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_requires_active_type_before_single_or_bulk_writes():
    _, a = create_object_with_point(client, "A")
    _, b = create_object_with_point(client, "B")
    pair = {"source": point_endpoint(a), "target": point_endpoint(b)}
    cable_type = catalog_item("cable-types", name="Twisted pair", medium="COPPER",
                              construction="TWISTED_PAIR", is_active=False)
    type_url = f"/v1/cable-types/{cable_type['id']}"
    before = snapshot()
    for fields in ({}, {"cable_type_id": str(uuid.uuid4())}, {"cable_type_id": cable_type["id"]}):
        assert client.post(CREATE, json={**pair, **fields}).status_code == 422
        assert client.post(f"{CREATE}/bulk", json={"pairs": [pair], **fields}).status_code == 422
        assert snapshot() == before

    assert client.delete(type_url).status_code == 204
    before = snapshot()
    assert client.post(CREATE, json={**pair, "cable_type_id": cable_type["id"]}).status_code == 422
    assert snapshot() == before

    copper = catalog_item("cable-types", name="Copper", medium="COPPER", construction="TWISTED_PAIR")
    archived_plug = catalog_item("connector-types", name="RJ45", mating_profile="RJ45",
                                 termination="PLUG", is_active=False)
    before = snapshot()
    assert client.post(CREATE, json={
        **pair, "cable_type_id": copper["id"], "connector_b_type_id": archived_plug["id"],
    }).status_code == 422
    assert snapshot() == before
    response = post_confirmed_physical(client, CREATE, json={**pair, "cable_type_id": copper["id"]})
    assert response.status_code == 201, response.text
    graph = snapshot()["canonical"]
    cable, = graph["Cable"]
    connection, = graph["Connection"]
    member, = graph["ConnectionMember"]
    assert cable["cable_type_id"] == copper["id"]
    assert connection["cardinality"] == member["point_a_member"] == member["point_b_member"] == 1


def test_independent_fibers_keep_ids_types_and_history_after_reconnect_and_import():
    fiber = catalog_item("cable-types", name="Single mode", medium="FIBER", construction="SINGLE_MODE")
    plug = catalog_item("connector-types", name="LC", mating_profile="LC", termination="PLUG")
    with SessionLocal.begin() as session:
        device_catalog = DeviceCatalog(session)
        repo = CanonicalRepository(session)
        left = device_catalog.create_physical_object("ODF left", "A1", None)
        right = device_catalog.create_physical_object("ODF right", "B1", None)
        a = [left.connection_point_id, repo.add_connection_point(left.physical_object_id, 1).id]
        b = [right.connection_point_id, *(repo.add_connection_point(right.physical_object_id, 1).id for _ in range(2))]

    ids = []
    for index in range(2):
        response = post_confirmed_physical(client, CREATE, json={
            "source": point_endpoint(str(a[index])), "target": point_endpoint(str(b[index])),
            "cable_type_id": fiber["id"], "connector_a_type_id": plug["id"],
            "cable_label": f"CAB01/{index + 1}/24",
        })
        assert response.status_code == 201, response.text
        ids.append(response.json()["cable_ref"]["entity_id"])

    package = snapshot()
    graph = package["canonical"]
    assert len(set(ids)) == len(graph["Cable"]) == len(graph["Connection"]) == len(graph["ConnectionMember"]) == 2
    assert all(member["point_a_member"] == member["point_b_member"] == 1 for member in graph["ConnectionMember"])
    assert {c["label"] for c in graph["Cable"]} == {"CAB01/1/24", "CAB01/2/24"}
    assert {(c["cable_type_id"], c["connector_a_type_id"], c["connector_b_type_id"]) for c in graph["Cable"]} == {
        (fiber["id"], plug["id"], None)
    }

    for path, item, update in [
        ("cable-types", fiber, {"construction": "MULTI_MODE"}),
        ("connector-types", plug, {"mating_profile": "SC"}),
    ]:
        url = f"/v1/{path}/{item['id']}"
        payload = {key: value for key, value in item.items() if key != "id"}
        assert client.put(url, json={**payload, **update}).status_code == 409
        assert client.put(url, json={**payload, "is_active": False}).status_code == 200
        assert client.delete(url).status_code == 409

    cable_url = f"/v1/cables/{ids[0]}"
    assert client.put(f"{cable_url}/label", json={"label": "CAB01/Renamed/24"}).status_code == 204
    renamed = snapshot()
    assert renamed["canonical"]["Connection"] == graph["Connection"]
    assert renamed["canonical"]["ConnectionMember"] == graph["ConnectionMember"]
    reconnect_url = f"{cable_url}/reconnect"
    expected = client.get(reconnect_url).json()["expected"]
    assert post_confirmed_physical(client, reconnect_url, json={"expected": expected, "side": "B", "new_point_id": str(b[2])}).status_code == 204
    reloaded = snapshot()
    assert reloaded["canonical"]["Cable"] == renamed["canonical"]["Cable"]
    assert reloaded["canonical"]["ConnectionMember"] == graph["ConnectionMember"]
    assert client.get(reconnect_url).json()["expected"] == {**expected, "point_b_id": str(b[2])}

    assert client.delete("/v1/workspace/dataset").status_code == 204
    empty = snapshot()
    for field in ("cable_type_id", "connector_b_type_id"):
        bad = copy.deepcopy(reloaded)
        del bad["canonical"]["Cable"][0][field]
        assert client.post(PACKAGE, json=bad).status_code == 422
        assert snapshot() == empty
    bad = copy.deepcopy(reloaded)
    bad["canonical"]["Cable"][0]["cable_type_id"] = str(uuid.uuid4())
    assert client.post(PACKAGE, json=bad).status_code == 422
    bad = copy.deepcopy(reloaded)
    bad["canonical"]["Connection"][0]["cardinality"] = 2
    assert client.post(PACKAGE, json=bad).status_code == 422
    assert client.post(PACKAGE, json={**reloaded, "format_version": 9}).status_code == 422
    assert snapshot() == empty
    response = client.post(PACKAGE, json=reloaded)
    assert response.status_code == 204, response.text
    assert snapshot() == reloaded
    assert client.delete(f"{CREATE}/{expected['connection_id']}").status_code == 204
    after = snapshot()
    assert [c["id"] for c in after["canonical"]["Cable"]] == [ids[1]]
    assert any(record["label"] == "CAB01/Renamed/24" and record["released_at"]
               for record in after["settings"]["CableLabelHistory"])
