import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import type { CatalogInventoryEquipmentItem } from '../topology/catalogInventoryTypes';
import type { ConnectionPointDetails, PhysicalObjectDetailsDataSource } from '../topology/physicalObjectDetailsTypes';
import {
  ExactTraceRequestError, memberAddressKey, traceExactGroup, traceExactMember,
  type ExactMemberGroup, type ExactMemberTrace, type MemberAddress,
} from '../topology/exactMemberTrace';
import { ApiInterfacePhysicalTraceDataSource } from '../topology/apiInterfacePhysicalTraceDataSource';
import type { InterfacePhysicalTraceArtifact } from '../topology/interfacePhysicalTraceTypes';
import type { TopologyDataSource, TopologyProjectionDocument } from '../topology/types';
import { resolveTraceMemberNames, traceMemberLabel, traceObjectNames, tracePointNames } from '../topology/traceAddresses';

interface MemberChoice {
  address: MemberAddress;
  label: string;
  free?: boolean;
}

type PairChoice = { from: MemberChoice; to: MemberChoice };

interface Props {
  equipment: CatalogInventoryEquipmentItem[] | null;
  details: PhysicalObjectDetailsDataSource;
  group: boolean;
  projection?: TopologyProjectionDocument | null;
  projectionSource?: TopologyDataSource;
  onEvidence: (trace: ExactMemberTrace | null) => void;
}

