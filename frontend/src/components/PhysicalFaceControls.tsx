import { useI18n } from '../i18n';
import type { ResolvedFace } from '../topology/physicalFaces';
import type { FaceOverride, PhysicalFace } from '../topology/savedMapTypes';

export function PhysicalFaceSelect({ value, allowInherit, unassigned, disabled, onChange }: {
  value: FaceOverride;
  allowInherit?: boolean;
  unassigned?: boolean;
  disabled?: boolean;
  onChange: (value: FaceOverride) => void;
}) {
  const { t } = useI18n();
  return <label>{t(unassigned ? 'face.panel' : 'face.view')}
    <select value={value} disabled={disabled} onChange={event => onChange(event.target.value as FaceOverride)}>
      {(allowInherit || unassigned) && <option value="INHERIT">{t(unassigned ? 'face.unassigned' : 'face.inherit')}</option>}
      <option value="FRONT">{t('face.front')}</option>
      <option value="REAR">{t('face.rear')}</option>
    </select>
  </label>;
}

export function PhysicalFaceIndicator({ resolved, panelFace, disabled, onChange }: {
  resolved: ResolvedFace;
  panelFace?: PhysicalFace | null;
  disabled?: boolean;
  onChange?: (value: FaceOverride) => void;
}) {
  const { t } = useI18n();
  const { face, source, explicit } = resolved;
  const side = (value: PhysicalFace) => t(value === 'FRONT' ? 'face.front' : 'face.rear');
  const label = t('face.effective', {
    face: side(face),
    source: source.kind === 'location' ? t('face.locationSource', { name: source.name })
      : t(source.kind === 'variant' ? 'face.variantSource' : 'face.objectSource'),
  }) + (panelFace ? ' / ' + t('face.singlePanel', { face: side(panelFace) }) : '');
  return <span className={'physical-face' + (explicit ? ' physical-face--explicit' : '') + (onChange ? ' nodrag nopan' : '')}
    title={label} aria-label={label}>
    {(panelFace ?? face) === 'FRONT' ? 'F' : 'R'}
    {onChange && <select aria-label={t('face.view') + ' / ' + label} title={label} value={explicit ? face : 'INHERIT'}
      disabled={disabled} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
      onChange={event => onChange(event.target.value as FaceOverride)}>
      <option value="INHERIT">{t('face.inherit')}</option>
      <option value="FRONT">{t('face.front')}</option>
      <option value="REAR">{t('face.rear')}</option>
    </select>}
  </span>;
}
