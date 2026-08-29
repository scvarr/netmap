import type { BlueprintBlockInstance } from '../blueprints/editorModel';
import { useI18n } from '../i18n';

interface Props { item: BlueprintBlockInstance; }

/** Exact-version layout preview; composition placement never affects this view. */
export function PortBlockStructurePreview({ item }: Props) {
  const { t } = useI18n();
  const columns = Math.max(...item.ports.map((port) => port.column), 1);
  const rows = Math.max(...item.ports.map((port) => port.row), 1);
  const cellWidth = 150; const cellHeight = 90;
  return <figure className="port-block-structure-preview" data-testid="port-block-structure-preview">
    <figcaption>{item.portBlockName} · v{item.versionNumber}</figcaption>
    <div className="port-block-structure-preview__canvas"><svg viewBox={`0 0 ${columns * cellWidth} ${rows * cellHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('portBlock.preview.aria', { name: item.portBlockName, version: item.versionNumber })}><rect className="port-block-structure-preview__surface" width={columns * cellWidth} height={rows * cellHeight} rx="10" />{item.ports.map((port) => { const x = (port.column - .5) * cellWidth; const y = (port.row - .5) * cellHeight; return <g key={port.local_id} className="port-block-structure-preview__port"><circle cx={x} cy={y - 12} r="13" /><text x={x} y={y + 25}>{port.display_label}</text></g>; })}</svg></div>
  </figure>;
}
