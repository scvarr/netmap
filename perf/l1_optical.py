"""Compare L1 trace cost on one isolated PostgreSQL snapshot before and after 01B."""
import argparse
import json
from pathlib import Path
from statistics import median
from uuid import UUID

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import Cable
from app.repository import CanonicalRepository, ConnectionMemberInput
from perf.l1_trace import INTERFACE, OBJECT, measure
from tests.conftest import require_confirmed_test_database
from tests.test_hardware_configuration import board_base_payload, create_base, create_object, install
from tests.test_passive_module_continuity import create_module, module_definition, points


def seed(client, capacity):
    pairs = [(i, capacity + 1 - i) for i in range(1, capacity + 1)]
    port = client.post("/v1/port-types", json={
        "name": f"Optical benchmark {capacity}", "medium": "FIBER", "color": "#336699",
        "members": [str(i) for i, _ in pairs], "compatibility_mode": "SAME_TYPE",
    })
    port.raise_for_status()
    payload = module_definition(pairs, capacity=capacity)
    for endpoint in payload["endpoints"]:
        endpoint["port_type_id"] = port.json()["id"]
    modes = ("SM", "MM", "NO_FIBER", None)
    for mapping, (index, _) in zip(payload["internal_links"][0]["member_mappings"], pairs, strict=True):
        if (mode := modes[index % len(modes)]) is not None:
            mapping["fiber_type"] = mode
    module = create_module(payload)
    host, definition = create_base(board_base_payload())
    panel = create_object(host)["physical_object_ref"]["entity_id"]
    installed = install(panel, module["template_id"], definition["bays"][0]["bay_key"])
    installed.raise_for_status()
    passive = points(installed.json()["bays"][0]["installation"])
    left_panel, right_panel = (UUID(passive[key]) for key in ("rear", "front"))

    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        source, target = [repo.add_physical_object() for _ in range(2)]
        left = repo.add_connection_point(source.id, capacity)
        right = repo.add_connection_point(target.id, capacity)
        a, b = [repo.add_network_interface() for _ in range(2)]
        for i, j in pairs:
            for point_a, point_b, member, mode in (
                (left.id, left_panel, i, "SM"),
                (right_panel, right.id, j, "SM" if i % 3 else "MM"),
            ):
                connection, _ = repo.add_connection(point_a, point_b, 1, [ConnectionMemberInput(1, member, member)])
                session.add(Cable(connection_id=connection.id, fiber_type=mode))
            repo.add_interface_physical_binding(a.id, left.id, i)
            repo.add_interface_physical_binding(b.id, right.id, j)

        expected = [
            {"from": {"point_id": str(left.id), "member_index": i},
             "to": {"point_id": str(right.id), "member_index": j}}
            for i, j in pairs
        ]
        return {
            f"exact-{capacity}": ["/v1/traces/l1", expected[0]],
            f"group-{capacity}": ["/v1/traces/l1/group", {"expected_pairs": expected}],
            f"object-{capacity}": [OBJECT, {"from_physical_object_id": str(source.id), "to_physical_object_id": str(target.id)}],
            f"interface-{capacity}": [INTERFACE, {"from_interface_id": str(a.id), "to_interface_id": str(b.id)}],
        }


def main():
    require_confirmed_test_database()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repetitions", type=int, default=7)
    args = parser.parse_args()
    with TestClient(app) as client:
        if args.seed:
            cases = seed(client, 12) | seed(client, 48)
            args.cases.write_text(json.dumps(cases), encoding="utf-8")
        else:
            cases = json.loads(args.cases.read_text(encoding="utf-8"))
        report = {}
        for name, (path, query) in cases.items():
            measure(client, path, query, "http://127.0.0.1:8000")
            samples = []
            for _ in range(args.repetitions):
                sample, artifact = measure(client, path, query, "http://127.0.0.1:8000")
                if sample["status"] != 200:
                    raise RuntimeError(artifact)
                samples.append(sample)
            metrics = {key: median(sample[key] for sample in samples)
                       for key in ("app_ms", "http_ttfb_ms", "http_ms", "bytes")}
            metrics.update(walks=median(sample["counts"].get("walks", 0) for sample in samples),
                           sql=median(sample["counts"]["sql"] for sample in samples))
            report[name] = {"metrics": metrics, "artifact": artifact}
            print(name, metrics, flush=True)
        args.output.write_text(json.dumps(report), encoding="utf-8")


if __name__ == "__main__":
    main()
