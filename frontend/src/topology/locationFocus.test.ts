import { describe, expect, it } from 'vitest';
import { locationDescendantIds } from './locationFocus';

const ref = (entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id });

describe('locationDescendantIds', () => {
  it('follows only explicit parent refs and ignores arbitrary user type strings', () => {
    const locations = [
      { location_ref: ref('root'), name: 'Site', type: 'completely arbitrary', parent_location_ref: null },
      { location_ref: ref('child'), name: 'Floor', type: 'not a taxonomy', parent_location_ref: ref('root') },
      { location_ref: ref('leaf'), name: 'Rack', type: 'anything', parent_location_ref: ref('child') },
      { location_ref: ref('other'), name: 'Same display name', type: 'Rack', parent_location_ref: null },
    ];
    expect(locationDescendantIds(locations, 'root')).toEqual(new Set(['root', 'child', 'leaf']));
  });
});
