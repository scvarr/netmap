import { useState } from 'react';
import { useI18n } from '../i18n';
import { PageHeader } from '../components/PageChrome';
import { BlueprintCompositionCanvas } from '../components/BlueprintCompositionCanvas';
import { addEndpoints, alignSelection, createBlueprintRequest, distributeSelection, internalLinkPairKey, layoutSelectionRow, layoutSelectionTwoRows, removeEndpoints, translateSelection, type BlueprintEditorState, type BlueprintValidationError } from '../blueprints/editorModel';
import type { BlueprintFace, BlueprintSlot, BlueprintSlotKind } from '../topology/objectBlueprintTypes';

interface Props { title: string; description: string; saveLabel: string; onSave: (state: BlueprintEditorState) => Promise<void>; initialState: BlueprintEditorState; versionNotice?: string; }
export const newBlueprintEditorState = (): BlueprintEditorState => ({ name: '', defaultClass: '', width: 160, height: 60, fillColor: '#28565a', slots: [], individualLinks: [] });
const validationKey = {
  nameRequired: 'blueprint.validation.nameRequired', dimensionsPositive: 'blueprint.validation.dimensionsPositive', colorFormat: 'blueprint.validation.colorFormat',
  duplicateSlotKeys: 'blueprint.validation.duplicateSlotKeys', individualSelfLink: 'blueprint.validation.individualSelfLink',
  individualMissingPort: 'blueprint.validation.individualMissingPort', duplicateIndividualLink: 'blueprint.validation.duplicateIndividualLink',
} as const satisfies Record<BlueprintValidationError, string>;

