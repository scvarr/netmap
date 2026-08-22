import type {
  TopologyProjectionEdge,
  TopologyProjectionNode,
} from './types';

const TECHNICAL_DEVICE_LABEL = /^PhysicalObject\s+(.+)$/i;

const shortId = (value: string): string => value.replace(/[{}]/g, '').slice(0, 8);

export interface PhysicalClassPresentation {
  label: string;
  accent: 'workstation' | 'switch' | 'cable' | 'outlet' | 'patch-panel' | 'unknown';
}

export const physicalClassPresentation = (value: unknown): PhysicalClassPresentation => {
  if (value === 'workstation') return { label: 'ПК', accent: 'workstation' };
  if (value === 'switch') return { label: 'КОММУТАТОР', accent: 'switch' };
  if (value === 'cable') return { label: 'КАБЕЛЬ', accent: 'cable' };
  if (value === 'outlet') return { label: 'РОЗЕТКА', accent: 'outlet' };
  if (value === 'patch_panel') return { label: 'ПАТЧ-ПАНЕЛЬ', accent: 'patch-panel' };
  return { label: 'ФИЗИЧЕСКИЙ ОБЪЕКТ', accent: 'unknown' };
};

export const displayNodeLabel = (node: TopologyProjectionNode): string => {
  const technicalMatch = node.label.match(TECHNICAL_DEVICE_LABEL);
  if (node.attributes.label_source !== 'TECHNICAL_FALLBACK' && !technicalMatch) {
    return node.label;
  }

  const physicalObjectRef = node.source_refs.find(
    (sourceRef) => sourceRef.entity_type === 'PhysicalObject',
  );
  const identifier = physicalObjectRef?.entity_id ?? technicalMatch?.[1] ?? node.id;
  return node.kind === 'PHYSICAL_OBJECT'
    ? `Объект ${shortId(identifier)}`
    : `Устройство ${shortId(identifier)}`;
};

export const displayStatus = (status?: string): string => ({
  CONFIGURED: 'Настроено',
  ACTIVE: 'Работает',
  INACTIVE: 'Неактивно',
  DOWN: 'Недоступно',
  UNKNOWN: 'Статус неизвестен',
}[status ?? 'UNKNOWN'] ?? 'Статус не определён');

export const numericAttribute = (
  item: TopologyProjectionNode | TopologyProjectionEdge,
  name: string,
): number | null => {
  const value = item.attributes[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const displayCount = (value: number | null): string => (
  value === null ? 'Нет данных' : String(value)
);
