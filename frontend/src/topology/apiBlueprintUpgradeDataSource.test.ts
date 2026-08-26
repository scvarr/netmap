import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiBlueprintUpgradeDataSource,
  parseBlueprintUpgradeAnalysisDocument,
} from './apiBlueprintUpgradeDataSource';
import { BlueprintUpgradeApiError } from './blueprintUpgradeTypes';

const document = {
  schema_version: '1.0',
  status: 'OUTDATED',
  blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: '00000000-0000-4000-8000-000000000001' },
  current_version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: '00000000-0000-4000-8000-000000000002' },
  current_version_number: 1,
  target_version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: '00000000-0000-4000-8000-000000000003' },
  target_version_number: 2,
  compatible_changes: [{ code: 'SLOT_ADDED', slot_key: 'C', kind: 'NETWORK_PORT' }],
  blockers: [{ code: 'INTERNAL_LINK_REMOVED', slot_keys: ['A', 'B'], details: 'review required' }],
};

const response = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  ...init,
});

describe('ApiBlueprintUpgradeDataSource', () => {
  const fetchMock = vi.fn();

  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });

  it('parses a valid analysis document and preserves refs, status, changes, and blockers', async () => {
    fetchMock.mockResolvedValue(response(document));

    await expect(new ApiBlueprintUpgradeDataSource().analyzeBlueprintUpgrade('object/id')).resolves.toEqual(document);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/physical-objects/object%2Fid/blueprint-upgrade-analysis');
  });

  it.each([
    ['an unsupported status', { ...document, status: 'UNKNOWN' }],
    ['missing compatible_changes', (() => { const { compatible_changes: _changes, ...value } = document; return value; })()],
    ['missing blockers', (() => { const { blockers: _blockers, ...value } = document; return value; })()],
    ['a malformed library ref', { ...document, target_version_ref: { ...document.target_version_ref, entity_id: 'not-a-uuid' } }],
    ['a malformed change', { ...document, compatible_changes: [{ code: '' }] }],
  ])('rejects malformed analysis with %s', async (_label, malformed) => {
    fetchMock.mockResolvedValue(response(malformed));

    await expect(new ApiBlueprintUpgradeDataSource().analyzeBlueprintUpgrade('object')).rejects.toThrow(
      'Malformed Blueprint upgrade analysis response:',
    );
  });

  it('does not return malformed analysis documents from the standalone parser', () => {
    expect(() => parseBlueprintUpgradeAnalysisDocument({ ...document, blockers: {} })).toThrow(
      'Malformed Blueprint upgrade analysis response:',
    );
  });

  it('exposes a structured backend apply conflict', async () => {
    fetchMock.mockResolvedValue(response({
      error: { code: 'MODEL_ERROR', message: 'Blueprint upgrade review is stale', details: { reason: 'UPGRADE_CONFLICT' } },
    }, { status: 409 }));

    await expect(new ApiBlueprintUpgradeDataSource().applyBlueprintUpgrade('object', 'target')).rejects.toMatchObject({
      name: 'BlueprintUpgradeApiError', status: 409, code: 'MODEL_ERROR', details: { reason: 'UPGRADE_CONFLICT' },
    });
  });

  it('preserves status for malformed error envelopes without inventing an error code', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 502 }));

    try {
      await new ApiBlueprintUpgradeDataSource().analyzeBlueprintUpgrade('object');
      throw new Error('Expected the request to reject.');
    } catch (reason) {
      expect(reason).toBeInstanceOf(BlueprintUpgradeApiError);
      expect(reason).toMatchObject({ status: 502, code: null, message: 'Blueprint upgrade analysis request failed.' });
    }
  });
});
