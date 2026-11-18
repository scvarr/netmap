"""Exercise the uniform-grid JSON contract through HTTP and PostgreSQL."""
from copy import deepcopy
import os
import uuid

import httpx
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.workspace_portability import reset_dataset
from tests.l1_builders import create_object_with_point


def test_object_sequences_roundtrip_and_membership_reconciliation():
    base_url = os.getenv("TEST_BASE_URL")
    with (httpx.Client(base_url=base_url) if base_url else TestClient(app)) as client:
        def send(method, path, payload, expected=200):
            response = client.request(method, path, json=payload)
            assert response.status_code == expected, response.text
            return response.json() if expected != 204 else None

        def create_location(name):
            return send("POST", "/v1/locations", {"name": name}, 201)["location_ref"]["entity_id"]

        def assign(key, parent):
            send("PUT", f"/v1/topology/physical-objects/{key}/location", {"location_id": parent})

        room, other = create_location("Rack"), create_location("Other rack")
        created = send("POST", "/v1/maps", {"name": "Equipment layout"}, 201)
        map_url = "/v1/maps/" + created["map_ref"]["entity_id"]
        variant = created["active_variant_ref"]["entity_id"]
        variants_url = map_url + "/presentation-variants"
        layout_url = f"{variants_url}/{variant}/automatic-layout"

        def place(key):
            send("POST", map_url + "/placements", {"physical_object_id": key, "x": 0, "y": 0}, 201)

        def layouts():
            response = client.get(map_url)
            assert response.status_code == 200, response.text
            return {v["variant_ref"]["entity_id"]: v["automatic_layout"] for v in response.json()["variants"]}

        a, b, c, unplaced = [create_object_with_point(client, name)[0] for name in ("A", "B", "C", "Unplaced")]
        for key in (a, b):
            assign(key, room)
        assign(unplaced, room)
        for key in (a, b, c):
            place(key)

        def seq(direction, *order):
            return {"direction": direction, "order": list(order)}

        old_grid = {"mode": "uniform_grid", "version": 1, "hide_empty": False, "tables": {"root": [[room, other]]}}
        send("PUT", layout_url, old_grid)
        assert layouts()[variant] == old_grid
        config = {**old_grid, "object_sequences": {room: seq("HORIZONTAL", b, a), "root": seq("VERTICAL", c)}}
        send("PUT", layout_url, config)
        assert layouts()[variant] == config
        for invalid in (seq("HORIZONTAL", a, a), seq("HORIZONTAL", c), seq("HORIZONTAL", unplaced),
                        seq("DIAGONAL", a), seq("HORIZONTAL", str(uuid.uuid4()))):
            send("PUT", layout_url, {**config, "object_sequences": {room: invalid}}, 422)
        assert layouts()[variant] == config

        copy = send("POST", variants_url, {"name": "Copy", "source_variant_id": variant}, 201)
        copied = copy["variant_ref"]["entity_id"]
        assert copy["automatic_layout"] == config
        different = {**config, "object_sequences": {**config["object_sequences"], room: seq("VERTICAL", a, b)}}
        send("PUT", f"{variants_url}/{copied}/automatic-layout", different)
        assert layouts() == {variant: config, copied: different}

        added = create_object_with_point(client, "Added")[0]
        assign(added, room)
        place(added)
        assert layouts()[variant]["object_sequences"][room] == seq("HORIZONTAL", b, a, added)
        assert layouts()[copied]["object_sequences"][room] == seq("VERTICAL", a, b, added)
        assign(b, other)
        for current in layouts().values():
            assert current["object_sequences"]["root"] == seq("VERTICAL", c)
            assert current["object_sequences"][other] == seq("VERTICAL", b)
            assert current["object_sequences"][room]["order"] == [a, added]
        assign(b, None)
        assert layouts()[variant]["object_sequences"]["root"] == seq("VERTICAL", c, b)
        send("DELETE", f"/v1/topology/physical-objects/{a}", None, 204)
        send("DELETE", map_url + f"/placements/{added}", None, 204)
        stored = layouts()
        assert stored[variant]["object_sequences"][room] == seq("HORIZONTAL")
        assert stored[copied]["object_sequences"][room] == seq("VERTICAL")
        assert all(a not in entry["order"] and added not in entry["order"]
                   for grid in stored.values() for entry in grid["object_sequences"].values())

        export = client.get("/v1/workspace/package")
        assert export.status_code == 200, export.text
        package = export.json()
        bad = deepcopy(package)
        row = next(v for v in bad["presentation"]["MapPresentationVariant"] if v["id"] == variant)
        row["automatic_layout"]["object_sequences"][room] = seq("HORIZONTAL", b)
        send("POST", "/v1/workspace/package", bad, 422)
        with SessionLocal.begin() as session:
            reset_dataset(session)
        send("POST", "/v1/workspace/package", package, 204)
        assert layouts() == stored
