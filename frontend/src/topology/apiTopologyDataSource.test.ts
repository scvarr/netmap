import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiTopologyDataSource } from './apiTopologyDataSource';
import type { TopologyProjectionDocument, TopologyProjectionRequest } from './types';

const request: TopologyProjectionRequest = {
  layer: 'L2',
  detail_level: 'DEVICE',
  scope: { include_location_subtrees: [], include_entities: [] },
  grouping: { basis: 'owner' },
  filters: { status: 'configured' },
};

const document: TopologyProjectionDocument = {
  schema_version: '1.0',
  layer: 'L2',
  detail_level: 'DEVICE',
  nodes: [{
    id: 'device-a',
    kind: 'NETWORK_DEVICE',
    label: 'PhysicalObject abcdef12',
    source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: '00000000-0000-0000-0000-000000000001' }],
    attributes: {},
  }],
  edges: [],
  gaps: [],
  warnings: [],
};

const jsonResponse = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  ...init,
});

describe('ApiTopologyDataSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends POST to the public same-origin projection URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(document));

    await new ApiTopologyDataSource().loadProjection(request);

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/projection', expect.objectContaining({ method: 'POST' }));
  });

  it('sends the exact projection request body without frontend fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse(document));

    await new ApiTopologyDataSource().loadProjection(request);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual(request);
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('returns a valid projection document', async () => {
    fetchMock.mockResolvedValue(jsonResponse(document));
    await expect(new ApiTopologyDataSource().loadProjection(request)).resolves.toEqual(document);
  });

  it('accepts the public L1 physical-object projection document', async () => {
    const physical: TopologyProjectionDocument = {
      ...document,
      layer: 'L1',
      detail_level: 'PHYSICAL_OBJECT',
      nodes: [{
        ...document.nodes[0],
        id: 'l1-object-a',
        kind: 'PHYSICAL_OBJECT',
        attributes: { connection_point_count: 2, owned_interface_count: 0 },
      }],
    };
    const physicalRequest: TopologyProjectionRequest = {
      layer: 'L1',
      detail_level: 'PHYSICAL_OBJECT',
      scope: { include_location_subtrees: [], include_entities: [] },
    };
    fetchMock.mockResolvedValue(jsonResponse(physical));

    await expect(new ApiTopologyDataSource().loadProjection(physicalRequest)).resolves.toEqual(physical);
  });
  it('accepts exact L1 off-map continuation facts without a remote topology node', async () => {
    const physical = { ...document, layer: 'L1' as const, detail_level: 'PHYSICAL_OBJECT' as const, l1_off_map_continuations: [{ id: 'continuation', local_node_id: 'l1-object-a', local_physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'local' }, local_connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'local-cp' }, local_connection_point_display_name: 'Rear', cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'cable' }, cable_display_name: 'cable-17', remote_physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'remote' }, remote_display_name: 'PP1', remote_connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'remote-cp' }, remote_connection_point_display_name: 'A07', source_refs: [] }] };
    fetchMock.mockResolvedValue(jsonResponse(physical));
    await expect(new ApiTopologyDataSource().loadProjection({ ...request, layer: 'L1', detail_level: 'PHYSICAL_OBJECT', grouping: undefined, filters: undefined })).resolves.toEqual(physical);
  });
  it('validates bounded blueprint presentation and internal L1-link attributes', async () => {
    const physical = { ...document, layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [{ ...document.nodes[0], kind: 'PHYSICAL_OBJECT', attributes: { blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v1' }, body: { kind: 'RECTANGLE', width: 120, height: 6 }, slots: [{ slot_key: 'A', display_name: 'A', kind: 'CONNECTION_POINT', rendered_position: { x: .1, y: .5 }, external_attachment: { x: 0, y: .5, side: 'LEFT' }, face: 'FRONT', connection_point_id: 'cp-a' }] }, internal_l1_links: [{ from_connection_point_id: 'cp-a', from_member_index: 2, to_connection_point_id: 'cp-b', to_member_index: 3, connection_id: 'c', connection_member_id: 'm', source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionMember', entity_id: 'm' }] }] } }], edges: [{ id: 'e', from_node_id: 'device-a', to_node_id: 'device-a', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: { endpoint_pairs: [{ from_connection_point_id: 'cp-a', from_member_index: 1, to_connection_point_id: 'cp-b', to_member_index: 1, connection_id: 'c', connection_member_id: 'm' }] } }] };
    fetchMock.mockResolvedValue(jsonResponse(physical));
    await expect(new ApiTopologyDataSource().loadProjection({ ...request, layer: 'L1', detail_level: 'PHYSICAL_OBJECT', grouping: undefined, filters: undefined })).resolves.toEqual(physical);
    fetchMock.mockResolvedValue(jsonResponse({ ...physical, nodes: [{ ...physical.nodes[0], attributes: { blueprint_presentation: { ...physical.nodes[0].attributes.blueprint_presentation, body: { kind: 'RECTANGLE', width: 0, height: 6 } } } }] }));
    await expect(new ApiTopologyDataSource().loadProjection({ ...request, layer: 'L1', detail_level: 'PHYSICAL_OBJECT', grouping: undefined, filters: undefined })).rejects.toThrow('Malformed topology projection response');
  });

  it('accepts an empty projection document', async () => {
    const empty = { ...document, nodes: [], edges: [] };
    fetchMock.mockResolvedValue(jsonResponse(empty));
    await expect(new ApiTopologyDataSource().loadProjection(request)).resolves.toEqual(empty);
  });

  it('preserves backend gaps and warnings', async () => {
    const noted = { ...document, gaps: ['NETWORK_INTERFACE_OWNER_UNKNOWN'], warnings: ['Partial projection'] };
    fetchMock.mockResolvedValue(jsonResponse(noted));
    await expect(new ApiTopologyDataSource().loadProjection(request)).resolves.toMatchObject({
      gaps: ['NETWORK_INTERFACE_OWNER_UNKNOWN'],
      warnings: ['Partial projection'],
    });
  });

  it('turns a backend 422 ErrorResponse into a readable Error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      error: { code: 'VALIDATION_ERROR', message: 'Topology projection layer is not supported', details: {} },
    }, { status: 422 }));
    await expect(new ApiTopologyDataSource().loadProjection(request)).rejects.toThrow(
      'VALIDATION_ERROR: Topology projection layer is not supported',
    );
  });

  it('handles a backend 409 ErrorResponse', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      error: { code: 'MODEL_ERROR', message: 'Projection data conflicts', details: { reason: 'CONFLICT' } },
    }, { status: 409 }));
    await expect(new ApiTopologyDataSource().loadProjection(request)).rejects.toThrow(
      'MODEL_ERROR: Projection data conflicts',
    );
  });

  it('rejects a malformed successful DTO', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      ...document,
      nodes: [{ ...document.nodes[0], id: 42 }],
    }));
    await expect(new ApiTopologyDataSource().loadProjection(request)).rejects.toThrow(
      'Malformed topology projection response: nodes[0].id must be a string.',
    );
  });

  it('propagates a network fetch failure', async () => {
    const failure = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(failure);
    await expect(new ApiTopologyDataSource().loadProjection(request)).rejects.toBe(failure);
  });

  it('does not fall back to fixture data after an API error', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }));
    await expect(new ApiTopologyDataSource().loadProjection(request)).rejects.toThrow(
      'HTTP 502 Bad Gateway while loading topology projection.',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
