import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  displayCount,
  displayNodeLabel,
  numericAttribute,
  physicalClassPresentation,
} from '../topology/presentation';
import { physicalObjectIdForNode } from '../topology/projection';
import type {
  TopologyProjectionDocument,
  TopologyProjectionNode,
  TopologySelection,
} from '../topology/types';

interface QuickInspectorProps {
  document: TopologyProjectionDocument | null;
  selection: TopologySelection;
  onSelectNode: (node: TopologyProjectionNode) => void;
  onClose: () => void;
  onDeletePhysicalObject?: (physicalObjectId: string) => Promise<void>;
  onRemoveFromMap?: (physicalObjectId: string) => Promise<void>;
  onAddContinuationToMap?: (physicalObjectId: string) => Promise<void>;
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div><span>{label}</span><strong>{value}</strong></div>
);

export function QuickInspector({
  document,
  selection,
  onSelectNode,
  onClose,
  onDeletePhysicalObject,
  onRemoveFromMap,
  onAddContinuationToMap,
}: QuickInspectorProps) {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  if (!selection) return null;
  const nodesById = new Map(document?.nodes.map((node) => [node.id, node]) ?? []);

  if (selection.type === 'continuation') {
    const continuation = selection.item;
    const remoteObjectId = continuation.remote_physical_object_ref.entity_id;
    return (
      <aside className="quick-inspector" aria-label="Быстрый инспектор">
        <button className="quick-inspector__close" onClick={onClose} aria-label="Закрыть инспектор">×</button>
        <span className="eyebrow">L1 continuation</span>
        <h2>{continuation.local_connection_point_display_name} → {continuation.cable_display_name} → {continuation.remote_display_name}/{continuation.remote_connection_point_display_name}</h2>
        <p className="quick-inspector__unavailable">Целевой объект не добавлен на эту карту.</p>
        <Link className="quick-inspector__primary" to={`/infrastructure/objects/${encodeURIComponent(remoteObjectId)}`}>Открыть объект в Catalog</Link>
        {onAddContinuationToMap && <button type="button" onClick={() => void onAddContinuationToMap(remoteObjectId)}>Добавить объект на карту</button>}
        <details className="quick-inspector__technical">
          <summary>Технические детали</summary>
          <dl>
            <div><dt>Local ConnectionPoint</dt><dd>{continuation.local_connection_point_ref.entity_id}</dd></div>
            <div><dt>Cable</dt><dd>{continuation.cable_ref.entity_id}</dd></div>
            <div><dt>Remote PhysicalObject</dt><dd>{remoteObjectId}</dd></div>
            <div><dt>Remote ConnectionPoint</dt><dd>{continuation.remote_connection_point_ref.entity_id}</dd></div>
          </dl>
        </details>
      </aside>
    );
  }

  if (selection.type === 'node') {
    const node = selection.item;
    const physicalObjectId = physicalObjectIdForNode(node);
    const incidentEdges = document?.edges.filter((edge) => (
      edge.from_node_id === node.id || edge.to_node_id === node.id
    )) ?? [];
    const isPhysical = document?.layer === 'L1';
    const classLabel = isPhysical
      ? physicalClassPresentation(node.attributes.class).label
      : node.attributes.class
        ? physicalClassPresentation(node.attributes.class).label
        : 'СЕТЕВОЙ ОБЪЕКТ';
    const isCable = node.attributes.class === 'cable';
    const deleteLabel = isCable
      ? `Удалить кабель «${displayNodeLabel(node)}» и разорвать соединение?`
      : `Удалить объект «${displayNodeLabel(node)}»?`;
    const deleteObject = async () => {
      if (!physicalObjectId || !onDeletePhysicalObject || !window.confirm(deleteLabel)) return;
      setDeleteError(null);
      try { await onDeletePhysicalObject(physicalObjectId); } catch (reason) {
        setDeleteError(reason instanceof Error ? reason.message : 'Не удалось удалить объект');
      }
    };

    return (
      <aside className="quick-inspector" aria-label="Быстрый инспектор">
        <button className="quick-inspector__close" onClick={onClose} aria-label="Закрыть инспектор">×</button>
        <span className="eyebrow">{classLabel}</span>
        <h2>{displayNodeLabel(node)}</h2>
        <div className="quick-inspector__facts">
          {isPhysical && (
            <Metric
              label="Точек подключения"
              value={displayCount(numericAttribute(node, 'connection_point_count'))}
            />
          )}
          <Metric
            label="Интерфейсов"
            value={displayCount(numericAttribute(node, 'owned_interface_count'))}
          />
          <Metric label={isPhysical ? 'Физических связей' : 'Связей'} value={String(incidentEdges.length)} />
        </div>
        {physicalObjectId ? (
          <Link className="quick-inspector__primary" to={`/infrastructure/objects/${encodeURIComponent(physicalObjectId)}`}>
            Открыть объект
          </Link>
        ) : (
          <p className="quick-inspector__unavailable">У объекта нет однозначной canonical-ссылки.</p>
        )}
        {isPhysical && physicalObjectId && onDeletePhysicalObject && (
          <button type="button" onClick={() => void deleteObject()}>Удалить</button>
        )}
        {isPhysical && physicalObjectId && onRemoveFromMap && (
          <button type="button" onClick={() => void onRemoveFromMap(physicalObjectId)}>Убрать с карты</button>
        )}
        {deleteError && <p role="alert">{deleteError}</p>}
        <details className="quick-inspector__technical">
          <summary>Технические детали</summary>
          <dl>
            <div><dt>Projection ID</dt><dd>{node.id}</dd></div>
            <div><dt>Kind</dt><dd>{node.kind}</dd></div>
          </dl>
        </details>
      </aside>
    );
  }

  const edge = selection.item;
  const source = nodesById.get(edge.from_node_id);
  const target = nodesById.get(edge.to_node_id);
  return (
    <aside className="quick-inspector" aria-label="Быстрый инспектор">
      <button className="quick-inspector__close" onClick={onClose} aria-label="Закрыть инспектор">×</button>
      <span className="eyebrow">Связь проекции</span>
      <h2>{source ? displayNodeLabel(source) : 'Неизвестный объект'} ↔ {target ? displayNodeLabel(target) : 'Неизвестный объект'}</h2>
      <div className="quick-inspector__facts">
        <Metric label="Агрегированная" value={edge.aggregate ? 'Да' : 'Нет'} />
        <Metric label="Source refs" value={String(edge.source_refs.length)} />
      </div>
      <div className="quick-inspector__endpoints">
        {source && <button onClick={() => onSelectNode(source)}>{displayNodeLabel(source)}</button>}
        {target && <button onClick={() => onSelectNode(target)}>{displayNodeLabel(target)}</button>}
      </div>
      <details className="quick-inspector__technical">
        <summary>Технические детали</summary>
        <dl>
          <div><dt>Projection ID</dt><dd>{edge.id}</dd></div>
          <div><dt>Kind</dt><dd>{edge.kind}</dd></div>
        </dl>
      </details>
    </aside>
  );
}
