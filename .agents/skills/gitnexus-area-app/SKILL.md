---
name: gitnexus-area-app
description: "Skill for the App area of netmap. 505 symbols across 58 files."
---

# App

505 symbols | 58 files | Cohesion: 74%

## When to Use

- Working with code in `app/`
- Understanding how get_session, analyze_physical_object_blueprint_upgrade, create_connection_point work
- Modifying app-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `app/main.py` | analyze_physical_object_blueprint_upgrade, create_connection_point, create_l2_forwarding_context, ref, create_physical_link (+60) |
| `app/repository.py` | require_physical_objects, _l2_binding_record, get_l2_bindings_by_context, get_l2_bindings_by_interface, _get_nat_pool_record (+50) |
| `app/models.py` | BlueprintEndpointSlot, BlueprintInstance, BlueprintInstanceSlot, BlueprintInternalLink, BlueprintPortBlockInstance (+43) |
| `app/l2_resolver.py` | _add_branch, _binding_node, _binding_refs, _boundary_node, _context_node (+31) |
| `app/topology_projection_resolver.py` | _dedupe_refs, _internal_l1_link, _off_map_continuations, _oriented_endpoint_pair, _path_refs (+18) |
| `app/saved_map_catalog.py` | list, _cable_routes, _placements, _require_cable, create (+12) |
| `app/interface_resolver.py` | visit, _candidate_id, _candidate_schema, _l1_query, _resolve_physical (+12) |
| `app/packet_processing_executor.py` | _egress_context, _adjacency_identity_refs, _continue_adjacency_unknown, _dedupe, _execute (+9) |
| `app/device_catalog.py` | create_connection_point, set_physical_object_class, set_physical_object_display_alias, _display_aliases, connection_point_display_aliases (+6) |
| `app/nat_resolver.py` | _apply_transform, _constraint_key, _dedupe, _evaluate_rules, _packet_key (+5) |

## Entry Points

Start here when exploring this area:

- **`get_session`** (Function) — `app/database.py:27`
- **`analyze_physical_object_blueprint_upgrade`** (Function) — `app/main.py:385`
- **`create_connection_point`** (Function) — `app/main.py:763`
- **`create_l2_forwarding_context`** (Function) — `app/main.py:828`
- **`ref`** (Function) — `app/main.py:832`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `Base` | Class | `app/database.py` | 16 |
| `BlueprintEndpointSlot` | Class | `app/models.py` | 384 |
| `BlueprintInstance` | Class | `app/models.py` | 424 |
| `BlueprintInstanceSlot` | Class | `app/models.py` | 437 |
| `BlueprintInternalLink` | Class | `app/models.py` | 405 |
| `BlueprintPortBlockInstance` | Class | `app/models.py` | 363 |
| `Connection` | Class | `app/models.py` | 144 |
| `ConnectionMember` | Class | `app/models.py` | 166 |
| `ConnectionPoint` | Class | `app/models.py` | 129 |
| `EntityMetadata` | Class | `app/models.py` | 232 |
| `InterfaceAddress` | Class | `app/models.py` | 609 |
| `InterfacePhysicalBinding` | Class | `app/models.py` | 460 |
| `L2Binding` | Class | `app/models.py` | 514 |
| `L2EgressRule` | Class | `app/models.py` | 557 |
| `L2ForwardingContext` | Class | `app/models.py` | 507 |
| `L2IngressRule` | Class | `app/models.py` | 541 |
| `L3Binding` | Class | `app/models.py` | 582 |
| `MapCableRoute` | Class | `app/models.py` | 110 |
| `MapPlacement` | Class | `app/models.py` | 52 |
| `MapViewPosition` | Class | `app/models.py` | 80 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Evaluate_nat_policy → Fail` | cross_community | 7 |
| `Evaluate_packet_flow → Normalize_processing_scope` | cross_community | 7 |
| `Evaluate_packet_flow → Normalize_processing_stage_payload` | cross_community | 7 |
| `Evaluate_packet_flow → Processing_stage_payload_reference` | cross_community | 7 |
| `Evaluate_packet_flow → _require_packet_processing_plan` | cross_community | 7 |
| `Evaluate_packet_flow → _validate_packet_processing_plan_completeness` | cross_community | 7 |
| `Evaluate_security_policy → Fail` | cross_community | 7 |
| `Trace_l3_structural_adjacency → _dedupe` | cross_community | 7 |
| `Trace_l3_structural_adjacency → _ref` | cross_community | 7 |
| `Evaluate_nat_policy → Apply_nat_transform` | intra_community | 6 |

## How to Explore

1. `context({name: "get_session"})` — see callers and callees
2. `query({search_query: "app"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
