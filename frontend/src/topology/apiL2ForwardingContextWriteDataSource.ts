import type { ProjectionSourceRef } from './types';
import type {
  CreateL2ForwardingContextRequest,
  L2ForwardingContextCreationDocument,
  L2ForwardingContextWriteDataSource,
} from './l2ForwardingContextWriteTypes';

const DEFAULT_ENDPOINT = '/api/v1/l2/forwarding-contexts';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const malformed = (message: string): never => {
  throw new Error(`Malformed L2 forwarding context response: ${message}`);
};

const requireObject = (value: unknown, path: string): Record<string, unknown> => {
  if (!isObject(value)) malformed(`${path} must be an object.`);
  return value as Record<string, unknown>;
};

const requireRef = (value: unknown, path: string, entityType: string): ProjectionSourceRef => {
  const ref = requireObject(value, path);
  if (ref.ref_type !== 'CANONICAL_FACT') malformed(`${path}.ref_type must be "CANONICAL_FACT".`);
  if (ref.entity_type !== entityType) malformed(`${path}.entity_type must be "${entityType}".`);
  if (typeof ref.entity_id !== 'string' || !ref.entity_id) malformed(`${path}.entity_id must be a non-empty string.`);
  return ref as unknown as ProjectionSourceRef;
};

export const parseL2ForwardingContextCreationDocument = (
  value: unknown,
): L2ForwardingContextCreationDocument => {
  const document = requireObject(value, 'document');
  if (document.schema_version !== '1.0') malformed('schema_version must be "1.0".');
  const forwarding_context_ref = requireRef(
    document.forwarding_context_ref,
    'forwarding_context_ref',
    'L2ForwardingContext',
  );
  const bindingsValue = document.bindings;
  if (!Array.isArray(bindingsValue) || bindingsValue.length === 0) {
    malformed('bindings must be a non-empty array.');
  }
  const bindings = (bindingsValue as unknown[]).map((value, index) => {
    const binding = requireObject(value, `bindings[${index}]`);
    const interface_ref = requireRef(binding.interface_ref, `bindings[${index}].interface_ref`, 'NetworkInterface');
    const binding_ref = requireRef(binding.binding_ref, `bindings[${index}].binding_ref`, 'L2Binding');
    const ingressRuleRefsValue = binding.ingress_rule_refs;
    if (!Array.isArray(ingressRuleRefsValue) || ingressRuleRefsValue.length === 0) {
      malformed(`bindings[${index}].ingress_rule_refs must be a non-empty array.`);
    }
    const ingress_rule_refs = (ingressRuleRefsValue as unknown[]).map((ref, ruleIndex) => requireRef(
      ref,
      `bindings[${index}].ingress_rule_refs[${ruleIndex}]`,
      'L2IngressRule',
    ));
    const egress_rule_ref = requireRef(binding.egress_rule_ref, `bindings[${index}].egress_rule_ref`, 'L2EgressRule');
    return { interface_ref, binding_ref, ingress_rule_refs, egress_rule_ref };
  });
  return { schema_version: '1.0', forwarding_context_ref, bindings };
};

const readBackendError = async (response: Response): Promise<Error> => {
  try {
    const body: unknown = await response.json();
    if (isObject(body) && isObject(body.error) && typeof body.error.code === 'string' && typeof body.error.message === 'string') {
      return new Error(`${body.error.code}: ${body.error.message}`);
    }
  } catch {
    // Non-JSON errors use the generic HTTP message.
  }
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  return new Error(`HTTP ${response.status}${statusText} while creating L2 forwarding context.`);
};

export class ApiL2ForwardingContextWriteDataSource implements L2ForwardingContextWriteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async createL2ForwardingContext(
    request: CreateL2ForwardingContextRequest,
  ): Promise<L2ForwardingContextCreationDocument> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw await readBackendError(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      malformed('response body must be valid JSON.');
    }
    const document = parseL2ForwardingContextCreationDocument(body);
    const requestedIds = new Set(request.bindings.map((binding) => binding.interface_id));
    const returnedIds = document.bindings.map((binding) => binding.interface_ref.entity_id);
    if (returnedIds.length !== requestedIds.size || returnedIds.some((id) => !requestedIds.has(id)) || new Set(returnedIds).size !== returnedIds.length) {
      malformed('bindings must contain exactly the requested NetworkInterface refs.');
    }
    return document;
  }
}
