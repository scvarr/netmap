import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ViewState } from '../components/ViewState';
import { useI18n } from '../i18n';
import type { PortBlockDataSource, PortBlockListDocument } from '../topology/portBlockTypes';

export function PortBlockLibraryPage({ dataSource }: { dataSource: PortBlockDataSource }) {
  const { t } = useI18n(); const navigate = useNavigate(); const [document, setDocument] = useState<PortBlockListDocument | null>(null); const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); return dataSource.loadPortBlocks().then(setDocument, (reason) => setError(reason instanceof Error ? reason.message : t('portBlock.library.loadFailed'))); };
  useEffect(() => { void refresh(); }, [dataSource]);
  if (error) return <main className="catalog-page"><ViewState kind="error" message={error} /></main>;
  if (!document) return <main className="catalog-page"><ViewState kind="loading" /></main>;
  return <main className="catalog-page"><header className="catalog-page__header"><div><p className="catalog-page__eyebrow">{t('portBlock.library.section')}</p><h1>{t('portBlock.library.title')}</h1><p>{t('portBlock.library.description')}</p></div><button className="primary-action" type="button" onClick={() => navigate('/library/port-blocks/new')}>{t('portBlock.library.create')}</button></header><div className="port-block-library__content">{document.port_blocks.length === 0 ? <ViewState kind="empty" message={t('portBlock.library.empty')} /> : <section className="port-block-grid" aria-label={t('portBlock.library.title')}>{document.port_blocks.map((item) => <article className="port-block-card" key={item.port_block_ref.entity_id}><div className="port-block-card__preview" aria-label={t('portBlock.library.preview', { name: item.name })}>{Array.from({ length: Math.min(item.port_count, 24) }, (_, index) => <span key={index}>{index + 1}</span>)}</div><div><h2>{item.name}</h2><p>{t('portBlock.library.versionSummary', { version: item.version_number, count: item.version_count })}</p><dl><div><dt>{t('portBlock.library.ports')}</dt><dd>{item.port_count}</dd></div></dl><div className="blueprint-card__actions"><Link to={`/library/port-blocks/${item.port_block_ref.entity_id}/versions/${item.version_ref.entity_id}/edit`}>{t('portBlock.library.newVersion')}</Link></div></div></article>)}</section>}</div></main>;
}
