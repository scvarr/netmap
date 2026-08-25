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

const sides: BlueprintAnchorSide[] = ["LEFT", "RIGHT", "TOP", "BOTTOM"];
const kinds: BlueprintSlotKind[] = ["CONNECTION_POINT", "NETWORK_PORT"];
const sideLabel: Record<BlueprintAnchorSide, string> = {
  LEFT: "Слева",
  RIGHT: "Справа",
  TOP: "Сверху",
  BOTTOM: "Снизу",
};
const kindLabel: Record<BlueprintSlotKind, string> = {
  CONNECTION_POINT: "Точка подключения",
  NETWORK_PORT: "Сетевой порт",
};
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
const groupLabel = (group: EndpointGroup, index?: number) =>
  group.displayPrefix || `Группа ${(index ?? 0) + 1}`;
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
  const portChoices = editor.groups.flatMap((group, groupIndex) =>
    generatedGroupKeys(group).map((key, index) => ({
      key,
      label: `Группа ${groupIndex + 1}: ${groupLabel(group, groupIndex)} — ${generatedGroupDisplayNames(group)[index]}`,
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
          : "Не удалось сохранить шаблон.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <header className="catalog-page__header">
        <div>
          <span className="shell-nav__group-label">Визуальный редактор</span>
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
            Название шаблона
            <input
              aria-label="Название шаблона"
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            />
          </label>
          <label>
            Тип объекта
            <input
              aria-label="Тип объекта"
              value={editor.defaultClass}
              onChange={(e) =>
                setEditor({ ...editor, defaultClass: e.target.value })
              }
            />
            <span className="blueprint-editor__hint">
              Необязательная классификация, например switch или patch_panel.
            </span>
          </label>
          <div className="blueprint-editor-controls__row">
            <label>
              Ширина
              <input
                aria-label="Ширина"
                type="number"
                value={editor.width}
                onChange={(e) =>
                  setEditor({ ...editor, width: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Высота
              <input
                aria-label="Высота"
                type="number"
                value={editor.height}
                onChange={(e) =>
                  setEditor({ ...editor, height: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <p className="blueprint-editor__hint">
            Это схематическая форма шаблона; размер на карте определяет
            отображение карты.
          </p>
          <div className="blueprint-editor-color">
            <label>
              Цвет
              <input
                aria-label="Выбор цвета"
                type="color"
                value={colorValue(editor.fillColor)}
                onChange={(e) =>
                  setEditor({ ...editor, fillColor: e.target.value })
                }
              />
            </label>
            <label>
              Точный цвет (hex)
              <input
                aria-label="Цвет (hex)"
                value={editor.fillColor}
                onChange={(e) =>
                  setEditor({ ...editor, fillColor: e.target.value })
                }
              />
            </label>
          </div>
          <h2>Группы портов</h2>
          <p className="blueprint-editor__hint">
            Группа создаёт последовательность портов с общей маркировкой и
            расположением на схеме.
          </p>
          {editor.groups.length === 0 && <p className="blueprint-editor__hint">Группы портов необязательны. Добавьте группу, если у объекта есть порты.</p>}
          {editor.groups.map((g, i) => (
            <fieldset className="endpoint-group" key={g.id}>
              <legend>
                Группа {i + 1}: {groupLabel(g, i)}
              </legend>
              <p className="endpoint-group__summary">
                {generatedGroupDisplayNames(g).join(", ")} · {kindLabel[g.kind]}{" "}
                · {sideLabel[g.side]}
              </p>
              <label>
                Префикс отображаемого имени
                <input
                  aria-label={`Префикс отображаемого имени ${i + 1}`}
                  value={g.displayPrefix}
                  onChange={(e) =>
                    update(g.id, "displayPrefix", e.target.value)
                  }
                />
              </label>
              <div className="blueprint-editor-controls__row">
                <label>
                  Тип порта
                  <select
                    aria-label={`Тип порта ${i + 1}`}
                    value={g.kind}
                    onChange={(e) =>
                      update(g.id, "kind", e.target.value as BlueprintSlotKind)
                    }
                  >
                    {kinds.map((x) => (
                      <option key={x} value={x}>
                        {kindLabel[x]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Сторона схемы
                  <select
                    aria-label={`Сторона схемы ${i + 1}`}
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
                        {sideLabel[x]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="blueprint-editor-controls__row">
                <label>
                  Количество портов
                  <input
                    aria-label={`Количество портов ${i + 1}`}
                    type="number"
                    value={g.count}
                    onChange={(e) =>
                      update(g.id, "count", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Начать с номера
                  <input
                    aria-label={`Начать с номера ${i + 1}`}
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
                  Начало диапазона (0–1)
                  <input
                    aria-label={`Начало диапазона ${i + 1}`}
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
                  Длина диапазона (0–1)
                  <input
                    aria-label={`Длина диапазона ${i + 1}`}
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
                Порты равномерно располагаются внутри этого диапазона выбранной
                стороны.
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
                Удалить группу
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
            Добавить группу портов
          </button>
          <h2>Индивидуальные внутренние связи</h2>
          <p className="blueprint-editor__hint">
            Соедините любые два конкретных порта. Такие связи дополняют правила
            пар по номеру.
          </p>
          {editor.individualLinks.length === 0 && <p className="blueprint-editor__hint">Пока нет индивидуальных внутренних связей.</p>}
          {editor.individualLinks.map((link, i) => (
            <div className="blueprint-pair" key={`${link.from_slot_key}-${link.to_slot_key}-${i}`}>
              <label>
                <span className="sr-only">Первый порт индивидуальной связи {i + 1}</span>
                <select aria-label={`Первый порт индивидуальной связи ${i + 1}`} value={link.from_slot_key} onChange={(e) => updateIndividualLink(i, 'from_slot_key', e.target.value)}>
                  {!portChoices.some((port) => port.key === link.from_slot_key) && <option value={link.from_slot_key}>Недоступный порт</option>}
                  {portChoices.map((port) => <option key={port.key} value={port.key}>{port.label}</option>)}
                </select>
              </label>
              <span>↔</span>
              <label>
                <span className="sr-only">Второй порт индивидуальной связи {i + 1}</span>
                <select aria-label={`Второй порт индивидуальной связи ${i + 1}`} value={link.to_slot_key} onChange={(e) => updateIndividualLink(i, 'to_slot_key', e.target.value)}>
                  {!portChoices.some((port) => port.key === link.to_slot_key) && <option value={link.to_slot_key}>Недоступный порт</option>}
                  {portChoices.map((port) => <option key={port.key} value={port.key}>{port.label}</option>)}
                </select>
              </label>
              <button type="button" aria-label={`Удалить индивидуальную связь ${i + 1}`} onClick={() => setEditor((s) => ({ ...s, individualLinks: s.individualLinks.filter((_, current) => current !== i) }))}>Удалить</button>
            </div>
          ))}
          <button type="button" className="secondary-action" disabled={portChoices.length < 2} onClick={() => setEditor((s) => portChoices.length < 2 ? s : { ...s, individualLinks: [...s.individualLinks, { from_slot_key: portChoices[0].key, to_slot_key: portChoices[1].key }] })}>Добавить индивидуальную связь</button>
          <h2>Внутренние пары портов</h2>
          <p className="blueprint-editor__hint">
            Правило соединяет порт 1 одной группы с портом 1 другой группы,
            затем порт 2 с портом 2.
          </p>
          {editor.pairs.map((p, i) => (
            <div
              className="blueprint-pair"
              key={`${p.leftGroupId}-${p.rightGroupId}-${i}`}
            >
              <label>
                <span className="sr-only">Первая группа правила {i + 1}</span>
                <select
                  aria-label={`Первая группа правила ${i + 1}`}
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
                <span className="sr-only">Вторая группа правила {i + 1}</span>
                <select
                  aria-label={`Вторая группа правила ${i + 1}`}
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
                aria-label={`Удалить правило ${i + 1}`}
                onClick={() =>
                  setEditor((s) => ({
                    ...s,
                    pairs: s.pairs.filter((_, n) => n !== i),
                  }))
                }
              >
                Удалить
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
            Добавить правило пар по номеру
          </button>
          {hasAttemptedSave && generated.errors.length > 0 && <p role="alert" className="blueprint-editor__error">{generated.errors.join(" ")}</p>}
          {saveError && <p role="alert" className="blueprint-editor__error">Не удалось сохранить шаблон: {saveError}</p>}
          <button
            type="button"
            className="primary-action"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Сохраняем…" : saveLabel}
          </button>
        </section>
        <section className="blueprint-editor-preview">
          <div className="blueprint-editor-preview__heading">
            <h2>Предпросмотр схемы</h2>
            <div>
              <button
                type="button"
                aria-label="Уменьшить масштаб"
                onClick={() => setZoom((v) => Math.max(0.25, v - 0.25))}
              >
                −
              </button>
              <button
                type="button"
                aria-label="Сбросить масштаб"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="Увеличить масштаб"
                onClick={() => setZoom((v) => Math.min(2, v + 0.25))}
              >
                +
              </button>
              <button type="button" onClick={() => setZoom(1)}>
                Вписать
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
            Портов: {generated.slots.length} · внутренних связей:{" "}
            {generated.internalLinks.length}
          </p>
        </section>
      </div>
    </>
  );
}
