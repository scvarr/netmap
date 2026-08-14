# 02.2 Resolver structures

## Статус

Согласованная минимальная архитектура execution/read structures для resolver'ов NetMap.

Эта ветка переводит canonical facts и `EvaluationView` в практические backend-структуры.

Главный принцип:

```text
canonical tables / observations
        |
        | DB indexes + view selection
        v
ResolverWorkspace
        |
        +-- L1 structures
        +-- interface structures
        +-- L2 structures
        +-- L3 structures
        +-- SecurityProgram
        +-- NATProgram
        +-- PacketProcessingPlan CFG
        |
        v
query-time state machines
```

Ни одна read structure не становится вторым source of truth.

Связанные заметки:

- [[02-graph|02. Граф сети]];
- [[02-01-canonical-view|02.1 Canonical facts и EvaluationView]];
- [[03-02-l2-trace|03.2 L2 Trace]];
- [[03-03-l3-trace|03.3 L3 Trace]];
- [[03-04-packet-flow-trace|03.4 Packet Flow Trace]].

## Три уровня структур

Для первого backend полезно жёстко разделить три класса оптимизации.

### Persistent DB indexes

Обычные индексы над canonical tables.

Они:

- живут рядом со storage;
- ускоряют candidate lookup;
- не принимают semantic решений;
- не требуют отдельного compiler lifecycle.

### View-scoped read models

Структуры над конкретным `EvaluationView`.

Они могут:

- строиться лениво;
- жить в памяти процесса;
- переиспользоваться в рамках одного pinned view;
- кэшироваться по view fingerprint.

### Query-scoped memoization

Живёт только внутри конкретного trace.

Примеры:

```text
route lookup memo
predicate memo
expanded L1 states
resolved FDB lookups
visited states
```

Это не topology cache.

## ResolverWorkspace

Conceptual runtime boundary:

```text
ResolverWorkspace
    evaluation_view
    repository

    l1
    interfaces
    l2
    l3
    security
    nat
    processing_plans

    query_memo
```

Concrete language API пока не фиксируется.

Workspace привязан к одному immutable semantic `EvaluationView`.

## Lazy by default

Первый backend не должен после каждого изменения запускать:

```text
compile entire network
```

Предпочтительно:

```text
build on first use
memoize within view/query
rebuild when view changes
```

Исключение — дешёвые persistent DB indexes.

## Индекс не принимает решение

Критический invariant:

> Индекс находит candidates. Resolver определяет их semantic meaning.

Например prefix index может вернуть matching routes, но не имеет права сам объявить:

```text
selected route
```

Потому что ещё нужны:

```text
routing table selection
LPM
completeness
configured/effective view
conflict resolution
```

То же правило применяется к FDB, Security и NAT.

# L1

## L1 state key

Минимальный semantic vertex:

```text
(ConnectionPoint.id, member_index)
```

## Persistent L1 indexes

Нужны быстрые lookups по обоим концам `ConnectionMember`:

```text
(point_a_id, point_a_member)
(point_b_id, point_b_member)
connection_id
```

Точная SQL syntax будет определена storage schema.

## L1 adjacency read model

View/query structure:

```text
l1_adjacency[
    (point_id, member)
] -> [
    L1AdjacencyEdge
]
```

`L1AdjacencyEdge` минимум содержит:

```text
peer_point_id
peer_member
connection_id
connection_member_id
evidence_refs
```

## One-to-many обязательно

Нельзя зашивать:

```text
(point, member) -> one peer
```

Пассивная/internal topology может давать несколько relations.

Поэтому API возвращает list/set.

## L1 не знает L2

`L1AdjacencyEdge` не содержит:

```text
VLAN
MAC
IP
STP
```

L1 read model отвечает только за физический переход.

## Ownership lookups

Для evidence/UI полезны:

```text
point_owner[point_id] -> PhysicalObject
object_parent[object_id] -> PhysicalObject?
effective_location[entity_id] -> Location?
```

Они не должны определять connectivity сами по себе.

# NetworkInterface

## Physical binding lookup

Нужны оба направления:

```text
interfaces_by_point_member[
    (point_id, member)
] -> [InterfacePhysicalBinding]

physical_bindings_by_interface[
    interface_id
] -> [InterfacePhysicalBinding]
```

Даже если canonical state ожидает uniqueness со стороны point/member, read API возвращает set/list, чтобы conflict не затёрся.

