import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ViewState } from '../components/ViewState';
import { displayCount, displayNodeLabel, numericAttribute, physicalClassPresentation } from '../topology/presentation';
import { PHYSICAL_PROJECTION_REQUEST, physicalObjectIdForNode } from '../topology/projection';
import type { TopologyDataSource, TopologyProjectionDocument } from '../topology/types';

interface InfrastructureObjectsPageProps {
  dataSource: TopologyDataSource;
}

export function InfrastructureObjectsPage({ dataSource }: InfrastructureObjectsPageProps) {
  const [document, setDocument] = useState<TopologyProjectionDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

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
              <thead><tr><th>Название</th><th>Класс</th><th>Точки</th><th>Интерфейсы</th><th><span className="sr-only">Открыть</span></th></tr></thead>
              <tbody>{objects.map(({ node, physicalObjectId }) => {
                const classValue = typeof node.attributes.class === 'string' ? node.attributes.class : undefined;
                return (
                  <tr key={physicalObjectId}>
                    <td><Link to={`/infrastructure/objects/${encodeURIComponent(physicalObjectId)}`}>{displayNodeLabel(node)}</Link></td>
                    <td><strong>{physicalClassPresentation(classValue).label}</strong>{classValue && <code>{classValue}</code>}</td>
                    <td>{displayCount(numericAttribute(node, 'connection_point_count'))}</td>
                    <td>{displayCount(numericAttribute(node, 'owned_interface_count'))}</td>
                    <td><Link className="catalog-table__open" aria-label={`Открыть ${displayNodeLabel(node)}`} to={`/infrastructure/objects/${encodeURIComponent(physicalObjectId)}`}>→</Link></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      {document?.warnings.map((warning, index) => <p className="catalog-note" key={`warning-${index}-${warning}`}>{warning}</p>)}
      {document?.gaps.map((gap, index) => <p className="catalog-note catalog-note--gap" key={`gap-${index}-${gap}`}>{gap}</p>)}
    </main>
  );
}
