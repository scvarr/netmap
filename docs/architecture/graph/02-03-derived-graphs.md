# 02.3 Derived graphs и evidence

## Статус

Согласованный контракт производного trace/evidence graph.

Цель этой ветки — определить единый result format, который могут использовать:

- L1/L2/L3 resolvers;
- Security/NAT;
- Packet Flow;
- HTTP/API boundary;
- automated tests;
- UI;
- сохранённые diagnostic artifacts.

Evidence graph является **derived result**, а не canonical topology.

Связанные заметки:

- [[architecture/graph/02-graph|02. Граф сети]];
- [[architecture/graph/02-01-canonical-view|02.1 Canonical facts и EvaluationView]];
- [[architecture/graph/02-02-resolver-structures|02.2 Resolver structures]];
- [[architecture/tracing/03-tracing|03. Трассировка]];
- [[architecture/tracing/03-04-packet-flow-trace|03.4 Packet Flow Trace]].

## Почему нужен общий контракт

Каждый resolver уже имеет собственные typed states.

Не нужно заставлять все layers иметь один универсальный internal state.

Но на границе результата нужен общий envelope:

```text
TraceArtifact
    query
    evaluation_view
    verdict
    branches / evidence DAG
    evidence references
    gaps/warnings
```

Internal resolver state остаётся typed.

Serialization contract унифицирует только результат reasoning.

## Evidence DAG

Trace result естественно может:

- ветвиться;
- сходиться;
- повторно использовать один resolved state;
- содержать несколько причин;
- хранить packet lineage.

Поэтому базовая форма:

```text
directed acyclic evidence graph
```

а не только:

```text
list of log lines
```

Если execution обнаруживает loop, loop представляется terminal/evidence condition.

Сам persisted result не обязан содержать циклическую ссылочную структуру.

## TraceArtifact

Conceptual top-level object:

```text
TraceArtifact
    schema_version

    trace_id?
    created_at

    query
    evaluation_view_ref

    resolver_version
    mode

    verdict

    nodes[]
    edges[]
    evidence_refs[]
    gaps[]
    warnings[]

    summary?
```

`trace_id` обязателен только для persisted artifact.

Для обычного synchronous API result он может быть request/result identifier.

## schema_version

Result format должен иметь explicit version:

```text
schema_version = 1
```

Это позволит frontend/Codex/tests отличать изменение API contract от изменения network facts.

Schema version не равна application version.

## Query echo

Artifact хранит normalized query, а не только пользовательскую строку.

Например Packet Flow:

```text
query:
    kind = packet_flow
    origin = canonical target/ref
    packet:
        src_ip
        dst_ip
        protocol
        src_port?
        dst_port?
    target?
    exactness = EXACT | POSSIBLE
```

Это важно для reproducibility.

## Evaluation view reference

Result хранит минимум:

```text
mode
at_time
view_fingerprint/revision
important pinned snapshot refs
```

Не обязательно inline сериализовать весь `EvaluationView`.

Нужно иметь достаточно данных, чтобы понять:

> над каким semantic input view был получен результат?

## Resolver version

Artifact фиксирует implementation semantic version/fingerprint resolver'а.

Это особенно важно для persisted diagnostics.

Одинаковые facts/query после изменения algorithm могут законно дать другой result.

## Verdict

Top-level verdict зависит от query kind.

Примеры:

```text
L2/L3:
    REACHABLE
    UNREACHABLE
    UNKNOWN

Security:
    PASS
    BLOCKED
    UNKNOWN

PacketFlow:
    DELIVERED
    NOT_DELIVERED
    UNKNOWN
```

Нельзя приводить всё к одному generic boolean.

## Node

Общий envelope:

```text
EvidenceNode
    id
    kind
    layer?
    payload
    canonical_refs[]
```

`payload` является tagged/typed data в API schema.

## Минимальные node kinds

Полезное первое ядро:

```text
STATE
DECISION
TERMINAL
```

### STATE

Semantic state resolver'а.

Примеры:

```text
L1 point/member
L2 BoundaryState
L2 ContextState
L3 RoutingState
PacketState
FlowExecutionState projection
```

### DECISION

Производный resolver result.

Примеры:

```text
route selected
security rule matched
NAT transform applied
FDB resolution
processing-plan transition
```

### TERMINAL

Branch completion:

```text
target reached
security drop
no route
unknown missing data
loop detected
```

## Не делать entity-type zoo в общем graph

Общий evidence graph не обязан иметь top-level node kind:

```text
ROUTE
FIREWALL_RULE
CABLE
NAT_RULE
...
```

Это canonical entities, на которые указывают `canonical_refs`.

Node описывает **роль в reasoning graph**, а не копирует domain database.

## Edge

```text
EvidenceEdge
    id
    from_node_id
    to_node_id
    transition_kind
    outcome?
    layer?
    evidence_refs[]
    uncertainty?
```

Примеры `transition_kind`:

```text
L1_TRAVERSE
L2_INGRESS_DECODE
L2_FORWARD
ROUTE_LOOKUP
NEXT_HOP_RESOLVE
SECURITY_EVALUATE
NAT_TRANSFORM
PROCESSING_TRANSITION
L2_HANDOFF
LOCAL_DELIVERY
```

Enum/registry может расширяться versioned API schema.

## EvidenceRef

Evidence graph не должен inline-копировать всю canonical БД.

Ссылка:

```text
EvidenceRef
    ref_type
    entity_type
    entity_id
    revision/snapshot_id?
```

Минимальные ref classes:

```text
CANONICAL_FACT
OBSERVATION
SNAPSHOT
QUERY_SCOPED_EVIDENCE
PROCESSING_PLAN
```

Точная representation будет определена API/storage schema.

## Evidence dereference

Backend должен иметь способ по evidence ref получить human-readable explanation/details при наличии прав.

Но основной trace response может содержать только компактные refs + summary labels.

Это защищает размер ответа.

## Raw source не тащить автоматически

Trace JSON не должен по умолчанию включать:

```text
full device config
full API response
credentials
secret fields
large source documents
```

Evidence ref указывает на normalized/source record.

Raw provenance раскрывается отдельным endpoint/permission-aware operation при необходимости.

## Branch

Хотя artifact хранится DAG, API удобно иметь derived branch views.

Conceptually:

```text
TraceBranch
    branch_id
    start_node
    terminal_node
    verdict/outcome
    edge_ids[]
    gaps[]
```

Branches могут разделять одни и те же nodes/edges.

Не обязательно дублировать graph data для каждой branch.

## Branch identity

Branch ID — result-local identity.

Он не является canonical network entity.

## Merge

Если две execution branches приходят в один semantic state:

```text
branch A
branch B
    ->
state X
```

graph хранит один state node X и две incoming evidence edges, если state equivalence resolver'ом подтверждена.

Это предотвращает explosion и сохраняет обе причины пути.

## State payload immutable

Один `STATE` node описывает конкретную semantic state version.

Если NAT меняет PacketState:

```text
P0 -> P1
```

это два state nodes.

Нельзя переписать payload P0.

## Packet lineage

Packet Flow artifact явно хранит lineage через edges:

```text
PacketState P0
    |
    | NAT_TRANSFORM
    v
PacketState P1
```

Security/route decision node должен ссылаться на конкретный PacketState input node.

Таким образом API может точно ответить:

```text
какой packet видел rule?
```

## Decision node

Decision полезен, когда один transition имеет богатый result.

Например route:

```text
RoutingState
    ->
Decision(route R17 / next-hop ...)
    ->
next state
```

Это лучше, чем прятать всю route-selection semantics только в edge attributes.

Но implementation может collapse trivial decisions, если API schema сохраняет evidence equivalently.

## Минимальная рекомендация implementation

Для первого backend предпочтительна явная форма:

```text
state -> decision -> state
```

для:

```text
routing
security
NAT
```

и direct edge для простых physical transitions.

Это делает JSON/test assertions понятнее.

## Gap

`UNKNOWN` должен иметь структурированную причину.

```text
TraceGap
    code
    node_id?
    edge_id?
    message?
    required_fact_scope?
    evidence_refs[]
```

Примеры:

```text
MISSING_L2_STATE
ROUTING_TABLE_PARTIAL
STALE_FDB
POLICY_ORDER_INCOMPLETE
PROCESSING_PLAN_UNKNOWN
AMBIGUOUS_L3_HANDOFF
```

`message` для человека вторичен.

Machine-readable `code` обязателен.

## Warning

Warning не делает result обязательно `UNKNOWN`.

```text
TraceWarning
    code
    severity
    node/edge refs
    evidence_refs
```

Пример:

```text
STALE_NON_CRITICAL_OBSERVATION
ALTERNATE_BRANCH_CONFLICT
TEMPORAL_SKEW_WITHIN_POLICY
```

## Error отдельно

Internal/model error не является gap.

API должен различать:

```text
successful trace with UNKNOWN verdict
```

