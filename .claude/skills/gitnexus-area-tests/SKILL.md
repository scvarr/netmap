---
name: gitnexus-area-tests
description: "Skill for the Tests area of netmap. 811 symbols across 66 files."
---

# Tests

811 symbols | 66 files | Cohesion: 75%

## When to Use

- Working with code in `tests/`
- Understanding how test_adjacency_without_forwarding_decision_follows_unknown_transition, test_complete_nat_plan_is_executable, test_routing_policy_stage_obeys_graph_and_does_not_route_automatically work
- Modifying tests-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `app/repository.py` | _processing_path_exists, _require_packet_processing_plan, add_packet_processing_plan, add_processing_entry_point, add_processing_stage (+40) |
| `tests/test_packet_processing_plan_e2e.py` | references, terminal_plan, test_adjacency_success_rejects_non_continue_terminal, test_complete_adjacency_plan_missing_outcome_is_rejected, test_complete_adjacency_plan_requires_and_accepts_all_outcomes (+37) |
| `tests/test_routing_policy_evaluation_e2e.py` | create_context_tables, create_policy, evaluate, select_table, test_allowed_shared_packet_predicates_select_rule_table (+25) |
| `tests/test_packet_processing_evaluation_e2e.py` | test_complete_nat_plan_is_executable, test_routing_policy_stage_obeys_graph_and_does_not_route_automatically, add_routing_plan, add_terminal, evaluate (+24) |
| `tests/test_packet_processing_nat_e2e.py` | add_downstream_stage, add_route_edges, add_terminal, routing_setup, test_ecmp_branches_run_nat_independently_with_branch_local_egress_scope (+24) |
| `tests/test_l3_reachability_e2e.py` | add_context, attach_l2, bind_interface, make_ecmp_outcomes, make_two_router_path (+24) |
| `tests/test_l2_reachability_e2e.py` | add_physical_link, configured_l2_loop, configured_one_hop, configured_path, configured_two_hop (+23) |
| `tests/test_packet_flow_e2e.py` | add_forwarding_plan, add_gateway_loop, add_router, attach, attach_handoff_fixture (+21) |
| `tests/test_nat_constrained_e2e.py` | test_invalid_or_empty_pool_is_rejected, add_policy, add_pool, identity, policy_evaluate (+20) |
| `tests/test_reference_network_acceptance_e2e.py` | add_exact_security_attachment, add_owned_interface, add_physical_segment, attach_plan, build_reference_network (+20) |

## Entry Points

Start here when exploring this area:

- **`test_adjacency_without_forwarding_decision_follows_unknown_transition`** (Function) — `tests/test_packet_processing_adjacency_e2e.py:366`
- **`test_complete_nat_plan_is_executable`** (Function) — `tests/test_packet_processing_evaluation_e2e.py:205`
- **`test_routing_policy_stage_obeys_graph_and_does_not_route_automatically`** (Function) — `tests/test_packet_processing_evaluation_e2e.py:294`
- **`test_local_input_security_controls_access_to_local_delivery`** (Function) — `tests/test_packet_processing_local_delivery_e2e.py:299`
- **`test_route_local_changes_class_then_local_delivery_confirms_network_delivery`** (Function) — `tests/test_packet_processing_local_delivery_e2e.py:233`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `test_adjacency_without_forwarding_decision_follows_unknown_transition` | Function | `tests/test_packet_processing_adjacency_e2e.py` | 366 |
| `test_complete_nat_plan_is_executable` | Function | `tests/test_packet_processing_evaluation_e2e.py` | 205 |
| `test_routing_policy_stage_obeys_graph_and_does_not_route_automatically` | Function | `tests/test_packet_processing_evaluation_e2e.py` | 294 |
| `test_local_input_security_controls_access_to_local_delivery` | Function | `tests/test_packet_processing_local_delivery_e2e.py` | 299 |
| `test_route_local_changes_class_then_local_delivery_confirms_network_delivery` | Function | `tests/test_packet_processing_local_delivery_e2e.py` | 233 |
| `add_downstream_stage` | Function | `tests/test_packet_processing_nat_e2e.py` | 383 |
| `add_route_edges` | Function | `tests/test_packet_processing_nat_e2e.py` | 452 |
| `add_terminal` | Function | `tests/test_packet_processing_nat_e2e.py` | 37 |
| `routing_setup` | Function | `tests/test_packet_processing_nat_e2e.py` | 443 |
| `test_ecmp_branches_run_nat_independently_with_branch_local_egress_scope` | Function | `tests/test_packet_processing_nat_e2e.py` | 648 |
| `test_nat_before_routing_policy_and_route_both_see_translated_packet` | Function | `tests/test_packet_processing_nat_e2e.py` | 459 |
| `test_nat_then_security_sees_translated_packet_and_reverse_order_sees_original` | Function | `tests/test_packet_processing_nat_e2e.py` | 604 |
| `test_unknown_packet_skips_downstream_resolver_and_follows_uncertainty` | Function | `tests/test_packet_processing_nat_e2e.py` | 405 |
| `references` | Function | `tests/test_packet_processing_plan_e2e.py` | 32 |
| `terminal_plan` | Function | `tests/test_packet_processing_plan_e2e.py` | 49 |
| `test_adjacency_success_rejects_non_continue_terminal` | Function | `tests/test_packet_processing_plan_e2e.py` | 480 |
| `test_complete_adjacency_plan_missing_outcome_is_rejected` | Function | `tests/test_packet_processing_plan_e2e.py` | 280 |
| `test_complete_adjacency_plan_requires_and_accepts_all_outcomes` | Function | `tests/test_packet_processing_plan_e2e.py` | 239 |
| `test_complete_local_delivery_missing_outcome_is_model_error_but_partial_is_valid` | Function | `tests/test_packet_processing_plan_e2e.py` | 379 |
| `test_complete_local_delivery_requires_both_outcomes_and_validates` | Function | `tests/test_packet_processing_plan_e2e.py` | 351 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Evaluate_packet_flow → Normalize_processing_scope` | cross_community | 7 |
| `Evaluate_packet_flow → Normalize_processing_stage_payload` | cross_community | 7 |
| `Evaluate_packet_flow → Processing_stage_payload_reference` | cross_community | 7 |
| `Evaluate_packet_flow → _require_packet_processing_plan` | cross_community | 7 |
| `Evaluate_packet_flow → _validate_packet_processing_plan_completeness` | cross_community | 7 |
| `Evaluate_security_policy → Fail` | cross_community | 7 |
| `Evaluate_packet_flow → _validate_plan_attachment_set_values` | cross_community | 6 |
| `Create_l2_forwarding_context → _validate_stack` | cross_community | 5 |
| `Evaluate_routing_policy → _validate_stored_routing_table` | cross_community | 5 |
| `Evaluate_security_policy → _validate_security_action` | cross_community | 5 |

## How to Explore

1. `context({name: "test_adjacency_without_forwarding_decision_follows_unknown_transition"})` — see callers and callees
2. `query({search_query: "tests"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
