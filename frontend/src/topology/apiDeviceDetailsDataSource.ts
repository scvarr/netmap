import type {
  DeviceDetailsDataSource,
  DeviceDetailsDocument,
} from './deviceDetailsTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/devices';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const malformed = (message: string): never => {
  throw new Error(`Malformed device details response: ${message}`);
};

const requireObject: (
  value: unknown,
  path: string,
) => asserts value is Record<string, unknown> = (value, path) => {
  if (!isObject(value)) malformed(`${path} must be an object.`);
};

const requireString = (value: unknown, path: string): void => {
  if (typeof value !== 'string') malformed(`${path} must be a string.`);
};

const requireCount = (value: unknown, path: string): void => {
  if (!Number.isInteger(value) || Number(value) < 0) {
    malformed(`${path} must be a non-negative integer.`);
  }
};

const requireStringArray = (value: unknown, path: string): void => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    malformed(`${path} must be an array of strings.`);
  }
};

const validateSourceRef = (
  value: unknown,
  path: string,
  expectedEntityType?: string,
): void => {
  requireObject(value, path);
  if (value.ref_type !== 'CANONICAL_FACT') {
    malformed(`${path}.ref_type must be "CANONICAL_FACT".`);
  }
  requireString(value.entity_type, `${path}.entity_type`);
  if (expectedEntityType && value.entity_type !== expectedEntityType) {
    malformed(`${path}.entity_type must be "${expectedEntityType}".`);
  }
  requireString(value.entity_id, `${path}.entity_id`);
};

const validateSourceRefs = (value: unknown, path: string): void => {
  if (!Array.isArray(value)) return malformed(`${path} must be an array.`);
  value.forEach((ref, index) => validateSourceRef(ref, `${path}[${index}]`));
};

const validateLabelSource = (value: unknown, path: string): void => {
  if (value !== undefined && value !== 'TECHNICAL_FALLBACK') {
    malformed(`${path} must be "TECHNICAL_FALLBACK" when present.`);
  }
};

const validateAddress = (value: unknown, path: string): void => {
  requireObject(value, path);
  requireString(value.address, `${path}.address`);
  requireCount(value.prefix_length, `${path}.prefix_length`);
  if (Number(value.prefix_length) > 128) {
    malformed(`${path}.prefix_length must not exceed 128.`);
  }
  validateSourceRefs(value.source_refs, `${path}.source_refs`);
};

const validatePhysicalBinding = (value: unknown, path: string): void => {
  requireObject(value, path);
  validateSourceRef(
    value.connection_point_ref,
    `${path}.connection_point_ref`,
    'ConnectionPoint',
  );
  if (!Number.isInteger(value.member_index) || Number(value.member_index) < 1) {
    malformed(`${path}.member_index must be a positive integer.`);
  }
  validateSourceRefs(value.source_refs, `${path}.source_refs`);
};

const validateInterface = (value: unknown, index: number): void => {
  const path = `interfaces[${index}]`;
  requireObject(value, path);
  validateSourceRef(value.interface_ref, `${path}.interface_ref`, 'NetworkInterface');
  requireString(value.label, `${path}.label`);
  validateLabelSource(value.label_source, `${path}.label_source`);
  const addresses = value.addresses;
  if (!Array.isArray(addresses)) return malformed(`${path}.addresses must be an array.`);
  addresses.forEach((address, addressIndex) => (
    validateAddress(address, `${path}.addresses[${addressIndex}]`)
  ));
  requireCount(value.l2_binding_count, `${path}.l2_binding_count`);
  requireCount(value.l3_binding_count, `${path}.l3_binding_count`);
  const directPhysicalBindings = value.direct_physical_bindings;
  if (!Array.isArray(directPhysicalBindings)) {
    return malformed(`${path}.direct_physical_bindings must be an array.`);
  }
  directPhysicalBindings.forEach((binding, bindingIndex) => (
    validatePhysicalBinding(binding, `${path}.direct_physical_bindings[${bindingIndex}]`)
  ));
  requireCount(value.realization_down_count, `${path}.realization_down_count`);
  requireCount(value.realization_up_count, `${path}.realization_up_count`);
  validateSourceRefs(value.source_refs, `${path}.source_refs`);
};

export const parseDeviceDetailsDocument = (value: unknown): DeviceDetailsDocument => {
  requireObject(value, 'document');
  if (value.schema_version !== '1.0') malformed('schema_version must be "1.0".');
  requireObject(value.device, 'device');
  validateSourceRef(value.device.source_ref, 'device.source_ref', 'PhysicalObject');
  requireString(value.device.label, 'device.label');
  validateLabelSource(value.device.label_source, 'device.label_source');
  const interfaces = value.interfaces;
  if (!Array.isArray(interfaces)) return malformed('interfaces must be an array.');
  interfaces.forEach(validateInterface);
  requireStringArray(value.gaps, 'gaps');
  requireStringArray(value.warnings, 'warnings');
  return value as unknown as DeviceDetailsDocument;
};

const readBackendError = async (response: Response): Promise<Error> => {
  try {
    const body: unknown = await response.json();
    if (
      isObject(body)
      && isObject(body.error)
      && typeof body.error.code === 'string'
      && typeof body.error.message === 'string'
    ) {
      return new Error(`${body.error.code}: ${body.error.message}`);
    }
  } catch {
    // Non-JSON responses use the generic HTTP message.
  }
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  return new Error(`HTTP ${response.status}${statusText} while loading device details.`);
};

export class ApiDeviceDetailsDataSource implements DeviceDetailsDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async loadDeviceDetails(physicalObjectId: string): Promise<DeviceDetailsDocument> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(physicalObjectId)}`);
    if (!response.ok) throw await readBackendError(response);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      malformed('response body must be valid JSON.');
    }
    return parseDeviceDetailsDocument(body);
  }
}
