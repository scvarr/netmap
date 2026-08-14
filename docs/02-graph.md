# 02. Граф сети

## Статус

Согласованная архитектура представления NetMap как набора canonical facts, resolver-specific execution structures и производных графов.

Эта ветка намеренно **не вводит отдельную графовую базу данных как обязательный source of truth**.

Главный принцип:

```text
Canonical facts
    ↓
EvaluationView
    ↓
resolver-specific compile/index
    ↓
query execution
    ↓
Trace evidence graph
    ↓
presentation projection / aggregation
```

## Почему не один giant graph

Не все сетевые semantics естественно являются одинаковыми graph edges.

Например:

```text
L1 connectivity
```

естественно представляется adjacency graph.

Но:

```text
route lookup
```

лучше обслуживается prefix index.

```text
FDB lookup
```

— индексом:

```text
(context, MAC)
```

```text
security/NAT
```

— ordered rule evaluation.

```text
PacketProcessingPlan
```

— control-flow graph.

Попытка привести всё к универсальному:

```text
node --edge--> node
```

создала бы:

- потерю типизированной semantics;
- сложные generic edge attributes;
- дорогие запросы;
- необходимость materialize query-dependent relations;
- риск превратить derived facts в вторую истину.

Поэтому NetMap использует graph как **semantic/execution concept**, а не как обязательную physical storage model.

## Canonical facts

Source of truth — нормализованные typed domain facts.

Примеры:

```text
Location
PhysicalObject
ConnectionPoint
Connection
ConnectionMember

NetworkInterface
InterfacePhysicalBinding
NetworkInterfaceRealization

L2ForwardingContext
L2Binding
L2IngressRule
L2EgressRule

RoutingContext
L3Binding
RoutingTable
Route
RouteNextHop

SecurityPolicy
SecurityRule

NATPolicy
NATRule

PacketProcessingPlan
ProcessingStage
ProcessingTransition
```

Operational observations также являются facts:

```text
FDBSnapshot / FDBEntry
NeighborSnapshot / NeighborEntry
ForwardingEligibility
RoutingTableSnapshot
NATBindingObservation
SessionObservation
```

Они отличаются provenance/time semantics, но не становятся derived reachability edges.

## Canonical relation может быть graph-like

Некоторые domain relations естественно формируют граф:

```text
ConnectionMember
NetworkInterfaceRealization
ProcessingTransition
```

Это не означает, что вся база должна храниться в generic:

```text
node
edge
```

таблицах.

Типизированная relation остаётся source of semantics.

## Derived relation не является source of truth

Нельзя canonical-хранить как независимый факт:

```text
A reaches B
```

если это результат:

```text
L1 + L2 state + routing + policy + NAT
```

Аналогично:

```text
L2ReachabilityDomain
shortest path
effective route graph
site-level aggregate link
```

являются derived.

Их можно:

```text
compute
cache
materialize
```

но cache обязан знать, из какого input view он построен.

## EvaluationView

Перед выполнением resolver выбирает coherent semantic view.

Подробности: [[02-01-canonical-view|02.1 Canonical facts и EvaluationView]].

Концептуально:

```text
EvaluationView
    mode
    at_time?
    canonical_revision
    observation_selection
    freshness_policy
    source_resolution_policy
```

Это не обязательно отдельная persisted entity.

Она означает:

> какой набор canonical/configured/observed facts считается входом конкретного анализа?

## Зачем нужен coherent view

Без этого один trace мог бы начать на:

```text
route snapshot T1
```

а через несколько шагов внезапно использовать:

```text
route snapshot T2
```

после background poll.

Result тогда нельзя воспроизвести и трудно объяснить.

Trace должен либо:

- использовать pinned selected facts/snapshots;
- либо явно фиксировать query-scoped observations, полученные во время execution.

Новые observations не должны незаметно менять уже пройденные steps.

## Resolver structures

Из `EvaluationView` строятся структуры, удобные конкретным алгоритмам.

Подробности: [[02-02-resolver-structures|02.2 Resolver structures]].