и:

```text
trace execution failed
```

Technical error response:

```text
MODEL_ERROR
VALIDATION_ERROR
INTERNAL_ERROR
```

не должен сериализоваться как terminal `UNKNOWN` network node, если trace не был корректно выполнен.

## Terminal reason

Terminal node payload минимум содержит:

```text
reason_code
```

Например:

```text
TARGET_REACHED
LOCAL_NETWORK_DELIVERY
SECURITY_DROP
SECURITY_REJECT
ROUTE_DISCARD
NO_ROUTE
L2_UNREACHABLE
LOOP_DETECTED
SEARCH_LIMIT
UNKNOWN_REQUIRED_DATA
```

Top-level verdict агрегируется отдельно.

## Почему terminal reason != verdict

Например один ECMP branch:

```text
SECURITY_DROP
```

а другой:

```text
TARGET_REACHED
```

Для `POSSIBLE` query overall:

```text
DELIVERED
```

Оба terminal reasons всё равно сохраняются.

## Layer

Node/edge может иметь:

```text
layer = L1 | L2 | L3 | SECURITY | NAT | PACKET_FLOW
```

Но layer — presentation/filter attribute.

Он не заменяет typed payload.

## Timeline order

DAG не всегда имеет одну линейную временную последовательность.

Для human timeline backend/UI может получить topological/path order внутри выбранной branch.

`created sequence number` может существовать как diagnostic metadata, но не определяет semantics.

## Evidence graph deterministic IDs

Persisted artifact может использовать random/UUID node IDs.

Для automated tests удобнее также поддерживать stable structural comparison без привязки к конкретным generated IDs.

Тесты должны сравнивать:

```text
node kinds/payloads
transitions
verdicts
evidence canonical refs
gap codes
```

а не требовать конкретный UUID.

## Summary

Top-level `summary` является derived convenience field.

Пример:

```text
summary:
    first_blocking_point
    delivered_target
    hop_count
    layer_statuses
```

Он не должен содержать единственные данные, отсутствующие в evidence graph.

Summary можно пересоздать из graph/result.

## Layer statuses

Convenience projection:

```text
L1: OK
L2: OK
L3: OK
SECURITY: BLOCKED
NAT: IDENTITY
```

Это UI/report aid.

Canonical end-to-end evidence остаётся DAG.

## First blocker

Derived summary:

```text
first_known_blocker
```

должен ссылаться на node/edge ID.

Он не хранится как независимый network fact.

## Unknown frontier

Полезная derived summary:

```text
unknown_frontier[]
```

— места, где analysis не смог продолжить доказательную цепочку.

Это помогает пользователю понять, какие данные надо добавить.

## Evidence path

API/UI должен иметь возможность получить:

```text
path to terminal
path to gap
path to decision
```

как graph traversal над artifact.

Не нужно заранее дублировать каждый root-to-leaf path отдельным массивом, если graph большой.

## Persisted trace artifact

Trace можно сохранять для диагностики.

Persisted artifact:

- immutable;
- имеет trace ID;
- содержит query/view/resolver version;
- не считается current network truth;
- после изменения inputs остаётся historical evidence.

## Staleness artifact

Сохранённый trace не переписывается после изменения topology.

UI может определить:

```text
current view fingerprint != artifact view fingerprint
```

и показать:

```text
historical/stale trace artifact
```

Это не требует пересчитывать старый artifact.

## Не использовать saved trace как source

Новый resolver query не должен читать старый:

```text
DELIVERED
```

как доказательство нового packet flow.

Он должен использовать canonical facts или validated rebuildable cache.

Persisted trace — diagnostic result.

## Serialization

Первый backend должен уметь сериализовать artifact в JSON.

Это основной machine-readable contract для:

```text
API
tests
future UI
Codex fixtures
```

Конкретный JSON schema/OpenAPI фиксируется implementation milestone.

## JSON и typed payload

Не следует делать:

```json
{"payload": "route 10.0.0.0/8 via R2"}
```

как единственную semantics.

Нужны structured fields.

Human-readable explanation можно добавить отдельно:

```text
display
```

## Минимальный illustrative JSON

