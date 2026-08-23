import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ViewState } from '../components/ViewState';
import { displayCount, displayNodeLabel, numericAttribute, physicalClassPresentation } from '../topology/presentation';
import { PHYSICAL_PROJECTION_REQUEST, physicalObjectIdForNode } from '../topology/projection';
import type { TopologyDataSource, TopologyProjectionDocument } from '../topology/types';
import type { PhysicalObjectDeleteDataSource } from '../topology/physicalObjectDeleteTypes';

interface InfrastructureObjectsPageProps {
  dataSource: TopologyDataSource;
  physicalObjectDeleteDataSource?: PhysicalObjectDeleteDataSource;
}

export function InfrastructureObjectsPage({ dataSource, physicalObjectDeleteDataSource }: InfrastructureObjectsPageProps) {
  const [document, setDocument] = useState<TopologyProjectionDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setDocument(null);
    setError(null);
    void dataSource.loadProjection(PHYSICAL_PROJECTION_REQUEST).then(
      (nextDocument) => { if (current) setDocument(nextDocument); },
      (reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
      },
    );
    return () => { current = false; };
  }, [dataSource, retryKey]);

  const objects = document?.nodes.flatMap((node) => {
    const physicalObjectId = physicalObjectIdForNode(node);
    return physicalObjectId ? [{ node, physicalObjectId }] : [];
  }) ?? [];

  const deleteObject = async (physicalObjectId: string, label: string, isCable: boolean) => {
    if (!physicalObjectDeleteDataSource) return;
    const confirmation = isCable
      ? `Удалить кабель «${label}» и разорвать соединение?`
      : `Удалить объект «${label}»?`;
    if (!window.confirm(confirmation)) return;
    setDeleteError(null);
    try {
      await physicalObjectDeleteDataSource.deletePhysicalObject(physicalObjectId);
      setRetryKey((key) => key + 1);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Не удалось удалить объект');
    }
  };

  return (
    <main className="catalog-page">
      <header className="catalog-page__header">
        <div>
          <span className="eyebrow">Инфраструктура</span>
          <h1>Объекты</h1>
          <p>Canonical физические объекты, доступные в текущем workspace.</p>
        </div>
        <Link className="primary-action" to="/infrastructure/objects/new">Создать объект</Link>
      </header>
      <div className="catalog-filter-placeholder" aria-label="Область будущего поиска">
        <span aria-hidden="true">⌕</span>
        Поиск и фильтры появятся в следующих catalog slices
      </div>
      <section className="catalog-surface" aria-label="Список объектов">
        {!document && !error && <div className="catalog-state"><ViewState kind="loading" /></div>}
        {error && <div className="catalog-state"><ViewState kind="error" message={error} onRetry={() => setRetryKey((key) => key + 1)} /></div>}
        {document && objects.length === 0 && <div className="catalog-state"><ViewState kind="empty" /></div>}
        {document && objects.length > 0 && (
          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead><tr><th>Название</th><th>Класс</th><th>Точки</th><th>Интерфейсы</th><th><span className="sr-only">Действия</span></th></tr></thead>
              <tbody>{objects.map(({ node, physicalObjectId }) => {
                const classValue = typeof node.attributes.class === 'string' ? node.attributes.class : undefined;
                return (
                  <tr key={physicalObjectId}>
                    <td><Link to={`/infrastructure/objects/${encodeURIComponent(physicalObjectId)}`}>{displayNodeLabel(node)}</Link></td>
                    <td><strong>{physicalClassPresentation(classValue).label}</strong>{classValue && <code>{classValue}</code>}</td>
                    <td>{displayCount(numericAttribute(node, 'connection_point_count'))}</td>
                    <td>{displayCount(numericAttribute(node, 'owned_interface_count'))}</td>
                    <td className="catalog-table__actions">
                      <Link className="catalog-table__open" aria-label={`Открыть ${displayNodeLabel(node)}`} to={`/infrastructure/objects/${encodeURIComponent(physicalObjectId)}`}>→</Link>
                      {physicalObjectDeleteDataSource && (
                        <button
                          type="button"
                          className="catalog-table__delete"
                          aria-label={`Удалить ${displayNodeLabel(node)}`}
                          onClick={() => void deleteObject(physicalObjectId, displayNodeLabel(node), classValue === 'cable')}
                        >⌫</button>
                      )}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      {deleteError && <p className="catalog-note catalog-note--gap" role="alert">{deleteError}</p>}
      {document?.warnings.map((warning, index) => <p className="catalog-note" key={`warning-${index}-${warning}`}>{warning}</p>)}
      {document?.gaps.map((gap, index) => <p className="catalog-note catalog-note--gap" key={`gap-${index}-${gap}`}>{gap}</p>)}
    </main>
  );
}
