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

## UI-SHELL.1 — application shell и product surfaces

**FIXED для текущей frontend architecture; network/API semantics не меняются**

Frontend использует client-side routing и reusable application shell с основной
sidebar navigation. Текущие маршруты:

```text
/
    -> redirect /map

/map
/infrastructure/objects
/infrastructure/objects/new
/infrastructure/objects/:physicalObjectId
```

Текущая product model:

```text
Map
    projection/read/exploration surface

Catalog
    canonical data management через существующие public read/write operations

Trace Command Bar
    planned primary trace interaction surface; не реализован в UI-SHELL.1
```

`/map` получает только `TopologyProjectionDocument`, сохраняет frontend-owned
layout и использует canonical `PhysicalObject` source refs для URL `focus` и
переходов между projections/pages. Quick Inspector показывает bounded context и
не содержит canonical create/edit forms.

Первый Catalog list временно переиспользует public `L1 / PHYSICAL_OBJECT`
projection как bounded object list. Object Detail загружает authoritative
`PhysicalObjectDetailsDocument` и переиспользует W.2/W.3/W.6/W.6.1/W.7 detail
sections/datasources. Full-page creation переиспользует W.1 и W.5 operations.
Это frontend reuse текущих public boundaries, а не новый backend catalog API и
не frontend raw join.

Историческое размещение W.1-W.7 forms внутри большого map inspector superseded
этим разделением. Их FIXED API, transaction и canonical identity semantics не
изменяются.

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

## B.UI.2 — public device details read model

`GET /v1/topology/devices/{physical_object_id}` возвращает bounded
`DeviceDetailsDocument` для inspector выбранного DEVICE projection node. Документ
содержит устройство, его интерфейсы по явным
`NetworkInterfacePhysicalOwner`, адреса через `L3Binding`/`InterfaceAddress`,
числа L2/L3 bindings и направлений `NetworkInterfaceRealization`, а также только
фактически существующие direct `InterfacePhysicalBinding`.

```text
DeviceDetailsDocument
    schema_version
    device: DeviceDetails
    interfaces: DeviceInterfaceDetails[]
    gaps[]
    warnings[]

DeviceDetails
    source_ref
    label
    label_source?

DeviceInterfaceDetails
    interface_ref
    label
    label_source?
    addresses: InterfaceAddressDetails[]
    l2_binding_count
    l3_binding_count
    direct_physical_bindings: InterfacePhysicalBindingDetails[]
    realization_down_count
    realization_up_count
    source_refs[]
```

Это presentation read-model: canonical source refs сохраняются, но frontend не
должен самостоятельно join-ить raw domain tables. Технические labels помечаются
`TECHNICAL_FALLBACK`; существующий `alias.display` используется как primary
label без изменения canonical identity. Endpoint не вводит workspace semantics
или новые network/core relations; до workspace API он читает implicit default
workspace.

## W.1 — первое canonical создание устройства

**FIXED**

Public operation:

```text
POST /v1/topology/devices
    CreateNetworkDeviceRequest
        display_name
        initial_interface.display_name
    -> 201 DeviceDetailsDocument
```

Одна transaction атомарно создаёт `PhysicalObject`, его `alias.display`, первый
`NetworkInterface`, его `alias.display` и `NetworkInterfacePhysicalOwner`.
Operation не создаёт `ConnectionPoint`, physical binding, L2/L3 facts или IP.

UI вызывает только этот public endpoint. В текущем UI-SHELL.1 operation
размещена на full-page Catalog create flow; после success UI переходит на detail
route по canonical PhysicalObject source ref. Созданный объект не является
optimistic/fake presentation object и после browser reload снова приходит из
canonical backend. Прежнее размещение формы на карте superseded.

## W.2 — добавление NetworkInterface устройству

**FIXED**

Public operation:

```text
POST /v1/topology/devices/{physical_object_id}/interfaces
    CreateDeviceInterfaceRequest
        display_name
    -> 201 DeviceDetailsDocument
```

Одна transaction проверяет существование `PhysicalObject` и атомарно создаёт
только `NetworkInterface`, его `alias.display` и
`NetworkInterfacePhysicalOwner`. Operation не создаёт `ConnectionPoint`,
physical/realization binding, L2/L3 facts или IP. Совпадающие display names не
являются canonical uniqueness constraint.

