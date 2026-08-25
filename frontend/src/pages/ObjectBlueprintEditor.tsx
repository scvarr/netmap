import { useMemo, useState } from "react";
import { BlueprintPreviewViewport } from "../components/BlueprintPreview";
import {
  createBlueprintRequest,
  generateBlueprint,
  generatedGroupDisplayNames,
  generatedGroupKeys,
  type BlueprintEditorState,
  type EndpointGroup,
} from "../blueprints/editorModel";
import type {
  BlueprintAnchorSide,
  BlueprintSlotKind,
} from "../topology/objectBlueprintTypes";
import { useI18n, type MessageKey } from '../i18n';

const sides: BlueprintAnchorSide[] = ["LEFT", "RIGHT", "TOP", "BOTTOM"];
const kinds: BlueprintSlotKind[] = ["CONNECTION_POINT", "NETWORK_PORT"];
export const newEndpointGroup = (displayPrefix = ""): EndpointGroup => {
  const stableId = globalThis.crypto.randomUUID();
  return {
    id: `group-${stableId}`,
    keyPrefix: `group-${stableId}`,
    displayPrefix,
    kind: "CONNECTION_POINT",
    side: "LEFT",
    count: 1,
    startingNumber: 1,
    placementOffset: 0,
    placementSpan: 1,
  };
};
const colorValue = (value: string) =>
  /^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#28565a";
const validationKey: Record<string, MessageKey> = {
  nameRequired: 'blueprint.validation.nameRequired', dimensionsPositive: 'blueprint.validation.dimensionsPositive', colorFormat: 'blueprint.validation.colorFormat', stableGroupId: 'blueprint.validation.stableGroupId', uniqueStableGroupIds: 'blueprint.validation.uniqueStableGroupIds', groupDisplayPrefix: 'blueprint.validation.groupDisplayPrefix', groupPortCount: 'blueprint.validation.groupPortCount', groupStartingNumber: 'blueprint.validation.groupStartingNumber', groupRange: 'blueprint.validation.groupRange', duplicateSlotKeys: 'blueprint.validation.duplicateSlotKeys', pairMissingGroup: 'blueprint.validation.pairMissingGroup', pairSameGroup: 'blueprint.validation.pairSameGroup', pairCountMismatch: 'blueprint.validation.pairCountMismatch', duplicateInternalLink: 'blueprint.validation.duplicateInternalLink', individualSelfLink: 'blueprint.validation.individualSelfLink', individualMissingPort: 'blueprint.validation.individualMissingPort', duplicateIndividualLink: 'blueprint.validation.duplicateIndividualLink', individualDuplicatesPair: 'blueprint.validation.individualDuplicatesPair',
};
const slotBelongsToGroup = (slotKey: string, stableGroupKey: string) => {
  const prefix = `${stableGroupKey}:`;
  return slotKey.startsWith(prefix) && /^[1-9]\d*$/.test(slotKey.slice(prefix.length));
};
export const newBlueprintEditorState = (): BlueprintEditorState => ({
  name: "",
  defaultClass: "",
  width: 120,
  height: 60,
  fillColor: "#28565a",
  groups: [],
  pairs: [],
  individualLinks: [],
});

