import type { BlueprintAnchorSide, BlueprintAuthoringRecipe, BlueprintInternalLink, BlueprintSlot, BlueprintSlotKind, CreateObjectBlueprintRequest, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';

export interface EndpointGroup {
  id: string;
  keyPrefix: string;
  displayPrefix: string;
  kind: BlueprintSlotKind;
  side: BlueprintAnchorSide;
  count: number;
  startingNumber: number;
  placementOffset: number;
  placementSpan: number;
}

export interface GroupPair { leftGroupId: string; rightGroupId: string; }
export interface BlueprintEditorState {
  name: string;
  defaultClass: string;
  width: number;
  height: number;
  fillColor: string;
  groups: EndpointGroup[];
  pairs: GroupPair[];
}

export interface GeneratedBlueprint { slots: BlueprintSlot[]; internalLinks: BlueprintInternalLink[]; errors: string[]; }

const pad = (value: number, width: number) => String(value).padStart(width, '0');
const normalized = (value: string) => value.trim();

export const generatedGroupKeys = (group: EndpointGroup): string[] => {
  const width = Math.max(2, String(group.startingNumber + Math.max(group.count - 1, 0)).length);
  return Array.from({ length: Math.max(0, group.count) }, (_, index) => `${normalized(group.keyPrefix)}${pad(group.startingNumber + index, width)}`);
};

export const hydrateBlueprintEditorState = (version: ObjectBlueprintVersionDocument): BlueprintEditorState | null => {
  const recipe = version.authoring_recipe;
  if (!recipe) return null;
  return {
    name: version.name, defaultClass: version.default_physical_object_class ?? '', width: version.body.width, height: version.body.height, fillColor: version.body.fill_color ?? '#28565a',
    groups: recipe.endpoint_groups.map((group) => ({ id: group.group_id, keyPrefix: group.key_prefix, displayPrefix: group.display_prefix, kind: group.kind, side: group.side, count: group.count, startingNumber: group.starting_number, placementOffset: group.placement_offset ?? 0, placementSpan: group.placement_span ?? 1 })),
    pairs: recipe.pair_recipes.map((pair) => ({ leftGroupId: pair.group_a_id, rightGroupId: pair.group_b_id })),
  };
};

export const generateBlueprint = (state: BlueprintEditorState): GeneratedBlueprint => {
  const errors: string[] = [];
  if (!normalized(state.name)) errors.push('Укажите название шаблона.');
  if (!Number.isFinite(state.width) || state.width <= 0 || !Number.isFinite(state.height) || state.height <= 0) errors.push('Ширина и высота должны быть больше нуля.');
  if (state.fillColor && !/^#[0-9A-Fa-f]{6}$/.test(state.fillColor)) errors.push('Цвет должен быть в формате #RRGGBB.');
  const prefixes = new Set<string>();
  state.groups.forEach((group) => {
    const prefix = normalized(group.keyPrefix);
    if (!prefix) errors.push('Укажите префикс ключа каждой группы.');
    else if (prefixes.has(prefix)) errors.push(`Повторяется префикс ключа: ${prefix}.`);
    prefixes.add(prefix);
    if (!normalized(group.displayPrefix)) errors.push('Укажите префикс отображаемого имени каждой группы.');
    if (!Number.isInteger(group.count) || group.count < 1) errors.push('Количество портов в группе должно быть не меньше 1.');
    if (!Number.isInteger(group.startingNumber) || group.startingNumber < 0) errors.push('Начальный номер должен быть целым числом от 0.');
    if (!Number.isFinite(group.placementOffset) || group.placementOffset < 0 || group.placementOffset > 1 || !Number.isFinite(group.placementSpan) || group.placementSpan <= 0 || group.placementSpan > 1 || group.placementOffset + group.placementSpan > 1) errors.push('Диапазон группы должен находиться в пределах 0–1 и иметь положительную длину.');
  });

  const slots: BlueprintSlot[] = [];
  const groupsBySide = new Map<BlueprintAnchorSide, EndpointGroup[]>();
  for (const group of state.groups) groupsBySide.set(group.side, [...(groupsBySide.get(group.side) ?? []), group]);
  for (const [side, groups] of groupsBySide) {
    groups.forEach((group) => generatedGroupKeys(group).forEach((key, index) => {
      const width = Math.max(2, String(group.startingNumber + Math.max(group.count - 1, 0)).length);
      const number = pad(group.startingNumber + index, width);
      slots.push({ key, display_name: `${normalized(group.displayPrefix)}${number}`, kind: group.kind, anchor: { side, offset: group.placementOffset + group.placementSpan * (group.count === 1 ? .5 : index / (group.count - 1)) } });
    }));
  }
  const slotKeys = slots.map((slot) => slot.key);
  if (new Set(slotKeys).size !== slotKeys.length) errors.push('Получились повторяющиеся идентификаторы портов. Измените группы.');

  const groupsById = new Map(state.groups.map((group) => [group.id, group]));
  const links: BlueprintInternalLink[] = [];
  const pairs = new Set<string>();
  for (const pair of state.pairs) {
    const left = groupsById.get(pair.leftGroupId); const right = groupsById.get(pair.rightGroupId);
    if (!left || !right) { errors.push('Правило внутренних пар ссылается на отсутствующую группу.'); continue; }
    if (left.count !== right.count) { errors.push('Внутренние пары возможны только при одинаковом количестве портов в группах.'); continue; }
    generatedGroupKeys(left).forEach((from_slot_key, index) => {
      const to_slot_key = generatedGroupKeys(right)[index]; const key = [from_slot_key, to_slot_key].sort().join('\u0000');
      if (pairs.has(key)) errors.push('Сгенерирована повторяющаяся внутренняя связь.'); else { pairs.add(key); links.push({ from_slot_key, to_slot_key }); }
    });
  }
  return { slots, internalLinks: links, errors };
};

export const createBlueprintRequest = (state: BlueprintEditorState): { request?: CreateObjectBlueprintRequest; errors: string[] } => {
  const generated = generateBlueprint(state);
  if (generated.errors.length) return { errors: generated.errors };
  const authoring_recipe: BlueprintAuthoringRecipe = {
    endpoint_groups: state.groups.map((group) => ({ group_id: group.id, key_prefix: normalized(group.keyPrefix), display_prefix: normalized(group.displayPrefix), kind: group.kind, side: group.side, count: group.count, starting_number: group.startingNumber, placement_offset: group.placementOffset, placement_span: group.placementSpan })),
    pair_recipes: state.pairs.map((pair) => ({ group_a_id: pair.leftGroupId, group_b_id: pair.rightGroupId })),
  };
  return { errors: [], request: { name: normalized(state.name), ...(normalized(state.defaultClass) ? { default_physical_object_class: normalized(state.defaultClass) } : {}), body: { kind: 'RECTANGLE', width: state.width, height: state.height, ...(state.fillColor ? { fill_color: state.fillColor } : {}) }, slots: generated.slots, internal_links: generated.internalLinks, authoring_recipe } };
};
