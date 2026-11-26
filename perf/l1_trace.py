"""Reproduce the L1 trace acceptance workload in the isolated Compose test DB."""
import argparse
from collections import Counter
from contextlib import ExitStack, contextmanager
from functools import wraps
import hashlib
import json
import os
from pathlib import Path
from time import perf_counter
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.database import SessionLocal, engine
from app.interface_resolver import InterfacePhysicalResolver
from app.main import app
from app.module_geometry import initial_geometry
from app.physical_object_l1_resolver import PhysicalObjectL1Resolver
from app.repository import CanonicalRepository, ConnectionMemberInput
from app.resolver import L1Resolver
from tests.conftest import require_confirmed_test_database
from tests.port_type_fixtures import ensure_port_type_id
from tests.test_hardware_configuration import board_base_payload, create_base, install
from tests.test_passive_module_continuity import create_module, link, points

OBJECT = "/v1/traces/physical-objects/l1"
INTERFACE = "/v1/traces/interfaces/physical"


def seed(client, capacity):
    base = board_base_payload()
    base["bays"].append({**base["bays"][0], "bay_key": str(uuid.uuid4()), "display_name": "Cassette 2"})
    template, _ = create_base(base)
    names = ("IN-1", "OUT-1", "IN-2", "OUT-2")
    module = create_module({
        "name": f"Passive cassette {capacity}",
        "mount_kind": "MODULE_BAY",
        "module_bay_type_id": base["bays"][0]["module_bay_type_id"],
        "geometry": initial_geometry(names),
        "endpoints": [
            {"key": name, "display_name": name, "kind": "CONNECTION_POINT",
             "port_type_id": ensure_port_type_id(2 if name.endswith("1") else capacity)}
            for name in names
        ],
        "internal_links": [
            link("IN-1", "OUT-1", [(1, 2), (2, 1)]),
            link("IN-2", "OUT-2", [(i, i) for i in range(1, capacity - 1)]),
        ],
    })
    response = client.post("/v1/topology/physical-objects", json={
        "base_template_id": template, "display_name": f"TEST-ODF-02-{capacity}", "class": "server",
    })
    response.raise_for_status()
    object_id = response.json()["physical_object_ref"]["entity_id"]
    for bay in base["bays"]:
        installed = install(object_id, module["template_id"], bay["bay_key"])
        installed.raise_for_status()
    cassette = points(installed.json()["bays"][0]["installation"])

    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)

        def connect(a, b, mapping):
            repo.add_connection(a, b, len(mapping), [
                ConnectionMemberInput(i, left, right) for i, (left, right) in enumerate(mapping, 1)
            ])

        def new_point(owner, size):
            return repo.add_connection_point(owner.id, size).id

        # The first cassette has one external passive section at each Duplex end.
        for name in ("IN-1", "OUT-1"):
            passive, terminal = repo.add_physical_object(), repo.add_physical_object()
            entry, exit_ = new_point(passive, 2), new_point(passive, 2)
            ending = new_point(terminal, 2)
            connect(uuid.UUID(cassette[name]), entry, [(1, 1), (2, 2)])
            connect(entry, exit_, [(1, 1), (2, 2)])
            connect(exit_, ending, [(1, 1), (2, 2)])
            interface = repo.add_network_interface()
            for index in (1, 2):
                repo.add_interface_physical_binding(interface.id, ending, index)

        # Independent interface workload with multiple bindings and two realization paths.
        left_owner, panel, right_owner = [repo.add_physical_object() for _ in range(3)]
        left, rear = new_point(left_owner, capacity), new_point(panel, capacity)
        front, right = new_point(panel, capacity), new_point(right_owner, capacity)
        identity = [(i, i) for i in range(1, capacity + 1)]
        connect(left, rear, identity)
        connect(rear, front, [(i, capacity + 1 - i) for i in range(1, capacity - 1)])
        connect(front, right, identity)
        root, way_a, way_b, lower, destination = [repo.add_network_interface() for _ in range(5)]
        repo.add_network_interface_realization(root.id, way_a.id)
        repo.add_network_interface_realization(root.id, way_b.id)
        repo.add_network_interface_realization(way_a.id, lower.id)
        repo.add_network_interface_realization(way_b.id, lower.id)
        for index, _ in identity:
            repo.add_interface_physical_binding(lower.id, left, index)
            repo.add_interface_physical_binding(destination.id, right, index)
        source_id, target_id = str(root.id), str(destination.id)

    return {
        f"object-{capacity}": [OBJECT, {"from_physical_object_id": object_id, "to_physical_object_id": object_id}],
        f"interface-{capacity}": [INTERFACE, {"from_interface_id": source_id, "to_interface_id": target_id}],
    }


