import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiL2ForwardingContextWriteDataSource } from './apiL2ForwardingContextWriteDataSource';

const ref = (entity_type: string, entity_id: string) => ({
  ref_type: 'CANONICAL_FACT', entity_type, entity_id,
});

const document = {
  schema_version: '1.0',
  forwarding_context_ref: ref('L2ForwardingContext', 'context-1'),
  bindings: ['eth1', 'eth2'].map((interfaceId) => ({
    interface_ref: ref('NetworkInterface', interfaceId),
    binding_ref: ref('L2Binding', `binding-${interfaceId}`),
    ingress_rule_refs: [ref('L2IngressRule', `ingress-${interfaceId}`)],
    egress_rule_ref: ref('L2EgressRule', `egress-${interfaceId}`),
  })),
} as const;

const request = {
  bindings: ['eth1', 'eth2'].map((interface_id) => ({
    interface_id, ingress_exact_stacks: [[]] as [][], egress_emit_stack: [] as [],
  })),
};

afterEach(() => vi.unstubAllGlobals());

describe('ApiL2ForwardingContextWriteDataSource', () => {
  it('posts only the bounded symmetric untagged operation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(document), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new ApiL2ForwardingContextWriteDataSource().createL2ForwardingContext(request)).resolves.toEqual(document);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/l2/forwarding-contexts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
  });

  it('rejects malformed successful responses at the datasource boundary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...document,
      forwarding_context_ref: ref('NetworkInterface', 'not-a-context'),
    }), { status: 201 })));

    await expect(new ApiL2ForwardingContextWriteDataSource().createL2ForwardingContext(request))
      .rejects.toThrow('forwarding_context_ref.entity_type must be "L2ForwardingContext"');
  });

  it('surfaces public backend errors without treating them as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'VALIDATION_ERROR', message: 'canonical uniqueness violation' },
    }), { status: 422 })));

    await expect(new ApiL2ForwardingContextWriteDataSource().createL2ForwardingContext(request))
      .rejects.toThrow('VALIDATION_ERROR: canonical uniqueness violation');
  });
});