UI запускает operation из секции интерфейсов Object Detail Page. После success
он обновляет Device Details и relevant projection из backend, сохраняя тот же
canonical PhysicalObject; optimistic/fake interface не создаётся. Прежнее
размещение секции в map inspector superseded.

## W.3 — первое физическое соединение интерфейсов

**FIXED**

Public user-intent operation:

```text
POST /v1/topology/physical-links
    source_interface_id
    target_interface_id
    cable_display_name?
    -> 201 PhysicalConnectionCreationDocument
```

Bounded operation принимает два разных существующих `NetworkInterface` с
явными physical owners и без direct `InterfacePhysicalBinding`. Одна transaction
создаёт для каждого интерфейса атомарную device `ConnectionPoint`, две конечные
точки cable `PhysicalObject`, обе direct bindings и три `Connection`, каждый с
единственным явным `ConnectionMember` `1↔1`. Optional имя кабеля хранится как
существующий `alias.display` PhysicalObject metadata.

`PhysicalLink` не становится canonical entity. Operation не создаёт
realization, L2/L3/IP или другие network facts. После success UI заново загружает
Device Details и DEVICE projection; edge появляется только как derived backend
projection над созданным L1 path.

## W.4 — первая физическая L1-карта

**FIXED**

Существующий public `POST /v1/topology/projection` поддерживает две bounded
комбинации layer/detail:

```text
L2 / DEVICE
L1 / PHYSICAL_OBJECT
```

`L1 / PHYSICAL_OBJECT` представляет каждый canonical `PhysicalObject`, включая
passive объекты без `NetworkInterface`. Node показывает `alias.display` либо
deterministic fallback, количество собственных `ConnectionPoint` и количество
интерфейсов по explicit `NetworkInterfacePhysicalOwner`.

Physical edge выводится только из explicit `Connection` и его
`ConnectionMember` между `ConnectionPoint` разных `PhysicalObject`. Relations
между одной парой объектов агрегируются с сохранением supporting canonical refs;
внутренняя связь двух точек одного объекта не создаёт self-loop. UI переключает
logical/physical projections через общий `TopologyDataSource` и сохраняет node
selection только по совпадающей canonical `PhysicalObject` source ref.

## W.5 — создание физического объекта с первой точкой

**FIXED**

Public read/write boundary:

```text
GET  /v1/topology/physical-objects/{physical_object_id}
    -> PhysicalObjectDetailsDocument

POST /v1/topology/physical-objects
    display_name
    initial_connection_point.display_name
    -> 201 PhysicalObjectDetailsDocument
```

Одна transaction создаёт только `PhysicalObject`, его `alias.display`, одну
`ConnectionPoint` с `cardinality=1` и её `alias.display`. Operation не создаёт
`NetworkInterface`, binding, `Connection`, L2/L3/IP facts или новый canonical
тип passive object. Details document возвращает factual counts для owned
interfaces, incident connections и direct interface bindings.

UI предоставляет operation на full-page Catalog create flow, после success
переходит на canonical Object Detail route и показывает именованную точку через
bounded details API. Relevant `L1 / PHYSICAL_OBJECT` projection позднее
загружается обычным read flow. Optimistic physical nodes не создаются. Прежнее
размещение operation только в Physical map mode superseded.

## W.6 — соединение физических endpoints

**FIXED**

Существующий W.3 interface-to-interface endpoint остаётся совместимым. Для
последовательной сборки L1 composition добавлена adjacent public operation:

```text
POST /v1/topology/physical-connections
    source: PhysicalEndpoint
    target: PhysicalEndpoint
    cable_display_name?

PhysicalEndpoint =
    NETWORK_INTERFACE(network_interface_id)
    | CONNECTION_POINT(connection_point_id, member_index=1)
```

W.6 ограничен `cardinality=1` / member `1`. Для unbound
`NetworkInterface` transaction создаёт owning device `ConnectionPoint` и
`InterfacePhysicalBinding`; для `ConnectionPoint` используется ровно выбранная
canonical точка. Затем та же transaction создаёт cable `PhysicalObject`, две
его точки и три explicit `Connection` с member mapping `1↔1`.

