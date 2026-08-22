import { describe, expect, it } from 'vitest';
import type { DeviceFlowNode } from './layout';
import {
  applyTopologyPositionOverrides,
  BrowserTopologyLayoutStore,
} from './layoutStore';

describe('BrowserTopologyLayoutStore', () => {
  it('restores saved positions through a new store instance', () => {
    const storage = window.localStorage;
    storage.clear();
    new BrowserTopologyLayoutStore(storage).save('L1/PHYSICAL_OBJECT', {
      cable: { x: 120, y: 340 },
    });

    expect(new BrowserTopologyLayoutStore(storage).load('L1/PHYSICAL_OBJECT')).toEqual({
      cable: { x: 120, y: 340 },
    });
  });

  it('keeps logical and physical layouts independent and clears only one view', () => {
    const storage = window.localStorage;
    storage.clear();
    const store = new BrowserTopologyLayoutStore(storage);
    store.save('L1/PHYSICAL_OBJECT', { physical: { x: 1, y: 2 } });
    store.save('L2/DEVICE', { logical: { x: 3, y: 4 } });

    store.clear('L1/PHYSICAL_OBJECT');

    expect(store.load('L1/PHYSICAL_OBJECT')).toEqual({});
    expect(store.load('L2/DEVICE')).toEqual({ logical: { x: 3, y: 4 } });
  });

  it('ignores stale overrides for nodes absent from the projection', () => {
    const node = {
      id: 'present', type: 'device', position: { x: 10, y: 20 }, data: { projection: {} },
    } as DeviceFlowNode;

    expect(applyTopologyPositionOverrides([node], {
      present: { x: 30, y: 40 },
      removed: { x: 500, y: 600 },
    })).toEqual([{ ...node, position: { x: 30, y: 40 } }]);
  });
});
