import { useI18n } from '../i18n';
import type { PhysicalPortAvailability } from '../topology/physicalPortAvailability';

export function PhysicalMemberSelect({ point, label, value, onChange, disabled }: {
  point: PhysicalPortAvailability;
  label: string;
  value?: number;
  onChange: (index: number | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  if (point.cardinality === 1) return null;
  return <label>
    <span>{label}</span>
    <select value={value ?? ''} disabled={disabled}
      onChange={event => onChange(Number(event.target.value) || undefined)}>
      <option value="">{t('connect.selectMember')}</option>
      {point.members?.map(member => <option key={member.index} value={member.index} disabled={member.occupied}>
        {member.designation}{member.occupied ? ` · ${t('physical.connected')}` : ''}
      </option>)}
    </select>
  </label>;
}
