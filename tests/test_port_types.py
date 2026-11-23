from tests.module_port_type_fixtures import ensure_module_bay_type_id
import copy

import pytest

from tests.test_workspace_portability import client, isolated_workspace, snapshot


pytestmark = pytest.mark.no_database
URL = "/v1/port-types"
PORT = {"medium": "COPPER", "members": ["1"], "connector_type_id": None}


def create_port(fields):
    return client.post(URL, json={**PORT, **fields})


def update_port(url, fields):
    return client.put(url, json={**PORT, **fields})


@pytest.mark.parametrize("fields", [
    {"name": " \t\u00a0"},
    {"color": "#123"},
    {"color": "#XYZ123"},
    {"is_active": "false"},
])
def test_invalid_port_type(fields):
    assert create_port({"name": "SFP+", "color": "#123456", **fields}).status_code == 422
    assert client.get(URL).json() == []


def test_port_type_lifecycle_and_normalized_name_conflicts():
    response = create_port({"name": "  Оптика\t  SFP+ ", "color": " #a0b1c2 "})
    assert response.status_code == 201, response.text
    item = response.json()
    assert item == {"id": item["id"], **PORT, "cardinality": 1, "name": "Оптика SFP+", "color": "#A0B1C2",
                    "description": None, "is_active": True}
    url = f"{URL}/{item['id']}"
    assert client.delete(url).status_code == 409
    edited = {"name": "Оптика SFP+", "description": "Модуль", "color": "#223344", "is_active": False}
    assert update_port(url, edited).json() == {"id": item["id"], **PORT, "cardinality": 1, **edited}
    assert client.get(url).json() == {"id": item["id"], **PORT, "cardinality": 1, **edited}
    assert client.get(URL).json() == [{"id": item["id"], **PORT, "cardinality": 1, **edited}]
    assert create_port({"name": "оптика  sfp+", "color": "#334455"}).status_code == 409
    other = create_port({"name": "Other", "color": "#334455"}).json()
    assert update_port(f"{URL}/{other['id']}", edited).status_code == 409
    assert client.delete(url).status_code == 204
    assert client.get(url).status_code == 404