Примеры:

```text
L1:
    adjacency[(ConnectionPoint, member)]

NetworkInterface:
    physical_binding_by_point_member
    realization_up/down adjacency

L2:
    ingress match index
    context -> egress bindings
    FDB[(context, MAC)]

L3:
    prefix index / radix trie per RoutingTable
    neighbor[(L3Binding, IP)]

Security:
    ordered normalized rule program

NAT:
    ordered normalized transform program

Packet Flow:
    PacketProcessingPlan CFG
```

Все они являются **compiled/read models**, а не новой domain model.

## Compiler — логический термин

`compile` не означает обязательный отдельный build step.

Первая реализация может:

- выполнять SQL queries напрямую;
- использовать обычные DB indexes;
- лениво создавать in-memory maps;
- кэшировать часто используемые структуры.

Главное — semantic boundary:

```text
facts != execution structure
```

## Не всё надо materialize

Особенно плохо заранее materialize:

```text
all possible L3 paths
all possible packet flows
all possible firewall decisions
```

Число состояний зависит от:

```text
source
destination
protocol
ports
VRF
NAT state
session state
time
```

Поэтому многие transitions генерируются query-time.

## Static и dynamic execution edges

Полезно различать:

### Static-ish

Выводятся непосредственно из selected facts:

```text
ConnectionMember adjacency
InterfacePhysicalBinding
NetworkInterfaceRealization
L2Binding attachment
ProcessingTransition
```

### Query-dependent

Возникают только для конкретного state:

```text
matching L2IngressRule
selected FDB target
selected Route
selected ECMP candidate
matching SecurityRule
matching NATRule
current PacketProcessingPlan branch
```

Query-dependent transition не должен становиться permanent graph edge.

## Evidence graph

Результат trace сам естественно является graph/DAG.

Подробности: [[02-03-derived-graphs|02.3 Derived graphs и evidence]].

Например:

```text
PacketState P0
    |
    | NAT rule 10
    v
PacketState P1
    |
    | Route R17
    v
ForwardDecision
    |
    | L2 trace
    v
NextProcessingPoint
```

Каждое ребро имеет:

```text
transition kind
input/output state
evidence refs
uncertainty
```

Это **результат reasoning**, а не canonical topology.

## Evidence refs — обязательны

Любая compiled/query-time transition должна быть объяснима исходными facts.

Например:

```text
Context A -> Gi48/tag100
```

должно ссылаться на:

```text
L2Binding
L2EgressRule
eligibility facts
```

Route step:

```text
Route
RouteNextHop
snapshot/selection evidence
```

Security:

```text
policy
rule/default
predicate evidence
```

Derived edge без evidence не должен считаться authoritative.

## Projection graph

UI не должен напрямую показывать execution states как единственный map format.

Presentation projection может схлопнуть:

```text
ConnectionPoint/member
    -> PhysicalObject

PhysicalObject
    -> Location

L2 contexts
    -> site-level L2 relation

many routing hops
    -> aggregate site link
```

Подробности: [[02-04-projections-aggregation|02.4 Projections и aggregation]].

Projection — только view.

Изменение projection node не должно мутировать несколько canonical entities неявно.

## Layer projection

Один canonical fact set поддерживает разные projections:

```text
L1 projection
L2 projection
L3 projection
Security projection
Packet-flow overlay
```

Это не отдельные topology databases.

## Detail projection

Layer и detail level независимы.

Можно показать:

```text
L1 at site scale
```

или:

```text
L3 at one firewall with fine interface detail
```

Projection задаёт mapping canonical/derived states -> presentation nodes.

## Aggregated edge

Например UI показывает:

```text
SITE-A ===== SITE-B
```

Один aggregate edge может скрывать:

```text
12 physical links
4 LAGs
3 L2 contexts
multiple routing adjacencies
```

Он не является editable canonical `Connection`.

UI должен иметь возможность раскрыть supporting facts.

## Graph identity

Presentation node identity не должна подменять domain identity.

Например aggregate:

```text
location:DC1
```

может быть presentation group для сотен entities.

