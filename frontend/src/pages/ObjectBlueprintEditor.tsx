import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { PageHeader } from '../components/PageChrome';
import { BlueprintCompositionCanvas } from '../components/BlueprintCompositionCanvas';
import { applyPairwiseContinuity, pairwiseContinuityPreview, applyBulkNames, bulkNamePreview, reorderOrderedKeys, toggleOrderedKey, addEndpoints, addPanel, alignSelectionLine, compositionBounds, copySelectionError, copySelectionToPanel, createBlueprintRequest, deleteActivePanel, distributeSelection, internalLinkPairKey, layoutSelectionRow, layoutSelectionTwoRows, positionSelection, positionSelectionAt, removeEndpoints, renameActivePanel, selectionPosition, setPanelRectangle, translateSelection, type BlueprintEditorState, type BlueprintValidationError, type PanelDirection } from '../blueprints/editorModel';
import type { BlueprintSlot, BlueprintSlotKind } from '../topology/objectBlueprintTypes';

interface Props { title: string; description: string; saveLabel: string; onSave: (state: BlueprintEditorState) => Promise<void>; initialState: BlueprintEditorState; versionNotice?: string; }
export const newBlueprintEditorState = (): BlueprintEditorState => { const key = crypto.randomUUID(); return { name: '', defaultClass: '', width: 160, height: 60, fillColor: '#28565a', panels: [{ panel_key: key, panel_number: 1, display_name: 'Панель 1', x: 0, y: 0, width: 160, height: 60 }], slots: [], individualLinks: [], activePanelKey: key, nextPanelNumber: 2, nextLocalNumberByPanel: { [key]: 1 } }; };
const validationKey = {
  nameRequired: 'blueprint.validation.nameRequired', panelNameRequired: 'blueprint.validation.panelNameRequired', dimensionsPositive: 'blueprint.validation.dimensionsPositive', colorFormat: 'blueprint.validation.colorFormat',
  duplicateSlotKeys: 'blueprint.validation.duplicateSlotKeys', individualSelfLink: 'blueprint.validation.individualSelfLink',
  individualMissingPort: 'blueprint.validation.individualMissingPort', duplicateIndividualLink: 'blueprint.validation.duplicateIndividualLink',
} as const satisfies Record<BlueprintValidationError, string>;
const menuSections = [
  { label: 'align', actions: ['horizontalLine', 'verticalLine'] },
  { label: 'distribute', actions: ['distributeX', 'distributeY'] },
  { label: 'position', actions: ['left', 'centerX', 'right', 'top', 'centerY', 'bottom'] },
  { label: 'layout', actions: ['oneRow', 'twoRows'] },
  { label: 'delete', actions: ['deleteSelected'] },
] as const;
type MenuAction = (typeof menuSections)[number]['actions'][number];