## Realization graph

Минимально:

```text
realization_down[
    upper_interface_id
] -> [RealizationEdge]

realization_up[
    lower_interface_id
] -> [RealizationEdge]
```

Edge сохраняет:

```text
upper_interface_id
lower_interface_id
relation identity
evidence_refs
```

## Operational overlay

Static relation не мутируется current state.

Отдельно:

```text
realization_eligibility[
    realization_edge_id,
    direction
] -> resolved eligibility
```

Аналогично interface state:

```text
interface_eligibility[
    interface_id,
    direction
]
```

# L2

## Binding indexes

```text
l2_bindings_by_interface[
    interface_id
] -> [L2Binding]

l2_bindings_by_context[
    context_id
] -> [L2Binding]

l2_binding_by_id[
    binding_id
]
```

## Ingress exact-match index

Пока canonical minimum:

```text
exact(EncapsulationStack)
```

поэтому нужен быстрый lookup:

```text
l2_ingress_exact[
    (interface_id, encapsulation_key)
] -> [IngressCandidate]
```

Candidate:

```text
rule_id
binding_id
context_id
evidence_refs
```

## Encapsulation key

`EncapsulationStack` — value object с deterministic equality/hash.

Пример:

```text
(
    (dot1ad, 500),
    (dot1q, 100)
)
```

Пустой tuple:

```text
()
```

означает untagged wire frame.

Internal attachment не использует этот key как пустой wire stack.

## Multiple candidates сохраняются

Read model не решает:

```text
last rule wins
```

Если candidates несколько, L2 resolver разрешает:

```text
priority
ambiguity
conflict
```

## Future matchers

Если позже появятся wildcard/range predicates:

- exact index остаётся fast path;
- дополнительные matchers получают отдельный candidate program.

Не надо заранее заменять всё generic rule engine.

## Egress lookup

```text
l2_egress_by_binding[
    binding_id
] -> [L2EgressRule]
```

List нужен для conflict detection даже если нормальный effective binding ожидает одну concrete egress encoding.

## Context candidate set

Для reachability:

```text
l2_bindings_by_context[
    context_id
]
```

даёт candidate egress attachments.

FDB/eligibility/frame semantics применяются позже.

## Binding eligibility

```text
binding_eligibility[
    binding_id,
    direction
] -> ResolvedEligibility
```

Value должен сохранять:

```text
status
evidence_refs
freshness
conflicts
```

а не только boolean.

## FDB

Ключ:

```text
(context_id, mac)
```

Read model:

```text
fdb_lookup[
    (context_id, mac)
] -> FDBResolutionInput
```

Value сохраняет:

```text
selected snapshot
matching entries
snapshot completeness
observed_at
source/evidence
```

## FDB cache не MAC->port

Нельзя:

```text
mac -> interface
```

Scope — `L2ForwardingContext`, а target — `L2Binding`.

## FDB absence

```text
entries = []
```

не означает автоматически:

```text
ABSENT_CONFIRMED
```

Это решение resolver'а с учётом completeness/freshness.

## MAC assignments

Отдельно:

```text
mac_assignments_by_mac[
    mac
] -> [MacAssignment]

mac_assignments_by_interface[
    interface_id
] -> [MacAssignment]
```

FDB и ownership не смешиваются.

# L3

## Binding indexes

```text
l3_bindings_by_interface[
    interface_id
] -> [L3Binding]

l3_bindings_by_context[
    routing_context_id
] -> [L3Binding]
```

## Address indexes

Нужны оба направления:

```text
addresses_by_l3_binding[
    binding_id
] -> [InterfaceAddress]

address_assignments_by_address[
    normalized_ip
] -> [InterfaceAddress]
```

Глобальный:

```text
IP -> one interface
```

запрещён.

Resolver фильтрует по routing context/scope.

## Routing table lookup

```text
routing_tables_by_context_family[
    (routing_context_id, address_family)
] -> [RoutingTable]
```

Если есть explicit primary/default relation:

```text
primary_routing_table[
    (routing_context_id, address_family)
] -> table_id
```

Имя таблицы не используется как fallback.

## Prefix index

Для каждой selected table нужен efficient:

```text
destination IP
    ->
matching prefixes/routes
```

Варианты реализации:

```text
PostgreSQL inet/cidr operators
radix/patricia trie
sorted prefix structure
```

Архитектура не фиксирует один конкретный.

