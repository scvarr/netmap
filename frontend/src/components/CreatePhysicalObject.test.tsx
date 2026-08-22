import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { physicalObjectDocument } from '../test/physicalObjectDetailsFixture';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import { CreatePhysicalObject } from './CreatePhysicalObject';

describe('CreatePhysicalObject', () => {
  it('guards blank names and prevents double submit', async () => {
    let resolveRequest!: (value: PhysicalObjectDetailsDocument) => void;
    const createPhysicalObject = vi.fn(() => new Promise<PhysicalObjectDetailsDocument>((resolve) => {
      resolveRequest = resolve;
    }));
    const onCreated = vi.fn();
    render(<CreatePhysicalObject dataSource={{ createPhysicalObject }} onCreated={onCreated} />);

    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    const submit = screen.getByRole('button', { name: 'Создать' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Название'), '  Розетка 101-1  ');
    await userEvent.type(screen.getByLabelText('Первая точка подключения'), '  Порт  ');
    await userEvent.click(submit);
    await userEvent.click(submit);

    expect(createPhysicalObject).toHaveBeenCalledTimes(1);
    expect(createPhysicalObject).toHaveBeenCalledWith({
      display_name: 'Розетка 101-1',
      initial_connection_point: { display_name: 'Порт' },
    });
    resolveRequest(physicalObjectDocument);
    expect(await screen.findByRole('button', { name: '+ Добавить' })).toHaveAttribute(
      'aria-expanded', 'false',
    );
    expect(onCreated).toHaveBeenCalledWith(physicalObjectDocument);
  });

  it('keeps a backend error in the form for retry', async () => {
    const createPhysicalObject = vi.fn().mockRejectedValue(new Error('backend unavailable'));
    render(<CreatePhysicalObject dataSource={{ createPhysicalObject }} onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await userEvent.type(screen.getByLabelText('Название'), 'Розетка 101-1');
    await userEvent.type(screen.getByLabelText('Первая точка подключения'), 'Порт');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('backend unavailable');
    expect(screen.getByLabelText('Название')).toHaveValue('Розетка 101-1');
    expect(screen.getByRole('button', { name: 'Создать' })).toBeEnabled();
  });
});
