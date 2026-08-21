import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.repository import CanonicalRepository, L3BindingAttachmentRecord


client = TestClient(app)


def _by_interface(document: dict) -> dict[str, dict]:
    return {
        item["interface_ref"]["entity_id"]: item
        for item in document["interfaces"]
    }


def test_repository_reads_l3_bindings_by_interface():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface_with_binding = repository.add_network_interface()
        interface_without_binding = repository.add_network_interface()
        routing_context = repository.add_routing_context()
        binding = repository.add_l3_binding(
            interface_with_binding.id, routing_context.id
        )

        result = repository.get_l3_bindings_by_interface(
            [interface_with_binding.id, interface_without_binding.id]
        )

        assert result[interface_with_binding.id] == [
            L3BindingAttachmentRecord(
                l3_binding_id=binding.id,
                network_interface_id=interface_with_binding.id,
                routing_context_id=routing_context.id,
            )
        ]
        assert result[interface_without_binding.id] == []


def test_device_details_collects_owned_interface_read_model():
    device_id = uuid.UUID("00000000-0000-0000-0000-000000000010")
    interface_a_id = uuid.UUID("00000000-0000-0000-0000-000000000011")
    interface_b_id = uuid.UUID("00000000-0000-0000-0000-000000000012")
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        device = repository.add_physical_object(device_id)
        other_device = repository.add_physical_object()
        interface_a = repository.add_network_interface(interface_a_id)
        interface_b = repository.add_network_interface(interface_b_id)
        unrelated = repository.add_network_interface()
        repository.add_network_interface_physical_owner(interface_a.id, device.id)
        repository.add_network_interface_physical_owner(interface_b.id, device.id)
        repository.add_network_interface_physical_owner(unrelated.id, other_device.id)

        l2_context = repository.add_l2_forwarding_context()
        l2_binding = repository.add_l2_binding(interface_a.id, l2_context.id)
        routing_context_a = repository.add_routing_context()
        routing_context_b = repository.add_routing_context()
        l3_a = repository.add_l3_binding(interface_a.id, routing_context_a.id)
        l3_b = repository.add_l3_binding(interface_b.id, routing_context_b.id)
        ipv4 = repository.add_interface_address(l3_a.id, "192.0.2.10", 24)
        ipv6 = repository.add_interface_address(l3_a.id, "2001:db8::10", 64)

        point = repository.add_connection_point(device.id, 2)
        direct = repository.add_interface_physical_binding(interface_a.id, point.id, 2)
        lower = repository.add_network_interface()
        upper = repository.add_network_interface()
        down = repository.add_network_interface_realization(interface_a.id, lower.id)
        up = repository.add_network_interface_realization(upper.id, interface_a.id)

    response = client.get(f"/v1/topology/devices/{device_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == "1.0"
    assert body["device"] == {
        "source_ref": {
            "ref_type": "CANONICAL_FACT",
            "entity_type": "PhysicalObject",
            "entity_id": str(device_id),
        },
        "label": "PhysicalObject 00000000",
        "label_source": "TECHNICAL_FALLBACK",
    }
    assert body["gaps"] == []
    assert body["warnings"] == []

    interfaces = _by_interface(body)
    assert set(interfaces) == {str(interface_a_id), str(interface_b_id)}
    interface_a_document = interfaces[str(interface_a_id)]
    assert interface_a_document["label"] == "NetworkInterface 00000000"
    assert interface_a_document["label_source"] == "TECHNICAL_FALLBACK"
    assert interface_a_document["l2_binding_count"] == 1
    assert interface_a_document["l3_binding_count"] == 1
    assert interface_a_document["realization_down_count"] == 1
    assert interface_a_document["realization_up_count"] == 1
    assert [
        (item["address"], item["prefix_length"])
        for item in interface_a_document["addresses"]
    ] == [("192.0.2.10", 24), ("2001:db8::10", 64)]
    address_ref_ids = {
        ref["entity_id"]
        for item in interface_a_document["addresses"]
        for ref in item["source_refs"]
        if ref["entity_type"] == "InterfaceAddress"
    }
    assert address_ref_ids == {str(ipv4.id), str(ipv6.id)}
    assert interface_a_document["direct_physical_bindings"] == [
        {
            "connection_point_ref": {
                "ref_type": "CANONICAL_FACT",
                "entity_type": "ConnectionPoint",
                "entity_id": str(point.id),
            },
            "member_index": 2,
            "source_refs": [
                {
                    "ref_type": "CANONICAL_FACT",
                    "entity_type": "InterfacePhysicalBinding",
                    "entity_id": str(direct.id),
                },
                {
                    "ref_type": "CANONICAL_FACT",
                    "entity_type": "ConnectionPoint",
                    "entity_id": str(point.id),
                },
            ],
        }
    ]
    source_types = {ref["entity_type"] for ref in interface_a_document["source_refs"]}
    assert source_types == {
        "NetworkInterface",
        "NetworkInterfacePhysicalOwner",
        "L2Binding",
        "L3Binding",
        "InterfacePhysicalBinding",
        "NetworkInterfaceRealization",
    }
    source_ref_ids = {ref["entity_id"] for ref in interface_a_document["source_refs"]}
    assert {str(l2_binding.id), str(l3_a.id), str(down.id), str(up.id)} <= source_ref_ids

    interface_b_document = interfaces[str(interface_b_id)]
    assert interface_b_document["addresses"] == []
    assert interface_b_document["direct_physical_bindings"] == []
    assert interface_b_document["l2_binding_count"] == 0
    assert interface_b_document["l3_binding_count"] == 1
    assert interface_b_document["realization_down_count"] == 0
    assert interface_b_document["realization_up_count"] == 0


def test_device_details_for_missing_device_is_validation_error():
    missing = uuid.UUID("00000000-0000-0000-0000-000000000099")

    response = client.get(f"/v1/topology/devices/{missing}")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