function EndpointPicker<T extends { label: string; free?: boolean }>({ side, equipment, details, value, onChange, choicesFor, keyFor, kind, onChoices }: {
  side: 'source' | 'destination';
  equipment: CatalogInventoryEquipmentItem[] | null;
  details: PhysicalObjectDetailsDataSource;
  value: T | null;
  onChange: (value: T | null) => void;
  choicesFor: (objectName: string, points: ConnectionPointDetails[]) => T[];
  keyFor: (choice: T) => string;
  kind: 'member' | 'interface';
  onChoices?: (choices: T[]) => void;
}) {
  const { t } = useI18n();
  const [objectId, setObjectId] = useState('');
  const [loaded, setLoaded] = useState<{ choices: T[]; failed: boolean } | null>(null);
  const objectNames = traceObjectNames(equipment ?? []);
  const objectName = objectNames.get(objectId);
  useEffect(() => {
    if (!objectName) return;
    let active = true;
    details.loadPhysicalObjectDetails(objectId).then(({ connection_points: points }) => {
      if (!active) return;
      const choices = choicesFor(objectName, points);
      onChoices?.(choices);
      setLoaded({ choices, failed: false });
    }, () => { if (active) setLoaded({ choices: [], failed: true }); });
    return () => { active = false; };
  }, [choicesFor, details, objectId, objectName, onChoices]);

  const objectLabel = t(side === 'source' ? 'trace.source' : 'trace.destination');
  const endpointLabel = t(kind === 'member'
    ? side === 'source' ? 'trace.sourceMember' : 'trace.destinationMember'
    : side === 'source' ? 'trace.sourceInterface' : 'trace.destinationInterface');
  return <>
    <label>{objectLabel}
      <select aria-label={objectLabel} value={objectId} disabled={!equipment} onChange={event => {
        setLoaded(null);
        setObjectId(event.target.value);
        onChange(null);
      }}>
        <option value="">{t('trace.selectObject')}</option>
        {[...objectNames].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
    <label>{endpointLabel}
      <select aria-label={endpointLabel} disabled={!loaded?.choices.length} value={value ? keyFor(value) : ''}
        onChange={event => onChange(loaded?.choices.find(choice => keyFor(choice) === event.target.value) ?? null)}>
        <option value="">{t(kind === 'member' ? 'trace.selectMember' : 'trace.selectInterface')}</option>
        {loaded?.choices.map(choice => <option key={keyFor(choice)} value={keyFor(choice)}>
          {choice.label}{choice.free ? ` · ${t('trace.freeMember')}` : ''}
        </option>)}
      </select>
      {loaded?.failed && <small role="alert">{t(kind === 'member' ? 'trace.memberLoadFailed' : 'trace.interfaceLoadFailed')}</small>}
    </label>
  </>;
}

function memberChoices(objectName: string, points: ConnectionPointDetails[]): MemberChoice[] {
  const names = tracePointNames(objectName, points);
  return points.flatMap(point => {
    const point_id = point.connection_point_ref.entity_id;
    return Array.from({ length: point.cardinality }, (_, offset) => {
      const member_index = offset + 1;
      const member = point.members?.find(item => item.index === member_index);
      const designation = member?.designation;
      return {
        address: { point_id, member_index },
        label: traceMemberLabel(names.get(point_id) ?? point.label, member_index, designation),
        free: member?.occupied === false,
      };
    });
  });
}
const memberKey = (choice: MemberChoice) => memberAddressKey(choice.address);

export function ExactMemberTracePanel({ equipment, details, group, projection, projectionSource, onEvidence }: Props) {
  const { t } = useI18n();
  const [source, setSource] = useState<MemberChoice | null>(null);
  const [destination, setDestination] = useState<MemberChoice | null>(null);
  const [pairs, setPairs] = useState<PairChoice[]>([]);
  const [result, setResult] = useState<{ results: ExactMemberTrace[]; completeness?: ExactMemberGroup['completeness'] } | null>(null);
  const [resolvedNames, setResolvedNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const knownNames = useRef(new Map<string, string>());
  const rememberNames = useCallback((choices: MemberChoice[]) => {
    for (const choice of choices) knownNames.current.set(memberKey(choice), choice.label);
  }, []);
  useLayoutEffect(() => () => request.current?.abort(), []);

  const reset = () => {
    request.current?.abort();
    setLoading(false);
    setError(null);
    setResult(null);
    setResolvedNames(new Map());
    onEvidence(null);
  };
  const draft = source && destination ? { from: source, to: destination } : null;
  const endpointsMatch = (a: MemberChoice, b: MemberChoice) =>
    memberAddressKey(a.address) === memberAddressKey(b.address);

  function addPair() {
    if (!draft) return;
    reset();
    if (endpointsMatch(draft.from, draft.to) || pairs.some(pair =>
      endpointsMatch(pair.from, draft.from) || endpointsMatch(pair.to, draft.to))) {
      setError(t('trace.invalidPairs'));
      return;
    }
    setPairs([...pairs, draft]);
    setSource(null);
    setDestination(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    reset();
    if (group ? !pairs.length : !draft) return;
    if (!group && draft && endpointsMatch(draft.from, draft.to)) {
      setError(t('trace.invalidPairs'));
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const submitted = (group ? pairs : draft ? [draft] : []).map(({ from, to }) => ({ from: from.address, to: to.address }));
      const response = group ? await traceExactGroup(submitted, controller.signal)
        : { results: [await traceExactMember(submitted[0], controller.signal)] };
      if (controller.signal.aborted) return;
      setSelected(0);
      setResult(response);
      onEvidence(response.results[0]);
      const missing = new Map<string, MemberAddress>();
      for (const trace of response.results) {
        for (const { payload } of trace.nodes) {
          const key = memberAddressKey(payload);
          if (!knownNames.current.has(key)) missing.set(key, payload);
        }
      }
      const addresses = [...missing.values()];
      void resolveTraceMemberNames(addresses, equipment ?? [], details, projection, projectionSource, controller.signal)
        .then(names => { if (!controller.signal.aborted) setResolvedNames(names); });
    } catch (reason) {
      if (!controller.signal.aborted) setError(t(reason instanceof ExactTraceRequestError
        ? reason.code === 'MODEL_ERROR' ? 'trace.modelError' : 'trace.invalidPairs' : 'trace.failed'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const names = new Map((group ? pairs : draft ? [draft] : []).flatMap(({ from, to }) =>
    [from, to].map(member => [memberAddressKey(member.address), member.label])));
  const address = (value: MemberAddress) => {
    const key = memberAddressKey(value);
    return names.get(key) ?? resolvedNames.get(key) ?? knownNames.current.get(key)
      ?? t('trace.addressUnavailable', { point: value.point_id, index: value.member_index });
  };
  const trace = result?.results[selected];
  const nodes = new Map(trace?.nodes.map(node => [node.id, address(node.payload)]));
  const verdict = (value: ExactMemberTrace['verdict']) => t(value === 'REACHABLE' ? 'trace.reachable' : 'trace.unknown');

  return <>
    <form onSubmit={submit} aria-busy={loading}>
      <EndpointPicker kind="member" choicesFor={memberChoices} keyFor={memberKey} onChoices={rememberNames} side="source" equipment={equipment} details={details} value={source} onChange={value => { reset(); setSource(value); }} />
      <EndpointPicker kind="member" choicesFor={memberChoices} keyFor={memberKey} onChoices={rememberNames} side="destination" equipment={equipment} details={details} value={destination} onChange={value => { reset(); setDestination(value); }} />
      {group && <button type="button" disabled={!draft} onClick={addPair}>{t('trace.addPair')}</button>}
      <button type="submit" disabled={loading || (group ? !pairs.length : !draft)}>{t(group ? 'trace.verifyGroup' : 'trace.run')}</button>
    </form>
    {error && <p className="trace-command__message" role="alert">{error}</p>}
    {result?.completeness && <p className="trace-command__group-verdict" role="status">{t(`trace.group.${result.completeness}`)}</p>}
    {group && pairs.length > 0 && <ol className="trace-pairs">
      {pairs.map((pair, index) => {
        const row = result?.results[index];
        return <li key={memberAddressKey(pair.from.address)}>
          <span>{pair.from.label} → {pair.to.label}</span>
          {row && <button type="button" aria-pressed={selected === index} onClick={() => {
            setSelected(index);
            onEvidence(row);
          }}>{verdict(row.verdict)}</button>}
          <button type="button" onClick={() => { reset(); setPairs(pairs.filter(item => item !== pair)); }}>{t('trace.removePair')}</button>
        </li>;
      })}
    </ol>}
    {trace && <section className={`trace-result trace-result--${trace.verdict.toLowerCase()}`} aria-label={t('trace.result')}>
      {!group && <strong role="status">{verdict(trace.verdict)}</strong>}
      <p>{address(trace.query.from)} → {address(trace.query.to)}</p>
      {trace.edges.length > 0 && <details open>
        <summary>{t('trace.provenSegments', { count: trace.edges.length })}</summary>
        <ol>{trace.edges.map(edge => <li key={edge.id}>{nodes.get(edge.from_node_id)} → {nodes.get(edge.to_node_id)}</li>)}</ol>
      </details>}
      {trace.terminations.map(end => <p key={`${end.node_id}/${end.reason}`}>{t(`trace.end.${end.reason}`)} · {nodes.get(end.node_id)}</p>)}
      <button type="button" className="trace-result__clear" onClick={reset}>{t('trace.clear')}</button>
    </section>}
  </>;
}


type InterfaceChoice = { id: string; label: string };

function interfaceChoices(object: string, points: ConnectionPointDetails[]): InterfaceChoice[] {
  const bindings = new Map(points.flatMap(point => (point.direct_interface_bindings ?? []).map(binding =>
    [binding.interface_ref.entity_id, binding.label] as const)));
  const counts = new Map<string, number>();
  for (const label of bindings.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...bindings].map(([id, label]) => ({
    id, label: `${object} / ${label}${counts.get(label) === 1 ? '' : ` [${id}]`}`,
  }));
}

const interfaceKey = (choice: InterfaceChoice) => choice.id;
const interfaceTrace = new ApiInterfacePhysicalTraceDataSource();

export function InterfaceTracePanel({ equipment, details, onEvidence }: {
  equipment: CatalogInventoryEquipmentItem[] | null;
  details: PhysicalObjectDetailsDataSource;
  onEvidence: (trace: Pick<ExactMemberTrace, 'edges'> | null) => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<InterfaceChoice | null>(null);
  const [target, setTarget] = useState<InterfaceChoice | null>(null);
  const [result, setResult] = useState<InterfacePhysicalTraceArtifact | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useLayoutEffect(() => () => { generation.current += 1; }, []);

  function reset() {
    generation.current += 1;
    setResult(null);
    setSelected('');
    setError(null);
    setLoading(false);
    onEvidence(null);
  }

  function chooseBranch(artifact: InterfacePhysicalTraceArtifact, id: string) {
    setSelected(id);
    const branch = artifact.branches.find(item => item.branch_id === id);
    if (!branch) {
      onEvidence(null);
      return;
    }
    const edges = new Map(artifact.edges.map(edge => [edge.id, edge]));
    onEvidence({ edges: branch.edge_ids.flatMap(edgeId => {
      const edge = edges.get(edgeId);
      return edge ? [edge] : [];
    }) });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    reset();
    if (!source || !target || source.id === target.id) return;
    const request = generation.current;
    setLoading(true);
    try {
      const artifact = await interfaceTrace.traceInterfacePhysical({ from_interface_id: source.id, to_interface_id: target.id });
      if (request !== generation.current) return;
      setResult(artifact);
      chooseBranch(artifact, artifact.branches[0]?.branch_id ?? '');
    } catch (reason) {
      if (request === generation.current) setError(t(reason instanceof Error && reason.message.startsWith('MODEL_ERROR:')
        ? 'trace.modelError' : 'trace.failed'));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  return <>
    <form onSubmit={submit} aria-busy={loading}>
      <EndpointPicker kind="interface" choicesFor={interfaceChoices} keyFor={interfaceKey} side="source"
        equipment={equipment} details={details} value={source} onChange={value => { reset(); setSource(value); }} />
      <EndpointPicker kind="interface" choicesFor={interfaceChoices} keyFor={interfaceKey} side="destination"
        equipment={equipment} details={details} value={target} onChange={value => { reset(); setTarget(value); }} />
      <button type="submit" disabled={loading || !source || !target || source.id === target.id}>{t('trace.run')}</button>
    </form>
    {error && <p className="trace-command__message" role="alert">{error}</p>}
    {result && <section className={`trace-result trace-result--${result.verdict.toLowerCase()}`} aria-label={t('trace.result')}>
      <strong role="status">{t(result.verdict === 'REACHABLE' ? 'trace.reachable' : 'trace.unknown')}</strong>
      {result.branches.length > 0 && <label>{t('trace.showAlternative')}
        <select aria-label={t('trace.showAlternative')} value={selected} onChange={event => chooseBranch(result, event.target.value)}>
          {result.branches.map((branch, index) => <option key={branch.branch_id} value={branch.branch_id}>
            {t('trace.alternative', { index: index + 1 })}
          </option>)}
        </select>
      </label>}
      <button type="button" className="trace-result__clear" onClick={reset}>{t('trace.clear')}</button>
    </section>}
  </>;
}
