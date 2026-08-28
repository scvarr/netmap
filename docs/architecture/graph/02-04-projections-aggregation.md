# 02.4 Projections и aggregation

## Статус

Согласованная модель presentation/read projections NetMap.

Эта ветка **не добавляет новую network semantics**.

Projection отвечает только на вопрос:

> Как выбранные canonical facts и derived evidence представить пользователю/API на нужном уровне детализации?

Связанные заметки:

- [[architecture/graph/02-graph|02. Граф сети]];
- [[architecture/graph/02-03-derived-graphs|02.3 Derived graphs и evidence]];
- [[architecture/presentation/05-presentation|05. Представление]].

## Основной принцип

```text
canonical facts / TraceArtifact
        |
        v
ProjectionSpec
        |
        v
ProjectionGraph / projection document
```

Projection является derived read model.

Она не является topology source of truth.

## Layer и detail — разные измерения

Нельзя связывать:

```text
L1 = детально
L3 = крупно
```

как обязательное правило.

Можно иметь:

```text
L1 / site overview
L1 / fiber member detail

L2 / site overview
L2 / interface/context detail

L3 / site overview
L3 / route/next-hop detail
```

Поэтому projection request минимум логически содержит:

```text
layer
detail level
scope
```

независимо.

## ProjectionSpec

Conceptual request:

```text
ProjectionSpec
    source
    scope
    layer?
    detail_level
    grouping?
    filters?
    overlays?
```

`source` может быть:

```text
EvaluationView
TraceArtifact
```

или сочетанием canonical view + selected trace overlay.

Точная API schema определяется implementation milestone.

## Scope

Projection не обязана загружать всю сеть.

Scope может быть:

```text
Location subtree
PhysicalObject subtree
selected entities
routing context
L2 context
trace artifact
explicit bounding set
```

Resolver semantics не зависит от UI scope.

## ProjectionNode

```text
ProjectionNode
    id
    kind
    display
    source_refs[]
    attributes
    status?
```

`source_refs` указывает на canonical/derived entities, которые node представляет.

Projection node ID не является canonical entity ID.

## ProjectionEdge

```text
ProjectionEdge
    id
    kind
    from
    to
    source_refs[]
    attributes
    status?
```

Edge может представлять:

```text
one exact canonical relation
```

или:

```text
aggregate of many relations/evidence paths
```

Тип должен позволять различить эти случаи.

## Exact projection

На максимальной детализации projection может почти один-в-один показывать canonical structure.

Например L1:

```text
ConnectionPoint/member
    ->
ConnectionMember
    ->
ConnectionPoint/member
```

Но даже в этом режиме presentation node остаётся view object.

## Aggregation

Aggregation схлопывает несколько underlying entities/states в один presentation object.

Примеры:

```text
ports -> device
devices -> rack
racks -> room/site

multiple physical links -> aggregate device edge
multiple trace steps -> one hop summary
multiple L2 contexts -> site-level relation
```

Aggregation не изменяет canonical graph.

## Aggregate node

```text
AggregateNode
    projection id
    member_refs[]
    grouping_basis
```

`grouping_basis` должен быть явным.

Примеры:

```text
same PhysicalObject
same Location subtree
same routing context
explicit UI group
```

Нельзя группировать entities только потому, что их aliases похожи.

## Aggregate edge

Aggregate edge означает:

> между members группы A и members группы B существуют underlying relations/paths, подходящие данной projection.

Он **не означает**:

```text
существует один canonical Connection A-B
```

## Aggregate edge evidence

Edge должен иметь возможность раскрыть:

```text
supporting source_refs
supporting trace edge refs
counts
status aggregation
```

Например:

```text
SITE-A <-> SITE-B
    physical links: 4
    active: 3
    unknown: 1
```

## Aggregation не должна скрывать UNKNOWN

Если aggregate включает:

```text
2 confirmed paths
1 unknown path
```

UI может показать compact summary, но underlying uncertainty должна оставаться доступной.

Нельзя автоматически агрегировать в:

```text
all OK
```

только потому, что существует один healthy member.

## Status aggregation зависит от projection purpose

Для разных views возможны разные summaries:

### Availability-style

```text
ANY_REACHABLE
ALL_REACHABLE
PARTIAL
UNKNOWN
```

### Inventory-style

```text
count
known/unknown members
```

### Trace-style

```text
confirmed path
alternate branch
unknown branch
blocked branch
```

Поэтому generic projection layer не должен иметь один universal `edge_status` algorithm.

Status policy является частью `ProjectionSpec`.

## Trace overlay

TraceArtifact может отображаться поверх topology projection.

Например:

```text
base projection:
    devices/sites

overlay:
    used path
    blocked rule
    NAT step
    unknown frontier
```

Overlay ссылается на evidence node/edge IDs.

Он не создаёт canonical relations.

## Multiple traces

UI может сравнивать несколько saved/current traces.

Каждый overlay сохраняет собственный:

```text
trace_id/view fingerprint
```

Нельзя смешивать их evidence как один current fact set.

## Filtering

Projection filters могут скрывать:

```text
metadata
inactive entities
layers
alternate branches
passive detail
```

Filter — presentation operation.

Скрытый object не считается отсутствующим для resolver semantics.

