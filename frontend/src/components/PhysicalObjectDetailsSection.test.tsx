import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  PhysicalObjectDetailsDocument,
} from '../topology/physicalObjectDetailsTypes';
import type { TopologyProjectionNode } from '../topology/types';
import { PhysicalObjectDetailsSection } from './PhysicalObjectDetailsSection';

const node = (id: string): TopologyProjectionNode => ({
  id: `projection-${id}`,
  kind: 'PHYSICAL_OBJECT',
  label: `Object ${id}`,
  status: 'CONFIGURED',
  attributes: { connection_point_count: 2, owned_interface_count: 0 },
  source_refs: [{
    ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id,
  }],
});

const details = (id: string, pointLabel = 'Порт'): PhysicalObjectDetailsDocument => ({
  schema_version: '1.0',
  physical_object: { source_ref: node(id).source_refs[0], label: `Object ${id}` },
  connection_points: [{
    connection_point_ref: {
      ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: `${id}-point-1`,
    },
    label: pointLabel,
    cardinality: 1,
    incident_connection_count: 0,
    direct_interface_binding_count: 0,
    source_refs: [{
      ref_type: 'CANONICAL_FACT', entity_type: 'EntityMetadata', entity_id: `${id}-alias`,
    }],
  }, {
    connection_point_ref: {
      ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: `${id}-point-2`,
    },
    label: `ConnectionPoint ${id.slice(0, 8)}`,
    label_source: 'TECHNICAL_FALLBACK',
    cardinality: 4,
    incident_connection_count: 2,
    direct_interface_binding_count: 1,
    source_refs: [],
  }],
  owned_interface_count: 0,
  gaps: [],
  warnings: [],
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};

describe('PhysicalObjectDetailsSection', () => {
  it('naturally sorts rendered connection-point cards instead of preserving UUID order', async () => {
    const unordered = {
      ...details('object-a'),
      connection_points: ['R10', 'R20', 'R11', 'R09', 'R22', 'L02'].map((label, index) => ({
        ...details('object-a').connection_points[0],
        label,
        connection_point_ref: {
          ref_type: 'CANONICAL_FACT' as const,
          entity_type: 'ConnectionPoint',
          entity_id: `point-${index}`,
        },
      })),
    };
    render(<PhysicalObjectDetailsSection node={node('object-a')} dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(unordered) }} />);

    await screen.findByRole('heading', { name: 'L02' });
    expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent))
      .toEqual(['L02', 'R09', 'R10', 'R11', 'R20', 'R22']);
  });

  it('renders named points, factual counts, fallback, and collapsed raw refs', async () => {
    render(
      <PhysicalObjectDetailsSection
        node={node('object-a')}
        dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(details('object-a')) }}
      />,
    );

    const namedPoint = (await screen.findByRole('heading', { name: 'Порт' })).closest('article')!;
    expect(screen.getByRole('heading', { name: 'Точка object-a' })).toBeInTheDocument();
    expect(within(namedPoint).getByText('Cardinality:', { exact: false })).toHaveTextContent('Cardinality: 1');
    expect(within(namedPoint).getByText('Связей:', { exact: false })).toHaveTextContent('Связей: 0');
    expect(screen.getByText('Интерфейсов:', {
      exact: false,
      selector: '.physical-object-details__summary span',
    })).toHaveTextContent('Интерфейсов: 0');
    const technical = screen.getAllByText('Технические данные')[0].closest('details')!;
    await userEvent.click(within(technical).getByText('Технические данные'));
    expect(within(technical).getByText('EntityMetadata')).toBeInTheDocument();
  });

  it('shows a local error and retries without breaking the parent inspector', async () => {
    const loadPhysicalObjectDetails = vi.fn()
      .mockRejectedValueOnce(new Error('details unavailable'))
      .mockResolvedValueOnce(details('object-a'));
    render(
      <PhysicalObjectDetailsSection
        node={node('object-a')}
        dataSource={{ loadPhysicalObjectDetails }}
      />,
    );

    expect(await screen.findByText(/details unavailable/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Порт' })).toBeInTheDocument();
    expect(loadPhysicalObjectDetails).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale response replace the newly selected object', async () => {
    const first = deferred<PhysicalObjectDetailsDocument>();
    const second = deferred<PhysicalObjectDetailsDocument>();
    const loadPhysicalObjectDetails = vi.fn((id: string) => (
      id === 'object-a' ? first.promise : second.promise
    ));
    const { rerender } = render(
      <PhysicalObjectDetailsSection
        node={node('object-a')}
        dataSource={{ loadPhysicalObjectDetails }}
      />,
    );
    rerender(
      <PhysicalObjectDetailsSection
        node={node('object-b')}
        dataSource={{ loadPhysicalObjectDetails }}
      />,
    );

    second.resolve(details('object-b', 'Порт B'));
    expect(await screen.findByRole('heading', { name: 'Порт B' })).toBeInTheDocument();
    first.resolve(details('object-a', 'Порт A'));
    await Promise.resolve();
    expect(screen.queryByRole('heading', { name: 'Порт A' })).not.toBeInTheDocument();
  });

  it('does not request when the PhysicalObject ref is ambiguous', () => {
    const loadPhysicalObjectDetails = vi.fn();
    const ambiguous = {
      ...node('object-a'),
      source_refs: [...node('object-a').source_refs, ...node('object-b').source_refs],
    };
    render(
      <PhysicalObjectDetailsSection
        node={ambiguous}
        dataSource={{ loadPhysicalObjectDetails }}
      />,
    );

    expect(screen.getByText(/нет однозначной ссылки/)).toBeInTheDocument();
    expect(loadPhysicalObjectDetails).not.toHaveBeenCalled();
  });

  it('updates class from presets and reports authoritative refresh', async () => {
    const initial = details('object-a');
    const updated = {
      ...initial,
      physical_object: { ...initial.physical_object, class: 'switch' },
    };
    const setPhysicalObjectClass = vi.fn().mockResolvedValue(updated);
    const onClassUpdated = vi.fn();
    render(
      <PhysicalObjectDetailsSection
        node={node('object-a')}
        dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(initial) }}
        classWriteDataSource={{ setPhysicalObjectClass }}
        onClassUpdated={onClassUpdated}
      />,
    );

    await screen.findByText('ФИЗИЧЕСКИЙ ОБЪЕКТ');
    await userEvent.selectOptions(screen.getByLabelText('Классификация'), 'switch');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить тип' }));

    expect(setPhysicalObjectClass).toHaveBeenCalledWith('object-a', 'switch');
    expect(await screen.findByText('КОММУТАТОР')).toBeInTheDocument();
    expect(onClassUpdated).toHaveBeenCalledTimes(1);
  });

  it('adds a point from the authoritative response and requests projection refresh', async () => {
    const initial = details('object-a');
    const updated = {
      ...initial,
      connection_points: [...initial.connection_points, {
        connection_point_ref: {
          ref_type: 'CANONICAL_FACT' as const,
          entity_type: 'ConnectionPoint',
          entity_id: 'object-a-point-3',
        },
        label: 'Port02',
        cardinality: 1,
        incident_connection_count: 0,
        direct_interface_binding_count: 0,
        source_refs: [],
      }],
    };
    const createConnectionPoint = vi.fn().mockResolvedValue(updated);
    const onConnectionPointCreated = vi.fn();
    render(
      <PhysicalObjectDetailsSection
        node={node('object-a')}
        dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(initial) }}
        connectionPointWriteDataSource={{ createConnectionPoint }}
        onConnectionPointCreated={onConnectionPointCreated}
      />,
    );

    await screen.findByRole('heading', { name: 'Порт' });
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить точку' }));
    await userEvent.type(screen.getByLabelText('Название'), 'Port02');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByRole('heading', { name: 'Port02' })).toBeInTheDocument();
    expect(createConnectionPoint).toHaveBeenCalledWith('object-a', { display_name: 'Port02' });
    expect(onConnectionPointCreated).toHaveBeenCalledTimes(1);
  });
});
