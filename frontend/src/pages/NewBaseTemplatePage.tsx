import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createBlueprintRequest, hydrateBlueprintEditorState, type BlueprintEditorState } from '../blueprints/editorModel';
import { newBlueprintEditorState } from './BaseTemplateEditor';
import { LocalBaseTemplateEditor as BaseTemplateEditor } from './LocalBaseTemplateEditor';
import type { BaseTemplateDataSource } from '../topology/baseTemplateTypes';
import { useI18n } from '../i18n';
import { Breadcrumbs, PageShell } from '../components/PageChrome';

export function NewBaseTemplatePage({ dataSource }: { dataSource: BaseTemplateDataSource }) {
  const navigate = useNavigate(); const { t } = useI18n();
  const [params] = useSearchParams();
  const source = params.get('copyTemplate'); const revision = params.get('copyRevision');
  const [initial, setInitial] = useState<BlueprintEditorState>();
  const [failed, setFailed] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setInitial(undefined); setFailed(false);
    if (!source && !revision) setInitial(newBlueprintEditorState());
    else if (!source || !revision) setFailed(true);
    else void dataSource.loadBaseTemplateRevision(source, revision).then(document => {
      if (active) setInitial({ ...hydrateBlueprintEditorState(structuredClone(document)), name: t('templateCopy.name', { name: document.name }) });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [source, revision, dataSource, retry, t]);
  return <PageShell className="catalog-page blueprint-editor-page">
    <Breadcrumbs label={t('blueprint.breadcrumbs')} items={[{ label: t('blueprint.library.section') }, { label: t('blueprint.breadcrumb.library'), to: '/library/base-templates' }, { label: t('blueprint.breadcrumb.new') }]} />
    {failed && <p role="alert">{t('templateCopy.failed')} <button className="secondary-action" onClick={() => setRetry(value => value + 1)}>{t('action.retry')}</button></p>}
    {!initial && !failed && <p role="status">{t('templateLibrary.previewLoading')}</p>}
    {initial && <BaseTemplateEditor seeded={!!source} initialState={initial} title={t('hardware.newBase')} description={t('blueprint.new.description')} saveLabel={t('blueprint.new.save')} onSave={async (state) => { const result = createBlueprintRequest(state); if (!result.request) throw new Error(result.errors.join(' ')); await dataSource.createBaseTemplate(result.request); navigate('/library/base-templates'); }} />}
  </PageShell>;
}
