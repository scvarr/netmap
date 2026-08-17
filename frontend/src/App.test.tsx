import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import type { TopologyDataSource } from './topology/types';

describe('App projection states', () => {
  it('renders the empty state from a data source response', async () => {
    const dataSource: TopologyDataSource = {
      loadProjection: async () => ({
        schema_version: '1.0', layer: 'L2', detail_level: 'DEVICE',
        nodes: [], edges: [], gaps: [], warnings: [],
      }),
    };
    render(<App dataSource={dataSource} />);
    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
  });

  it('renders an error and retries the injected data source', async () => {
    let calls = 0;
    const dataSource: TopologyDataSource = {
      loadProjection: async () => {
        calls += 1;
        if (calls === 1) throw new Error('fixture failed');
        return { schema_version: '1.0', layer: 'L2', detail_level: 'DEVICE', nodes: [], edges: [], gaps: [], warnings: [] };
      },
    };
    render(<App dataSource={dataSource} />);
    expect(await screen.findByText('fixture failed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