## Prefix index возвращает candidates

```text
route_candidates(
    table_id,
    destination_ip
) -> [RouteCandidate]
```

Candidate содержит:

```text
route_id
prefix
prefix_length
snapshot/evidence
```

LPM/completeness остаются обязанностью L3 resolver.

## Partial table

Даже sorted-by-prefix index не имеет права объявить top candidate selected route при partial table.

Неизвестный более специфичный prefix всё ещё может существовать.

## Query-scoped FIB result

Authoritative:

```text
route get destination
```

может дать готовый selected-route evidence для конкретного query.

Он нормализуется в тот же `RouteLookupResult`, а не отдельную ветку алгоритма.

## Next hops

```text
next_hops_by_route[
    route_id
] -> [RouteNextHop]
```

Несколько rows — normal candidate set.

## Recursive route memo

Query-scoped:

```text
route_resolution_memo[
    (
        routing_context,
        lookup_address,
        egress_constraint,
        view
    )
]
```

Используется для:

- recursion;
- ECMP branch reuse;
- loop detection.

## Neighbor

Scope key:

```text
(l3_binding_id, ip)
```

Read model:

```text
neighbor_lookup[
    (l3_binding_id, ip)
] -> NeighborResolutionInput
```

Value сохраняет snapshot/completeness/evidence.

Отсутствие entry само по себе не означает failure.

# Security

## Attachment candidate indexes

Не нужно materialize все:

```text
ingress x egress x VRF x traffic class
```

комбинации.

Достаточны coarse indexes:

```text
security_attachments_by_context
security_attachments_by_ingress
security_attachments_by_egress
security_attachments_by_traffic_class
```

Resolver получает candidate set и затем выполняет exact `SecurityScope` match.

## Compiled policy

View-scoped:

```text
SecurityProgram
    ordered_rules[]
    default_action
    completeness/evidence
```

Rule:

```text
CompiledSecurityRule
    rule_id
    order_key
    compiled_predicate
    action
    evidence_refs
```

## Predicate compilation

Typed predicate tree можно compile в efficient matcher.

Например:

```text
ALL
├── src-prefix matcher
├── protocol == TCP
└── dst-port matcher
```

Canonical predicate tree остаётся source of truth.

## Address set matcher

Для больших sets может использоваться:

```text
prefix trie
interval structure
```

Для небольших достаточно обычного normalized list.

Выбор определяется profiler'ом.

## Port set matcher

Нормализованные port ranges удобно держать как:

```text
sorted non-overlapping intervals
```

## Predicate memo

Query-scoped:

```text
predicate_result_memo[
    (
        predicate_id,
        packet_state_id,
        context_key
    )
]
```

полезен при branching по `UNKNOWN`.

## Не materialize packet->rule

Нельзя заранее строить:

```text
all packets -> matching rule
```

Это query-dependent result.

# NAT

## Attachment indexes

Аналогично Security:

```text
nat_attachments_by_context
nat_attachments_by_ingress
nat_attachments_by_egress
nat_attachments_by_traffic_class
```

Exact scope match остаётся у NAT resolver.

## Compiled NAT program

```text
NATProgram
    ordered_rules[]
    default_transform
```

Rule:

```text
CompiledNATRule
    rule_id
    compiled_predicate
    compiled_transform
    evidence_refs
```

## NAT pools

```text
nat_pool_by_id[
    pool_id
] -> normalized address/port set
```

Configured pool не содержит runtime allocator state.

## Existing bindings

Для effective existing-session lookup:

```text
nat_binding_lookup[
    normalized_flow_key
] -> [NATBindingObservation]
```

Flow-key schema уточнится вместе с session model.

## Hypothetical allocation

What-if:

```text
PAT port 50123
```

не становится cache/fact.

Он живёт только в ephemeral query state, если это не actual observed binding.

# PacketProcessingPlan

## Plan attachment lookup

```text
processing_plan_attachments_by_context
processing_plan_attachments_by_traffic_class
```

Exact scope selection делает orchestrator.

## Compiled CFG

```text
PlanProgram
    entry_points
    stages
    transitions
```

Практический shape:

```text
entry[
    traffic_class
] -> stage_id

stage_by_id[
    stage_id
] -> ProcessingStage

transition[
    (stage_id, outcome)
] -> next_stage_or_terminal
```

## Transition uniqueness

Для deterministic normalized plan ожидается максимум один transition на:

