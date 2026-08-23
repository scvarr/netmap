import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NewObjectBlueprintPage } from './NewObjectBlueprintPage';

const dataSource = () => ({ loadObjectBlueprints: vi.fn(), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn() });

describe('NewObjectBlueprintPage preview viewport', () => {
  it('keeps extreme shapes inside a bounded viewport and Fit resets presentation zoom', async () => {
    render(<MemoryRouter><NewObjectBlueprintPage dataSource={dataSource()} /></MemoryRouter>);
    const viewport = document.querySelector('.blueprint-preview-viewport') as HTMLElement;
    expect(viewport).toBeInTheDocument(); expect(viewport.style.aspectRatio).toBe('');
    await userEvent.clear(screen.getByLabelText('Width')); await userEvent.type(screen.getByLabelText('Width'), '480');
    await userEvent.clear(screen.getByLabelText('Height')); await userEvent.type(screen.getByLabelText('Height'), '6');
    expect(viewport).toHaveAttribute('data-preview-scale', '1');
    await userEvent.click(screen.getByRole('button', { name: 'Увеличить масштаб' }));
    expect(viewport).toHaveAttribute('data-preview-scale', '1.25');
    await userEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(viewport).toHaveAttribute('data-preview-scale', '1');
    expect(screen.getByRole('img')).toHaveAttribute('data-ratio', '80');
  });
});
