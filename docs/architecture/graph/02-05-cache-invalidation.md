# 02.5 Cache и invalidation

## Статус

Согласованная минимальная cache/invalidation policy NetMap.

Главное решение:

> correctness NetMap не должна зависеть от наличия cache.

Первая реализация может вообще не иметь cross-query application cache.

Связанные заметки:

- [[architecture/graph/02-01-canonical-view|02.1 Canonical facts и EvaluationView]];
- [[architecture/graph/02-02-resolver-structures|02.2 Resolver structures]];
- [[architecture/graph/02-03-derived-graphs|02.3 Derived graphs и evidence]];
- [[architecture/graph/02-04-projections-aggregation|02.4 Projections и aggregation]].

## Cache — только optimization

Для любого cache должно выполняться:

```text
result_with_cache
==
result_without_cache
```

по semantic verdict/evidence.

Cache miss:

```text
recompute
```

Cache stale:

```text
do not use
recompute
```

Cache failure не должен делать network:

```text
UNREACHABLE
```

или:

```text
UNKNOWN
```

если source facts доступны.

## Что не является cache

Обычные PostgreSQL indexes:

```text
B-tree
GiST/SP-GiST
GIN
```

являются storage indexes, а не application semantic cache.

Canonical/observed tables также не cache.

## Cache levels

Полезно различать:

### Query memo

Живёт один trace.

### View-scoped compiled cache

Например:

```text
L1 adjacency
route trie
SecurityProgram
NATProgram
PlanProgram
```

для конкретного EvaluationView/entity version.

### Trace artifact cache

Опционально сохранённый computed result для exact query/view.

### Projection cache

Опционально сохранённая presentation projection.

## Milestone 1

Разрешённая стратегия:

```text
query memo only
```

и никакого cross-query application cache.

Это preferred default.

PostgreSQL и OS page cache уже дадут базовую производительность.

Не надо заранее строить Redis/invalidation subsystem.

## Redis не требуется

Первый backend не должен зависеть от:

```text
Redis
Memcached
message broker
```

ради cache.

Если profiler позднее покажет реальную проблему, cache service можно добавить как implementation optimization.

## Cache key

Любой cross-query semantic cache key минимум включает:

```text
workspace identity / cache namespace
EvaluationView fingerprint/revision
compiler/resolver version
entity/scope key
```

Даже если canonical IDs совпадают между forked workspaces, cached result одного workspace не может использоваться другим.

Для query result также:

```text
normalized query
mode/exactness
target
```

## Нельзя key только по topology ID

Неверно:

```text
l2_cache[context_id]
```

если result зависит от:

```text
FDB snapshot
operational state
view time
resolver version
```

Нужно version/view-aware key.

## Compiler version

Изменение code semantics должно invalidate старый compiled/result cache даже если canonical data не изменились.

Поэтому key/version metadata учитывает:

```text
compiler_version
resolver_version
schema/result version где применимо
```

## EvaluationView fingerprint

Главный безопасный dependency boundary.

Если fingerprint отличается:

```text
cache miss
```

Это позволяет начать с coarse invalidation вместо сложного dependency graph.

## Coarse invalidation

Первый cross-query cache, если вообще появится, может invalidate крупно.

Например:

```text
L2 view changed
    -> discard compiled L2 structures for view

routing revision changed
    -> discard route structures for affected context/view
```

Лучше пересчитать лишнее, чем оставить stale semantic result.

## Fine-grained invalidation позднее

Не нужны сейчас:

```text
event dependency graph
per-edge dependency tracking
distributed invalidation events
incremental all-path recomputation
```

Они вводятся только при измеренной необходимости.

## Immutable cache entries

Cache entry conceptual immutable:

```text
key -> compiled/read result
```

При изменении inputs создаётся новый key/value.

Не надо пытаться патчить сложный in-memory graph на месте в первой реализации.

## Query memo

Query memo безопаснее всего, потому что `EvaluationView` уже pinned.

Примеры:

