import { parseDeviceDetailsDocument } from './apiDeviceDetailsDataSource';
import type { DeviceDetailsDocument } from './deviceDetailsTypes';
import type {
  CreateNetworkDeviceRequest,
  DeviceWriteDataSource,
} from './deviceWriteTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/devices';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

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
  return new Error(`HTTP ${response.status}${statusText} while creating network device.`);
};

export class ApiDeviceWriteDataSource implements DeviceWriteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async createNetworkDevice(
    request: CreateNetworkDeviceRequest,
  ): Promise<DeviceDetailsDocument> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw await readBackendError(response);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('Malformed device details response: response body must be valid JSON.');
    }
    return parseDeviceDetailsDocument(body);
  }
}