```text
(stage_id, outcome)
```

Если их несколько и explicit branching semantics не определена:

```text
validation conflict
```

а не «берём первую».

## Plan validation

View-scoped compile может один раз проверять:

```text
entry exists
references valid
required outcomes covered
payload kind valid
no accidental local cycles
```

Packet Flow не обязан повторять structural validation на каждом stage.

# EvaluationView operational selection

## Snapshot selection cache

View может лениво pin:

```text
selected_fdb_snapshot[context]
selected_neighbor_snapshot[binding]
selected_route_view[table]
selected_policy_snapshot[policy]
```

После pin выбор не меняется внутри query.

## Resolution object вместо scalar

Лучше возвращать:

```text
ResolvedValue
    status
    value?
    evidence_refs[]
    freshness
    completeness
    conflicts[]
```

а не:

```text
true/false
```

Так `UNKNOWN` не теряется.

## Denormalized current tables

Можно иметь rebuildable:

```text
current_interface_state
current_fdb
```

для скорости.

Но API не должен позволять редактировать их независимо от source observations.

# Query memoization

## Что memoize

Внутри trace:

```text
L1 expansion
L2 ingress resolution
FDB resolution
route lookup
recursive gateway resolution
security predicate
NAT predicate
plan selection
target normalization
```

## Memo key включает view

Например неверно:

```text
security_result[policy_id]
```

Правильно:

```text
(
    policy_id,
    packet_state_key,
    context_key,
    view_fingerprint
)
```

## Negative memo

Можно memoize:

```text
confirmed no route
confirmed no ingress match
confirmed no applicable attachment
```

только вместе с completeness/evidence.

Unknown absence не превращается в persistent negative.

# Lifetime

## Первый implementation: per-query

Самый безопасный старт:

```text
ResolverWorkspace
query memo
trace evidence
```

живут до конца query.

## Cross-query cache позже

После measurements можно переиспользовать:

```text
L1 adjacency
route trie
SecurityProgram
NATProgram
PlanProgram
```

по:

```text
view/entity version
compiler version
```

## Eviction

Обычный:

```text
LRU
size based
time based
```

Cache eviction не влияет на correctness.

# Что materialize

## Сразу

Persistent DB indexes:

```text
FK indexes
ConnectionMember endpoint indexes
bindings by interface/context
routes by table/prefix
FDB by snapshot/context/MAC
neighbor by snapshot/binding/IP
rules by policy/order
attachment anchor indexes
```

Exact SQL list будет частью storage schema.

## Лениво

Хорошие candidates:

```text
L1 adjacency
realization adjacency
route trie
compiled policy programs
compiled PacketProcessingPlan
view-selected operational maps
```

## Только query-time

Не materialize globally:

```text
selected route for every destination
matched firewall rule for every packet
matched NAT rule for every packet
all ECMP/LAG choices
all L2 frame paths
all packet flows
all reachability pairs
```

## Возможно позже

Только если profiler докажет пользу:

```text
location closure
current L1 adjacency
popular route tries
common L2 component summaries
```

с explicit version/invalidation semantics.

# Performance constraints

## Correctness first

Приоритет первого backend:

```text
correct semantics
evidence
UNKNOWN handling
```

выше micro-optimization.

## Но не закладывать N+1

Очевидный anti-pattern:

```text
one SQL query per traversed edge
```

лучше не превращать в repository contract.

Repository API должен позволять batch/scoped fetch.

## Scope loading

Не нужно загружать всю сеть в RAM.

Нормальные границы:

```text
one routing context
one L2 context
one policy
one processing plan
current L1 frontier/component
```

## Batch frontier

Branching resolver может одним запросом fetch'ить facts для набора current states.

Например N L1 point-members -> одна batch query по endpoint keys.

# Backend boundaries

## CanonicalRepository

Отвечает за typed canonical facts.

Без trace semantics.

## ViewResolver

Отвечает за:

```text
snapshot selection
freshness
source resolution
completeness
```

## StructureProvider

Возвращает/build'ит:

```text
L1 adjacency
route index
compiled policies
plan CFG
```

для конкретного view.

## Layer resolvers

```text
L1Resolver
L2Resolver
L3Resolver
SecurityResolver
NATResolver
PacketFlowResolver
```

используют typed interfaces выше.

Raw SQL не должен быть размазан внутри state machines.

# Resolver API shape

