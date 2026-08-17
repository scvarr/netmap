import type { ProjectionSourceRef, TopologySelection } from '../topology/types';

interface InspectorProps {
  selection: TopologySelection;
  onClose: () => void;
}

const SourceRef = ({ sourceRef }: { sourceRef: ProjectionSourceRef }) => (
  <li>
    <span>{sourceRef.entity_type}</span>
    <code>{sourceRef.entity_id}</code>
    <small>{sourceRef.ref_type}</small>
  </li>
);

export function Inspector({ selection, onClose }: InspectorProps) {
  if (!selection) {
    return (
      <aside className="inspector inspector--empty" aria-label="Инспектор">
        <div className="inspector__empty-icon">↖</div>
        <h2>Инспектор</h2>
        <p>Выберите устройство или связь на схеме, чтобы увидеть projection-данные и исходные ссылки.</p>
      </aside>
    );
  }

  const item = selection.item;
  const title = selection.type === 'node'
    ? selection.item.label
    : `${selection.item.from_node_id} → ${selection.item.to_node_id}`;

  return (
    <aside className="inspector" aria-label="Инспектор">
      <button className="inspector__close" onClick={onClose} aria-label="Закрыть инспектор">×</button>
      <span className="eyebrow">{selection.type === 'node' ? 'Устройство' : 'Связь'}</span>
      <h2>{title}</h2>
      <div className="inspector__facts">
        <div><span>Kind</span><strong>{item.kind}</strong></div>
        <div><span>Status</span><strong className="status-text">{item.status ?? 'UNKNOWN'}</strong></div>
        {selection.type === 'edge' && <div><span>Aggregate</span><strong>{selection.item.aggregate ? 'Да' : 'Нет'}</strong></div>}
      </div>
      <section>
        <h3>Атрибуты</h3>
        {Object.keys(item.attributes).length ? (
          <dl className="attribute-list">
            {Object.entries(item.attributes).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
            ))}
          </dl>
        ) : <p className="muted">Нет атрибутов</p>}
      </section>
      <section>
        <h3>Source refs <span>{item.source_refs.length}</span></h3>
        <ul className="source-refs">
          {item.source_refs.map((sourceRef) => (
            <SourceRef key={`${sourceRef.entity_type}-${sourceRef.entity_id}`} sourceRef={sourceRef} />
          ))}
        </ul>
      </section>
    </aside>
  );
}
