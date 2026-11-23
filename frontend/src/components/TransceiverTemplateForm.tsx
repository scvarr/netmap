import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { moduleMount, mountTypeId, type ModuleTemplateInput, type TransceiverSpecifications } from '../topology/hardwareModules';
import { MountTypeNotice, MountTypeSelect, useMountTypes } from './ModulePortTypeSelect';
import { PortTypeNotice, PortTypeSelect, usePortTypes, type ConnectorType, type PortType } from './PortTypeSelect';

const textFields = ['manufacturer', 'part_number', 'fiber_type', 'description', 'notes'] as const;
const numericFields = ['speed_mbps', 'reach_m', 'tx_wavelength_nm', 'rx_wavelength_nm'] as const;

export function TransceiverSpecificationFacts({ specifications }: { specifications?: TransceiverSpecifications }) {
  const { t } = useI18n();
  if (!specifications || !Object.keys(specifications).length) return null;
  return <dl>
    {[...textFields, ...numericFields].map(field => {
      const value = specifications[field];
      return value == null || value === '' ? null : <div key={field}>
        <dt>{t(`transceiver.${field}`)}</dt><dd>{value}</dd>
      </div>;
    })}
  </dl>;
}

export function TransceiverPortFacts({ endpoints, types }: {
  endpoints: ModuleTemplateInput['endpoints']; types?: PortType[];
}) {
  const { t } = useI18n();
  const [connectors, setConnectors] = useState<ConnectorType[]>();
  const [failed, setFailed] = useState(false);
  const hasPort = endpoints.some(endpoint => Boolean(endpoint.port_type_id));
  useEffect(() => {
    if (!hasPort) return;
    const controller = new AbortController();
    void fetch('/api/v1/connector-types', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const items: unknown = await response.json();
      if (!Array.isArray(items)) throw new Error();
      if (!controller.signal.aborted) setConnectors(items as ConnectorType[]);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [hasPort]);
  return <>
    {failed && <p role="alert">{t('portTypes.request')}</p>}
    {endpoints.filter(endpoint => endpoint.port_type_id).map(endpoint => {
      const port = types?.find(item => item.id === endpoint.port_type_id);
      if (!port) return <p key={endpoint.key}>{endpoint.port_type_id}</p>;
      const connector = connectors?.find(item => item.id === port.connector_type_id);
      return <dl key={endpoint.key}>
        <dt>{t('portTypes.field')}</dt><dd>{port.name}</dd>
        <dt>{t('physicalCatalog.medium')}</dt><dd>{t(`physicalCatalog.${port.medium}`)}</dd>
        <dt>{t('physicalCatalog.connector')}</dt>
        <dd>{connector?.name ?? port.connector_type_id ?? t('physicalCatalog.noConnector')}</dd>
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
  const portTypes = catalog.types?.filter(port => port.connector_type_id);
  const endpoint = value.endpoints[0];
  const editableEnding = !endpoint || (value.endpoints.length === 1 && endpoint.kind === 'CONNECTION_POINT');
  const portTypeId = endpoint?.port_type_id ?? '';
  const hasConnector = portTypes?.some(port => port.id === portTypeId);
  const selectEnding = (id: string) => {
    if (id === portTypeId) return;
    const key = creating && endpoint ? endpoint.key : crypto.randomUUID();
    onChange({
      ...value, transceiver: value.transceiver ?? {},
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
      {editableEnding && <PortTypeSelect types={portTypes} value={hasConnector ? portTypeId : ''} onChange={selectEnding} />}
    </div>
    {editableEnding && endpoint && !creating && <p>{t('transceiver.endingChange')}</p>}
    {!value.transceiver && !creating && <p>{t('transceiver.historical')}</p>}
    <TransceiverPortFacts endpoints={value.endpoints} types={catalog.types} />
    {editableEnding && (creating || hasConnector) && <div className="port-types-form__fields">
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