## Hide vs collapse

Полезно различать:

```text
hide:
    entity не показана

collapse:
    entity включена в aggregate node/edge
```

Для explainability collapse предпочтительнее, когда скрытые entities участвуют в показанном path.

## Projection path continuity

Если intermediate entities collapse, projection должна сохранять связь с underlying evidence path.

Например:

```text
SW1 -> patch panel -> fiber -> SW2
```

может отображаться:

```text
SW1 ===== SW2
```

но edge раскрывается до всех supporting L1 facts.

## Editing

По умолчанию aggregate projection **не является write API**.

Нельзя:

```text
PATCH aggregate SITE-A--SITE-B
```

и ожидать, что backend угадает, какие 12 canonical connections надо изменить.

Write operation должна target'ить конкретные canonical IDs/relations.

## UI convenience write

Позднее UI может предложить high-level operation:

```text
move selected objects to location X
```

Но она должна явно раскрыться в набор canonical mutations и пройти validation/confirmation.

Projection itself не становится editable source.

## Stable presentation identity

В рамках одного ProjectionSpec полезны deterministic IDs.

Например derived hash:

```text
projection spec
+
sorted source refs
+
projection kind
```

Но эти IDs:

- не canonical;
- могут измениться при изменении grouping/spec;
- не используются resolver'ами.

## Determinism

Одинаковые:

```text
input view/artifact
ProjectionSpec
projection implementation version
```

должны давать semantic-equivalent projection.

Порядок unrelated arrays для UI может быть stable-sort для удобства tests.

## Projection API

Первый backend может иметь простой endpoint conceptual вида:

```text
GET/POST projection
```

с request:

```text
scope
layer
detail
grouping
filters
trace overlay?
```

Но полноценный topology UI не является requirement Milestone 1.

## Evidence dereference

Projection object должен ссылаться на canonical/evidence refs.

UI сможет:

```text
click aggregate edge
    ->
show supporting relations/path
```

без повторного угадывания topology.

## Не materialize все projections

Projection обычно строится query-time.

Не надо заранее сохранять:

```text
every site projection
every rack projection
every layer/detail combination
```

Если конкретный projection окажется дорогим и популярным, его можно кэшировать позднее.

## Location projection

`Location` tree особенно удобна для aggregation.

Пример:

```text
country
  site
    building
      room
        rack
```

Но backend не знает semantic fixed levels.

Projection группирует по выбранному ancestor/depth/path rule.

## PhysicalObject projection

Physical containment:

```text
chassis
  module
    transceiver
```

может collapse в parent object на крупном zoom.

`parent_object_id` и Location остаются независимыми grouping dimensions.

## NetworkInterface projection

Interfaces можно:

```text
show individually
collapse into owner
collapse LAG members into aggregate NI
```

Но collapse не уничтожает realization evidence.

## L2 projection

Возможные presentation nodes:

```text
NetworkInterface
L2ForwardingContext
PhysicalObject owner
derived L2 reachability group
```

Выбор зависит от detail level.

Derived L2 reachability group остаётся projection/read result.

## L3 projection

На крупном уровне:

```text
RoutingContext / routing node
```

может представлять множество interfaces/routes.

На trace overlay показываются selected routes/next hops, а не вся routing table.

## Security/NAT projection

Security/NAT удобнее отображать как trace annotations/stages:

```text
FW01
    rule 153 PERMIT

DNAT
    public -> private
```

Не обязательно превращать каждое правило firewall в постоянный node topology map.

## Projection и source completeness

Presentation может показывать completeness indicators:

```text
partial data
stale observation
unknown coverage
```

Эти значения приходят из EvaluationView/evidence.

Projection не вычисляет completeness заново по отсутствию объектов.

## Empty projection

Пустой result может означать:

```text
scope действительно пуст
filter всё скрыл
data unknown/incomplete
```

API должен различать эти случаи через metadata/gaps.

## Инварианты

1. Projection является derived read model.
2. Projection не добавляет network semantics.
3. Layer и detail level независимы.
4. Projection имеет explicit scope.
5. Projection node/edge identity не заменяет canonical ID.
6. Every meaningful projection object имеет source/evidence refs.
7. Aggregate node содержит explicit member refs/grouping basis.
8. Aggregate edge не является canonical Connection.
9. Aggregation не должна терять underlying UNKNOWN/conflict.
10. Status aggregation является projection policy, а не universal resolver rule.
11. Trace overlay сохраняет trace/evidence identity.
12. Filter не влияет на resolver truth.
13. Collapse сохраняет supporting path refs.
14. Aggregate projection по умолчанию read-only.
15. High-level write должен раскладываться в explicit canonical mutations.
16. Projection IDs могут быть deterministic, но остаются derived.
17. Projection строится query-time по умолчанию.
18. UI может раскрыть aggregate до supporting canonical/evidence refs.
19. Completeness/freshness приходят из underlying view/evidence, а не выводятся presentation layer.
20. Полноценный frontend не требуется для первого backend milestone.

## Следующий шаг

[[architecture/graph/02-05-cache-invalidation|02.5 Cache и invalidation]] фиксирует последнюю core backend policy: cache является только оптимизацией и не должен усложнять первую реализацию до появления measurements.
