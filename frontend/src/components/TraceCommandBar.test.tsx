import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TraceCommandBar, parseTraceCommand } from './TraceCommandBar';
import type { DeviceDetailsDocument } from '../topology/deviceDetailsTypes';
import type { InterfacePhysicalTraceArtifact, InterfacePhysicalTraceDataSource, InterfacePhysicalTraceQuery } from '../topology/interfacePhysicalTraceTypes';
import type { TopologyProjectionDocument } from '../topology/types';

const sourceId = '00000000-0000-0000-0000-000000000101';
const targetId = '00000000-0000-0000-0000-000000000102';
const interfaceId = (suffix: string) => `00000000-0000-0000-0000-000000000${suffix}`;
const physicalRef = (entity_id: string) => ({ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id });
const interfaceDetails = (deviceId: string, label: string, ids: string[], labels?: string[]): DeviceDetailsDocument => ({
  schema_version: '1.0', device: { source_ref: physicalRef(deviceId), label },
  interfaces: ids.map((id, index) => ({
    interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: id },
    label: labels?.[index] ?? `eth${index}`, addresses: [], l2_binding_count: 0, l3_binding_count: 0,
    direct_physical_bindings: [], realization_down_count: 0, realization_up_count: 0, source_refs: [],
  })), gaps: [], warnings: [],
});
const document: TopologyProjectionDocument = {
  schema_version: '1.0', layer: 'L2', detail_level: 'DEVICE', edges: [], gaps: [], warnings: [],
  nodes: [
    { id: 'pc1', kind: 'NETWORK_DEVICE', label: 'PC1', source_refs: [physicalRef(sourceId)], attributes: {} },
    { id: 'pc2', kind: 'NETWORK_DEVICE', label: 'PC2', source_refs: [physicalRef(targetId)], attributes: {} },
  ],
};
const reachable: InterfacePhysicalTraceArtifact = {
  schema_version: 1, query: { from_interface_id: interfaceId('201'), to_interface_id: interfaceId('202') },
  verdict: 'REACHABLE', branches: [{ branch_id: 'branch-1', source_candidate_id: 'source', target_candidate_id: 'target', edge_ids: [], evidence_refs: [] }], nodes: [], edges: [], gaps: [], warnings: [],
};

const TraceHarness = ({ logicalDocument, deviceDetailsDataSource, traceDataSource, onTraceArtifact }: {
  logicalDocument: TopologyProjectionDocument;
  deviceDetailsDataSource: { loadDeviceDetails(id: string): Promise<DeviceDetailsDocument> };
  traceDataSource: InterfacePhysicalTraceDataSource;
  onTraceArtifact: (artifact: InterfacePhysicalTraceArtifact | null) => void;
}) => {
  const [traceArtifact, setTraceArtifact] = useState<InterfacePhysicalTraceArtifact | null>(null);
  return <TraceCommandBar logicalDocument={logicalDocument} deviceDetailsDataSource={deviceDetailsDataSource} traceDataSource={traceDataSource} traceArtifact={traceArtifact} onTraceArtifact={(artifact) => { setTraceArtifact(artifact); onTraceArtifact(artifact); }} />;
};

const renderBar = (overrides: { document?: TopologyProjectionDocument; details?: Record<string, DeviceDetailsDocument>; result?: InterfacePhysicalTraceArtifact } = {}) => {
  const details = overrides.details ?? {
    [sourceId]: interfaceDetails(sourceId, 'PC1', [interfaceId('201')]),
    [targetId]: interfaceDetails(targetId, 'PC2', [interfaceId('202')]),
  };
  const deviceDetailsDataSource = { loadDeviceDetails: vi.fn((id: string) => Promise.resolve(details[id])) };
  const traceDataSource: InterfacePhysicalTraceDataSource = {
    traceInterfacePhysical: vi.fn<(query: InterfacePhysicalTraceQuery) => Promise<InterfacePhysicalTraceArtifact>>().mockResolvedValue(overrides.result ?? reachable),
  };
  const onTraceArtifact = vi.fn();
  render(<TraceHarness logicalDocument={overrides.document ?? document} deviceDetailsDataSource={deviceDetailsDataSource} traceDataSource={traceDataSource} onTraceArtifact={onTraceArtifact} />);
  return { deviceDetailsDataSource, traceDataSource, onTraceArtifact };
};

const submit = async (value: string) => {
  await userEvent.type(screen.getByLabelText('Trace command'), value);
  await userEvent.click(screen.getByRole('button', { name: 'Trace' }));
};