```text
route lookup
recursive next hop
FDB resolution
L1 expansion
predicate evaluation
plan selection
```

Memo удаляется после завершения query.

## Negative cache

Особенно опасен.

Можно cache:

```text
NO_ROUTE_CONFIRMED
```

только вместе с evidence/completeness/view key.

Нельзя cache:

```text
record not found -> no route
```

если completeness unknown.

То же:

```text
no FDB entry
no policy
no neighbor
```

## UNKNOWN cache

`UNKNOWN` можно memoize в рамках query.

Cross-query cache UNKNOWN имеет мало пользы и легко скрывает появившиеся данные.

Если сохраняется, он всё равно привязан к exact EvaluationView fingerprint.

## Compiled policy cache

Хороший будущий candidate:

```text
(policy_id, policy_revision, compiler_version)
    ->
SecurityProgram
```

То же для NAT.

Изменение unrelated topology не обязано инвалидировать policy program, если fine-grained versions уже доступны.

Но Milestone 1 может compile policy каждый раз.

## Route index cache

Хороший candidate:

```text
(routing_table_id, selected_view_revision, compiler_version)
    ->
route index
```

Но PostgreSQL prefix query может оказаться достаточно быстрым, и отдельный trie вообще не понадобится.

Profiler решает.

## L1 adjacency cache

Physical topology меняется относительно редко.

Позже можно cache:

```text
physical revision
    ->
L1 adjacency
```

Но первая реализация может batch-load relation rows в query workspace.

## FDB/neighbor cache

Operational data быстро меняется.

Нежелательно создавать второй independent long-lived application cache поверх уже сохранённых snapshots без необходимости.

Лучше:

```text
EvaluationView selects snapshot
query workspace builds lookup
```

## Trace result cache

Опционально:

```text
(query fingerprint, EvaluationView fingerprint, resolver version)
    ->
TraceArtifact
```

Но сохранённый artifact уже имеет historical semantics.

Для `current` query backend не должен возвращать старый artifact, если view fingerprint изменился.

## Persisted artifact != current cache

Если пользователь сохранил trace для истории:

```text
trace_id = X
```

он не удаляется при invalidation.

Он просто больше не является current result.

То есть:

```text
diagnostic artifact retention
```

и:

```text
current query cache
```

— разные вещи.

## Projection cache

Projection может cache по:

```text
source view/artifact fingerprint
ProjectionSpec fingerprint
projection code version
```

Но полноценный topology UI появится позже, поэтому cache projection не нужен первому backend.

## Invalidation source

Самый безопасный источник invalidation:

```text
canonical/data revision change
snapshot selection change
code/compiler version change
```

Не нужно строить отдельные hand-written invalidation callbacks между каждым repository method и каждым cache.

## DB transaction commit

Если implementation использует monotonic canonical revision, mutation transaction увеличивает revision только после successful commit.

Cache key нового query использует новую revision.

Failed transaction не должна инвалидировать semantic view как будто изменение произошло.

## Operational snapshots

Новый FDB/route/interface observation может не менять canonical configuration revision.

EvaluationView fingerprint учитывает selected snapshot IDs/operational revision.

Так current effective cache автоматически получает другой key.

## Source precedence change

Изменение:

```text
freshness policy
source precedence
completeness resolver
```

может изменить result без изменения network records.

Поэтому policy version входит в EvaluationView fingerprint.

## Time-dependent view

`at_time=now` потенциально меняется даже без новых records из-за freshness expiration.

Нельзя cache current effective result бессрочно только по data revision.

View fingerprint/validity должен учитывать time/freshness boundary.

## Valid-until

Опционально EvaluationView/cache entry может иметь:

```text
valid_until
```

например ближайший момент, когда selected observation станет stale.

После него entry нельзя использовать для нового `now` query.

Это optimization, не requirement Milestone 1.

## Historical cache

Historical:

```text
at_time = T
```

обычно проще cache, потому что time не движется.

Но historical support вообще не требуется первому vertical slice.

