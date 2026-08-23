import { useEffect, useState } from 'react';
import type { DeviceInterfaceDetails } from '../topology/deviceDetailsTypes';
import type { L2ForwardingContextCreationDocument, L2ForwardingContextWriteDataSource } from '../topology/l2ForwardingContextWriteTypes';

interface CreateUntaggedL2ForwardingContextProps {
  interfaces: DeviceInterfaceDetails[];
  dataSource: L2ForwardingContextWriteDataSource;
  onCreated: () => void;
}

export function CreateUntaggedL2ForwardingContext({
  interfaces,
  dataSource,
  onCreated,
}: CreateUntaggedL2ForwardingContextProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<L2ForwardingContextCreationDocument | null>(null);

  useEffect(() => {
    const knownIds = new Set(interfaces.map((item) => item.interface_ref.entity_id));
    setSelectedIds((current) => new Set([...current].filter((id) => knownIds.has(id))));
  }, [interfaces]);

  const toggle = (interfaceId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(interfaceId)) next.delete(interfaceId);
      else next.add(interfaceId);
      return next;
    });
    setError(null);
    setCreated(null);
  };

  const submit = async () => {
    if (submitting) return;
    const selected = interfaces.filter((item) => selectedIds.has(item.interface_ref.entity_id));
    if (selected.length < 2) {
      setError('Выберите минимум два owned interface текущего объекта.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
      const created = await dataSource.createL2ForwardingContext({
        bindings: selected.map((item) => ({
          interface_id: item.interface_ref.entity_id,
          ingress_exact_stacks: [[]],
          egress_emit_stack: [],
        })),
      });
      setCreated(created);
      setSelectedIds(new Set());
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="l2-forwarding" aria-labelledby="l2-forwarding-heading">
      <h3 id="l2-forwarding-heading">L2 forwarding</h3>
      <p>Создать untagged context</p>
      <p className="muted">Будут созданы symmetric untagged boundary rules. Счётчик L2 — только фактический контекст, а не список membership.</p>
      <fieldset disabled={submitting}>
        <legend>Owned interfaces</legend>
        {interfaces.map((item) => (
          <label key={item.interface_ref.entity_id}>
            <input
              type="checkbox"
              checked={selectedIds.has(item.interface_ref.entity_id)}
              onChange={() => toggle(item.interface_ref.entity_id)}
            />
            {item.label} <small>(L2 bindings: {item.l2_binding_count})</small>
          </label>
        ))}
      </fieldset>
      <button type="button" onClick={() => void submit()} disabled={submitting || selectedIds.size < 2}>
        {submitting ? 'Создаём…' : 'Создать L2 context'}
      </button>
      {error && <p className="l2-forwarding__error" role="alert">Не удалось создать L2 context. {error}</p>}
      {created && (
        <div className="l2-forwarding__success" role="status">
          L2 context создан.
          <details><summary>Технические данные</summary><code>{created.forwarding_context_ref.entity_id}</code></details>
        </div>
      )}
      <p className="muted">Существующие L2 contexts после обновления не показываются: public read/detail API для этого пока нет.</p>
    </section>
  );
}
