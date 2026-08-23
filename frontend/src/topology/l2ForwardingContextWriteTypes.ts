import type { ProjectionSourceRef } from './types';

export interface CreateL2ForwardingContextBindingRequest {
  interface_id: string;
  ingress_exact_stacks: [][];
  egress_emit_stack: [];
}

export interface CreateL2ForwardingContextRequest {
  bindings: CreateL2ForwardingContextBindingRequest[];
}

export interface L2ForwardingContextBindingCreationDocument {
  interface_ref: ProjectionSourceRef;
  binding_ref: ProjectionSourceRef;
  ingress_rule_refs: ProjectionSourceRef[];
  egress_rule_ref: ProjectionSourceRef;
}

export interface L2ForwardingContextCreationDocument {
  schema_version: '1.0';
  forwarding_context_ref: ProjectionSourceRef;
  bindings: L2ForwardingContextBindingCreationDocument[];
}

export interface L2ForwardingContextWriteDataSource {
  createL2ForwardingContext(
    request: CreateL2ForwardingContextRequest,
  ): Promise<L2ForwardingContextCreationDocument>;
}
