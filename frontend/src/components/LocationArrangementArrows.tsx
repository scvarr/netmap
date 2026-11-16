import { useI18n } from '../i18n';
import type { GridDirection } from '../topology/locationGridArrangement';
export function LocationArrangementArrows({canMove, onMove}: {canMove:(direction:GridDirection)=>boolean; onMove:(direction:GridDirection)=>void}) {
  const {t} = useI18n();
  return <span onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>{(['UP','DOWN','LEFT','RIGHT'] as const).map((direction,i) => <button type="button" className="location-action" key={direction} aria-label={t(`autoLocation.move${direction}`)} disabled={!canMove(direction)} onClick={() => onMove(direction)}>{['↑','↓','←','→'][i]}</button>)}</span>;
}
