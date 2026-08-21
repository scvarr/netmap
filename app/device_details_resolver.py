import uuid

from app.repository import CanonicalRepository
from app.schemas import (
    DeviceDetails,
    DeviceDetailsDocument,
    DeviceInterfaceDetails,
    InterfaceAddressDetails,
    InterfacePhysicalBindingDetails,
    ProjectionSourceRef,
)


class ConfiguredDeviceDetailsResolver:
    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(self, physical_object_id: uuid.UUID) -> DeviceDetailsDocument:
        self.repository.require_physical_objects([physical_object_id])
        owners = tuple(
            owner
            for owner in self.repository.get_network_interface_physical_owners()
            if owner.physical_object_id == physical_object_id
        )
        owners = tuple(sorted(owners, key=lambda owner: str(owner.interface_id)))
        interface_ids = [owner.interface_id for owner in owners]

        l2_by_interface = self.repository.get_l2_bindings_by_interface(interface_ids)
        l3_by_interface = self.repository.get_l3_bindings_by_interface(interface_ids)
        physical_by_interface = self.repository.get_physical_bindings_by_interface(
            interface_ids
        )
        down_by_interface = self.repository.get_realizations_down(interface_ids)
        up_by_interface = self.repository.get_realizations_up(interface_ids)
        l3_binding_ids = [
            binding.l3_binding_id
            for interface_id in interface_ids
            for binding in l3_by_interface[interface_id]
        ]
        addresses_by_binding = self.repository.addresses_by_l3_binding(l3_binding_ids)

        interfaces: list[DeviceInterfaceDetails] = []
        for owner in owners:
            interface_id = owner.interface_id
            l2_bindings = sorted(
                l2_by_interface[interface_id], key=lambda binding: str(binding.binding_id)
            )
            l3_bindings = l3_by_interface[interface_id]
            physical_bindings = sorted(
                physical_by_interface[interface_id],
                key=lambda binding: (
                    str(binding.point_id),
                    binding.point_member,
                    str(binding.binding_id),
                ),
            )
            realizations_down = sorted(
                down_by_interface[interface_id],
                key=lambda realization: str(realization.realization_id),
            )
            realizations_up = sorted(
                up_by_interface[interface_id],
                key=lambda realization: str(realization.realization_id),
            )

            addresses = sorted(
                (
                    address
                    for binding in l3_bindings
                    for address in addresses_by_binding[binding.l3_binding_id]
                ),
                key=lambda address: (
                    address.address.version,
                    int(address.address),
                    address.prefix_length,
                    str(address.interface_address_id),
                ),
            )
            source_refs = [
                self._ref("NetworkInterface", interface_id),
                self._ref("NetworkInterfacePhysicalOwner", owner.owner_relation_id),
                *(
                    self._ref("L2Binding", binding.binding_id)
                    for binding in l2_bindings
                ),
                *(
                    self._ref("L3Binding", binding.l3_binding_id)
                    for binding in l3_bindings
                ),
                *(
                    self._ref("InterfacePhysicalBinding", binding.binding_id)
                    for binding in physical_bindings
                ),
                *(
                    self._ref("NetworkInterfaceRealization", realization.realization_id)
                    for realization in (*realizations_down, *realizations_up)
                ),
            ]
            interfaces.append(
                DeviceInterfaceDetails(
                    interface_ref=self._ref("NetworkInterface", interface_id),
                    label=f"NetworkInterface {str(interface_id)[:8]}",
                    label_source="TECHNICAL_FALLBACK",
                    addresses=[
                        InterfaceAddressDetails(
                            address=address.address,
                            prefix_length=address.prefix_length,
                            source_refs=[
                                self._ref(
                                    "InterfaceAddress", address.interface_address_id
                                ),
                                self._ref("L3Binding", address.l3_binding_id),
                            ],
                        )
                        for address in addresses
                    ],
                    l2_binding_count=len(l2_bindings),
                    l3_binding_count=len(l3_bindings),
                    direct_physical_bindings=[
                        InterfacePhysicalBindingDetails(
                            connection_point_ref=self._ref(
                                "ConnectionPoint", binding.point_id
                            ),
                            member_index=binding.point_member,
                            source_refs=[
                                self._ref(
                                    "InterfacePhysicalBinding", binding.binding_id
                                ),
                                self._ref("ConnectionPoint", binding.point_id),
                            ],
                        )
                        for binding in physical_bindings
                    ],
                    realization_down_count=len(realizations_down),
                    realization_up_count=len(realizations_up),
                    source_refs=self._dedupe_refs(source_refs),
                )
            )

        return DeviceDetailsDocument(
            device=DeviceDetails(
                source_ref=self._ref("PhysicalObject", physical_object_id),
                label=f"PhysicalObject {str(physical_object_id)[:8]}",
                label_source="TECHNICAL_FALLBACK",
            ),
            interfaces=interfaces,
            gaps=[],
            warnings=[],
        )

    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> ProjectionSourceRef:
        return ProjectionSourceRef(
            ref_type="CANONICAL_FACT",
            entity_type=entity_type,
            entity_id=entity_id,
        )

    @staticmethod
    def _dedupe_refs(
        refs: list[ProjectionSourceRef],
    ) -> list[ProjectionSourceRef]:
        by_key = {
            (ref.entity_type, str(ref.entity_id)): ref
            for ref in refs
        }
        return [by_key[key] for key in sorted(by_key)]
