import copy
import uuid

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import BaseInternalLink, ModuleTemplateRevision, ObjectConfiguration
from tests.test_hardware_configuration import client
from tests.test_module_reconciliation import package
from tests.test_optical_diagnostics import exact, panel, point, trace
from tests.test_physical_compatibility_e2e import port, typed_points
from tests.test_transceiver_binding import point_end


@pytest.mark.parametrize("mode", ["SM", "MM"])
def test_cable_with_optical_metadata_between_copper_endings_is_unknown(mode):
    copper = port("Copper passive termination", "COPPER", "SAME_TYPE")
    _, (left,) = typed_points("Copper A", copper)
    _, (right,) = typed_points("Copper B", copper)
    body = {"source": point_end(left), "target": point_end(right), "fiber_type": mode}
    url = "/v1/topology/physical-connections"
    before = package()
    preview = client.post(url, params={"preview": True}, json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()["verdict"] == "ALLOW"
    assert package() == before
    created = client.post(url, json=body)
    assert created.status_code == 201, created.text
    cable_id = created.json()["cable_ref"]["entity_id"]

    snapshot = package()
    result = trace(exact(point(left), point(right)))
    assert result["verdict"] == "REACHABLE"
    diagnostics = [preview.json()["pairs"][0]["optical_diagnostic"], result["optical_diagnostics"][0]]
    for diagnostic in diagnostics:
        assert diagnostic["status"] == "UNKNOWN"
        assert diagnostic["conflicts"] == []
        cable, = diagnostic["facts"]
        assert cable["value"] == mode
        assert cable["unknown_reason"] == "CABLE_ENDING_MEDIUM_MISMATCH"
        assert cable["points"] == [point(left), point(right)]
        assert [item["side"] for item in cable["ending_media"]] == ["A", "B"]
        assert all(item["medium"] == "COPPER" and item["port_type_id"] == copper
                   for item in cable["ending_media"])
    assert diagnostics[1]["facts"][0]["trace_edge_id"] == result["edges"][0]["id"]
    assert {"entity_id": cable_id, "entity_type": "Cable", "ref_type": "CANONICAL_FACT"} in (
        diagnostics[1]["facts"][0]["canonical_refs"]
    )
    assert client.get(f"/v1/cables/{cable_id}/fiber-type").json() == {"fiber_type": mode}
    assert package() == snapshot


def mapped_panel(kind):
    pairs = [(1, 3), (2, 2), (3, 1)]
    if kind == "module":
        return panel(3, pairs, ["MM", "SM", None])
    fiber = client.post("/v1/port-types", json={
        "name": "Base optical", "medium": "FIBER", "color": "#336699",
        "members": ["1", "2", "3"], "compatibility_mode": "SAME_TYPE",
    }).json()["id"]
    mappings = [{"from_member_index": a, "to_member_index": b} for a, b in pairs]
    mappings[0]["fiber_type"] = "MM"
    mappings[1]["fiber_type"] = "SM"
    owner, (a, b) = typed_points("Base with permutation", fiber, fiber, cardinality=3, internal_links=[
        {"from_slot_key": "p1", "to_slot_key": "p2", "member_mappings": mappings},
    ])
    with SessionLocal() as session:
        revision = session.scalar(select(ObjectConfiguration.base_revision_id).where(
            ObjectConfiguration.physical_object_id == uuid.UUID(owner),
        ))
    return a, b, str(revision)


@pytest.mark.parametrize("kind", ["base", "module"])
@pytest.mark.parametrize("damage,expected_reason", [
    ("bad_list", "INVALID_MEMBER_MAPPINGS"),
    ("bad_member", "INVALID_MEMBER_MAPPINGS"),
    ("bad_fiber", "INVALID_MEMBER_FIBER_TYPE"),
    ("duplicate", "AMBIGUOUS_MEMBER_MAPPING"),
])
def test_damaged_pinned_member_mappings_are_reported_on_affected_channels(kind, damage, expected_reason):
    a, b, revision = mapped_panel(kind)
    queries = [exact(point(a, i), point(b, 4 - i)) for i in (1, 2, 3)]
    # Observe canonical evidence before corrupting optical metadata only.
    before = [trace(query) for query in queries]
    with SessionLocal.begin() as session:
        if kind == "base":
            link = session.scalar(select(BaseInternalLink).where(BaseInternalLink.base_revision_id == uuid.UUID(revision)))
            mappings = copy.deepcopy(link.member_mappings)
        else:
            module = session.get(ModuleTemplateRevision, uuid.UUID(revision))
            links = copy.deepcopy(module.internal_links)
            mappings = links[0]["member_mappings"]
        damaged = next(mapping for mapping in mappings if mapping.get("fiber_type") == "MM")
        if damage == "bad_list":
            mappings = {"unexpected": mappings}
        elif damage == "bad_member":
            del damaged["to_member_index"]
        elif damage == "bad_fiber":
            damaged["fiber_type"] = ["MM"]
        elif kind == "base":
            mappings.append({**damaged, "fiber_type": "SM"})
        else:
            links.append({"from_endpoint_key": links[0]["to_endpoint_key"],
                          "to_endpoint_key": links[0]["from_endpoint_key"],
                          "member_mappings": [{"from_member_index": damaged["to_member_index"],
                                               "to_member_index": damaged["from_member_index"], "fiber_type": "SM"}]})
        if kind == "base":
            link.member_mappings = mappings
        else:
            links[0]["member_mappings"] = mappings
            module.internal_links = links

    response = client.post("/v1/traces/l1/group", json={"expected_pairs": queries})
    assert response.status_code == 200, response.text
    grouped = response.json()
    assert grouped["completeness"] == "COMPLETE"
    for index, (previous, current) in enumerate(zip(before, grouped["results"], strict=True)):
        for key in ("verdict", "edges", "nodes", "evidence_refs", "terminations"):
            assert current[key] == previous[key]
        diagnostic, = current["optical_diagnostics"]
        fact, = diagnostic["facts"]
        if index == 0 or damage == "bad_list":
            assert diagnostic["status"] == "UNKNOWN"
            assert fact["model_error"] == {"code": "MODEL_ERROR", "reason": "INVALID_CANONICAL_DATA",
                                           "detail": expected_reason}
            assert fact["unknown_reason"] is None
            assert fact["provenance"]["revision_id"] == revision
        elif index == 1:
            assert diagnostic["status"] == "CONSISTENT"
            assert fact["value"] == "SM" and fact["model_error"] is None
        else:
            assert diagnostic["status"] == "UNKNOWN"
            assert fact["unknown_reason"] == "FIBER_TYPE_UNSPECIFIED" and fact["model_error"] is None


@pytest.mark.parametrize("shape", ["collection", "unused_entries"])
def test_module_internal_link_errors_are_local_to_used_provenance(shape):
    a, b, revision = mapped_panel("module")
    with SessionLocal.begin() as session:
        module = session.get(ModuleTemplateRevision, uuid.UUID(revision))
        if shape == "collection":
            module.internal_links = {"links": module.internal_links}
        else:
            module.internal_links = [None, {"from_endpoint_key": "spare", "to_endpoint_key": []},
                                     {"from_endpoint_key": "spare", "to_endpoint_key": "other", "member_mappings": {}},
                                     *module.internal_links]
    result = trace(exact(point(b, 2), point(a, 2)))
    assert result["verdict"] == "REACHABLE"
    diagnostic, = result["optical_diagnostics"]
    fact, = diagnostic["facts"]
    assert fact["trace_edge_id"] == result["edges"][0]["id"]
    if shape == "collection":
        assert diagnostic["status"] == "UNKNOWN"
        assert fact["model_error"] == {"code": "MODEL_ERROR", "reason": "INVALID_CANONICAL_DATA",
                                       "detail": "INVALID_INTERNAL_LINKS"}
    else:
        assert diagnostic["status"] == "CONSISTENT" and fact["value"] == "SM"
        assert fact["model_error"] is None