def seed_probes(client, cases):
    object_id = cases["object-12"][1]["from_physical_object_id"]
    config = client.get(f"/v1/topology/physical-objects/{object_id}/configuration")
    config.raise_for_status()
    first, second = [points(bay["installation"]) for bay in config.json()["bays"]]
    exact, group = "/v1/traces/l1", "/v1/traces/l1/group"

    def pair(a, i, b, j):
        return {"from": {"point_id": str(a), "member_index": i},
                "to": {"point_id": str(b), "member_index": j}}

    def object_pair(a, b):
        return {"from_physical_object_id": str(a), "to_physical_object_id": str(b)}

    def interface_pair(a, b):
        return {"from_interface_id": str(a), "to_interface_id": str(b)}

    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)

        def point(owner, size=1):
            return repo.add_connection_point(owner.id, size).id

        def connect(a, b):
            repo.add_connection(a, b, 1, [ConnectionMemberInput(1, 1, 1)])

        left, right, fault, spare, active_end = [repo.add_physical_object() for _ in range(5)]
        a, b = point(left), point(left)
        c, d = point(right), point(right)
        for start, end in ((a, b), (b, d), (d, c), (c, a)):
            connect(start, end)
        damaged, extra = point(fault, 2), point(spare)
        connect(damaged, extra)
        ending = point(active_end)
        connect(damaged, ending)  # two external links occupy fault member 1
        passive_owner = repo.add_physical_object()
        clean, transit, goal = point(passive_owner), point(active_end), point(active_end)
        connect(clean, transit)
        connect(transit, goal)
        clean_iface, active_iface, destination_iface, damaged_iface = [repo.add_network_interface() for _ in range(4)]
        for interface, endpoint in ((clean_iface, clean), (active_iface, transit),
                                    (destination_iface, goal), (damaged_iface, damaged)):
            repo.add_interface_physical_binding(interface.id, endpoint, 1)
        left_id, right_id, fault_id, spare_id = left.id, right.id, fault.id, spare.id
        clean_iface_id, destination_iface_id, damaged_iface_id = clean_iface.id, destination_iface.id, damaged_iface.id

    duplex_a = pair(first["IN-1"], 1, first["OUT-1"], 2)
    duplex_b = pair(first["IN-1"], 2, first["OUT-1"], 1)
    free = pair(first["IN-2"], 11, first["OUT-2"], 11)
    return {
        "duplex-subset": [group, {"expected_pairs": [duplex_b]}],
        "duplex-permutation": [group, {"expected_pairs": [duplex_b, duplex_a]}],
        "partial-continuity": [group, {"expected_pairs": [duplex_a, free]}],
        "distinct-installations": [exact, pair(first["IN-2"], 1, second["OUT-2"], 1)],
        "cycle-and-reverse-branches": [OBJECT, object_pair(left_id, right_id)],
        "cycle-termination": [exact, pair(a, 1, extra, 1)],
        "active-termination": [exact, pair(clean, 1, goal, 1)],
        "damaged-group": [group, {"expected_pairs": [duplex_a, pair(damaged, 1, extra, 1)]}],
        "damaged-object": [OBJECT, object_pair(fault_id, spare_id)],
        "damaged-interface": [INTERFACE, interface_pair(damaged_iface_id, destination_iface_id)],
        "interface-active-stops": [INTERFACE, interface_pair(clean_iface_id, destination_iface_id)],
    }