Conceptual pattern:

```text
resolve(
    typed_input_state,
    evaluation_view,
    workspace
) -> typed_result
```

Result:

```text
outcome
next states
evidence refs
uncertainty
```

## UI не является resolver input

UI может передать:

```text
"APP01"
```

но перед resolver query нормализуется в stable canonical ID/state.

Алгоритм не ищет display name посередине trace.

# Evidence

## Read-model entries держат canonical refs

Например:

```text
L1 edge
    -> ConnectionMember.id

route trie leaf
    -> Route.id + snapshot

compiled security rule
    -> SecurityRule.id

compiled NAT rule
    -> NATRule.id
```

## Не дублировать provenance целиком

Read model хранит stable refs.

Полный source/raw config/timestamp можно dereference при формировании объяснения.

# Validation vs UNKNOWN

## MODEL_ERROR

Если canonical state нарушает внутренний invariant:

```text
invalid member index
broken foreign relation
route next-hop missing required data
plan transition to missing stage
```

это не legitimate network `UNKNOWN`.

Это:

```text
MODEL_ERROR / VALIDATION_ERROR
```

## Resolver/internal failure

Technical exception также не masquerade как:

```text
UNREACHABLE
UNKNOWN
```

API должен различать:

```text
network uncertainty
model validation failure
internal execution failure
```

# Минимальная реализация

Первая версия backend может быть:

```text
PostgreSQL
    |
    +-- canonical typed tables
    +-- ordinary/composite indexes
    |
application process
    |
    +-- EvaluationView
    +-- lazy ResolverWorkspace
    +-- in-memory maps/programs
    +-- query memo
    |
    +-- typed resolvers
```

Без:

```text
Neo4j
SurrealDB
separate graph compiler service
distributed cache
all-pairs reachability
fine-grained event invalidation
```

Если profiler позже покажет bottleneck, read layer оптимизируется без изменения domain semantics.

# Инварианты

1. Persistent DB indexes, view-scoped read models и query memo — разные слои.
2. Read model не является source of truth.
3. Индекс находит candidates, resolver принимает semantic decision.
4. `ResolverWorkspace` привязан к одному `EvaluationView`.
5. Lazy construction — default для nontrivial structures.
6. L1 key — `(ConnectionPoint, member)`.
7. L1 adjacency допускает несколько edges.
8. L1 structures не содержат L2/L3 semantics.
9. Physical binding и realization имеют bidirectional lookups.
10. Operational eligibility — overlay над static relations.
11. L2 ingress exact matcher индексируется по `(interface, encapsulation)`.
12. Multiple candidates не теряются до resolver decision.
13. FDB key — `(L2ForwardingContext, MAC)`.
14. FDB result сохраняет snapshot/completeness/evidence.
15. FDB absence не равен `ABSENT_CONFIRMED`.
16. MAC assignment и FDB имеют разные indexes.
17. IP lookup возвращает scoped candidate list.
18. Route prefix index принадлежит routing table/view.
19. Prefix index не заменяет route-selection semantics.
20. Neighbor key — `(L3Binding, IP)`.
21. Security/NAT attachments используют coarse indexes + exact scope match.
22. Ordered policies компилируются в read programs.
23. Match result не materialize для всего packet space.
24. PacketProcessingPlan компилируется в typed CFG.
25. Snapshot selection pinится внутри view/query.
26. Operational lookup сохраняет `UNKNOWN/conflict`.
27. Negative cache требует completeness/evidence.
28. Query memo key включает semantic state и view.
29. Cross-query cache требует versioned key.
30. Cache eviction не влияет на semantics.
31. All-pairs reachability/packet flows заранее не materialize.
32. PostgreSQL достаточен для первой реализации.
33. Repository API допускает batch/scoped loading.
34. Raw SQL не размазывается по resolver algorithms.
35. Compiled structures сохраняют canonical evidence refs.
36. Validation error отличается от network `UNKNOWN`.
37. Internal error не превращается в network verdict.

## Следующий шаг

Теперь переходим к [[02-03-derived-graphs|02.3 Derived graphs и evidence]].

Он должен быть уже заметно короче: нужен единый format evidence DAG, который затем используют:

- API;
- UI;
- диагностика;
- сохранённые trace artifacts;
- будущая инструкция работы NetMap.

После `02.3–02.5` можно переходить непосредственно к physical storage schema/API и первому implementation milestone.