```json
{
  "schema_version": 1,
  "verdict": "NOT_DELIVERED",
  "nodes": [
    {
      "id": "n1",
      "kind": "STATE",
      "layer": "PACKET_FLOW",
      "payload": {
        "type": "packet_state",
        "src_ip": "10.1.1.10",
        "dst_ip": "10.2.2.20",
        "protocol": "tcp",
        "dst_port": 443
      }
    },
    {
      "id": "n2",
      "kind": "DECISION",
      "layer": "SECURITY",
      "payload": {
        "type": "security_decision",
        "action": "DROP"
      },
      "canonical_refs": [
        {"type": "SecurityRule", "id": "rule-77"}
      ]
    },
    {
      "id": "n3",
      "kind": "TERMINAL",
      "payload": {
        "reason_code": "SECURITY_DROP"
      }
    }
  ],
  "edges": [
    {
      "from": "n1",
      "to": "n2",
      "transition_kind": "SECURITY_EVALUATE"
    },
    {
      "from": "n2",
      "to": "n3",
      "transition_kind": "TERMINATE"
    }
  ]
}
```

Это только shape example, не окончательная OpenAPI schema.

## API response size

Trace может быть большим.

Первый API может поддержать:

```text
detail = summary
detail = evidence
```

или отдельный endpoint для persisted artifact.

Но summary-mode не должен менять computed verdict.

## Evidence pagination

Не нужна в первом milestone, если test fixtures малы.

Если production trace начнёт давать большие DAG, можно добавить:

```text
artifact persistence + graph slice endpoint
```

позже.

Не надо усложнять первый API streaming/pagination заранее.

## In-memory first

Первый implementation может строить evidence graph полностью in-memory и отдавать JSON.

Persistent trace storage не требуется для первого milestone.

Важно сначала стабилизировать result contract.

## Test contract

Automated resolver test должен проверять не только verdict.

Например:

```text
expected verdict = UNKNOWN
expected gap code = ROUTING_TABLE_PARTIAL
expected evidence contains Route R1
```

Для security:

```text
expected terminal = SECURITY_DROP
expected SecurityRule = rule-77
```

Это предотвращает implementation, который случайно выдаёт правильный boolean неправильным reasoning path.

## Golden fixtures

Для end-to-end маленьких scenarios допустимы JSON golden files.

Но golden comparison должен:

- игнорировать generated IDs/timestamps;
- проверять schema/semantics;
- не мешать полезным additive fields.

Structured assertions предпочтительнее полного byte-for-byte JSON diff для unit tests.

## Security/privacy

Evidence serializer не включает secret values.

Canonical source record может содержать connection credential reference, но trace response не должен dereference secret.

Raw device/API payloads включаются только через отдельный controlled mechanism.

## Инварианты

1. Evidence graph — derived result, не topology source of truth.
2. Internal resolver states остаются typed; общий graph унифицирует serialization/result.
3. Artifact имеет explicit `schema_version`.
4. Artifact фиксирует normalized query.
5. Artifact фиксирует EvaluationView/revision/fingerprint.
6. Artifact фиксирует resolver/application semantic version достаточно для reproducibility.
7. Verdict остаётся domain-specific enum, а не generic boolean.
8. Базовые evidence node roles: `STATE`, `DECISION`, `TERMINAL`.
9. Canonical domain entities подключаются через evidence refs, а не копируются как generic graph nodes без необходимости.
10. Edge хранит transition semantics.
11. Branching и merge естественно представлены DAG.
12. PacketState versions immutable и образуют lineage.
13. Decision ссылается на конкретный input state.
14. `UNKNOWN` имеет machine-readable gap code.
15. Warning и Gap различаются.
16. Internal/model errors не masquerade как network `UNKNOWN`.
17. Terminal reason отделён от overall verdict.
18. Layer является projection/filter property.
19. Summary derivable из evidence graph.
20. First blocker/unknown frontier ссылаются на graph positions.
21. Persisted trace artifact immutable и historical.
22. Saved trace не используется как canonical evidence нового query.
23. Первый backend сериализует artifact в structured JSON.
24. Human-readable text не является единственной semantics payload.
25. Первый implementation может держать artifact только in-memory.
26. Tests проверяют evidence/gap/reason, а не только final verdict.
27. Trace serializer не раскрывает secrets.

## Следующий шаг

`02.4 Projections и aggregation` должен определить только правила presentation-level схлопывания evidence/canonical graph.

`02.5 Cache и invalidation` — минимальные version/fingerprint rules.

После них documentation phase для core backend можно считать достаточной и переходить к implementation milestone 1:

```text
Docker Compose
PostgreSQL
migrations
minimal canonical schema
Evidence JSON contract
первый L1 resolver vertical slice
```

Код этой реализации выполняет Codex согласно [[00-implementation-constraints|00. Ограничения реализации]].