Нельзя использовать его ID там, где resolver ожидает:

```text
NetworkInterface
L3Binding
L2ForwardingContext
```

## Cache

Derived structures могут кэшироваться.

Подробности: [[02-05-cache-invalidation|02.5 Cache и invalidation]].

Cache должен быть связан минимум с:

```text
EvaluationView fingerprint
compiler/resolver version
query key
```

где применимо.

## Invalidation

Canonical fact change должен делать зависимые cached results stale.

Первый backend не обязан иметь идеальный fine-grained dependency engine.

Безопасная стратегия:

```text
version/fingerprint mismatch
    ->
rebuild/recompute
```

лучше сложной ошибочной selective invalidation.

## Coarse invalidation допустима

Например при изменении L2 facts можно invalidate:

```text
all L2 compiled structures for affected view/context
```

вместо вычисления минимального набора edge dependencies.

Оптимизация появится только после measurements.

## Cache не должен влиять на semantics

Результат с cache и без cache должен быть одинаковым.

Если cache stale/unknown:

```text
recompute
```

а не продолжить на старой derived topology.

## Configured и effective execution views

Один canonical model может компилироваться в разные read models:

```text
ConfiguredResolverView
EffectiveResolverView
HistoricalResolverView(T)
```

Это не три базы.

Они отличаются selected input facts.

## Historical view

Для:

```text
at_time = T
```

resolver выбирает historical facts/snapshots.

Compiled structures могут быть построены временно для этого view.

Не требуется хранить permanent full graph snapshot на каждое изменение, если history layer позволяет reconstruct selected facts.

## Unknown сохраняется в graph execution

Compiler не должен удалять неопределённость.

Например missing operational state нельзя compile в отсутствие edge:

```text
no edge
```

если смысл:

```text
edge eligibility UNKNOWN
```

Иначе graph search ошибочно вернёт:

```text
UNREACHABLE
```

вместо:

```text
UNKNOWN
```

## Edge state

Execution transition концептуально может иметь:

```text
AVAILABLE
UNAVAILABLE
UNKNOWN
```

или resolver-specific richer outcome.

Но это runtime semantic state, а не обязательная generic edge table.

## Negative evidence

Отсутствие edge может означать разные вещи:

```text
подтверждено, что relation нет
relation неизвестна
relation ещё не скомпилирована
relation query-dependent и predicate false
```

Поэтому graph algorithm нельзя строить только на:

```text
edge exists / edge absent
```

без completeness semantics.

## Query frontier

Resolver исследует semantic frontier states.

Тип state зависит от уровня.

### L1

```text
(ConnectionPoint, member)
```

### L2

```text
BoundaryState
ContextState
InternalInterfaceState
```

### L3

```text
RoutingState
LookupState
```

### Packet Flow

```text
FlowExecutionState
```

Нет одного универсального graph vertex type, который одинаково удобен всем слоям.

## Typed state machine

Это ключевая архитектурная формула:

> NetMap — не один giant graph search, а композиция типизированных state machines над общими canonical facts.

Graph/index structures помогают им выполнять transitions эффективно.

## Resolver boundary

Каждый resolver должен иметь semantic API примерно вида:

```text
input typed state
+ EvaluationView
    ->
typed transition/result
+ evidence
+ uncertainty
```

Это важнее physical storage.

## Shared identifiers

Resolver outputs должны ссылаться на stable canonical IDs.

Например L2 returns:

```text
receiving NetworkInterface ID
```

L3 затем использует его для lookup:

```text
L3Binding
RoutingContext
```

Так слои связываются без duplicate topology.

## No hidden denormalized truth

Допустимые denormalized read models:

```text
current_fdb_lookup
route_prefix_index
location descendants cache
physical adjacency cache
```

Но они должны быть reconstructable из canonical facts/observations.

Недопустимо иметь два independently editable источника:

```text
ConnectionMember
```

и:

```text
graph_edge_l1
```

которые оба считаются canonical.

## Backend storage implication

