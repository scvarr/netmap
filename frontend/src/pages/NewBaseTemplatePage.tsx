import { useNavigate } from 'react-router-dom';
import { createBlueprintRequest } from '../blueprints/editorModel';
import { newBlueprintEditorState, BaseTemplateEditor } from './BaseTemplateEditor';
import type { BaseTemplateDataSource } from '../topology/baseTemplateTypes';
import { useI18n } from '../i18n';
import { Breadcrumbs, PageShell } from '../components/PageChrome';

export function NewBaseTemplatePage({ dataSource }: { dataSource: BaseTemplateDataSource }) {
  const navigate = useNavigate(); const { t } = useI18n();
  return <PageShell className="catalog-page blueprint-editor-page">
    <Breadcrumbs label={t('blueprint.breadcrumbs')} items={[{ label: t('blueprint.library.section') }, { label: t('blueprint.breadcrumb.library'), to: '/library/base-templates' }, { label: t('blueprint.breadcrumb.new') }]} />
    <BaseTemplateEditor initialState={newBlueprintEditorState()} title={t('hardware.newBase')} description={t('blueprint.new.description')} saveLabel={t('blueprint.new.save')} onSave={async (state) => { const result = createBlueprintRequest(state); if (!result.request) throw new Error(result.errors.join(' ')); await dataSource.createBaseTemplate(result.request); navigate('/library/base-templates'); }} />
  </PageShell>;
}
