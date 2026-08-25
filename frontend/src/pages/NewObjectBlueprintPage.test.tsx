import { fireEvent, render, screen } from '@testing-library/react';
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
    await userEvent.clear(screen.getByLabelText('Ширина')); await userEvent.type(screen.getByLabelText('Ширина'), '480');
    await userEvent.clear(screen.getByLabelText('Высота')); await userEvent.type(screen.getByLabelText('Высота'), '6');
    expect(viewport).toHaveAttribute('data-preview-scale', '1');
    await userEvent.click(screen.getByRole('button', { name: 'Увеличить масштаб' }));
    expect(viewport).toHaveAttribute('data-preview-scale', '1.25');
    await userEvent.click(screen.getByRole('button', { name: 'Вписать' }));
    expect(viewport).toHaveAttribute('data-preview-scale', '1');
    expect(screen.getByRole('img')).toHaveAttribute('data-ratio', '80');
  });

  it('uses human-facing port groups, pair rules, and synchronized color controls', async () => {
    render(<MemoryRouter><NewObjectBlueprintPage dataSource={dataSource()} /></MemoryRouter>);
    expect(screen.getByLabelText('Тип объекта')).toBeInTheDocument();
    expect(screen.queryByText(/Body kind/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Группы портов' })).toBeInTheDocument();
    expect(screen.getByLabelText('Тип порта 1')).toHaveTextContent('Точка подключения');
    expect(screen.getByLabelText('Сторона схемы 1')).toHaveTextContent('Слева');
    expect(screen.getByLabelText('Начало диапазона 1')).toHaveValue(0);
    expect(screen.getByLabelText('Длина диапазона 1')).toHaveValue(1);
    const picker = screen.getByLabelText('Выбор цвета'); const hex = screen.getByLabelText('Цвет (hex)');
    fireEvent.change(hex, { target: { value: '#112233' } }); expect(picker).toHaveValue('#112233');
    fireEvent.change(picker, { target: { value: '#445566' } }); expect(hex).toHaveValue('#445566');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить группу портов' }));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить правило пар по номеру' }));
    expect(screen.getByText(/Правило соединяет порт 1 одной группы/)).toBeInTheDocument();
    expect(screen.getByLabelText('Первая группа правила 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Вторая группа правила 1')).toBeInTheDocument();
  });
});