Наличие существующей `Connection` у passive `ConnectionPoint` не означает, что
точка занята: через неё разрешено строить последовательную physical composition.
Уже имеющий direct binding `NetworkInterface` автоматически не перепривязывается.
Operation не создаёт L2/L3/IP facts. UI запускает её из PhysicalObject detail
section на Object Detail Page и после success заново получает nodes/edges и
details только через public API. Прежнее размещение в Physical map inspector
superseded.

## W.6.1 — классификация PhysicalObject

**FIXED**

Bounded metadata materialization поддерживает optional непустую строку `class`
только для `PhysicalObject`. Она возвращается в `PhysicalObjectDetailsDocument`
и в `attributes.class` L1 projection без вывода из aliases, counts или
connectivity. `PUT /v1/topology/physical-objects/{id}/class` идемпотентно меняет
значение; create physical object принимает optional `class`, а новые cable
objects из W.3/W.6 получают explicit `class=cable`. Отсутствующий class остаётся
валидным и существующие объекты автоматически не классифицируются.

## W.7 — добавление ConnectionPoint

**FIXED**

```text
POST /v1/topology/physical-objects/{physical_object_id}/connection-points
    display_name
    -> 201 PhysicalObjectDetailsDocument
```

Одна transaction создаёт только owning `ConnectionPoint` с `cardinality=1` и
его `alias.display`. Совпадающие display names разрешены; operation не создаёт
`Connection`, cable, interface/binding или L2/L3/IP facts. UI после success
использует authoritative details response на Object Detail Page, заново
загружает L1 projection и сохраняет тот же canonical `PhysicalObject` route.
Прежнее размещение в map inspector superseded.

## L2.1a — создание одного forwarding context

```text
POST /v1/l2/forwarding-contexts
    bindings[]
        interface_id
        ingress_exact_stacks[]
        egress_emit_stack?
    -> L2ForwardingContextCreationDocument
```

Одна transaction создаёт один `L2ForwardingContext`, по одному `L2Binding` на
каждый уникальный interface и ровно запрошенные exact ingress/optional egress
rules. Пустой stack `[]` означает untagged representation; `null` у
`egress_emit_stack` означает отсутствие `L2EgressRule`. Response возвращает
только authoritative refs созданных context/binding/rule facts. Операция не
создаёт L1/L3/IP/MAC или canonical aliases и не меняет L2 resolver semantics.

## L2.1b — untagged context из Object Detail

Для active device с двумя или более owned `NetworkInterface` Object Detail
показывает bounded форму `L2 forwarding` → `Создать untagged context`. Пользователь
выбирает минимум два interface только из authoritative Device Details текущего
`PhysicalObject`; каждый выбранный interface отправляется как
`{ interface_id, ingress_exact_stacks: [[]], egress_emit_stack: [] }`.
`[]` означает untagged Ethernet representation. UI не вводит VLAN, canonical VLAN,
access/trunk или дополнительную frontend L2-semantics; context остаётся локальной
canonical сущностью backend.

После подтверждённого 201 UI показывает краткий success и technical
`forwarding_context_ref`, затем заново загружает Device Details. `l2_binding_count`
отображается только из этого authoritative refresh; optimistic binding не создаётся.
Count может быть показан как factual context, но не определяет membership и не
блокирует выбор: backend остаётся authority по uniqueness. Existing contexts после
reload намеренно не показываются — public L2 list/detail API пока отсутствует.

## BLUEPRINT.1 — persisted object blueprints

`ObjectBlueprint` и immutable initial `ObjectBlueprintVersion` — authoring/presentation
records, не canonical topology facts и не вход resolver semantics. Version хранит только
explicit `RECTANGLE` body и explicit slots/internal links; будущий editor может генерировать
повторяющиеся группы, но persisted version всегда хранит развёрнутые stable slots.

Instantiate атомарно materializes отдельный canonical `PhysicalObject`, его aliases/class,
ConnectionPoints, а для `NETWORK_PORT` — NetworkInterface, owner и direct physical binding.
Explicit internal links materialize ordinary canonical `Connection`/`ConnectionMember`; geometry
или стороны anchors никогда не создают L1 связи. Persisted slot-to-canonical endpoint mappings
сохраняют provenance каждого instance. List/detail/editor и новые version отсутствуют в этом slice.
