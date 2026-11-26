import { useI18n } from '../i18n';
import type { FiberType, InternalFiberType } from '../topology/fiberTypes';

type Options = {
  label?: string;
  action?: boolean;
  disabled?: boolean;
} & (
  | { internal: true; value: InternalFiberType | null; onChange: (value: InternalFiberType | null) => void }
  | { internal?: false; value: FiberType | null; onChange: (value: FiberType | null) => void }
);

export function FiberTypeSelect(props: Options) {
  const { t } = useI18n();
  return <select aria-label={props.label ?? t('fiber.type')} value={props.action ? 'apply' : props.value ?? ''}
    disabled={props.disabled} onChange={event => {
      const value = event.target.value;
      if (value === 'NO_FIBER' && props.internal) props.onChange(value);
      else if (value === 'SM' || value === 'MM' || value === '') props.onChange(value || null);
    }}>
    {props.action && <option value="apply" disabled>{t('fiber.applyAll')}</option>}
    <option value="">{t('fiber.unknown')}</option>
    <option value="SM">SM</option>
    <option value="MM">MM</option>
    {props.internal && <option value="NO_FIBER">{t('fiber.none')}</option>}
  </select>;
}