## Cache stampede

Не проектируем заранее distributed lock/single-flight infrastructure.

Если позже expensive compile вызывается параллельно, можно добавить per-process:

```text
single-flight
```

optimization.

## Memory bounds

Любой cross-query in-process cache должен иметь bounds:

```text
max entries
max bytes
LRU
```

Чтобы topology size не приводил к бесконечному росту process memory.

Query memo также защищается существующими trace search limits.

## Serialization cache

Не нужно отдельно cache JSON string, пока profiler не покажет bottleneck.

Хранить typed result и сериализовать обычно проще/безопаснее.

## Validation

Cached compiled structure должна быть построена только из valid canonical/view inputs.

Если compiler обнаружил:

```text
MODEL_ERROR
```

не надо сохранять «полурабочий» cache entry как нормальный result.

Technical failure можно кратко memoize только как implementation detail, но не как network verdict.

## Metrics before optimization

Перед добавлением cross-query cache должны появиться measurements:

```text
query latency
DB query count/time
workspace build time
resolver expansion count
memory
```

Без этого cache architecture будет преждевременной.

## Suggested first observability

Достаточно логировать/measure внутри backend:

```text
trace duration
DB calls
rows loaded
states expanded
branches
workspace build time
```

Полный Prometheus stack не requirement первого milestone.

## Docker implication

Cross-query cache, если он in-process, исчезает при restart container.

Это нормально:

```text
restart
    ->
cold cache
    ->
correct recompute
```

Никакая network truth не должна теряться.

## Horizontal scaling later

Если когда-нибудь backend станет multi-replica, local cache может быть independently cold/stale-by-key-safe.

Versioned keys уменьшают потребность в broadcast invalidation.

Distributed cache не является prerequisite horizontal scaling.

## Cache and migrations

Schema migration/code deploy естественно меняет application/compiler version.

Старые in-process caches исчезают при container restart.

Persisted semantic caches, если появятся, должны иметь schema/compiler version и не переживать incompatible deploy молча.

## Инварианты

1. Cache является optimization, не source of truth.
2. Correctness не зависит от cache availability.
3. PostgreSQL indexes не являются semantic cache.
4. Milestone 1 может использовать только query memo.
5. Redis/distributed cache не требуется первому backend.
6. Cross-query key включает EvaluationView fingerprint/revision.
7. Resolver/compiler version участвует в semantic cache key.
8. Coarse invalidation предпочтительнее risky fine-grained invalidation на старте.
9. Cache entries conceptually immutable.
10. Query memo живёт в одном pinned EvaluationView.
11. Negative cache требует completeness/evidence.
12. `UNKNOWN` не превращается в permanent negative.
13. Operational snapshot selection участвует в key.
14. Freshness/source-policy version участвует в view fingerprint.
15. `now` result нельзя cache бессрочно только по data revision.
16. Persisted diagnostic artifact не удаляется как current cache entry.
17. Projection cache не нужен первому backend.
18. Failed canonical mutation не создаёт новую committed semantic revision.
19. Cache technical failure не меняет network verdict.
20. Cross-query cache вводится после profiler/metrics.
21. In-process cache может быть полностью потерян при restart container без потери correctness.
22. Distributed invalidation не проектируется до реальной необходимости.

## Core architecture complete

На этом ветка `02. Граф сети` достаточна для начала реализации core backend.

Следующий шаг — **не новый архитектурный документ**, а implementation milestone для Codex.

Минимальный первый vertical slice:

```text
Docker Compose
├── PostgreSQL
└── backend

backend
├── migrations
├── canonical L1 tables
├── CanonicalRepository
├── minimal EvaluationView
├── Evidence JSON model
├── L1 Resolver
└── HTTP API

tests
├── schema invariants
├── simple cable path
├── passive pass-through
├── branching
├── loop protection
├── UNKNOWN vs validation error
└── evidence assertions
```

Implementation constraints: [[00-implementation-constraints|00. Ограничения реализации]].
