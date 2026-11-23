import { useI18n } from '../i18n';

export function HardwareInterfaceActions({ hasUnassigned, hasSelectedUnassigned, onAssign }: {
  hasUnassigned: boolean;
  hasSelectedUnassigned: boolean;
  onAssign: (selectedOnly: boolean) => void;
}) {
  const { t } = useI18n();
  return <div className="hardware-interface-actions">
    <button type="button" className="secondary-action" disabled={!hasUnassigned} onClick={() => onAssign(false)}>
      {t('hardware.assignAllInterfaces')}
    </button>
    <button type="button" className="secondary-action" disabled={!hasSelectedUnassigned} onClick={() => onAssign(true)}>
      {t('hardware.assignSelectedInterfaces')}
    </button>
  </div>;
}
