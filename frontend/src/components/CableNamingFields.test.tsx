import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CableNamingFields } from './CableNamingFields';
import type { CableLabelDataSource, CableNamingInput } from '../topology/cableLabelTypes';

const templates = { loadCableLabelTemplates: vi.fn().mockResolvedValue({ schema_version: '1.0', templates: [{ id: 'fc', name: 'FC', description: 'Магистральные кабели', pattern: 'FC####', start_at: 1 }] }) } as unknown as CableLabelDataSource;

function CreateNamingFields() {
  const [value, onChange] = useState<CableNamingInput>({});
  return <CableNamingFields dataSource={templates} disabled={false} value={value} onChange={onChange} />;
}

describe('CableNamingFields create variant', () => {
  it('defaults to manual mode without template, generator checkbox, or DSL help', async () => {
    render(<CreateNamingFields />);

    expect(screen.getByRole('radio', { name: 'Ввести вручную' })).toBeChecked();
    expect(screen.getByLabelText('Имя кабеля')).toBeInTheDocument();
    expect(screen.queryByLabelText('Шаблон')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Сгенерировать/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/# — цифра/)).not.toBeInTheDocument();
  });

  it('shows template metadata only in generated mode', async () => {
    render(<CreateNamingFields />);

    await userEvent.click(screen.getByRole('radio', { name: 'Сгенерировать по шаблону' }));
    expect(screen.queryByLabelText('Имя кабеля')).not.toBeInTheDocument();
    await screen.findByRole('option', { name: 'FC' });
    await userEvent.selectOptions(screen.getByLabelText('Шаблон'), 'fc');
    expect(screen.getByLabelText('FC')).toHaveTextContent('Магистральные кабели');
    expect(screen.getByLabelText('FC')).toHaveTextContent('FC####');
    expect(screen.getByText('Будет назначено первое свободное имя по выбранному шаблону.')).toBeInTheDocument();
  });
});