@contextmanager
def profile():
    counts, elapsed = Counter(), Counter()

    def before(*_):
        counts["sql"] += 1
        elapsed["sql_started"] = perf_counter()

    def after(*_):
        elapsed["sql"] += perf_counter() - elapsed["sql_started"]

    def timed(original, name):
        @wraps(original)
        def wrapped(*args, **kwargs):
            counts[name] += 1
            started = perf_counter()
            try:
                return original(*args, **kwargs)
            finally:
                elapsed[name] += perf_counter() - started
        return wrapped

    def timed_walk(original):
        @wraps(original)
        def wrapped(*args, **kwargs):
            visits = original(*args, **kwargs)
            while True:
                start = perf_counter()
                try:
                    address = next(visits)
                except StopIteration:
                    return
                finally:
                    elapsed["walks"] += perf_counter() - start
                yield address
        return wrapped

    with ExitStack() as stack:
        if hasattr(L1Resolver, "_walk"):
            stack.enter_context(patch.object(L1Resolver, "_walk", timed_walk(L1Resolver._walk)))
        for target, method, name in (
            (PhysicalObjectL1Resolver, "resolve", "resolver"),
            (InterfacePhysicalResolver, "resolve", "resolver"),
            (L1Resolver, "resolve", "exact_resolve"),
            (L1Resolver, "_traverse", "walks"),
            (CanonicalRepository, "get_l1_member_links", "single_member_reads"),
            (CanonicalRepository, "get_l1_member_links_batch", "batch_member_reads"),
            (CanonicalRepository, "get_l1_adjacency", "adjacency_reads"),
        ):
            if hasattr(target, method):
                stack.enter_context(patch.object(target, method, timed(getattr(target, method), name)))
        for event_name, listener in (("before_cursor_execute", before), ("after_cursor_execute", after)):
            event.listen(engine, event_name, listener)
            stack.callback(event.remove, engine, event_name, listener)
        yield counts, elapsed


def measure(client, path, query, server):
    with profile() as (counts, elapsed):
        start = perf_counter()
        response = client.post(path, json=query)
        app_ms = (perf_counter() - start) * 1000
    data = response.json()
    sample = {
        "status": response.status_code,
        "source_candidates": len(data.get("source_candidates", data.get("source_binding_candidates", []))),
        "target_candidates": len(data.get("target_candidates", data.get("target_binding_candidates", []))),
        "branches": len(data.get("branches", [])),
        "bytes": len(response.content),
        "counts": dict(counts),
        "ms": {name: round(sec * 1000, 2) for name, sec in elapsed.items() if name != "sql_started"},
        "app_ms": round(app_ms, 2),
    }
    if "resolver" in elapsed:
        member_io = elapsed["single_member_reads"] + elapsed["batch_member_reads"]
        sample["ms"]["member_read_total"] = round(member_io * 1000, 2)
        sample["ms"]["resolver_other"] = round((elapsed["resolver"] - member_io) * 1000, 2)
        sample["ms"]["http_app_overhead"] = round(app_ms - elapsed["resolver"] * 1000, 2)
    canonical_json = json.dumps(data, sort_keys=True, ensure_ascii=False).encode()
    sample["artifact_sha256"] = hashlib.sha256(canonical_json).hexdigest()
    if server:
        request = Request(server + path, json.dumps(query).encode(), {"Content-Type": "application/json"})
        start = perf_counter()
        try:
            result = urlopen(request, timeout=180)
        except HTTPError as error:
            result = error
        with result:
            result.read(1)
            sample["http_ttfb_ms"] = round((perf_counter() - start) * 1000, 2)
            result.read()
            sample["http_ms"] = round((perf_counter() - start) * 1000, 2)
    return sample, data


def main():
    require_confirmed_test_database()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", required=True, type=Path)
    seed_options = parser.add_mutually_exclusive_group()
    seed_options.add_argument("--seed", action="store_true")
    seed_options.add_argument("--seed-probes-from", type=Path)
    parser.add_argument("--server", default=os.environ.get("TEST_BASE_URL"))
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    with TestClient(app) as client:
        if args.seed:
            cases = seed(client, 12) | seed(client, 24)
        elif args.seed_probes_from:
            cases = seed_probes(client, json.loads(args.seed_probes_from.read_text()))
        else:
            cases = json.loads(args.cases.read_text())
        if args.seed or args.seed_probes_from:
            args.cases.write_text(json.dumps(cases, indent=2))
        report = {}
        for name, (path, query) in cases.items():
            metrics, artifact = measure(client, path, query, args.server)
            report[name] = {"metrics": metrics, "artifact": artifact}
            print(json.dumps({name: metrics}), flush=True)
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