export function ObjectBlueprintEditor({ title, description, saveLabel, onSave, initialState, versionNotice }: Props) {
  const { t } = useI18n();
  const [editor, setEditor] = useState(initialState);
  const panelKey = editor.activePanelKey;
  const activePanel = editor.panels.find((panel) => panel.panel_key === panelKey)!;
  const bounds = compositionBounds(editor.panels);
  const [panelSizeDraft, setPanelSizeDraft] = useState<{ panelKey: string; width: number; height: number; axis: 'width' | 'height'; value: string }>();
  useEffect(() => { setPanelSizeDraft(undefined); }, [panelKey, activePanel.width, activePanel.height]);
  const shownPanelSize = (axis: 'width' | 'height') => panelSizeDraft?.panelKey === panelKey && panelSizeDraft.width === activePanel.width && panelSizeDraft.height === activePanel.height && panelSizeDraft.axis === axis ? panelSizeDraft.value : String(activePanel[axis]);
  const commitPanelSize = (axis: 'width' | 'height', raw: string) => {
    const value = Number(raw);
    if (raw.trim() && Number.isFinite(value) && value > 0) {
      setEditor((old) => {
        const panel = old.panels.find((item) => item.panel_key === panelKey)!;
        return setPanelRectangle(old, panelKey, { x: panel.x, y: panel.y, width: panel.width, height: panel.height, [axis]: value });
      });
    }
    setPanelSizeDraft(undefined);
  };
  const [kind, setKind] = useState<BlueprintSlotKind>('NETWORK_PORT');
  const [count, setCount] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [orderedMode, setOrderedMode] = useState(false);
  const [orderedKeys, setOrderedKeys] = useState<string[]>([]);
  const [orderOpen, setOrderOpen] = useState(false);
  const [capturedA, setCapturedA] = useState<string[]>([]);
  const [capturedB, setCapturedB] = useState<string[]>([]);
  const [reverseB, setReverseB] = useState(false);
  const [pairwiseOpen, setPairwiseOpen] = useState(false);
  const pairwiseEntry = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (pairwiseOpen) return () => pairwiseEntry.current?.focus(); }, [pairwiseOpen]);
  const pairwise = pairwiseContinuityPreview(editor, capturedA, capturedB, reverseB);
  const canCapture = orderedMode && orderedKeys.length > 0 && new Set(orderedKeys).size === orderedKeys.length && orderedKeys.every((key) => editor.slots.some((slot) => slot.key === key && slot.panel_key === panelKey));
  const captureStatus = (keys: readonly string[]) => {
    if (!keys.length) return '0';
    const slots = keys.map((key) => editor.slots.find((slot) => slot.key === key));
    const panel = editor.panels.find((item) => item.panel_key === slots[0]?.panel_key);
    return `${keys.length} · ${slots.some((slot) => !slot) || !panel ? t('blueprint.pairwise.invalidSet') : panel.display_name}`;
  };
  const endpointLabel = (key: string) => {
    const slot = editor.slots.find((item) => item.key === key)!;
    return `${slot.display_name} · ${editor.panels.find((panel) => panel.panel_key === slot.panel_key)?.display_name}`;
  };
  const applyPairwise = () => {
    const next = applyPairwiseContinuity(editor, capturedA, capturedB, reverseB);
    if (next === editor) return;
    setEditor(next); setCapturedA([]); setCapturedB([]); setReverseB(false); setPairwiseOpen(false);
  };
  const [naming, setNaming] = useState({ prefix: '', start: '1', step: '1' });
  const orderEntry = useRef<HTMLButtonElement>(null);
  const preview = bulkNamePreview(editor, orderedKeys, naming);
  useEffect(() => { if (orderOpen) return () => orderEntry.current?.focus(); }, [orderOpen]);
  const [copyDestination, setCopyDestination] = useState('');
  const [createContinuity, setCreateContinuity] = useState(false);
  const destinationPanels = editor.panels.filter((panel) => panel.panel_key !== panelKey);
  const destinationKey = destinationPanels.some((panel) => panel.panel_key === copyDestination) ? copyDestination : destinationPanels[0]?.panel_key ?? '';
  const copyError = copySelectionError(editor, selected, destinationKey);
  const [positionDraft, setPositionDraft] = useState<{ axis: 'x' | 'y'; value: string }>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [distributionAxis, setDistributionAxis] = useState<'x' | 'y'>();
  const [distributionPercent, setDistributionPercent] = useState('50');
  const [distributionFull, setDistributionFull] = useState(false);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const linksEntry = useRef<HTMLButtonElement>(null);
  const [selectedLinks, setSelectedLinks] = useState<Set<number>>(new Set());
  const closeLinks = () => { setSelectedLinks(new Set()); setLinksOpen(false); };
  useEffect(() => {
    if (linksOpen) return () => linksEntry.current?.focus();
  }, [linksOpen]);
  const [error, setError] = useState<string>();
  const selectedSlot = selected.size === 1 ? editor.slots.find((slot) => selected.has(slot.key) && slot.panel_key === panelKey) : undefined;
  const selectedPosition = selectionPosition(editor, selected);
  const shownPosition = (value: number) => String(Number(value.toFixed(4)));
  const applyPosition = (axis: 'x' | 'y', raw: string) => {
    const requested = Number(raw);
    if (raw.trim() && Number.isFinite(requested) && raw !== shownPosition(selectedPosition?.[axis] ?? 0)) {
      setEditor((old) => positionSelectionAt(old, selected, axis, requested));
    }
    setPositionDraft(undefined);
  };
  const deleteSelected = () => { setEditor((old) => removeEndpoints(old, selected)); setSelected(new Set()); setPositionDraft(undefined); setMenu(undefined); };
  const clearPanelUi = () => { setOrderedKeys([]); setSelected(new Set()); setPositionDraft(undefined); setMenu(undefined); setDistributionAxis(undefined); setDistributionPercent('50'); setDistributionFull(false); setCopyDestination(''); setCreateContinuity(false); };
  const copySelected = () => {
    const result = copySelectionToPanel(editor, selected, destinationKey, createContinuity);
    if (result.error) return;
    setEditor(result.state);
    clearPanelUi();
    setSelected(new Set(result.copiedKeys));
  };
  const activatePanel = (key: string) => { if (key === panelKey) return; setEditor((old) => ({ ...old, activePanelKey: key })); clearPanelUi(); };
  const createPanel = (direction: PanelDirection) => { setEditor((old) => addPanel(old, direction)); clearPanelUi(); };
  const removePanel = () => { setEditor((old) => deleteActivePanel(old)); clearPanelUi(); };
  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (menu && (!(event.target instanceof Element) || !event.target.closest('.blueprint-composer__context-menu'))) setMenu(undefined);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (pairwiseOpen) { if (event.key === 'Escape') { event.preventDefault(); setPairwiseOpen(false); } return; }
      if (orderOpen) { if (event.key === 'Escape') { event.preventDefault(); setOrderOpen(false); } return; }
      if (linksOpen) {
        if (event.key === 'Escape') { event.preventDefault(); closeLinks(); }
        return;
      }
      if (event.key === 'Escape') {
        if (menu) setMenu(undefined);
        else setSelected(new Set());
      }
      if (event.key !== 'Delete' || selected.size === 0) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)) return;
      event.preventDefault();
      deleteSelected();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [menu, selected, linksOpen, orderOpen, pairwiseOpen]);
  const normalizedPixels = (axis: 'x' | 'y', pixels: number) => {
    const rect = canvasWrap.current?.querySelector('svg')?.getBoundingClientRect();
    const viewHeight = 1000 * bounds.height / bounds.width;
    const scale = rect && Math.min(rect.width / 1000, rect.height / viewHeight);
    return scale && Number.isFinite(scale) && scale > 0 ? pixels / (scale * (axis === 'x' ? activePanel.width : activePanel.height) * 1000 / bounds.width) : undefined;
  };
  const presentationInset = (axis: 'x' | 'y') => Math.min(.49, normalizedPixels(axis, 8) ?? .02);
  const layoutMetrics = () => ({
    minGapX: normalizedPixels('x', 18) ?? .06, minGapY: normalizedPixels('y', 18) ?? .08,
    insetX: presentationInset('x'), insetY: presentationInset('y'),
  });
  const runMenuAction = (action: MenuAction) => {
    if (action === 'distributeX' || action === 'distributeY') {
      setDistributionAxis(action === 'distributeX' ? 'x' : 'y');
      setDistributionPercent('50');
      setDistributionFull(false);
      return;
    }
    if (action === 'deleteSelected') deleteSelected();
    else setEditor((old) => {
      switch (action) {
        case 'horizontalLine': return alignSelectionLine(old, selected, 'horizontal', presentationInset('x'));
        case 'verticalLine': return alignSelectionLine(old, selected, 'vertical', presentationInset('y'));
        case 'left': return positionSelection(old, selected, 'x', 'start', presentationInset('x'));
        case 'centerX': return positionSelection(old, selected, 'x', 'center', presentationInset('x'));
        case 'right': return positionSelection(old, selected, 'x', 'end', presentationInset('x'));
        case 'top': return positionSelection(old, selected, 'y', 'start', presentationInset('y'));
        case 'centerY': return positionSelection(old, selected, 'y', 'center', presentationInset('y'));
        case 'bottom': return positionSelection(old, selected, 'y', 'end', presentationInset('y'));
        case 'oneRow': return layoutSelectionRow(old, selected, layoutMetrics());
        case 'twoRows': return layoutSelectionTwoRows(old, selected, layoutMetrics());
      }
    });
    setMenu(undefined);
  };
  const applyDistribution = () => {
    if (!distributionAxis) return;
    const percent = Number(distributionPercent);
    if (!distributionFull && (!Number.isFinite(percent) || percent < 1 || percent > 100)) return;
    setEditor((old) => distributeSelection(old, selected, distributionAxis, distributionFull ? { mode: 'full' } : { mode: 'percent', percent }, presentationInset(distributionAxis)));
    setMenu(undefined);
    setDistributionAxis(undefined);
  };
  const selectSlot = (key: string, toggle: boolean) => {
    if (orderedMode) {
      const owningPanel = editor.slots.find((slot) => slot.key === key)?.panel_key;
      setOrderedKeys((old) => toggleOrderedKey(owningPanel === panelKey ? old : [], key));
      return;
    }
    setPositionDraft(undefined);
    setSelected((old) => {
      if (!toggle) return new Set([key]);
      const next = new Set(old);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const updateSlot = (key: string, patch: Partial<BlueprintSlot>) => setEditor((old) => ({ ...old, slots: old.slots.map((slot) => slot.key === key ? { ...slot, ...patch } : slot) }));
  const addLink = () => {
    setSelectedLinks(new Set());
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
    <div className="blueprint-composer blueprint-composer--authoring-workspace"><div className="blueprint-composer__workspace" inert={linksOpen || orderOpen || pairwiseOpen}>
      <section className="blueprint-editor-controls blueprint-composer__properties">
        <div className="blueprint-editor-controls__row">
          <label>{t('blueprint.editor.name')}<input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label>
          <label>{t('blueprint.editor.class')}<input value={editor.defaultClass} onChange={(e) => setEditor({ ...editor, defaultClass: e.target.value })} /></label>
        </div>
        <div className="blueprint-editor-controls__row">
          <label>{t('blueprint.editor.width')}<input type="number" min="1" value={editor.panels.length === 1 ? activePanel.width : bounds.width} disabled={editor.panels.length > 1} onChange={(e) => setEditor((old) => ({ ...old, width: Number(e.target.value), panels: old.panels.map((panel) => ({ ...panel, width: Number(e.target.value) })) }))} /></label>
          <label>{t('blueprint.editor.height')}<input type="number" min="1" value={editor.panels.length === 1 ? activePanel.height : bounds.height} disabled={editor.panels.length > 1} onChange={(e) => setEditor((old) => ({ ...old, height: Number(e.target.value), panels: old.panels.map((panel) => ({ ...panel, height: Number(e.target.value) })) }))} /></label>
        </div>
        <label>{t('blueprint.editor.color')}<input type="color" value={editor.fillColor} onChange={(e) => setEditor({ ...editor, fillColor: e.target.value })} /></label>
        <section className="blueprint-composer__section blueprint-composer__links"><h2>{t('blueprint.composition.links')}</h2>
          <button ref={linksEntry} type="button" className="secondary-action" onClick={() => { setMenu(undefined); setDistributionAxis(undefined); setLinksOpen(true); }}>{t('blueprint.composition.editLinks', { count: editor.individualLinks.length })}</button>
        </section>
        {error && <p role="alert" className="blueprint-editor__error">{error}</p>}
        <button type="button" className="primary-action" onClick={() => void save()}>{saveLabel}</button>
      </section>
      <section className="blueprint-composer__composition blueprint-composer__surface">
        <div className="blueprint-composer__chooser">
          <label>{t('blueprint.endpoint.kind')}<select value={kind} onChange={(e) => setKind(e.target.value as BlueprintSlotKind)}><option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option><option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option></select></label>
          <label>{t('blueprint.endpoint.count')}<input type="number" min="1" max="256" value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
          <button type="button" className="secondary-action" onClick={() => { const next = addEndpoints(editor, kind, count, panelKey); if (next === editor) return; setEditor(next); if (!orderedMode) setSelected(new Set(next.slots.slice(editor.slots.length).map((slot) => slot.key))); setMenu(undefined); }}>{t('blueprint.endpoint.add')}</button>
        </div>
        <div className="blueprint-composer__panels" role="group" aria-label={t('blueprint.panel.list')}>{[...editor.panels].sort((a, b) => a.panel_number - b.panel_number).map((panel) => <button key={panel.panel_key} type="button" aria-pressed={panel.panel_key === panelKey} onClick={() => activatePanel(panel.panel_key)}>{panel.display_name}</button>)}</div>
        <div className="blueprint-composer__panel-actions">
          <label>{t('blueprint.panel.name')}<input value={activePanel.display_name} onChange={(event) => setEditor((old) => renameActivePanel(old, event.target.value))} /></label>
          {editor.panels.length > 1 && (['width', 'height'] as const).map((axis) => <label key={`${panelKey}:${axis}`}>{t(`blueprint.panel.${axis}`)}<input type="number" step="any" value={shownPanelSize(axis)}
            onChange={(event) => setPanelSizeDraft({ panelKey, width: activePanel.width, height: activePanel.height, axis, value: event.target.value })}
            onBlur={(event) => commitPanelSize(axis, event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitPanelSize(axis, event.currentTarget.value); } }}
          /></label>)}
          {(['above', 'right', 'below', 'left'] as const).map((direction) => <button key={direction} type="button" className="secondary-action" onClick={() => createPanel(direction)}>{t(`blueprint.panel.add.${direction}`)}</button>)}
          <button type="button" className="text-action" disabled={editor.panels.length === 1 || editor.slots.some((slot) => slot.panel_key === panelKey)} onClick={removePanel}>{t('blueprint.panel.delete')}</button>
        </div>
        <div ref={canvasWrap} className="blueprint-composer__canvas-wrap">
          <BlueprintCompositionCanvas key={`${panelKey}:${orderedMode}`} body={{ width: bounds.width, height: bounds.height, fillColor: editor.fillColor }} panels={editor.panels} activePanelKey={panelKey} slots={editor.slots} links={editor.individualLinks} selectedKeys={selected} orderedKeys={orderedMode ? orderedKeys : undefined} onActivatePanel={activatePanel} onSelect={selectSlot} onMarquee={(keys) => { setSelected(new Set(keys)); setPositionDraft(undefined); }} onTranslate={(keys, dx, dy) => setEditor((old) => translateSelection(old, keys, dx, dy))} onPanelGeometry={(key, rectangle) => setEditor((old) => setPanelRectangle(old, key, rectangle))} onContextMenu={(key, clientX, clientY) => {
            if (orderedMode) return;
            if (key && !selected.has(key)) setSelected(new Set([key]));
            if (!key && selected.size === 0) { setMenu(undefined); return; }
            const rect = canvasWrap.current!.getBoundingClientRect();
            setDistributionAxis(undefined);
            setMenu({ x: Math.max(0, Math.min(clientX - rect.left, rect.width - 320)), y: Math.max(0, Math.min(clientY - rect.top, rect.height - 280)) });
          }} />
          {menu && <div className="blueprint-composer__context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            {menuSections.map((section) => <div key={section.label} className={`blueprint-composer__context-section blueprint-composer__context-section--${section.label}`}>
              <strong>{t(`blueprint.layout.section.${section.label}`)}</strong>
              {section.actions.map((action) => <button key={action} type="button" role="menuitem" disabled={selected.size < (action === 'distributeX' || action === 'distributeY' || action === 'twoRows' ? 3 : action === 'horizontalLine' || action === 'verticalLine' || action === 'oneRow' ? 2 : 1)} onClick={() => runMenuAction(action)}>{t(`blueprint.layout.${action}`)}</button>)}
              {section.label === 'distribute' && distributionAxis && <div className="blueprint-composer__distribution-settings" role="group" aria-label={t('blueprint.layout.distributionSettings')}>
                <label>{t(distributionAxis === 'x' ? 'blueprint.layout.rangeWidth' : 'blueprint.layout.rangeHeight')}<input type="number" min="1" max="100" step="1" value={distributionPercent} disabled={distributionFull} onChange={(event) => setDistributionPercent(event.target.value)} /></label>
                <label className="blueprint-composer__distribution-full"><input type="checkbox" checked={distributionFull} onChange={(event) => setDistributionFull(event.target.checked)} />{t(distributionAxis === 'x' ? 'blueprint.layout.fullWidth' : 'blueprint.layout.fullHeight')}</label>
                <button type="button" className="blueprint-composer__distribution-apply" disabled={!distributionFull && (!Number.isFinite(Number(distributionPercent)) || Number(distributionPercent) < 1 || Number(distributionPercent) > 100)} onClick={applyDistribution}>{t('blueprint.layout.applyDistribution')}</button>
              </div>}
            </div>)}
          </div>}
        </div>
        <div className="blueprint-composer__contextual">
          <button ref={pairwiseEntry} type="button" className="secondary-action" onClick={() => { setMenu(undefined); setDistributionAxis(undefined); setPairwiseOpen(true); }}>{t('blueprint.pairwise.open')} · A: {capturedA.length} · B: {capturedB.length}</button>
          {!orderedMode ? <button type="button" className="secondary-action" onClick={() => { clearPanelUi(); setOrderedMode(true); }}>{t('blueprint.order.enter')}</button> : <>
            <span>{t('blueprint.order.count', { count: orderedKeys.length })}</span>
            <button ref={orderEntry} type="button" className="secondary-action" onClick={() => setOrderOpen(true)}>{t('blueprint.order.edit')}</button>
            <button type="button" className="text-action" onClick={() => setOrderedKeys([])}>{t('blueprint.order.clear')}</button>
            <button type="button" className="text-action" onClick={() => { clearPanelUi(); setOrderedMode(false); }}>{t('blueprint.order.exit')}</button>
          </>}
        {selected.size > 1 && <span className="blueprint-composer__selection-count">{t('blueprint.layout.selected', { count: selected.size })}</span>}
        {selectedPosition && <section className="blueprint-composer__position" role="group" aria-label={t('blueprint.position.title')}>
          <strong>{t('blueprint.position.title')}</strong>
          {(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()}<input type="number" min="0" max="1" step="0.001" value={positionDraft?.axis === axis ? positionDraft.value : shownPosition(selectedPosition[axis])} onFocus={() => setPositionDraft({ axis, value: shownPosition(selectedPosition[axis]) })} onChange={(event) => setPositionDraft({ axis, value: event.target.value })} onBlur={(event) => applyPosition(axis, event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>)}
        </section>}
        {selected.size >= 1 && editor.panels.length > 1 && <section className="blueprint-composer__copy" role="group" aria-label={t('blueprint.copy.title')}>
          <strong>{t('blueprint.copy.title')}</strong>
          <label>{t('blueprint.copy.destination')}<select value={destinationKey} onChange={(event) => setCopyDestination(event.target.value)}>{destinationPanels.map((panel) => <option key={panel.panel_key} value={panel.panel_key}>{panel.panel_number} · {panel.display_name}</option>)}</select></label>
          <label className="blueprint-composer__copy-continuity"><input type="checkbox" checked={createContinuity} onChange={(event) => setCreateContinuity(event.target.checked)} />{t('blueprint.copy.continuity')}</label>
          <button type="button" className="secondary-action" disabled={Boolean(copyError)} onClick={copySelected}>{t('blueprint.copy.action')}</button>
          {copyError === 'capacity' && <p role="status" className="blueprint-editor__error">{t('blueprint.copy.capacity')}</p>}
        </section>}
        {selectedSlot && <aside className="blueprint-composer__selected">
          <label>{t('blueprint.endpoint.name')}<input value={selectedSlot.display_name} onChange={(e) => updateSlot(selectedSlot.key, { display_name: e.target.value })} /></label>
          <label>{t('blueprint.endpoint.kind')}<select value={selectedSlot.kind} onChange={(e) => updateSlot(selectedSlot.key, { kind: e.target.value as BlueprintSlotKind })}><option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option><option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option></select></label>
          <button type="button" className="text-action" onClick={deleteSelected}>{t('blueprint.composition.remove')}</button>
        </aside>}
        </div>
      </section>
    </div></div>
    {orderOpen && <section className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="blueprint-order-title">
      <div className="catalog-dialog__surface blueprint-order-dialog">
        <h2 id="blueprint-order-title">{t('blueprint.order.edit')}</h2>
        <div className="blueprint-pairwise__captures">
          <span role="status">A: {captureStatus(capturedA)}</span>
          <button type="button" disabled={!canCapture} onClick={() => setCapturedA([...orderedKeys])}>{t('blueprint.pairwise.captureA')}</button>
          <button type="button" disabled={!capturedA.length} onClick={() => setCapturedA([])}>{t('blueprint.pairwise.clearA')}</button>
          <span role="status">B: {captureStatus(capturedB)}</span>
          <button type="button" disabled={!canCapture} onClick={() => setCapturedB([...orderedKeys])}>{t('blueprint.pairwise.captureB')}</button>
          <button type="button" disabled={!capturedB.length} onClick={() => setCapturedB([])}>{t('blueprint.pairwise.clearB')}</button>
        </div>
        <div className="blueprint-order-dialog__parameters">
          {(['prefix', 'start', 'step'] as const).map((field) => <label key={field}>{t(`blueprint.naming.${field}`)}<input type={field === 'prefix' ? 'text' : 'number'} step={field === 'prefix' ? undefined : '1'} value={naming[field]} onChange={(event) => setNaming((old) => ({ ...old, [field]: event.target.value }))} /></label>)}
        </div>
        {!preview && <p role="alert">{t('blueprint.naming.invalid')}</p>}
        <div className="blueprint-order-dialog__list">
          {orderedKeys.map((key, index) => { const slot = editor.slots.find((item) => item.key === key)!; return <div key={key} className="blueprint-order-dialog__row" data-ordered-key={key}>
            <span>{index + 1}</span><span>{slot.display_name} · {activePanel.display_name}</span>
            <span data-name-preview>{preview && `→ ${preview[index].display_name}`}</span>
            <button type="button" aria-label={t('blueprint.order.up', { index: index + 1 })} disabled={index === 0} onClick={() => setOrderedKeys((old) => reorderOrderedKeys(old, index, -1))}>↑</button>
            <button type="button" aria-label={t('blueprint.order.down', { index: index + 1 })} disabled={index === orderedKeys.length - 1} onClick={() => setOrderedKeys((old) => reorderOrderedKeys(old, index, 1))}>↓</button>
            <button type="button" className="text-action" onClick={() => setOrderedKeys((old) => old.filter((item) => item !== key))}>{t('blueprint.composition.remove')}</button>
          </div>; })}
        </div>
        <div className="catalog-dialog__actions">
          <button type="button" disabled={!preview?.length} onClick={() => setEditor((old) => applyBulkNames(old, orderedKeys, naming))}>{t('blueprint.naming.apply')}</button>
          <button type="button" autoFocus onClick={() => setOrderOpen(false)}>{t('action.close')}</button>
        </div>
      </div>
    </section>}
    {pairwiseOpen && <section className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="blueprint-pairwise-title">
      <div className="catalog-dialog__surface blueprint-pairwise-dialog">
        <h2 id="blueprint-pairwise-title">{t('blueprint.pairwise.open')}</h2>
        <div className="blueprint-pairwise__captures">
          <span role="status">A: {captureStatus(capturedA)}</span>
          <button type="button" disabled={!capturedA.length} onClick={() => setCapturedA([])}>{t('blueprint.pairwise.clearA')}</button>
          <span role="status">B: {captureStatus(capturedB)}</span>
          <button type="button" disabled={!capturedB.length} onClick={() => setCapturedB([])}>{t('blueprint.pairwise.clearB')}</button>
        </div>
        <label><input type="checkbox" checked={reverseB} onChange={(event) => setReverseB(event.target.checked)} />{t('blueprint.pairwise.reverseB')}</label>
        {pairwise.error && <p role="alert">{t(`blueprint.pairwise.error.${pairwise.error}`)}</p>}
        <div className="blueprint-pairwise-dialog__list">
          {pairwise.pairs.map((pair, index) => <div key={index} className="blueprint-pairwise-dialog__row" data-pairwise-row>
            <span>{index + 1}</span><span>{endpointLabel(pair.from_slot_key)}</span><span>↔</span><span>{endpointLabel(pair.to_slot_key)}</span>
          </div>)}
        </div>
        <div className="catalog-dialog__actions">
          <button type="button" disabled={Boolean(pairwise.error)} onClick={applyPairwise}>{t('blueprint.pairwise.apply')}</button>
          <button type="button" autoFocus onClick={() => setPairwiseOpen(false)}>{t('action.close')}</button>
        </div>
      </div>
    </section>}
    {linksOpen && <section className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="blueprint-links-title">
      <div className="catalog-dialog__surface blueprint-links-dialog">
        <h2 id="blueprint-links-title">{t('blueprint.composition.links')}</h2>
        <div className="blueprint-links-dialog__bulk">
          <button type="button" disabled={!editor.individualLinks.length} onClick={() => setSelectedLinks(new Set(editor.individualLinks.map((_, index) => index)))}>{t('blueprint.links.selectAll')}</button>
          <button type="button" disabled={!selectedLinks.size} onClick={() => setSelectedLinks(new Set())}>{t('blueprint.links.clearSelection')}</button>
          <button type="button" disabled={!selectedLinks.size} onClick={() => { setEditor((old) => ({ ...old, individualLinks: old.individualLinks.filter((_, index) => !selectedLinks.has(index)) })); setSelectedLinks(new Set()); }}>{t('blueprint.links.deleteSelected', { count: selectedLinks.size })}</button>
        </div>
        <div className="blueprint-links-dialog__list">
          {editor.individualLinks.map((link, index) => <div className="blueprint-composer__link" key={index}>
            <input type="checkbox" aria-label={t('blueprint.links.selectRow', { index: index + 1 })} checked={selectedLinks.has(index)} onChange={(event) => { const next = new Set(selectedLinks); if (event.target.checked) next.add(index); else next.delete(index); setSelectedLinks(next); }} />
            {(['from_slot_key', 'to_slot_key'] as const).map((field) => <label key={field} className="blueprint-links-dialog__endpoint">{field === 'to_slot_key' && <span aria-hidden="true" className="blueprint-links-dialog__separator">↔</span>}<select key={field} aria-label={t(field === 'from_slot_key' ? 'blueprint.composition.firstLink' : 'blueprint.composition.secondLink', { index: index + 1 })} value={link[field]} onChange={(e) => { setSelectedLinks(new Set()); setEditor((old) => ({ ...old, individualLinks: old.individualLinks.map((item, i) => i === index ? { ...item, [field]: e.target.value } : item) })); }}>{editor.slots.map((slot) => <option key={slot.key} value={slot.key}>{slot.display_name} · {editor.panels.find((panel) => panel.panel_key === slot.panel_key)?.display_name}</option>)}</select></label>)}
            <button type="button" className="text-action" onClick={() => { setSelectedLinks(new Set()); setEditor((old) => ({ ...old, individualLinks: old.individualLinks.filter((_, i) => i !== index) })); }}>{t('blueprint.composition.remove')}</button>
          </div>)}
        </div>
        <div className="catalog-dialog__actions">
          <button type="button" disabled={editor.slots.length < 2} onClick={addLink}>{t('blueprint.composition.addLink')}</button>
          <button type="button" autoFocus onClick={closeLinks}>{t('action.close')}</button>
        </div>
      </div>
    </section>}

  </>;
}