export function ObjectBlueprintEditor({ title, description, saveLabel, onSave, initialState, versionNotice }: Props) {
  const { t } = useI18n();
  const [editor, setEditor] = useState(initialState);
  const [face, setFace] = useState<BlueprintFace>('FRONT');
  const [kind, setKind] = useState<BlueprintSlotKind>('NETWORK_PORT');
  const [count, setCount] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const selectedSlot = selected.size === 1 ? editor.slots.find((slot) => selected.has(slot.key) && slot.face === face) : undefined;
  const deleteSelected = () => { setEditor((old) => removeEndpoints(old, selected)); setSelected(new Set()); };
  const selectSlot = (key: string, toggle: boolean) => setSelected((old) => {
    if (!toggle) return new Set([key]);
    const next = new Set(old);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const updateSlot = (key: string, patch: Partial<BlueprintSlot>) => setEditor((old) => ({ ...old, slots: old.slots.map((slot) => slot.key === key ? { ...slot, ...patch } : slot) }));
  const addLink = () => {
    const existing = new Set(editor.individualLinks.map((link) => internalLinkPairKey(link.from_slot_key, link.to_slot_key)));
    for (const first of editor.slots) for (const second of editor.slots) {
      if (first.key !== second.key && !existing.has(internalLinkPairKey(first.key, second.key))) {
        setEditor((old) => ({ ...old, individualLinks: [...old.individualLinks, { from_slot_key: first.key, to_slot_key: second.key }] }));
        return;
      }
    }
  };
  const save = async () => {
    const result = createBlueprintRequest(editor);
    if (!result.request) { setError(t(validationKey[result.errors[0]])); return; }
    try { await onSave(editor); } catch { setError(t('blueprint.validation.saveFailed')); }
  };
  return <>
    <PageHeader title={title} description={description} notice={versionNotice && <p className="blueprint-editor__notice">{versionNotice}</p>} />
    <div className="blueprint-composer"><div className="blueprint-composer__workspace">
      <section className="blueprint-editor-controls blueprint-composer__properties">
        <div className="blueprint-editor-controls__row">
          <label>{t('blueprint.editor.name')}<input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label>
          <label>{t('blueprint.editor.class')}<input value={editor.defaultClass} onChange={(e) => setEditor({ ...editor, defaultClass: e.target.value })} /></label>
        </div>
        <div className="blueprint-editor-controls__row">
          <label>{t('blueprint.editor.width')}<input type="number" min="1" value={editor.width} onChange={(e) => setEditor({ ...editor, width: Number(e.target.value) })} /></label>
          <label>{t('blueprint.editor.height')}<input type="number" min="1" value={editor.height} onChange={(e) => setEditor({ ...editor, height: Number(e.target.value) })} /></label>
        </div>
        <label>{t('blueprint.editor.color')}<input type="color" value={editor.fillColor} onChange={(e) => setEditor({ ...editor, fillColor: e.target.value })} /></label>
        <section className="blueprint-composer__section blueprint-composer__links"><h2>{t('blueprint.composition.links')}</h2>
          {editor.individualLinks.map((link, index) => <div className="blueprint-composer__link" key={index}>
            {(['from_slot_key', 'to_slot_key'] as const).map((field) => <select key={field} aria-label={t(field === 'from_slot_key' ? 'blueprint.composition.firstLink' : 'blueprint.composition.secondLink', { index: index + 1 })} value={link[field]} onChange={(e) => setEditor((old) => ({ ...old, individualLinks: old.individualLinks.map((item, i) => i === index ? { ...item, [field]: e.target.value } : item) }))}>{editor.slots.map((slot) => <option key={slot.key} value={slot.key}>{slot.display_name}</option>)}</select>)}
            <button type="button" className="text-action" onClick={() => setEditor((old) => ({ ...old, individualLinks: old.individualLinks.filter((_, i) => i !== index) }))}>{t('blueprint.composition.remove')}</button>
          </div>)}
          <button type="button" className="secondary-action" disabled={editor.slots.length < 2} onClick={addLink}>{t('blueprint.composition.addLink')}</button>
        </section>
        {error && <p role="alert" className="blueprint-editor__error">{error}</p>}
        <button type="button" className="primary-action" onClick={() => void save()}>{saveLabel}</button>
      </section>
      <section className="blueprint-composer__composition blueprint-composer__surface">
        <div className="blueprint-composer__chooser">
          <label>{t('blueprint.endpoint.kind')}<select value={kind} onChange={(e) => setKind(e.target.value as BlueprintSlotKind)}><option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option><option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option></select></label>
          <label>{t('blueprint.endpoint.count')}<input type="number" min="1" max="256" value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
          <button type="button" className="secondary-action" onClick={() => { const next = addEndpoints(editor, kind, count, face); if (next === editor) return; setEditor(next); setSelected(new Set(next.slots.slice(editor.slots.length).map((slot) => slot.key))); }}>{t('blueprint.endpoint.add')}</button>
        </div>
        <div className="blueprint-composer__faces"><button type="button" aria-pressed={face === 'FRONT'} onClick={() => { setFace('FRONT'); setSelected(new Set()); }}>{t('blueprint.face.front')}</button><button type="button" aria-pressed={face === 'REAR'} onClick={() => { setFace('REAR'); setSelected(new Set()); }}>{t('blueprint.face.rear')}</button></div>
        <BlueprintCompositionCanvas body={{ width: editor.width, height: editor.height, fillColor: editor.fillColor }} face={face} slots={editor.slots} links={editor.individualLinks} selectedKeys={selected} onSelect={selectSlot} onMarquee={(keys) => setSelected(new Set(keys))} onTranslate={(keys, dx, dy) => setEditor((old) => translateSelection(old, keys, dx, dy))} />
        {selected.size > 1 && <aside className="blueprint-composer__selected blueprint-composer__selected--multi">
          <strong>{t('blueprint.layout.selected', { count: selected.size })}</strong>
          <div className="blueprint-composer__layout-tools">
            {([
              ['left', () => alignSelection(editor, selected, 'x', 'min')], ['centerX', () => alignSelection(editor, selected, 'x', 'center')], ['right', () => alignSelection(editor, selected, 'x', 'max')],
              ['top', () => alignSelection(editor, selected, 'y', 'min')], ['centerY', () => alignSelection(editor, selected, 'y', 'center')], ['bottom', () => alignSelection(editor, selected, 'y', 'max')],
              ['distributeX', () => distributeSelection(editor, selected, 'x')], ['distributeY', () => distributeSelection(editor, selected, 'y')],
              ['oneRow', () => layoutSelectionRow(editor, selected)], ['twoRows', () => layoutSelectionTwoRows(editor, selected)],
            ] as const).map(([action, run]) => <button key={action} type="button" className="secondary-action" disabled={(action === 'distributeX' || action === 'distributeY' || action === 'twoRows') && selected.size < 3} onClick={() => setEditor(run())}>{t(`blueprint.layout.${action}`)}</button>)}
          </div>
          <button type="button" className="text-action" onClick={deleteSelected}>{t('blueprint.layout.deleteSelected')}</button>
        </aside>}
        {selectedSlot && <aside className="blueprint-composer__selected">
          <label>{t('blueprint.endpoint.name')}<input value={selectedSlot.display_name} onChange={(e) => updateSlot(selectedSlot.key, { display_name: e.target.value })} /></label>
          <label>{t('blueprint.endpoint.kind')}<select value={selectedSlot.kind} onChange={(e) => updateSlot(selectedSlot.key, { kind: e.target.value as BlueprintSlotKind })}><option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option><option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option></select></label>
          <label>{t('blueprint.composition.face')}<select value={selectedSlot.face} onChange={(e) => { updateSlot(selectedSlot.key, { face: e.target.value as BlueprintFace }); setFace(e.target.value as BlueprintFace); }}><option value="FRONT">{t('blueprint.face.front')}</option><option value="REAR">{t('blueprint.face.rear')}</option></select></label>
          <button type="button" className="text-action" onClick={deleteSelected}>{t('blueprint.composition.remove')}</button>
        </aside>}
      </section>
    </div></div>
  </>;
}