export function ObjectBlueprintEditor({
  initialState,
  title,
  description,
  saveLabel,
  versionNotice,
  onSave,
}: {
  initialState: BlueprintEditorState;
  title: string;
  description: string;
  saveLabel: string;
  versionNotice?: string;
  onSave: (state: BlueprintEditorState) => Promise<void>;
}) {
  const { t } = useI18n();
  const [editor, setEditor] = useState(initialState);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const generated = useMemo(() => generateBlueprint(editor), [editor]);
  const update = (
    id: string,
    field: keyof EndpointGroup,
    value: string | number,
  ) =>
    setEditor((s) => ({
      ...s,
      groups: s.groups.map((g) => (g.id === id ? { ...g, [field]: value } : g)),
    }));
  const sideLabel = (side: BlueprintAnchorSide) => t(`blueprint.side.${side}` as MessageKey);
  const kindLabel = (kind: BlueprintSlotKind) => t(`blueprint.kind.${kind}` as MessageKey);
  const groupLabel = (group: EndpointGroup, index: number) => group.displayPrefix || t('blueprint.editor.group', { index: index + 1 });
  const portChoices = editor.groups.flatMap((group, groupIndex) =>
    generatedGroupKeys(group).map((key, index) => ({
      key,
      label: t('blueprint.editor.groupPort', { index: groupIndex + 1, group: groupLabel(group, groupIndex), port: generatedGroupDisplayNames(group)[index] }),
    })),
  );
  const updateIndividualLink = (
    index: number,
    field: "from_slot_key" | "to_slot_key",
    value: string,
  ) =>
    setEditor((s) => ({
      ...s,
      individualLinks: s.individualLinks.map((link, current) =>
        current === index ? { ...link, [field]: value } : link,
      ),
    }));
  const save = async () => {
    const result = createBlueprintRequest(editor);
    setHasAttemptedSave(true);
    if (!result.request) {
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(editor);
    } catch (reason) {
      setSaveError(
        reason instanceof Error
          ? reason.message
          : t('blueprint.library.deleteFailed'),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <header className="catalog-page__header">
        <div>
          <span className="shell-nav__group-label">{t('blueprint.editor.section')}</span>
          <h1>{title}</h1>
          <p>{description}</p>
          {versionNotice && (
            <p className="blueprint-editor__notice">{versionNotice}</p>
          )}
        </div>
      </header>
      <div className="blueprint-editor-layout">
        <section className="blueprint-editor-controls">
          <label>
            {t('blueprint.editor.name')}
            <input
              aria-label={t('blueprint.editor.name')}
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            />
          </label>
          <label>
            {t('blueprint.editor.class')}
            <input
              aria-label={t('blueprint.editor.class')}
              value={editor.defaultClass}
              onChange={(e) =>
                setEditor({ ...editor, defaultClass: e.target.value })
              }
            />
            <span className="blueprint-editor__hint">
              {t('blueprint.editor.classHint')}
            </span>
          </label>
          <div className="blueprint-editor-controls__row">
            <label>
              {t('blueprint.editor.width')}
              <input
                aria-label={t('blueprint.editor.width')}
                type="number"
                value={editor.width}
                onChange={(e) =>
                  setEditor({ ...editor, width: Number(e.target.value) })
                }
              />
            </label>
            <label>
              {t('blueprint.editor.height')}
              <input
                aria-label={t('blueprint.editor.height')}
                type="number"
                value={editor.height}
                onChange={(e) =>
                  setEditor({ ...editor, height: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <p className="blueprint-editor__hint">
            {t('blueprint.editor.sizeHint')}
          </p>
          <div className="blueprint-editor-color">
            <label>
              {t('blueprint.editor.color')}
              <input
                aria-label={t('blueprint.editor.colorPicker')}
                type="color"
                value={colorValue(editor.fillColor)}
                onChange={(e) =>
                  setEditor({ ...editor, fillColor: e.target.value })
                }
              />
            </label>
            <label>
              {t('blueprint.editor.colorExact')}
              <input
                aria-label={t('blueprint.editor.colorHex')}
                value={editor.fillColor}
                onChange={(e) =>
                  setEditor({ ...editor, fillColor: e.target.value })
                }
              />
            </label>
          </div>
          <h2>{t('blueprint.editor.groups')}</h2>
          <p className="blueprint-editor__hint">
            {t('blueprint.editor.groupsHint')}
          </p>
          {editor.groups.length === 0 && <p className="blueprint-editor__hint">{t('blueprint.editor.groupsEmpty')}</p>}
          {editor.groups.map((g, i) => (
            <fieldset className="endpoint-group" key={g.id}>
              <legend>
                {t('blueprint.editor.group', { index: i + 1 })}: {groupLabel(g, i)}
              </legend>
              <p className="endpoint-group__summary">
                {generatedGroupDisplayNames(g).join(", ")} · {kindLabel(g.kind)} · {sideLabel(g.side)}
              </p>
              <label>
                {t('blueprint.editor.displayPrefix')}
                <input
                  aria-label={t('blueprint.editor.displayPrefixIndexed', { index: i + 1 })}
                  value={g.displayPrefix}
                  onChange={(e) =>
                    update(g.id, "displayPrefix", e.target.value)
                  }
                />
              </label>
              <div className="blueprint-editor-controls__row">
                <label>
                  {t('blueprint.editor.portKind')}
                  <select
                    aria-label={t('blueprint.editor.portKindIndexed', { index: i + 1 })}
                    value={g.kind}
                    onChange={(e) =>
                      update(g.id, "kind", e.target.value as BlueprintSlotKind)
                    }
                  >
                    {kinds.map((x) => (
                      <option key={x} value={x}>
                        {kindLabel(x)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('blueprint.editor.anchorSide')}
                  <select
                    aria-label={t('blueprint.editor.anchorSideIndexed', { index: i + 1 })}
                    value={g.side}
                    onChange={(e) =>
                      update(
                        g.id,
                        "side",
                        e.target.value as BlueprintAnchorSide,
                      )
                    }
                  >
                    {sides.map((x) => (
                      <option key={x} value={x}>
                        {sideLabel(x)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="blueprint-editor-controls__row">
                <label>
                  {t('blueprint.editor.portCount')}
                  <input
                    aria-label={t('blueprint.editor.portCountIndexed', { index: i + 1 })}
                    type="number"
                    value={g.count}
                    onChange={(e) =>
                      update(g.id, "count", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  {t('blueprint.editor.startingNumber')}
                  <input
                    aria-label={t('blueprint.editor.startingNumberIndexed', { index: i + 1 })}
                    type="number"
                    value={g.startingNumber}
                    onChange={(e) =>
                      update(g.id, "startingNumber", Number(e.target.value))
                    }
                  />
                </label>
              </div>
              <div className="blueprint-editor-controls__row">
                <label>
                  {t('blueprint.editor.rangeStart')}
                  <input
                    aria-label={t('blueprint.editor.rangeStartIndexed', { index: i + 1 })}
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={g.placementOffset}
                    onChange={(e) =>
                      update(g.id, "placementOffset", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  {t('blueprint.editor.rangeLength')}
                  <input
                    aria-label={t('blueprint.editor.rangeLengthIndexed', { index: i + 1 })}
                    type="number"
                    min="0.01"
                    max="1"
                    step="0.01"
                    value={g.placementSpan}
                    onChange={(e) =>
                      update(g.id, "placementSpan", Number(e.target.value))
                    }
                  />
                </label>
              </div>
              <span className="blueprint-editor__hint">
                {t('blueprint.editor.rangeHint')}
              </span>
              <button
                type="button"
                onClick={() =>
                  setEditor((s) => {
                    return {
                      ...s,
                      groups: s.groups.filter((x) => x.id !== g.id),
                      pairs: s.pairs.filter(
                        (p) => p.leftGroupId !== g.id && p.rightGroupId !== g.id,
                      ),
                      individualLinks: s.individualLinks.filter(
                        (link) => !slotBelongsToGroup(link.from_slot_key, g.keyPrefix) && !slotBelongsToGroup(link.to_slot_key, g.keyPrefix),
                      ),
                    };
                  })
                }
              >
                {t('blueprint.editor.removeGroup')}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="secondary-action"
            onClick={() =>
              setEditor((s) => ({
                ...s,
                groups: [...s.groups, newEndpointGroup()],
              }))
            }
          >
            {t('blueprint.editor.addGroup')}
          </button>
          <h2>{t('blueprint.editor.individualLinks')}</h2>
          <p className="blueprint-editor__hint">
            {t('blueprint.editor.individualLinksHint')}
          </p>
          {editor.individualLinks.length === 0 && <p className="blueprint-editor__hint">{t('blueprint.editor.individualLinksEmpty')}</p>}
          {editor.individualLinks.map((link, i) => (
            <div className="blueprint-pair" key={`${link.from_slot_key}-${link.to_slot_key}-${i}`}>
              <label>
                <span className="sr-only">{t('blueprint.editor.firstLinkPort', { index: i + 1 })}</span>
                <select aria-label={t('blueprint.editor.firstLinkPort', { index: i + 1 })} value={link.from_slot_key} onChange={(e) => updateIndividualLink(i, 'from_slot_key', e.target.value)}>
                  {!portChoices.some((port) => port.key === link.from_slot_key) && <option value={link.from_slot_key}>{t('blueprint.editor.unavailablePort')}</option>}
                  {portChoices.map((port) => <option key={port.key} value={port.key}>{port.label}</option>)}
                </select>
              </label>
              <span>↔</span>
              <label>
                <span className="sr-only">{t('blueprint.editor.secondLinkPort', { index: i + 1 })}</span>
                <select aria-label={t('blueprint.editor.secondLinkPort', { index: i + 1 })} value={link.to_slot_key} onChange={(e) => updateIndividualLink(i, 'to_slot_key', e.target.value)}>
                  {!portChoices.some((port) => port.key === link.to_slot_key) && <option value={link.to_slot_key}>{t('blueprint.editor.unavailablePort')}</option>}
                  {portChoices.map((port) => <option key={port.key} value={port.key}>{port.label}</option>)}
                </select>
              </label>
              <button type="button" aria-label={t('blueprint.editor.removeIndividualLink', { index: i + 1 })} onClick={() => setEditor((s) => ({ ...s, individualLinks: s.individualLinks.filter((_, current) => current !== i) }))}>{t('blueprint.editor.remove')}</button>
            </div>
          ))}
          <button type="button" className="secondary-action" disabled={portChoices.length < 2} onClick={() => setEditor((s) => portChoices.length < 2 ? s : { ...s, individualLinks: [...s.individualLinks, { from_slot_key: portChoices[0].key, to_slot_key: portChoices[1].key }] })}>{t('blueprint.editor.addIndividualLink')}</button>
          <h2>{t('blueprint.editor.pairs')}</h2>
          <p className="blueprint-editor__hint">
            {t('blueprint.editor.pairsHint')}
          </p>
          {editor.pairs.map((p, i) => (
            <div
              className="blueprint-pair"
              key={`${p.leftGroupId}-${p.rightGroupId}-${i}`}
            >
              <label>
                <span className="sr-only">{t('blueprint.editor.firstPairGroup', { index: i + 1 })}</span>
                <select
                  aria-label={t('blueprint.editor.firstPairGroup', { index: i + 1 })}
                  value={p.leftGroupId}
                  onChange={(e) =>
                    setEditor((s) => ({
                      ...s,
                      pairs: s.pairs.map((x, n) =>
                        n === i ? { ...x, leftGroupId: e.target.value } : x,
                      ),
                    }))
                  }
                >
                  {editor.groups.map((g, index) => (
                    <option key={g.id} value={g.id}>
                      {groupLabel(g, index)}
                    </option>
                  ))}
                </select>
              </label>
              <span>↔</span>
              <label>
                <span className="sr-only">{t('blueprint.editor.secondPairGroup', { index: i + 1 })}</span>
                <select
                  aria-label={t('blueprint.editor.secondPairGroup', { index: i + 1 })}
                  value={p.rightGroupId}
                  onChange={(e) =>
                    setEditor((s) => ({
                      ...s,
                      pairs: s.pairs.map((x, n) =>
                        n === i ? { ...x, rightGroupId: e.target.value } : x,
                      ),
                    }))
                  }
                >
                  {editor.groups.map((g, index) => (
                    <option key={g.id} value={g.id}>
                      {groupLabel(g, index)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-label={t('blueprint.editor.removePair', { index: i + 1 })}
                onClick={() =>
                  setEditor((s) => ({
                    ...s,
                    pairs: s.pairs.filter((_, n) => n !== i),
                  }))
                }
              >
                {t('blueprint.editor.remove')}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary-action"
            disabled={editor.groups.length < 2}
            onClick={() =>
              setEditor((s) =>
                s.groups.length < 2
                  ? s
                  : {
                      ...s,
                      pairs: [
                        ...s.pairs,
                        {
                          leftGroupId: s.groups[0].id,
                          rightGroupId: s.groups[1].id,
                        },
                      ],
                    },
              )
            }
          >
            {t('blueprint.editor.addPair')}
          </button>
          {hasAttemptedSave && generated.validationErrors.length > 0 && <p role="alert" className="blueprint-editor__error">{generated.validationErrors.map((error) => t(validationKey[error])).join(' ')}</p>}
          {saveError && <p role="alert" className="blueprint-editor__error">{t('blueprint.editor.saveFailed', { error: saveError })}</p>}
          <button
            type="button"
            className="primary-action"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? t('blueprint.editor.saving') : saveLabel}
          </button>
        </section>
        <section className="blueprint-editor-preview">
          <div className="blueprint-editor-preview__heading">
            <h2>{t('blueprint.editor.preview')}</h2>
            <div>
              <button
                type="button"
                aria-label={t('blueprint.editor.zoomOut')}
                onClick={() => setZoom((v) => Math.max(0.25, v - 0.25))}
              >
                −
              </button>
              <button
                type="button"
                aria-label={t('blueprint.editor.resetZoom')}
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label={t('blueprint.editor.zoomIn')}
                onClick={() => setZoom((v) => Math.min(2, v + 0.25))}
              >
                +
              </button>
              <button type="button" onClick={() => setZoom(1)}>
                {t('blueprint.editor.fit')}
              </button>
            </div>
          </div>
          <BlueprintPreviewViewport
            body={{
              kind: "RECTANGLE",
              width: Math.max(editor.width, 1),
              height: Math.max(editor.height, 1),
              fill_color: editor.fillColor || undefined,
            }}
            slots={generated.slots}
            internalLinks={generated.internalLinks}
            scale={zoom}
          />
          <p>
            {t('blueprint.editor.summary', { ports: generated.slots.length, links: generated.internalLinks.length })}
          </p>
        </section>
      </div>
    </>
  );
}