describe('TraceCommandBar', () => {
  it('parses the first supported L1 command only', () => {
    expect(parseTraceCommand('trace PC1 PC2 l1')).toEqual({ sourceLabel: 'PC1', destinationLabel: 'PC2' });
    expect(parseTraceCommand('trace PC1 PC2 l2')).toBeInstanceOf(Error);
    expect(parseTraceCommand('PC1 PC2 l1')).toBeInstanceOf(Error);
  });

  it('resolves unique devices with one interface each and traces their exact IDs', async () => {
    const { deviceDetailsDataSource, traceDataSource } = renderBar();
    await submit('trace PC1 PC2 l1');
    await waitFor(() => expect(traceDataSource.traceInterfacePhysical).toHaveBeenCalledWith({
      from_interface_id: interfaceId('201'), to_interface_id: interfaceId('202'),
    }));
    expect(deviceDetailsDataSource.loadDeviceDetails).toHaveBeenCalledWith(sourceId);
    expect(deviceDetailsDataSource.loadDeviceDetails).toHaveBeenCalledWith(targetId);
    expect(await screen.findByText('Физический L1-путь доказан')).toBeInTheDocument();
    expect(screen.getByText('Доказанных ветвей: 1')).toBeInTheDocument();
  });

  it('does not call the API for duplicate labels', async () => {
    const duplicateDocument = { ...document, nodes: [...document.nodes, { ...document.nodes[0], id: 'pc1-copy' }] };
    const { traceDataSource, deviceDetailsDataSource } = renderBar({ document: duplicateDocument });
    await submit('trace PC1 PC2 l1');
    expect(await screen.findByText(/неоднозначно/)).toBeInTheDocument();
    expect(deviceDetailsDataSource.loadDeviceDetails).not.toHaveBeenCalled();
    expect(traceDataSource.traceInterfacePhysical).not.toHaveBeenCalled();

  });

  it('does not call the API for malformed commands or a missing label', async () => {
    const { traceDataSource } = renderBar();
    await submit('trace PC1 PC2 l2');
    expect(await screen.findByText(/Поддерживается только команда/)).toBeInTheDocument();
    expect(traceDataSource.traceInterfacePhysical).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Trace command'));
    await submit('trace absent PC2 l1');
    expect(await screen.findByText(/отсутствует/)).toBeInTheDocument();
    expect(traceDataSource.traceInterfacePhysical).not.toHaveBeenCalled();
  });

  it('requires an explicit interface choice for a multi-interface endpoint', async () => {
    const { traceDataSource } = renderBar({ details: {
      [sourceId]: interfaceDetails(sourceId, 'PC1', [interfaceId('211'), interfaceId('212')]),
      [targetId]: interfaceDetails(targetId, 'PC2', [interfaceId('202')]),
    } });
    await submit('trace PC1 PC2 l1');
    expect(await screen.findByLabelText('Интерфейс источника')).toBeInTheDocument();
    expect(traceDataSource.traceInterfacePhysical).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText('Интерфейс источника'), interfaceId('212'));
    await userEvent.click(screen.getByRole('button', { name: 'Трассировать L1' }));
    await waitFor(() => expect(traceDataSource.traceInterfacePhysical).toHaveBeenCalledWith({
      from_interface_id: interfaceId('212'), to_interface_id: interfaceId('202'),
    }));
  });

  it('sorts selectable interfaces in stable natural label order', async () => {
    renderBar({ details: {
      [sourceId]: interfaceDetails(sourceId, 'PC1', [interfaceId('211'), interfaceId('212'), interfaceId('213')], ['A10', 'A02', 'A01']),
      [targetId]: interfaceDetails(targetId, 'PC2', [interfaceId('202')]),
    } });
    await submit('trace PC1 PC2 l1');
    const selector = await screen.findByLabelText('Интерфейс источника') as HTMLSelectElement;
    expect(Array.from(selector.options, (option) => option.text)).toEqual(['Выберите интерфейс', 'A01', 'A02', 'A10']);
  });

  it('presents UNKNOWN as not proven and exposes public gaps and warnings', async () => {
    renderBar({ result: {
      ...reachable, verdict: 'UNKNOWN', branches: [],
      gaps: [{ code: 'L1_TOPOLOGY_INCOMPLETE' }], warnings: [{ code: 'OBSERVATION_STALE' }],
    } });
    await submit('trace PC1 PC2 l1');
    expect(await screen.findByText('Физический L1-путь не доказан')).toBeInTheDocument();
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
    expect(screen.getByText('Gaps: L1_TOPOLOGY_INCOMPLETE')).toBeInTheDocument();
    expect(screen.getByText('Warnings: {"code":"OBSERVATION_STALE"}')).toBeInTheDocument();
  });
});
