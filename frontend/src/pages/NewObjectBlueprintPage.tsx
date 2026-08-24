import { Link, useNavigate } from 'react-router-dom';
import { createBlueprintRequest } from '../blueprints/editorModel';
import { newBlueprintEditorState, ObjectBlueprintEditor } from './ObjectBlueprintEditor';
import type { ObjectBlueprintDataSource } from '../topology/objectBlueprintTypes';

export function NewObjectBlueprintPage({ dataSource }: { dataSource: ObjectBlueprintDataSource }) {
  const navigate = useNavigate();
  return <main className="catalog-page blueprint-editor-page"><div className="breadcrumbs"><Link to="/library/object-blueprints">Библиотека</Link><span>/</span><span>Новый шаблон</span></div><ObjectBlueprintEditor initialState={newBlueprintEditorState()} title="Создать шаблон объекта" description="Настройте форму и группы портов. При сохранении будут созданы точные порты и внутренние связи." saveLabel="Сохранить шаблон" onSave={async (editor) => { const result = createBlueprintRequest(editor); if (!result.request) throw new Error(result.errors.join(' ')); await dataSource.createObjectBlueprint(result.request); navigate('/library/object-blueprints'); }} /></main>;
}