Из этой архитектуры **не следует необходимость Neo4j/SurrealDB/graph DB**.

Реляционная БД с:

```text
foreign keys
typed tables
indexes
ltree
inet/cidr
recursive queries where useful
```

может быть основной storage.

Graph engine можно добавить как cache/read model позднее, если profiler покажет реальную необходимость.

## PostgreSQL-friendly implementation

Для предполагаемого PostgreSQL backend естественно:

```text
Location path      -> ltree
IP/prefix          -> inet/cidr
L1 relation        -> ordinary indexed relation
routing lookup     -> prefix indexes / specialized query
metadata           -> typed columns + jsonb where appropriate
history/provenance -> ordinary temporal/source tables
```

Не надо выбирать graph DB только потому, что термин `graph` встречается в архитектуре.

## Derived graph materialization

Materialize стоит только то, что:

- дорого вычислять;
- часто переиспользуется;
- имеет чёткую dependency/version semantics;
- легко rebuild;
- не создаёт слишком большой state space.

Хорошие кандидаты могут появиться:

```text
L1 adjacency
location closure
current interface realization adjacency
```

Плохой ранний кандидат:

```text
all packet-flow reachability pairs
```

## Evidence graph storage

Trace evidence result можно:

```text
return only
```

или:

```text
persist as diagnostic artifact
```

Если сохраняется, он должен содержать input view fingerprint и не считаться current truth после изменения inputs.

Это похоже на сохранённый результат теста, а не на topology entity.

## Determinism

При одинаковых:

```text
EvaluationView
query
resolver/compiler version
```

semantic result должен быть deterministic, кроме явно моделируемой nondeterminism/constrained state.

Даже тогда output set/constraints должен быть deterministic.

Random traversal/selection не должен менять verdict.

## Инварианты

1. Canonical facts являются source of truth.
2. NetMap не требует одного universal physical graph representation.
3. Typed relations сохраняют собственную domain semantics.
4. Derived reachability/path/domain не является canonical independently editable fact.
5. Resolver выполняется над explicit `EvaluationView`.
6. Trace не должен незаметно переключаться на новые observations посередине уже вычисленного evidence path.
7. Resolver-specific execution structures являются read models/indexes.
8. `compile` не требует отдельного offline graph build.
9. Не все semantics должны materialize в graph edges.
10. Query-dependent transitions генерируются query-time.
11. Every meaningful derived transition имеет evidence refs.
12. Evidence graph является result, а не source of truth.
13. Presentation graph является projection.
14. Aggregated presentation edge не является canonical Connection.
15. Layer projection и detail projection независимы.
16. Cache обязан быть связан с input view/version.
17. Stale cache не используется как актуальная topology.
18. Coarse invalidation допустима до появления performance evidence.
19. Configured/effective/historical graph views отличаются входными facts, а не отдельными databases.
20. UNKNOWN state не должен теряться при compilation.
21. Отсутствие execution edge без completeness не означает confirmed impossibility.
22. Каждый resolver использует свой typed semantic state.
23. NetMap является композицией state machines, а не одним generic graph traversal.
24. Resolver outputs связывают layers stable canonical IDs.
25. Denormalized read model должен быть reconstructable из canonical facts.
26. PostgreSQL достаточно для первой реализации; graph DB не является архитектурным требованием.
27. Materialization вводится только после evidence, что она нужна.
28. Persisted trace является diagnostic artifact, не current truth.
29. Одинаковый query/view/resolver version должен давать deterministic semantic result.

## Ветки

- [[02-01-canonical-view|02.1 Canonical facts и EvaluationView]]
- [[02-02-resolver-structures|02.2 Resolver structures]]
- [[02-03-derived-graphs|02.3 Derived graphs и evidence]]
- [[02-04-projections-aggregation|02.4 Projections и aggregation]]
- [[02-05-cache-invalidation|02.5 Cache и invalidation]]

Следующий шаг — подробно зафиксировать `02.1`: что именно означает coherent `EvaluationView`, как выбираются configured/observed facts и почему completeness/freshness/source precedence должны быть частью query context.
