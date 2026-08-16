import uuid
from dataclasses import dataclass
from itertools import groupby, product

from app.nat_resolver import ConfiguredNATPolicyResolver
from app.packet_predicates import PacketPredicateEvaluationContext
from app.processing_scopes import ProcessingScopeEvaluation, evaluate_processing_scope
from app.repository import CanonicalRepository, NATPolicyAttachmentRecord
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    NATEvaluationArtifact,
    NATEvaluationContext,
    NATEvaluationGap,
    NATEvaluationQuery,
    NATExecutionBranch,
    NATPolicyEvaluationQuery,
    NATStageExecution,
    PacketState,
)


@dataclass(frozen=True)
class _Attachment:
    record: NATPolicyAttachmentRecord
    scope: ProcessingScopeEvaluation
    evidence_refs: tuple[EvidenceRef, ...]


@dataclass(frozen=True)
class _Execution:
    current_packet: PacketState | None
    stage_executions: tuple[NATStageExecution, ...]
    termination: str
    evidence_refs: tuple[EvidenceRef, ...]
    had_transform: bool


class ConfiguredNATEvaluationResolver:
    VERSION = "nat-configured-stages/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.policy_resolver = ConfiguredNATPolicyResolver(repository)

    def resolve(
        self, query: NATEvaluationQuery, view: EvaluationView
    ) -> NATEvaluationArtifact:
        context = query.context
        self.repository.validate_processing_evaluation_context(
            routing_context_id=context.routing_context_id,
            ingress_network_interface_id=context.ingress_network_interface_id,
            egress_network_interface_id=context.egress_network_interface_id,
            ingress_l3_binding_id=context.ingress_l3_binding_id,
            egress_l3_binding_id=context.egress_l3_binding_id,
        )

        attachments = [
            self._attachment(record, context)
            for record in self.repository.get_nat_policy_attachments()
        ]
        gaps: list[NATEvaluationGap] = []
        if query.configured_attachment_completeness != "COMPLETE":
            gaps.append(
                NATEvaluationGap(
                    code="NAT_ATTACHMENT_COVERAGE_INCOMPLETE", evidence_refs=[]
                )
            )
        for attachment in attachments:
            if attachment.scope.applicability == "UNKNOWN":
                gaps.append(
                    NATEvaluationGap(
                        code="NAT_ATTACHMENT_APPLICABILITY_UNKNOWN",
                        attachment_id=attachment.record.attachment_id,
                        evidence_refs=list(attachment.evidence_refs),
                    )
                )

        executions = [
            _Execution(
                current_packet=context.packet_state,
                stage_executions=(),
                termination="COMPLETED",
                evidence_refs=(),
                had_transform=False,
            )
        ]
        for _, grouped in groupby(
            attachments, key=lambda item: item.record.local_stage_order
        ):
            group = list(grouped)
            next_executions: list[_Execution] = []
            for execution in executions:
                if execution.termination != "COMPLETED":
                    next_executions.append(execution)
                    continue
                next_executions.extend(
                    self._execute_order_group(execution, group, view, context, gaps)
                )
            executions = next_executions

        completed = [
            execution
            for execution in executions
            if execution.termination == "COMPLETED"
        ]
        unresolved = any(
            execution.termination != "COMPLETED" for execution in executions
        )
        output_keys = {
            self._packet_key(execution.current_packet)
            for execution in completed
            if execution.current_packet is not None
        }
        differing_outputs = len(output_keys) > 1
        if differing_outputs:
            gaps.append(
                NATEvaluationGap(
                    code="NAT_TRANSLATION_UNKNOWN",
                    evidence_refs=self._dedupe(
                        [ref for execution in completed for ref in execution.evidence_refs]
                    ),
                )
            )

        coverage_complete = query.configured_attachment_completeness == "COMPLETE"
        if not coverage_complete or unresolved or differing_outputs or not completed:
            result = "UNKNOWN"
            reason = "NAT_UNCERTAINTY"
            packet_after = None
        else:
            packet_after = completed[0].current_packet
            transformed = any(execution.had_transform for execution in completed)
            if transformed:
                result = "TRANSFORMED_EXACT"
                reason = "NAT_STAGES_TRANSFORMED"
            else:
                result = "IDENTITY"
                executed_any = any(
                    stage.executed
                    for execution in completed
                    for stage in execution.stage_executions
                )
                reason = (
                    "NAT_STAGES_IDENTITY"
                    if executed_any
                    else "NO_NAT_POLICY_APPLICABLE"
                )

        branches = [
            NATExecutionBranch(
                branch_id=f"nat-execution-{index}",
                initial_packet=context.packet_state,
                stage_executions=list(execution.stage_executions),
                final_packet=(
                    execution.current_packet
                    if execution.termination == "COMPLETED"
                    else None
                ),
                termination=execution.termination,  # type: ignore[arg-type]
                evidence_refs=list(execution.evidence_refs),
            )
            for index, execution in enumerate(executions, start=1)
        ]
        return NATEvaluationArtifact(
            query=query,
            evaluation_view=view,
            context=context,
            configured_attachment_completeness=(
                query.configured_attachment_completeness
            ),
            result=result,  # type: ignore[arg-type]
            reason=reason,  # type: ignore[arg-type]
            packet_before=context.packet_state,
            packet_after=packet_after,
            branches=branches,
            evidence_refs=self._dedupe(
                [ref for execution in executions for ref in execution.evidence_refs]
            ),
            gaps=self._dedupe_gaps(gaps),
            warnings=[],
        )

    def _execute_order_group(
        self,
        execution: _Execution,
        group: list[_Attachment],
        view: EvaluationView,
        context: NATEvaluationContext,
        gaps: list[NATEvaluationGap],
    ) -> list[_Execution]:
        assert execution.current_packet is not None
        false_attachments = [
            item for item in group if item.scope.applicability == "FALSE"
        ]
        definite = [item for item in group if item.scope.applicability == "TRUE"]
        unknown = [item for item in group if item.scope.applicability == "UNKNOWN"]
        results: list[_Execution] = []

        for choices in product((False, True), repeat=len(unknown)):
            applied = [*definite]
            skipped = [*false_attachments]
            for attachment, applies in zip(unknown, choices, strict=True):
                (applied if applies else skipped).append(attachment)

            skipped_stages = tuple(
                self._skipped_stage(item, execution.current_packet)
                for item in skipped
            )
            base_stages = execution.stage_executions + skipped_stages
            base_evidence = tuple(
                self._dedupe(
                    [
                        *execution.evidence_refs,
                        *(ref for item in skipped for ref in item.evidence_refs),
                    ]
                )
            )

            if len(applied) > 1:
                competing_ids = [item.record.attachment_id for item in applied]
                competing_refs = [
                    ref for item in applied for ref in item.evidence_refs
                ]
                ambiguity_stages = tuple(
                    self._ambiguous_stage(item, execution.current_packet)
                    for item in applied
                )
                evidence = tuple(
                    self._dedupe([*base_evidence, *competing_refs])
                )
                gaps.append(
                    NATEvaluationGap(
                        code="NAT_STAGE_ORDER_AMBIGUOUS",
                        competing_attachment_ids=competing_ids,
                        evidence_refs=list(evidence),
                    )
                )
                results.append(
                    _Execution(
                        current_packet=None,
                        stage_executions=base_stages + ambiguity_stages,
                        termination="NAT_STAGE_ORDER_AMBIGUOUS",
                        evidence_refs=evidence,
                        had_transform=execution.had_transform,
                    )
                )
                continue

            if not applied:
                results.append(
                    _Execution(
                        current_packet=execution.current_packet,
                        stage_executions=base_stages,
                        termination="COMPLETED",
                        evidence_refs=base_evidence,
                        had_transform=execution.had_transform,
                    )
                )
                continue

            attachment = applied[0]
            policy_evaluation = self.policy_resolver.resolve_with_predicate_context(
                NATPolicyEvaluationQuery(
                    policy_id=attachment.record.policy_id,
                    packet_state=execution.current_packet,
                ),
                view,
                PacketPredicateEvaluationContext(
                    packet_state=execution.current_packet,
                    connection_state=context.connection_state,
                ),
            )
            stage_evidence = self._dedupe(
                [*attachment.evidence_refs, *policy_evaluation.evidence_refs]
            )
            stage = NATStageExecution(
                attachment_id=attachment.record.attachment_id,
                policy_id=attachment.record.policy_id,
                local_stage_order=attachment.record.local_stage_order,
                applicability=attachment.scope.applicability,  # type: ignore[arg-type]
                branch_assumption="APPLY",
                executed=True,
                policy_evaluation=policy_evaluation,
                packet_before=execution.current_packet,
                packet_after=policy_evaluation.packet_after,
                packet_after_constraint=policy_evaluation.packet_after_constraint,
                evidence_refs=stage_evidence,
            )
            evidence = tuple(self._dedupe([*base_evidence, *stage_evidence]))
            if policy_evaluation.result == "UNKNOWN":
                gaps.append(
                    NATEvaluationGap(
                        code="NAT_POLICY_EVALUATION_UNKNOWN",
                        attachment_id=attachment.record.attachment_id,
                        evidence_refs=stage_evidence,
                    )
                )
                results.append(
                    _Execution(
                        current_packet=None,
                        stage_executions=base_stages + (stage,),
                        termination="NAT_POLICY_EVALUATION_UNKNOWN",
                        evidence_refs=evidence,
                        had_transform=execution.had_transform,
                    )
                )
            elif policy_evaluation.result == "TRANSFORMED_CONSTRAINED":
                gaps.append(
                    NATEvaluationGap(
                        code="NAT_CONSTRAINED_OUTPUT",
                        attachment_id=attachment.record.attachment_id,
                        evidence_refs=stage_evidence,
                    )
                )
                results.append(
                    _Execution(
                        current_packet=None,
                        stage_executions=base_stages + (stage,),
                        termination="NAT_CONSTRAINED_OUTPUT",
                        evidence_refs=evidence,
                        had_transform=True,
                    )
                )
            else:
                assert policy_evaluation.packet_after is not None
                results.append(
                    _Execution(
                        current_packet=policy_evaluation.packet_after,
                        stage_executions=base_stages + (stage,),
                        termination="COMPLETED",
                        evidence_refs=evidence,
                        had_transform=(
                            execution.had_transform
                            or policy_evaluation.result == "TRANSFORMED_EXACT"
                        ),
                    )
                )
        return results

    def _attachment(
        self, record: NATPolicyAttachmentRecord, context: NATEvaluationContext
    ) -> _Attachment:
        scope = evaluate_processing_scope(record.scope, context)
        refs = [self._ref("NATPolicyAttachment", record.attachment_id)]
        refs.extend(
            self._ref(entity_type, entity_id)
            for entity_type, entity_id in scope.canonical_refs
        )
        return _Attachment(record, scope, tuple(self._dedupe(refs)))

    @staticmethod
    def _skipped_stage(
        attachment: _Attachment, packet: PacketState
    ) -> NATStageExecution:
        return NATStageExecution(
            attachment_id=attachment.record.attachment_id,
            policy_id=attachment.record.policy_id,
            local_stage_order=attachment.record.local_stage_order,
            applicability=attachment.scope.applicability,  # type: ignore[arg-type]
            branch_assumption="SKIP",
            executed=False,
            packet_before=packet,
            packet_after=packet,
            evidence_refs=list(attachment.evidence_refs),
        )

    @staticmethod
    def _ambiguous_stage(
        attachment: _Attachment, packet: PacketState
    ) -> NATStageExecution:
        return NATStageExecution(
            attachment_id=attachment.record.attachment_id,
            policy_id=attachment.record.policy_id,
            local_stage_order=attachment.record.local_stage_order,
            applicability=attachment.scope.applicability,  # type: ignore[arg-type]
            branch_assumption="APPLY",
            executed=False,
            packet_before=packet,
            packet_after=None,
            evidence_refs=list(attachment.evidence_refs),
        )

    @staticmethod
    def _packet_key(packet: PacketState | None) -> str:
        return "" if packet is None else packet.model_dump_json()

    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> EvidenceRef:
        return EvidenceRef(entity_type=entity_type, entity_id=entity_id)  # type: ignore[arg-type]

    @staticmethod
    def _dedupe(refs: list[EvidenceRef]) -> list[EvidenceRef]:
        result: list[EvidenceRef] = []
        seen: set[tuple[str, uuid.UUID]] = set()
        for ref in refs:
            key = (ref.entity_type, ref.entity_id)
            if key not in seen:
                seen.add(key)
                result.append(ref)
        return result

    @staticmethod
    def _dedupe_gaps(gaps: list[NATEvaluationGap]) -> list[NATEvaluationGap]:
        result: list[NATEvaluationGap] = []
        seen: set[tuple[str, uuid.UUID | None, tuple[uuid.UUID, ...]]] = set()
        for gap in gaps:
            key = (
                gap.code,
                gap.attachment_id,
                tuple(gap.competing_attachment_ids),
            )
            if key not in seen:
                seen.add(key)
                result.append(gap)
        return result