def test_port_type_workspace_round_trip_and_invalid_import():
    active = create_port({"name": "Copper", "color": "#123abc"}).json()
    archived = create_port({"name": "Optical", "color": "#abcdef",
                                      "description": "SFP+", "is_active": False}).json()
    before = snapshot()
    assert before["format_version"] == 14
    assert {item["id"]: item for item in before["settings"]["PortType"]} == {
        item["id"]: {k: v for k, v in item.items() if k != "cardinality"} for item in (active, archived)
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

@pytest.mark.parametrize("template_kind, section", [("base", "slots"), ("module", "endpoints")])
def test_assignment_lifecycle_and_workspace_round_trip(template_kind, section):
    import uuid

    from app.module_geometry import initial_geometry
    from tests.test_base_templates_e2e import panel

    original = create_port({"name": "Copper", "color": "#123456"}).json()
    replacement = create_port({"name": "Optical", "color": "#234567"}).json()
    library = f"/v1/library/{template_kind}-templates"
    first = {"key": "first", "display_name": "P1", "kind": "NETWORK_PORT"}
    second = {"key": "second", "display_name": "P2", "kind": "CONNECTION_POINT"}
    definition = {"name": "Test", section: [first, second]}
    if template_kind == "base":
        definition.update(body={"kind": "RECTANGLE", "width": 100, "height": 40}, panels=[panel()])
        for endpoint in (first, second):
            endpoint.update(panel_key="panel-1", rendered_position={"x": .5, "y": .5})
    else:
        definition.update(mount_kind="MODULE_BAY", module_bay_type_id=ensure_module_bay_type_id("OCP3"), geometry=initial_geometry(("first", "second")))

    assert client.post(library, json=definition).status_code == 422
    for endpoint in (first, second):
        endpoint["port_type_id"] = original["id"]
    first["port_type_id"] = str(uuid.uuid4())
    assert client.post(library, json=definition).status_code == 422
    first["port_type_id"] = original["id"]
    created = client.post(library, json=definition)
    assert created.status_code == 201, created.text
    record = created.json()
    if template_kind == "base":
        template = record["blueprint_ref"]["entity_id"]
        original_revision = record["version_ref"]["entity_id"]
        published_url = f"{library}/{template}/versions/{original_revision}"
    else:
        template = record["template_id"]

    draft_url = f"{library}/{template}/draft"
    draft = client.get(draft_url).json()
    original_authoring = snapshot()["authoring"]
    original_url = f"{URL}/{original['id']}"
    assert update_port(original_url, {"name": "Twisted pair", "color": "#112233", "is_active": False}).status_code == 200
    assert snapshot()["authoring"] == original_authoring
    assert client.post(library, json=definition).status_code == 422
    assert client.delete(original_url).status_code == 409
    if template_kind == "base":
        assert client.get(published_url).json()[section][0]["port_type_id"] == original["id"]
    else:
        modules = client.get(library).json()["modules"]
        assert modules[0][section][0]["port_type_id"] == original["id"]

    definition = copy.deepcopy(draft["definition"])
    definition[section][0]["port_type_id"] = replacement["id"]
    saved = client.put(draft_url, params={"expected_generation": draft["generation"]}, json=definition)
    assert saved.status_code == 200, saved.text
    assert client.get(draft_url).json()["definition"] == definition
    checked = client.post(f"{draft_url}/check", params={"expected_generation": saved.json()["generation"]})
    assert checked.status_code == 409, checked.text
    assert checked.json()["error"]["details"]["reason"] == "PHYSICAL_STRUCTURE_IMMUTABLE"

    replacement_url = f"{URL}/{replacement['id']}"
    assert update_port(replacement_url, {"name": "Optical", "color": "#234567", "is_active": False}).status_code == 200
    assert client.delete(replacement_url).status_code == 409  # Draft assignment.
    assert update_port(replacement_url, {"name": "Optical", "color": "#234567", "members": ["X"]}).status_code == 409
    assert update_port(original_url, {"name": "Twisted pair", "color": "#112233"}).status_code == 200
    definition = copy.deepcopy(draft["definition"])
    definition[section][0]["display_name"] = "Renamed P1"
    saved = client.put(draft_url, params={"expected_generation": saved.json()["generation"]}, json=definition)
    assert saved.status_code == 200, saved.text
    assert update_port(replacement_url, {"name": "Optical", "color": "#234567", "members": ["X"], "is_active": False}).status_code == 200
    assert client.delete(replacement_url).status_code == 204

    checked = client.post(f"{draft_url}/check", params={"expected_generation": saved.json()["generation"]})
    assert checked.status_code == 200, checked.text
    candidate_id = checked.json()["review"]["candidate_id"]
    assert update_port(original_url, {"name": "Twisted pair", "color": "#112233", "is_active": False}).status_code == 200
    published = client.post(f"{library}/{template}/candidates/{candidate_id}/publish")
    assert published.status_code == 200, published.text
    assert client.get(draft_url).json()["definition"] == definition
    assert update_port(original_url, {"name": "Twisted pair", "color": "#112233", "members": ["X"]}).status_code == 409

    before = snapshot()
    assert before["format_version"] == 14
    assert client.delete("/v1/workspace/dataset").status_code == 204
    malformed = copy.deepcopy(before)
    draft_record, = malformed["authoring"][f"{template_kind.capitalize()}TemplateDraft"]
    draft_record["definition"][section][0]["port_type_id"] = str(uuid.uuid4())
    assert client.post("/v1/workspace/package", json=malformed).status_code == 422
    assert client.post("/v1/workspace/package", json={**before, "format_version": 6}).status_code == 422
    response = client.post("/v1/workspace/package", json=before)
    assert response.status_code == 204, response.text
    assert snapshot() == before


@pytest.mark.parametrize("template_kind", ["base", "module"])
@pytest.mark.parametrize("replacement_medium", ["FIBER", "COPPER"])
def test_connected_retained_endpoint_type_is_immutable(template_kind, replacement_medium):
    from uuid import UUID

    from sqlalchemy import select

    from app import models as m
    from app.base_template_review import BaseTemplateReview
    from app.database import SessionLocal
    from app.hardware_catalog import HardwareCatalog
    from app.module_geometry import initial_geometry
    from app.schemas import CreateBaseTemplateRequest, CreateModuleTemplateRequest
    from tests.test_hardware_configuration import board_base_payload, create_base, create_object, install
    from tests.test_module_reconciliation import apply
    from tests.test_object_reconciliation import connect, reconcile

    port_types = []
    for profile, medium in (("RJ45", "COPPER"), ("LC" if replacement_medium == "FIBER" else "GG45", replacement_medium)):
        connector = client.post("/v1/connector-types", json={
            "name": profile, "color": "#123456", "mating_profile": profile, "termination": "SOCKET",
        })
        assert connector.status_code == 201, connector.text
        port = create_port({"name": profile, "color": "#123456", "medium": medium,
                            "connector_type_id": connector.json()["id"]})
        assert port.status_code == 201, port.text
        port_types.append(port.json())
    original, replacement = port_types
    assert original["cardinality"] == replacement["cardinality"] == 1

    base = board_base_payload()
    base["slots"][0]["port_type_id"] = original["id"]
    base_id, base = create_base(base)
    obj = create_object(base_id)
    object_id = obj["physical_object_ref"]["entity_id"]
    object_url = f"/v1/topology/physical-objects/{object_id}"
    library = f"/v1/library/{template_kind}-templates"
    if template_kind == "base":
        template_id, section = base_id, "slots"
        point_id = obj["slots"][0]["connection_point_ref"]["entity_id"]
        candidate_model, draft_model = m.BaseTemplateCandidate, m.BaseTemplateDraft
        schema, create_revision = CreateBaseTemplateRequest, HardwareCatalog._create_version
        impact_section = "objects"
    else:
        endpoint = {"key": "port", "kind": "NETWORK_PORT", "display_name": "P1", "port_type_id": original["id"]}
        created = client.post(library, json={"name": "Module", "mount_kind": "MODULE_BAY", "module_bay_type_id": ensure_module_bay_type_id("OCP3"), "endpoints": [endpoint],
                                            "geometry": initial_geometry([endpoint["key"]])})
        assert created.status_code == 201, created.text
        template_id, section = created.json()["template_id"], "endpoints"
        installed = install(object_id, template_id, base["bays"][0]["bay_key"])
        assert installed.status_code == 201, installed.text
        point_id = installed.json()["bays"][0]["installation"]["endpoints"][0]["connection_point_id"]
        candidate_model, draft_model = m.ModuleTemplateCandidate, m.ModuleTemplateDraft
        schema, create_revision = CreateModuleTemplateRequest, HardwareCatalog._create_module_revision
        impact_section = "installations"

    with SessionLocal.begin() as session:
        connect(session, UUID(point_id))
    before = snapshot()
    assert len(before["canonical"]["Cable"]) == 1
    draft_url = f"{library}/{template_id}/draft"
    draft = client.get(draft_url).json()
    definition = copy.deepcopy(draft["definition"])
    definition[section][0]["port_type_id"] = replacement["id"]
    saved = client.put(draft_url, params={"expected_generation": draft["generation"]}, json=definition)
    assert saved.status_code == 200, saved.text
    checked = client.post(f"{draft_url}/check", params={"expected_generation": saved.json()["generation"]})
    assert checked.status_code == 409, checked.text
    assert checked.json()["error"]["details"]["reason"] == "PHYSICAL_STRUCTURE_IMMUTABLE"

    # Exercise publication separately with a candidate written by the old rules.
    with SessionLocal.begin() as session:
        row = session.scalar(select(draft_model).where(draft_model.template_id == UUID(template_id)))
        candidate = candidate_model(template_id=row.template_id, source_revision_id=row.source_revision_id,
                                    draft_generation=row.generation, definition=row.definition,
                                    input_fingerprint=BaseTemplateReview(session)._inputs(),
                                    result={"changes": [], impact_section: []})
        session.add(candidate)
        session.flush()
        candidate_id = candidate.id
    candidate_snapshot = snapshot()
    result = client.post(f"{library}/{template_id}/candidates/{candidate_id}/publish")
    assert result.status_code == 409, result.text
    assert result.json()["error"]["details"]["reason"] == "PHYSICAL_STRUCTURE_IMMUTABLE"
    assert snapshot() == candidate_snapshot
    restored = client.put(draft_url, params={"expected_generation": saved.json()["generation"]},
                          json=draft["definition"])
    assert restored.status_code == 200, restored.text
    # Even after removing the draft reference, the frozen candidate protects its type.
    still_used = update_port(f"{URL}/{replacement['id']}", {
        "name": replacement["name"], "color": replacement["color"], "medium": replacement_medium,
        "connector_type_id": replacement["connector_type_id"], "members": ["X"],
    })
    assert still_used.status_code == 409, still_used.text

    # Exercise reconcile against a revision already persisted under the old rules.
    with SessionLocal.begin() as session:
        create_revision(HardwareCatalog(session), UUID(template_id), 2, schema.model_validate(definition))
    pinned = snapshot()
    impact, = reconcile(template_id).values() if template_kind == "base" else apply(template_id)
    assert impact["status"] == "requires_intervention"
    assert any(reason["code"] == "PHYSICAL_STRUCTURE_IMMUTABLE" for reason in impact["reasons"])
    assert snapshot() == pinned

    saved_type = update_port(f"{URL}/{original['id']}", {
        "name": "Renamed RJ45", "color": "#334455", "connector_type_id": original["connector_type_id"],
    })
    assert saved_type.status_code == 200, saved_type.text
    reloaded = client.get(object_url)
    assert reloaded.status_code == 200, reloaded.text
    point, = [item for item in reloaded.json()["connection_points"]
              if item["connection_point_ref"]["entity_id"] == point_id]
    assert point["blueprint_slot"]["port_type_id"] == original["id"]
    after = snapshot()
    assert after["canonical"] == before["canonical"]
    assert after["authoring"] == pinned["authoring"]


def test_connector_dependency_archiving_and_cable_catalog():
    connectors = "/v1/connector-types"
    connector = {"name": "Custom LC", "color": "#123456", "mating_profile": "Custom", "termination": "SOCKET"}
    created = client.post(connectors, json=connector)
    assert created.status_code == 201, created.text
    connector_id = created.json()["id"]
    url = f"{connectors}/{connector_id}"
    port = {"name": "Optical panel", "color": "#345678", "medium": "FIBER", "members": ["A", "B"],
            "connector_type_id": connector_id}
    created = create_port(port)
    assert created.status_code == 201, created.text
    port_id = created.json()["id"]
    assert client.get(f"{URL}/{port_id}").json()["cardinality"] == 2
    assert client.put(url, json={**connector, "termination": "PLUG"}).status_code == 409
    assert client.put(url, json={**connector, "name": "Edited LC", "is_active": False}).status_code == 200
    assert client.get(url).json()["name"] == "Edited LC"
    assert create_port({**port, "name": "New port"}).status_code == 409
    assert client.delete(url).status_code == 409
    assert update_port(f"{URL}/{port_id}", {**port, "connector_type_id": None}).status_code == 200
    assert client.put(url, json={**connector, "termination": "PLUG", "is_active": False}).status_code == 200
    assert client.delete(url).status_code == 204

    cables = "/v1/cable-types"
    cable = {"name": "Custom fiber", "color": "#223344", "medium": "FIBER", "construction": "CUSTOM"}
    assert client.post(cables, json={**cable, "cardinality": 12}).status_code == 422
    created = client.post(cables, json=cable)
    assert created.status_code == 201, created.text
    cable_id = created.json()["id"]
    url = f"{cables}/{cable_id}"
    assert client.put(url, json={**cable, "construction": "SINGLE_MODE", "is_active": False}).status_code == 200
    assert client.get(url).json()["construction"] == "SINGLE_MODE"
    assert client.get(cables).json()[0]["id"] == cable_id
    assert client.delete(url).status_code == 204


def test_structural_edit_waits_for_concurrent_template_assignment():
    from concurrent.futures import ThreadPoolExecutor
    from time import monotonic, sleep
    from uuid import UUID

    from sqlalchemy import text
    from app.database import SessionLocal
    from app.hardware_catalog import HardwareCatalog
    from app.schemas import CreateBaseTemplateRequest
    from tests.test_base_templates_e2e import panel

    port = {"name": "Concurrent", "color": "#345678"}
    port_id = create_port(port).json()["id"]
    definition = CreateBaseTemplateRequest.model_validate({
        "name": "Concurrent template", "body": {"kind": "RECTANGLE", "width": 100, "height": 40}, "panels": [panel()],
        "slots": [{"key": "first", "display_name": "P1", "kind": "NETWORK_PORT", "port_type_id": port_id,
                   "panel_key": "panel-1", "rendered_position": {"x": .5, "y": .5}}],
    })
    with ThreadPoolExecutor(max_workers=1) as executor:
        with SessionLocal.begin() as writer:
            HardwareCatalog(writer).create_initial_version(definition)
            pid = writer.scalar(text("SELECT pg_backend_pid()"))
            result = executor.submit(update_port, f"{URL}/{port_id}", {**port, "members": ["A", "B"]})
            deadline = monotonic() + 5
            with SessionLocal() as observer:
                while monotonic() < deadline:
                    # PostgreSQL caches its activity snapshot for the transaction.
                    observer.execute(text("SELECT pg_stat_clear_snapshot()"))
                    waiting = observer.scalar(text("""
                        SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE :pid = ANY(pg_blocking_pids(pid)))
                    """), {"pid": pid})
                    if waiting:
                        break
                    sleep(.02)
            assert waiting, "The structural edit must wait for the assigning transaction"
        assert result.result(timeout=5).status_code == 409
    assert client.get(f"{URL}/{UUID(port_id)}").json()["members"] == ["1"]


def test_seed_conflicts_preserve_user_edits(monkeypatch):
    from runpy import run_path
    from app.database import SessionLocal

    helpers = run_path("alembic/versions/catd01_physical_catalogs.py")
    with SessionLocal.begin() as session:
        monkeypatch.setattr(helpers["op"], "get_bind", session.connection)
        seed = helpers["seed"]
        item_id = seed("cable_types", "Seed", medium="COPPER", construction="TWISTED_PAIR")
    url = f"/v1/cable-types/{item_id}"
    assert client.put(url, json={"name": "Renamed seed", "color": "#123456", "medium": "FIBER",
                                 "construction": "CUSTOM"}).status_code == 200
    with SessionLocal.begin() as session:
        monkeypatch.setattr(helpers["op"], "get_bind", session.connection)
        assert seed("cable_types", "Seed", medium="COPPER", construction="TWISTED_PAIR") == item_id
    assert client.get(url).json()["construction"] == "CUSTOM"
    assert len(client.get("/v1/cable-types").json()) == 1


def test_multimember_module_materializes_passive_point_but_rejects_network_port():
    from uuid import UUID

    from app.database import SessionLocal
    from app.models import ConnectionPoint
    from app.module_geometry import initial_geometry
    from tests.test_hardware_configuration import create_board_base, create_object, install

    port = create_port({"name": "Duplex", "medium": "FIBER", "members": ["A", "B"], "color": "#123456"}).json()
    endpoint = {"key": "duplex", "display_name": "Duplex", "kind": "NETWORK_PORT", "port_type_id": port["id"]}
    definition = {"name": "Passive", "mount_kind": "MODULE_BAY", "module_bay_type_id": ensure_module_bay_type_id("OCP3"), "endpoints": [endpoint],
                  "geometry": initial_geometry([endpoint["key"]])}
    library = "/v1/library/module-templates"
    assert client.post(library, json=definition).status_code == 422
    endpoint["kind"] = "CONNECTION_POINT"
    created = client.post(library, json=definition)
    assert created.status_code == 201, created.text
    template_id = created.json()["template_id"]
    base_id, base = create_board_base()
    obj = create_object(base_id)
    installation = install(obj["physical_object_ref"]["entity_id"], template_id, base["bays"][0]["bay_key"])
    assert installation.status_code == 201, installation.text
    point, = installation.json()["bays"][0]["installation"]["endpoints"]
    assert point["network_interface_id"] is None
    with SessionLocal() as session:
        assert session.get(ConnectionPoint, UUID(point["connection_point_id"])).cardinality == 2

    draft = client.get(f"{library}/{template_id}/draft").json()
    changed = copy.deepcopy(draft["definition"])
    changed["endpoints"][0]["port_type_id"] = create_port({"name": "Simplex", "color": "#123456"}).json()["id"]
    draft_url = f"{library}/{template_id}/draft"
    saved = client.put(draft_url, params={"expected_generation": draft["generation"]}, json=changed)
    assert saved.status_code == 200, saved.text
    checked = client.post(f"{draft_url}/check", params={"expected_generation": saved.json()["generation"]})
    assert checked.status_code == 409, checked.text
    assert checked.json()["error"]["details"]["reason"] == "PHYSICAL_STRUCTURE_IMMUTABLE"
