import { useI18n } from '../i18n';

export function HardwareInterfaceCheckbox({ value, onChange }: {
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useI18n();
  return <label>
    <input type="checkbox" checked={!!value} onChange={event =>
      onChange(event.target.checked ? value ?? crypto.randomUUID() : undefined)} />
    {t('hardware.assignInterface')}
  </label>;
}
