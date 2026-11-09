import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RuntimePortTypes, RuntimePortLabel } from './RuntimePortTypes';

it('shares one archived catalog across ordinary, module and passive channel labels and leaves manual points neutral', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [{ id: 'type', name: 'Copper', color: '#123456', is_active: false }] } as Response);
  const point = { blueprint_slot: { port_type_id: 'type', kind: 'NETWORK_PORT', slot_key: 'base' } } as any;
  render(<RuntimePortTypes><RuntimePortLabel point={point} label="Base" /><RuntimePortTypes><RuntimePortLabel point={{ ...point, blueprint_slot: { ...point.blueprint_slot, kind: 'CONNECTION_POINT', slot_key: 'installation:port' } }} label="Channel A" /><RuntimePortLabel point={point} label="Channel B" /><RuntimePortLabel point={{} as any} label="Manual" /></RuntimePortTypes></RuntimePortTypes>);
  expect(await screen.findAllByText('Copper')).toHaveLength(3);
  expect(document.querySelectorAll('.runtime-port-type')).toHaveLength(3);
  expect(document.querySelector('.runtime-port-type > span')).toHaveStyle({ backgroundColor: '#123456', borderRadius: '0' });
  expect(document.body).toHaveTextContent('Manual');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockRestore();
});
