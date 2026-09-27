import { describe, expect, it } from 'vitest';
import { parseObjectBlueprintVersionDocument } from './apiObjectBlueprintDataSource';

const version = {
  schema_version: '2.0',
  blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' },
  version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v' },
  version_number: 1, name: 'Blueprint', body: { kind: 'RECTANGLE', width: 100, height: 40 },
  panels: [{ panel_key: 'opaque-panel', panel_number: 1, display_name: 'Панель 1', x: 0, y: 0, width: 100, height: 40 }],
  slots: [{ key: 'opaque-slot', display_name: '1-1', kind: 'NETWORK_PORT', panel_key: 'opaque-panel', rendered_position: { x: .2, y: .3 } }],
  internal_links: [],
};

describe('Blueprint v2 API document', () => {
  it('preserves exact panel keys, names and local endpoint positions', () => {
    expect(parseObjectBlueprintVersionDocument(version)).toMatchObject({ panels: version.panels, slots: version.slots });
  });
  it('rejects an endpoint assigned to an unknown panel', () => {
    expect(() => parseObjectBlueprintVersionDocument({ ...version, slots: [{ ...version.slots[0], panel_key: 'other' }] })).toThrow('membership');
  });
  it('rejects the former face representation', () => {
    expect(() => parseObjectBlueprintVersionDocument({ ...version, schema_version: '1.0', panels: undefined })).toThrow('invalid shape');
  });
});
