import { useI18n } from '../i18n';
import { moduleMount, mountTypeId, type ModuleTemplateInput, type TransceiverSpecifications } from '../topology/hardwareModules';
import { MountTypeNotice, MountTypeSelect, useMountTypes } from './ModulePortTypeSelect';
import { PortTypeNotice, PortTypeSelect, usePortTypes, type PortType } from './PortTypeSelect';

const textFields = ['manufacturer', 'part_number', 'description', 'notes'] as const;
const numericFields = ['speed_mbps', 'reach_m', 'tx_wavelength_nm', 'rx_wavelength_nm'] as const;

export function TransceiverSpecificationFacts({ specifications }: { specifications?: TransceiverSpecifications }) {
  const { t } = useI18n();
  if (!specifications || !Object.keys(specifications).length) return null;
  return <dl>
    {[...textFields, 'fiber_type' as const, ...numericFields].map(field => {
      const value = specifications[field];
      return value == null || value === '' ? null : <div key={field}>
        <dt>{t(`transceiver.${field}`)}</dt>
        <dd>{field === 'fiber_type' && (value === 'SM' || value === 'MM') ? t(`transceiver.${value}`) : value}</dd>
      </div>;
    })}
  </dl>;
}

export function TransceiverPortFacts({ endpoints, types }: {
  endpoints: ModuleTemplateInput['endpoints']; types?: PortType[];
}) {
  const { t } = useI18n();
  return <>
    {endpoints.filter(endpoint => endpoint.port_type_id).map(endpoint => {
      const port = types?.find(item => item.id === endpoint.port_type_id);
      if (!port) return <p key={endpoint.key}>{endpoint.port_type_id}</p>;
      return <dl key={endpoint.key}>
        <dt>{t('portTypes.field')}</dt><dd>{port.name}</dd>
        <dt>{t('physicalCatalog.medium')}</dt><dd>{t(`physicalCatalog.${port.medium}`)}</dd>
        <dt>{t('transceiver.members', { count: port.cardinality })}</dt>
        <dd>{port.members.join(' · ')}</dd>
      </dl>;
    })}
  </>;
}

export function TransceiverTemplateForm({ value, onChange, disabled, creating }: {
  value: ModuleTemplateInput; onChange: (value: ModuleTemplateInput) => void; disabled: boolean; creating?: boolean;
}) {
  const { t } = useI18n();
  const mounts = useMountTypes();
  const catalog = usePortTypes();
  const portTypes = catalog.types;
  const endpoint = value.endpoints[0];
  const editableEnding = !endpoint || (value.endpoints.length === 1 && endpoint.kind === 'CONNECTION_POINT');
  const portTypeId = endpoint?.port_type_id ?? '';
  const selectedPortType = portTypes?.find(port => port.id === portTypeId);
  const fiberType = value.transceiver?.fiber_type;
  const selectEnding = (id: string) => {
    if (id === portTypeId) return;
    const key = creating && endpoint ? endpoint.key : crypto.randomUUID();
    const nextPort = portTypes?.find(port => port.id === id);
    const transceiver = { ...value.transceiver };
    if (nextPort?.medium !== 'FIBER') delete transceiver.fiber_type;
    onChange({
      ...value, transceiver,
      endpoints: [{ key, port_type_id: id, display_name: t('transceiver.termination'), kind: 'CONNECTION_POINT' }],
      geometry: { ...value.geometry, endpoints: { [key]: { x: 0.5, y: 0.5 } } },
    });
  };
  return <fieldset className="port-types-form" disabled={disabled}>
    <p>{t('transceiver.mod03')}</p>
    <MountTypeNotice catalogs={mounts} kind="MODULE_PORT" />
    <PortTypeNotice types={portTypes} failed={catalog.failed} />
    <div className="port-types-form__fields">
      <label>{t('transceiver.model')}
        <input required maxLength={255} value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} />
      </label>
      <MountTypeSelect label="transceiver.mount" types={mounts.MODULE_PORT.types}
        value={mountTypeId(value)} onChange={id => onChange({ ...value, ...moduleMount('MODULE_PORT', id) })} />
      {editableEnding && <PortTypeSelect types={portTypes} value={selectedPortType ? portTypeId : ''} onChange={selectEnding} />}
    </div>
    {editableEnding && endpoint && !creating && <p>{t('transceiver.endingChange')}</p>}
    {!value.transceiver && !creating && <p>{t('transceiver.historical')}</p>}
    <TransceiverPortFacts endpoints={value.endpoints} types={catalog.types} />
    {editableEnding && (creating || selectedPortType) && <div className="port-types-form__fields">
      {selectedPortType?.medium === 'FIBER' && <label>{t('transceiver.fiber_type')}
        <select required value={fiberType === 'SM' || fiberType === 'MM' ? fiberType : ''}
          onChange={event => onChange({ ...value, transceiver: { ...value.transceiver, fiber_type: event.target.value || undefined } })}>
          <option value="">{t('physicalCatalog.UNDEFINED')}</option>
          <option value="SM">{t('transceiver.SM')}</option>
          <option value="MM">{t('transceiver.MM')}</option>
        </select>
      </label>}
      {textFields.map(field => {
        const change = (text: string) => onChange({
          ...value, transceiver: { ...value.transceiver, [field]: text.trim() ? text : undefined },
        });
        const props = { value: value.transceiver?.[field] ?? '', maxLength: field === 'description' || field === 'notes' ? 4000 : 255 };
        return <label key={field}>{t(`transceiver.${field}`)}
          {props.maxLength === 4000
            ? <textarea {...props} rows={3} onChange={event => change(event.target.value)} />
            : <input {...props} onChange={event => change(event.target.value)} />}
        </label>;
      })}
      {numericFields.map(field => <label key={field}>{t(`transceiver.${field}`)}
        <input type="number" step="any" min={0} value={value.transceiver?.[field] ?? ''}
          onChange={event => onChange({ ...value, transceiver: {
            ...value.transceiver, [field]: event.target.value === '' ? undefined : event.target.valueAsNumber,
          } })} />
      </label>)}
    </div>}
  </fieldset>;
}
