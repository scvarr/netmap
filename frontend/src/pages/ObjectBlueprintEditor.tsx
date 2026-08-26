import { useEffect, useMemo, useState } from 'react';
import { createBlueprintRequest, resolveSlotKeys, slotsForInstance, type BlueprintBlockInstance, type BlueprintEditorState, type BlueprintValidationError } from '../blueprints/editorModel';
import type { PortBlockDataSource, PortBlockListItem, PortBlockVersionSummary } from '../topology/portBlockTypes';
import { useI18n } from '../i18n';

export const newBlueprintEditorState = (): BlueprintEditorState => ({ name: '', defaultClass: '', width: 120, height: 60, fillColor: '#28565a', instances: [], individualLinks: [] });

const cleanupLinks = (links: BlueprintEditorState['individualLinks'], removedKeys: Set<string>) => links.filter((link) => !removedKeys.has(link.from_slot_key) && !removedKeys.has(link.to_slot_key));
const samePair = (first: string, second: string, link: BlueprintEditorState['individualLinks'][number]) => (first === link.from_slot_key && second === link.to_slot_key) || (first === link.to_slot_key && second === link.from_slot_key);

export function ObjectBlueprintEditor({ initialState, title, description, saveLabel, versionNotice, onSave, portBlockDataSource }: { initialState: BlueprintEditorState; title: string; description: string; saveLabel: string; versionNotice?: string; onSave: (state: BlueprintEditorState) => Promise<void>; portBlockDataSource: PortBlockDataSource }) {
  const { t } = useI18n();
  const [editor, setEditor] = useState(initialState);
  const [blocks, setBlocks] = useState<PortBlockListItem[]>([]);
  const [logical, setLogical] = useState('');
  const [versions, setVersions] = useState<PortBlockVersionSummary[]>([]);
  const [exact, setExact] = useState('');
  const [instanceVersions, setInstanceVersions] = useState<Record<string, PortBlockVersionSummary[]>>({});
  const [error, setError] = useState<BlueprintValidationError | 'compositionLoadFailed' | 'saveFailed' | null>(null);
  const slots = useMemo(() => editor.instances.flatMap(slotsForInstance), [editor]);
  const errorText = error ? t(`blueprint.validation.${error}` as const) : null;

  useEffect(() => { let active = true; void portBlockDataSource.loadPortBlocks().then((document) => { if (active) setBlocks(document.port_blocks); }, () => active && setError('compositionLoadFailed')); return () => { active = false; }; }, [portBlockDataSource]);
  useEffect(() => { if (!logical) { setVersions([]); setExact(''); return; } let active = true; void portBlockDataSource.loadPortBlockVersions(logical).then((document) => { if (active) { setVersions(document.versions); setExact(''); } }, () => active && setError('compositionLoadFailed')); return () => { active = false; }; }, [logical, portBlockDataSource]);
  useEffect(() => { for (const item of editor.instances) if (!instanceVersions[item.portBlockRef]) void portBlockDataSource.loadPortBlockVersions(item.portBlockRef).then((document) => setInstanceVersions((previous) => ({ ...previous, [item.portBlockRef]: document.versions })), () => setError('compositionLoadFailed')); }, [editor.instances, instanceVersions, portBlockDataSource]);

  const add = async () => {
    if (!blocks.some((item) => item.port_block_ref.entity_id === logical) || !versions.some((item) => item.version_ref.entity_id === exact)) return;
    try {
      const detail = await portBlockDataSource.loadPortBlockVersion(logical, exact);
      if (detail.port_block_ref.entity_id !== logical || detail.version_ref.entity_id !== exact) throw new Error('mismatched exact version');
      const base: BlueprintBlockInstance = { instanceKey: crypto.randomUUID(), portBlockRef: logical, portBlockVersionRef: exact, portBlockName: detail.name, versionNumber: detail.version_number, ports: detail.ports, resolvedSlotKeys: {} };
      const resolvedSlotKeys = await resolveSlotKeys(base);
      setEditor((state) => ({ ...state, instances: [...state.instances, { ...base, resolvedSlotKeys }] }));
    } catch { setError('compositionLoadFailed'); }
  };
  const remove = (item: BlueprintBlockInstance) => setEditor((state) => ({ ...state, instances: state.instances.filter((candidate) => candidate.instanceKey !== item.instanceKey), individualLinks: cleanupLinks(state.individualLinks, new Set(Object.values(item.resolvedSlotKeys))) }));
  const switchVersion = async (item: BlueprintBlockInstance, versionId: string) => {
    if (!versionId || versionId === item.portBlockVersionRef) return;
    try {
      const detail = await portBlockDataSource.loadPortBlockVersion(item.portBlockRef, versionId);
      if (detail.port_block_ref.entity_id !== item.portBlockRef || detail.version_ref.entity_id !== versionId) throw new Error('mismatched exact version');
      const nextBase: BlueprintBlockInstance = { ...item, portBlockVersionRef: versionId, portBlockName: detail.name, versionNumber: detail.version_number, ports: detail.ports, resolvedSlotKeys: {} };
      const next = { ...nextBase, resolvedSlotKeys: await resolveSlotKeys(nextBase) };
      const nextKeys = new Set(Object.values(next.resolvedSlotKeys));
      const removedKeys = new Set(Object.values(item.resolvedSlotKeys).filter((key) => !nextKeys.has(key)));
      setEditor((state) => ({ ...state, instances: state.instances.map((candidate) => candidate.instanceKey === item.instanceKey ? next : candidate), individualLinks: cleanupLinks(state.individualLinks, removedKeys) }));
    } catch { setError('compositionLoadFailed'); }
  };
  const updateLink = (index: number, next: BlueprintEditorState['individualLinks'][number]) => {
    if (next.from_slot_key === next.to_slot_key) { setError('individualSelfLink'); return; }
    if (editor.individualLinks.some((link, itemIndex) => itemIndex !== index && samePair(next.from_slot_key, next.to_slot_key, link))) { setError('duplicateIndividualLink'); return; }
    setEditor((state) => ({ ...state, individualLinks: state.individualLinks.map((link, itemIndex) => itemIndex === index ? next : link) }));
  };
  const addLink = () => { const existing = editor.individualLinks; const first = slots.find((slot) => slots.some((other) => other.key !== slot.key && !existing.some((link) => samePair(slot.key, other.key, link)))); const second = first && slots.find((slot) => slot.key !== first.key && !existing.some((link) => samePair(first.key, slot.key, link))); if (first && second) setEditor((state) => ({ ...state, individualLinks: [...state.individualLinks, { from_slot_key: first.key, to_slot_key: second.key }] })); };
  const save = async () => { const result = createBlueprintRequest(editor); if (!result.request) { setError(result.errors[0] ?? 'saveFailed'); return; } try { await onSave(editor); } catch { setError('saveFailed'); } };

  return <><header className="catalog-page__header"><h1>{title}</h1><p>{description}</p>{versionNotice && <p className="blueprint-editor__notice">{versionNotice}</p>}</header><div className="blueprint-composer"><section className="blueprint-editor-controls"><div className="blueprint-editor-controls__row"><label>{t('blueprint.editor.name')}<input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label><label>{t('blueprint.editor.class')}<input value={editor.defaultClass} onChange={(event) => setEditor({ ...editor, defaultClass: event.target.value })} /></label></div><div className="blueprint-editor-controls__row"><label>{t('blueprint.editor.width')}<input type="number" min="1" value={editor.width} onChange={(event) => setEditor({ ...editor, width: Number(event.target.value) })} /></label><label>{t('blueprint.editor.height')}<input type="number" min="1" value={editor.height} onChange={(event) => setEditor({ ...editor, height: Number(event.target.value) })} /></label></div><label>{t('blueprint.editor.color')}<input aria-label={t('blueprint.editor.color')} type="color" value={editor.fillColor} onChange={(event) => setEditor({ ...editor, fillColor: event.target.value })} /></label><section className="blueprint-composer__section"><h2>{t('blueprint.composition.title')}</h2><div className="blueprint-composer__chooser"><label>{t('blueprint.composition.logical')}<select value={logical} onChange={(event) => setLogical(event.target.value)}><option value="">{t('blueprint.composition.choose')}</option>{blocks.map((block) => <option key={block.port_block_ref.entity_id} value={block.port_block_ref.entity_id}>{block.name}</option>)}</select></label><label>{t('blueprint.composition.exactVersion')}<select value={exact} disabled={!logical} onChange={(event) => setExact(event.target.value)}><option value="">{t('blueprint.composition.choose')}</option>{versions.map((version) => <option key={version.version_ref.entity_id} value={version.version_ref.entity_id}>{t('blueprint.composition.versionOption', { version: version.version_number, count: version.port_count })}</option>)}</select></label><button className="secondary-action" type="button" disabled={!logical || !exact} onClick={() => void add()}>{t('blueprint.composition.add')}</button></div>{editor.instances.map((item) => <article className="blueprint-composer__instance" key={item.instanceKey}><div><strong>{item.portBlockName}</strong><span>{t('blueprint.composition.version', { version: item.versionNumber })} · {t('blueprint.composition.ports', { count: item.ports.length })}</span></div><label>{t('blueprint.composition.changeVersion')}<select value={item.portBlockVersionRef} onChange={(event) => void switchVersion(item, event.target.value)}>{(instanceVersions[item.portBlockRef] ?? []).map((version) => <option key={version.version_ref.entity_id} value={version.version_ref.entity_id}>{t('blueprint.composition.versionOption', { version: version.version_number, count: version.port_count })}</option>)}</select></label><p>{item.ports.map((port) => `${port.display_label} (${t(`blueprint.kind.${port.kind}` as const)})`).join(' · ')}</p><button className="text-action" type="button" onClick={() => remove(item)}>{t('blueprint.composition.remove')}</button></article>)}</section><section className="blueprint-composer__section"><h2>{t('blueprint.composition.links')}</h2>{editor.individualLinks.map((link, index) => <div className="blueprint-composer__link" key={`${link.from_slot_key}-${link.to_slot_key}`}><select aria-label={t('blueprint.composition.firstLink', { index: index + 1 })} value={link.from_slot_key} onChange={(event) => updateLink(index, { ...link, from_slot_key: event.target.value })}>{slots.map((slot) => <option key={slot.key} value={slot.key}>{slot.label} · {t(`blueprint.kind.${slot.kind}` as const)}</option>)}</select><select aria-label={t('blueprint.composition.secondLink', { index: index + 1 })} value={link.to_slot_key} onChange={(event) => updateLink(index, { ...link, to_slot_key: event.target.value })}>{slots.map((slot) => <option key={slot.key} value={slot.key}>{slot.label} · {t(`blueprint.kind.${slot.kind}` as const)}</option>)}</select><button className="text-action" type="button" onClick={() => setEditor((state) => ({ ...state, individualLinks: state.individualLinks.filter((_, itemIndex) => itemIndex !== index) }))}>{t('blueprint.composition.remove')}</button></div>)}<button className="secondary-action" type="button" disabled={slots.length < 2} onClick={addLink}>{t('blueprint.composition.addLink')}</button></section>{errorText && <p role="alert" className="blueprint-editor__error">{errorText}</p>}<button className="primary-action" type="button" onClick={() => void save()}>{saveLabel}</button></section></div></>;
}
