import copy

import pytest

from tests.test_workspace_portability import client, isolated_workspace, snapshot


pytestmark = pytest.mark.no_database
URL = "/v1/port-types"


@pytest.mark.parametrize("fields", [
    {"name": " \t\u00a0"},
    {"color": "#123"},
    {"color": "#XYZ123"},
    {"is_active": "false"},
])
def test_invalid_port_type(fields):
    assert client.post(URL, json={"name": "SFP+", "color": "#123456", **fields}).status_code == 422
    assert client.get(URL).json() == []


def test_port_type_lifecycle_and_normalized_name_conflicts():
    response = client.post(URL, json={"name": "  Оптика\t  SFP+ ", "color": " #a0b1c2 "})
    assert response.status_code == 201, response.text
    item = response.json()
    assert item == {"id": item["id"], "name": "Оптика SFP+", "color": "#A0B1C2",
                    "description": None, "is_active": True}
    url = f"{URL}/{item['id']}"
    assert client.delete(url).status_code == 409
    edited = {"name": "Оптика SFP+", "description": "Модуль", "color": "#223344", "is_active": False}
    assert client.put(url, json=edited).json() == {"id": item["id"], **edited}
    assert client.get(url).json() == {"id": item["id"], **edited}
    assert client.get(URL).json() == [{"id": item["id"], **edited}]
    assert client.post(URL, json={"name": "оптика  sfp+", "color": "#334455"}).status_code == 409
    other = client.post(URL, json={"name": "Other", "color": "#334455"}).json()
    assert client.put(f"{URL}/{other['id']}", json=edited).status_code == 409
    assert client.delete(url).status_code == 204
    assert client.get(url).status_code == 404


def test_port_type_workspace_round_trip_and_invalid_import():
    active = client.post(URL, json={"name": "Copper", "color": "#123abc"}).json()
    archived = client.post(URL, json={"name": "Optical", "color": "#abcdef",
                                      "description": "SFP+", "is_active": False}).json()
    before = snapshot()
    assert before["format_version"] == 6
    assert {item["id"]: item for item in before["settings"]["PortType"]} == {
        active["id"]: active, archived["id"]: archived,
    }
    assert client.post("/v1/workspace/package", json=before).status_code == 409
    assert client.delete("/v1/workspace/dataset").status_code == 204
    assert client.get(URL).json() == []
    corrupt = copy.deepcopy(before)
    corrupt["settings"]["PortType"][0]["color"] = "red"
    assert client.post("/v1/workspace/package", json=corrupt).status_code == 422
    assert client.get(URL).json() == []
    response = client.post("/v1/workspace/package", json=before)
    assert response.status_code == 204, response.text
    assert snapshot() == before
