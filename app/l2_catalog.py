import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.errors import ValidationError
from app.models import NetworkInterface
from app.repository import CanonicalRepository


@dataclass(frozen=True)
class L2ForwardingContextBindingInput:
    interface_id: uuid.UUID
    ingress_exact_stacks: list[list[dict[str, object]]]
    egress_emit_stack: list[dict[str, object]] | None


@dataclass(frozen=True)
class CreatedL2ForwardingContextBinding:
    interface_id: uuid.UUID
    binding_id: uuid.UUID
    ingress_rule_ids: list[uuid.UUID]
    egress_rule_id: uuid.UUID | None


@dataclass(frozen=True)
class CreatedL2ForwardingContext:
    forwarding_context_id: uuid.UUID
    bindings: list[CreatedL2ForwardingContextBinding]


class L2Catalog:
    """Bounded atomic catalog operation for one configured L2 forwarding context."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_forwarding_context(
        self, bindings: list[L2ForwardingContextBindingInput]
    ) -> CreatedL2ForwardingContext:
        interface_ids = [binding.interface_id for binding in bindings]
        duplicate_ids = sorted(
            {interface_id for interface_id in interface_ids if interface_ids.count(interface_id) > 1},
            key=str,
        )
        if duplicate_ids:
            raise ValidationError(
                "A NetworkInterface may appear only once in one L2ForwardingContext request",
                {"interface_ids": [str(interface_id) for interface_id in duplicate_ids]},
            )
        for interface_id in interface_ids:
            if self.session.get(NetworkInterface, interface_id) is None:
                raise ValidationError(
                    "NetworkInterface does not exist", {"interface_id": str(interface_id)}
                )

        repository = CanonicalRepository(self.session)
        context = repository.add_l2_forwarding_context()
        created_bindings: list[CreatedL2ForwardingContextBinding] = []
        for item in bindings:
            binding = repository.add_l2_binding(item.interface_id, context.id)
            ingress_rules = [
                repository.add_l2_ingress_rule(binding.id, stack)
                for stack in item.ingress_exact_stacks
            ]
            egress_rule = (
                repository.add_l2_egress_rule(binding.id, item.egress_emit_stack)
                if item.egress_emit_stack is not None
                else None
            )
            created_bindings.append(
                CreatedL2ForwardingContextBinding(
                    interface_id=item.interface_id,
                    binding_id=binding.id,
                    ingress_rule_ids=[rule.id for rule in ingress_rules],
                    egress_rule_id=egress_rule.id if egress_rule is not None else None,
                )
            )
        return CreatedL2ForwardingContext(context.id, created_bindings)
