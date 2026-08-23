import { useState, type FormEvent } from 'react';
import type { DeviceDetailsDataSource, DeviceInterfaceDetails } from '../topology/deviceDetailsTypes';
import type { InterfacePhysicalTraceArtifact, InterfacePhysicalTraceDataSource } from '../topology/interfacePhysicalTraceTypes';
import { physicalObjectIdForNode } from '../topology/projection';
import type { TopologyProjectionDocument, TopologyProjectionNode } from '../topology/types';

interface TraceCommandBarProps {
  document: TopologyProjectionDocument | null;
  deviceDetailsDataSource: DeviceDetailsDataSource;
  traceDataSource?: InterfacePhysicalTraceDataSource;
}

interface ParsedTraceCommand { sourceLabel: string; destinationLabel: string; }

interface EndpointChoice { label: string; interfaces: DeviceInterfaceDetails[]; selectedId?: string; }

interface PendingTrace { source: EndpointChoice; destination: EndpointChoice; }

export const parseTraceCommand = (input: string): ParsedTraceCommand | Error => {
  const parts = input.trim().split(/\s+/);
  if (parts.length !== 4 || parts[0].toLowerCase() !== 'trace' || parts[3].toLowerCase() !== 'l1') {
    return new Error('Поддерживается только команда: trace <source> <destination> l1');
  }
  if (!parts[1] || !parts[2]) return new Error('Укажите source и destination устройства.');
  return { sourceLabel: parts[1], destinationLabel: parts[2] };
};

const resolveDevice = (document: TopologyProjectionDocument, label: string): TopologyProjectionNode | Error => {
  const matches = document.nodes.filter((node) => node.label === label);
  if (matches.length === 0) return new Error(`Устройство «${label}» отсутствует в текущей логической схеме.`);
  if (matches.length > 1) return new Error(`Устройство «${label}» неоднозначно: найдено несколько узлов.`);
  if (!physicalObjectIdForNode(matches[0])) return new Error(`Узел «${label}» не содержит однозначной ссылки на PhysicalObject.`);
  return matches[0];
};

const endpointChoice = (label: string, interfaces: DeviceInterfaceDetails[]): EndpointChoice | Error => {
  if (interfaces.length === 0) return new Error(`У устройства «${label}» нет NetworkInterface для L1 trace.`);
  return { label, interfaces, selectedId: interfaces.length === 1 ? interfaces[0].interface_ref.entity_id : undefined };
};

const warningText = (warning: Record<string, unknown>) => JSON.stringify(warning);

export function TraceCommandBar({ document, deviceDetailsDataSource, traceDataSource }: TraceCommandBarProps) {
  const [command, setCommand] = useState('');
  const [pending, setPending] = useState<PendingTrace | null>(null);
  const [result, setResult] = useState<InterfacePhysicalTraceArtifact | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runTrace = async (sourceId: string, destinationId: string) => {
    if (!traceDataSource) { setMessage('L1 trace datasource пока недоступен.'); return; }
    setLoading(true); setMessage(null); setResult(null);
    try {
      setResult(await traceDataSource.traceInterfacePhysical({ from_interface_id: sourceId, to_interface_id: destinationId }));
      setPending(null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось выполнить L1 trace.');
    } finally { setLoading(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null); setResult(null); setPending(null);
    const parsed = parseTraceCommand(command);
    if (parsed instanceof Error) { setMessage(parsed.message); return; }
    if (!document || document.layer !== 'L2' || document.detail_level !== 'DEVICE') {
      setMessage('Для trace нужна загруженная логическая DEVICE projection.'); return;
    }
    const sourceNode = resolveDevice(document, parsed.sourceLabel);
    const destinationNode = resolveDevice(document, parsed.destinationLabel);
    if (sourceNode instanceof Error) { setMessage(sourceNode.message); return; }
    if (destinationNode instanceof Error) { setMessage(destinationNode.message); return; }
    const sourceId = physicalObjectIdForNode(sourceNode);
    const destinationId = physicalObjectIdForNode(destinationNode);
    if (!sourceId || !destinationId) { setMessage('Невозможно разрешить выбранное устройство.'); return; }
    setLoading(true);
    try {
      const [sourceDetails, destinationDetails] = await Promise.all([
        deviceDetailsDataSource.loadDeviceDetails(sourceId),
        deviceDetailsDataSource.loadDeviceDetails(destinationId),
      ]);
      const source = endpointChoice(parsed.sourceLabel, sourceDetails.interfaces);
      const destination = endpointChoice(parsed.destinationLabel, destinationDetails.interfaces);
      if (source instanceof Error) { setMessage(source.message); return; }
      if (destination instanceof Error) { setMessage(destination.message); return; }
      if (source.selectedId && destination.selectedId) await runTrace(source.selectedId, destination.selectedId);
      else setPending({ source, destination });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось загрузить Device Details.');
    } finally { setLoading(false); }
  };

  const updateEndpoint = (key: keyof PendingTrace, selectedId: string) => setPending((current) => (
    current ? { ...current, [key]: { ...current[key], selectedId } } : current
  ));

  const tracePending = () => {
    if (pending?.source.selectedId && pending.destination.selectedId) {
      void runTrace(pending.source.selectedId, pending.destination.selectedId);
    }
  };

  return <section className="trace-command" aria-label="L1 trace command">
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="trace-command-input">Trace command</label>
      <input id="trace-command-input" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="trace PC1 PC2 l1" />
      <button type="submit" disabled={loading}>Trace</button>
    </form>
    {message && <p className="trace-command__message" role="alert">{message}</p>}
    {pending && <div className="trace-command__choices" aria-label="Выбор интерфейсов">
      {(['source', 'destination'] as const).map((key) => (
        <label key={key}>{key === 'source' ? 'Интерфейс источника' : 'Интерфейс назначения'}
          <select value={pending[key].selectedId ?? ''} onChange={(event) => updateEndpoint(key, event.target.value)}>
            <option value="">Выберите интерфейс</option>
            {pending[key].interfaces.map((item) => <option key={item.interface_ref.entity_id} value={item.interface_ref.entity_id}>{item.label}</option>)}
          </select>
        </label>
      ))}
      <button type="button" onClick={tracePending} disabled={loading || !pending.source.selectedId || !pending.destination.selectedId}>Трассировать L1</button>
    </div>}
    {result && <div className={`trace-result trace-result--${result.verdict.toLowerCase()}`} aria-label="Результат L1 trace">
      <strong>{result.verdict === 'REACHABLE' ? 'Физический L1-путь доказан' : 'Физический L1-путь не доказан'}</strong>
      {result.verdict === 'REACHABLE' && <span>Доказанных ветвей: {result.branches.length}</span>}
      {result.gaps.length > 0 && <p>Gaps: {result.gaps.map((gap) => gap.code).join(', ')}</p>}
      {result.warnings.length > 0 && <p>Warnings: {result.warnings.map(warningText).join('; ')}</p>}
    </div>}
  </section>;
}
