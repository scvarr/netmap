import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PortBlockStructurePreview } from './PortBlockStructurePreview';

describe('PortBlockStructurePreview', () => {
  it('shows exact-version labels in a fixed fit-to-box preview, independent of placement', () => {
    render(<PortBlockStructurePreview item={{ instanceKey: 'instance', portBlockRef: 'block', portBlockVersionRef: 'version', placement: { x: .8, y: .8, width: .08, height: .08 }, portBlockName: 'Dense panel', versionNumber: 4, ports: [{ local_id: 'p1', display_label: 'Gi1/0/1', kind: 'NETWORK_PORT', row: 1, column: 1, layout_order: 1 }, { local_id: 'p2', display_label: 'Gi1/0/2', kind: 'NETWORK_PORT', row: 1, column: 2, layout_order: 2 }], resolvedSlotKeys: {} }} />);
    const preview = screen.getByTestId('port-block-structure-preview');
    expect(preview).toHaveTextContent('Dense panel · v4'); expect(preview).toHaveTextContent('Gi1/0/1'); expect(preview).toHaveTextContent('Gi1/0/2');
    expect(preview.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 300 90');
  });
});
