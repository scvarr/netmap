import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompositeNode } from './CompositeNode';

const node = (collapsed: boolean, onToggle = vi.fn()) => (
  <CompositeNode {...({
    data: { projection: { id: 'map-composite:rack', kind: 'MAP_COMPOSITE', label: 'Стойка A', source_refs: [], attributes: { collapsed, on_toggle: onToggle }, status: 'CONFIGURED' } },
    selected: false,
  } as any)} />
);

describe('CompositeNode', () => {
  it('shows the Russian UML-style frame header and collapsed expand control', () => {
    render(node(true));
    expect(screen.getByText('Стойка A')).toBeInTheDocument();
    expect(screen.getByText('«составной блок»')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Развернуть составной блок «Стойка A»' })).toHaveTextContent('+');
  });

  it('routes expanded minus through its callback without bubbling a node click', () => {
    const onToggle = vi.fn();
    const parentClick = vi.fn();
    render(<div onClick={parentClick}>{node(false, onToggle)}</div>);
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть составной блок «Стойка A»' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });
});
