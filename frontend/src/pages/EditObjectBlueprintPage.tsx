import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createBlueprintRequest, type BlueprintEditorState } from '../blueprints/editorModel';
import { ObjectBlueprintEditor } from './ObjectBlueprintEditor';
import { ViewState } from '../components/ViewState';
import type { ObjectBlueprintDataSource, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';

const hydrate = (version: ObjectBlueprintVersionDocument): BlueprintEditorState | null => {
  const recipe = version.authoring_recipe; if (!recipe) return null;
  return { name: version.name, defaultClass: version.default_physical_object_class ?? '', width: version.body.width, height: version.body.height, fillColor: version.body.fill_color ?? '#28565a', groups: recipe.endpoint_groups.map(group => ({ id: group.group_id, keyPrefix: group.key_prefix, displayPrefix: group.display_prefix, kind: group.kind, side: group.side, count: group.count, startingNumber: group.starting_number })), pairs: recipe.pair_recipes.map(pair => ({ leftGroupId: pair.group_a_id, rightGroupId: pair.group_b_id })) };
};

export function EditObjectBlueprintPage({ dataSource }: { dataSource: ObjectBlueprintDataSource }) {
 const { blueprintId, versionId } = useParams(); const navigate=useNavigate(); const [version,setVersion]=useState<ObjectBlueprintVersionDocument|null>(null); const [error,setError]=useState<string|null>(null);
 useEffect(()=>{if(!blueprintId||!versionId){setError('Некорректный адрес шаблона.');return;}void dataSource.loadObjectBlueprintVersion(blueprintId,versionId).then(setVersion,reason=>setError(reason instanceof Error?reason.message:'Не удалось загрузить шаблон.'));},[blueprintId,versionId,dataSource]);
 if(error) return <main className="catalog-page"><ViewState kind="error" message={error}/> </main>; if(!version) return <main className="catalog-page"><ViewState kind="loading"/></main>;
 const initial=hydrate(version); if(!initial) return <main className="catalog-page blueprint-editor-page"><div className="breadcrumbs"><Link to="/library/object-blueprints">Библиотека</Link><span>/</span><span>Редактирование</span></div><ViewState kind="empty" message="Structured editor недоступен: эта historical version не содержит authoring recipe. Группы и пары не будут угадываться по slot names."/></main>;
 return <main className="catalog-page blueprint-editor-page"><div className="breadcrumbs"><Link to="/library/object-blueprints">Библиотека</Link><span>/</span><span>Редактирование</span></div><ObjectBlueprintEditor key={version.version_ref.entity_id} initialState={initial} title="Редактировать шаблон объекта" description="Сохранение создаст новую версию с точными портами и внутренними связями." versionNotice={`Редактируется v${version.version_number}. Сохранение создаст v${version.version_number + 1}.`} saveLabel={`Создать v${version.version_number + 1}`} onSave={async editor=>{const result=createBlueprintRequest(editor);if(!result.request)throw new Error(result.errors.join(' '));const {name,...snapshot}=result.request;if(!dataSource.createObjectBlueprintVersion)throw new Error('Создание новой версии не поддерживается datasource.');await dataSource.createObjectBlueprintVersion(version.blueprint_ref.entity_id,{...snapshot,blueprint_name:name});navigate('/library/object-blueprints');}}/></main>;
}
