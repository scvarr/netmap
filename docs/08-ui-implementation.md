# 08. UI implementation contract

## Статус

Рабочий implementation contract frontend NetMap. Документ не меняет network semantics.

Связанные документы: [[05-presentation|05. Представление]], [[02-04-projections-aggregation|02.4 Projections]], [[07-workspaces|07. Workspace]].

## Ownership

**FIXED**

UI и backend развиваются параллельно и не изменяют внутренние файлы друг друга.

```text
frontend/**     UI implementation
app/**          backend implementation
alembic/**      backend storage implementation
```

Общие файлы вроде `compose.yaml` и корневых docs меняются минимально после чтения актуального `main`.

Если UI требует новых данных от backend, сначала фиксируется public API/DTO requirement. UI не читает PostgreSQL напрямую, не импортирует SQLAlchemy models и не зависит от internal repository methods.

## Frontend stack

**FIXED для первого UI implementation**

```text
React + TypeScript + Vite
React Flow (@xyflow/react)
```

Первому UI не требуется SSR/full-stack frontend framework.

## U.1 — первая логическая схема

**FIXED**

Первый UI slice — логическая device-to-device topology map без геометрической привязки к Location.

Первый fixture:

```text
SW-A-F1 --\
           CORE-A ---- EDGE-A ---- CORE-B
SW-A-F2 --/                    /      \
                              SW-B-F1  SW-B-F2
```

`Корпус A` и `Корпус B` в U.1 могут использоваться как scope labels, но не определяют screen coordinates.

U.1 поддерживает:

- pan/zoom;
- fit view;
- выбор node/edge;
- inspector выбранного элемента;
- label/kind/status;
- technical `source_refs`;
- deterministic initial layout;
- loading/empty/error states;
- backend health indicator.

Canonical editing, trace overlay и nested Location areas в U.1 не требуются.

## Frontend data-source boundary

**FIXED**

Graph components работают через frontend interface:

```text
TopologyDataSource
    loadProjection(request)
        -> TopologyProjectionDocument
```

U.1 использует `FixtureTopologyDataSource` с deterministic local fixture.

Позднее `ApiTopologyDataSource` заменяет fixture без изменения canvas/node/edge components.

Fixture не является canonical source of truth.

## B.UI.1 — public backend requirement

**REQUIRED API/DTO; реализация принадлежит backend**

UI требуется public topology projection API. Exact transport endpoint определяется backend milestone, но semantic DTO должен соответствовать existing projection contract.

Workspace выбирается application/request layer до projection evaluation согласно `07-workspaces`; workspace selection не является полем `ProjectionSpec`.

### TopologyProjectionRequest

```text
TopologyProjectionRequest
    layer: L1 | L2 | L3
    detail_level: DEVICE
    scope:
        include_location_subtrees[]
        include_entities[]
    grouping?
    filters?
```

`include_entities` содержит canonical refs. Scope entries образуют explicit include-set.

Для первого B.UI.1 backend пустые `include_entities` и
`include_location_subtrees` означают unbounded scope только внутри canonical
model, видимой уже выбранному workspace-scoped repository/session.

### ProjectionSourceRef

```text
ProjectionSourceRef
    ref_type
    entity_type
    entity_id
```

Первый backend может поддерживать только `CANONICAL_FACT`, но projection ID не равен canonical entity ID.

### TopologyProjectionNode

```text
TopologyProjectionNode
    id
    kind
    label
    source_refs[]
    attributes
    status?
```

### TopologyProjectionEdge

```text
TopologyProjectionEdge
    id
    from_node_id
    to_node_id
    kind
    aggregate
    source_refs[]
    attributes
    status?
```

`aggregate=true` означает supporting relations/path, а не один canonical `Connection`.

### TopologyProjectionDocument

```text
TopologyProjectionDocument
    schema_version
    layer
    detail_level
    nodes[]
    edges[]
    gaps[]
    warnings[]
```

## Layout ownership

**FIXED**

Logical topology API не возвращает обязательные screen coordinates.

Backend определяет nodes/edges и supporting facts. UI определяет их размещение на canvas.

`x/y/width/height` logical topology не являются canonical network facts. Saved/manual layout позднее может существовать как presentation state.

## Projection-oriented DTO

**FIXED**

Topology UI не должен получать набор raw domain tables и самостоятельно воспроизводить projection/resolver semantics.

Raw canonical endpoints могут позднее использоваться editors/inspectors, но topology canvas получает projection-oriented DTO.

## Workspace transition

**FIXED**

До реализации workspace API backend считается implicit default workspace. Frontend data-source abstraction готова к workspace selection, но U.1 fixture может использовать `default` без backend dependency.

## Docker/Compose

**FIXED**

Frontend остаётся Docker-first. После появления frontend container общий `compose.yaml` получает один минимальный `frontend` service. Backend Dockerfile/container не переделываются ради UI. Host не требует установленного Node.js.

## Acceptance U.1

1. Есть отдельный `frontend/` React/TypeScript app.
2. Frontend собирается в container.
3. Логическая fixture topology отображается на canvas.
4. Работают pan/zoom/fit/select.
5. Работает node/edge inspector.
6. UI не импортирует backend Python code и не читает DB.
7. Data access скрыт за `TopologyDataSource`.
8. Fixture можно заменить API adapter без переписывания graph components.
9. `/health` отображается как connection status.
10. Есть базовые frontend tests для data-source/DTO mapping и inspector interaction.
11. UI milestone не меняет `app/**` или `alembic/**`.

## Следующий slice

После U.1 предпочтительный U.2 — Location hierarchy / nested-area view на тех же projection/source-ref principles.
