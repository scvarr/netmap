# 08. UI implementation contract

## Статус

Рабочий implementation contract frontend NetMap. Документ не меняет network
semantics. Он фиксирует одновременно архитектурные boundaries и фактически
materialized subset на `main` после MAPS.2b; текст о будущих controls не следует
читать как описание уже существующего product surface.

### Фактический срез реализации

**IMPLEMENTED subset**

SavedMap Physical/L1 also supports direct visual canonical wiring: select two
authoritatively free cardinality=1 ConnectionPoints, confirm, then materialize
the cable through the existing physical-endpoint connection boundary. A failed
post-write projection refresh retries only the read, never the canonical write.

Canonical/resolver core существенно опережает UI. Backend materializes и
тестирует canonical L1/L2/L3, trace, routing, security, NAT, evidence и
projection contracts, но frontend пока не является универсальным editor или
trace workbench для всех этих domains. Реализованные UI surfaces: Saved Map
Physical/Logical presentation, Catalog/Object Detail, Object Library/Blueprint
editor и bounded `PhysicalObject -> PhysicalObject` L1 Trace Command Bar с
опциональным уточнением exact `ConnectionPoint`, явными alternatives и
evidence-based overlay на Physical map. Карта не владеет
canonical topology: она читает public projection DTO и SavedMap presentation
state.

The authoritative SavedMap read also contains `cable_routes`: each record is a
canonical Cable ref, explicit `L1/PHYSICAL_OBJECT` view and an
ordered list of finite flow-coordinate `{x, y}` waypoints. `PUT
/v1/maps/{map_id}/cable-routes/{cable_id}` replaces the complete list (including
an explicit empty list); DELETE removes the record, so no-route remains distinct
from zero waypoints. The route is SavedMap-owned presentation state, independent
of `MapPlacement` and canonical topology. In a Physical SavedMap, a collapsed
cable with the exact canonical cable identity renders that current route after
topology layout: its known endpoint anchors (or existing truthful floating
fallback) are joined through the stored waypoints in order. Rendering does not
write or infer geometry. The selected drawable cable exposes a bounded route
editor: add point then click the canvas appends before the target, drag moves a
draft point, delete removes the selected draft point, and Save issues one full
route PUT. Cancel leaves the authoritative map untouched; an empty saved draft
is an explicit straight route. Reset deletes only the route record, with a
refresh-only retry after a successful DELETE.

Связанные документы: [[architecture/presentation/05-presentation|05. Представление]], [[architecture/graph/02-04-projections-aggregation|02.4 Projections]], [[architecture/workspaces/07-workspaces|07. Workspace]], [[reviews/09-ui-ux-review|09. Рабочий L1 UI/UX review]], [[plans/09-01-l1-spatial-foundation-plan|09.1 План завершения L1 spatial foundation]].

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

## Frontend localization

The frontend owns a small typed localization boundary in
`frontend/src/i18n.tsx`. It supports `ru` (the default) and `en`, persists the
user choice in `localStorage`, updates `<html lang>`, and exposes `useI18n()`
for translated presentation strings, interpolation, and locale-aware sorting.
Do not add a general i18n framework unless the supported locales or formatting
requirements make this boundary insufficient. New user-facing frontend strings
must be added as message keys and rendered through this boundary. Canonical
tokens, UUIDs, API fields, routes, enum values, and backend-provided names,
warnings, and errors remain locale-neutral data.

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
/library/object-blueprints
/library/object-blueprints/new
/library/object-blueprints/:blueprintId/versions/:versionId/edit
```

Текущая product model:

```text
Map
    projection/read/exploration surface

Catalog
    canonical data management через существующие public read/write operations

Trace Command Bar
    current PhysicalObject → PhysicalObject L1 trace command,
    optionally refined by exact ConnectionPoint
```

`/map?map=<SavedMap UUID>&view=physical` first loads its explicit SavedMap
presentation scope, then obtains `TopologyProjectionDocument` only for its
placed canonical `PhysicalObject` refs. An empty map never sends an empty
projection scope. The Saved Map is presentation state, not a canonical topology
filter stored in resolvers: `MapPlacement` means explicit non-cable membership,
and `MapViewPosition` holds independent `L1/PHYSICAL_OBJECT` and `L2/DEVICE`
coordinates. It uses canonical `PhysicalObject` source refs for URL `focus` and
переходов между projections/pages. Quick Inspector показывает bounded context и
не содержит canonical create/edit forms.

Physical and Logical are separate presentation scenes (`<map-id>/physical` and
`<map-id>/logical`). Coordinate-only changes keep the same scene, viewport and
ELK result; acknowledged per-view writes update local SavedMap state without a
projection reload. Authoritative failed-write rollback reloads only the map
positions. A map/view switch creates a new scene and performs one initial fit;
server-side viewport persistence is not implemented.

On a Physical Saved Map, the user action is «Добавить на карту»: it creates a
`MapPlacement` for an existing PhysicalObject and its initial physical
position; it never creates or clones topology. The shared searchable picker
loads candidates exclusively from `CatalogInventoryDataSource.equipment`, so
cables are unavailable and already placed objects are excluded. Toolbar
insertion captures the current Physical React Flow viewport center; an
empty-pane context action captures the cursor's converted flow coordinate.
After the placement write, the current Saved Map is authoritatively reloaded;
the picker stays open with a refresh-only retry if that reload fails. A
same-scene insertion does not refit the viewport or change map/view identity.

Текущий `InfrastructureObjectsPage` временно продолжает переиспользовать public
`L1 / PHYSICAL_OBJECT` projection как object list. Для следующего Catalog
Equipment/Cables UI уже materialized отдельный bounded catalog read model
`GET /v1/catalog/inventory` (frontend transport: `/api/v1/catalog/inventory`):

```text
CatalogInventoryDocument
    schema_version
    equipment[]
        physical_object_ref, label, label_source?, class?
        occupancy? { total_ports, connected_ports, free_ports }
        map_memberships[] { map_ref, name }
    cables[]
        cable_ref, label, label_source?, resolution
        endpoint_a?/endpoint_b?
            remote_physical_object_ref + label
            remote_connection_point_ref + label
            evidence_refs[]
        gaps[], warnings[]
    gaps[], warnings[]
```

Equipment is every `PhysicalObject`; Cable is a separate descriptive relation
catalog entry and is not represented by a `class="cable"` PhysicalObject.
Occupancy is emitted only when every owned `ConnectionPoint` has cardinality
one; it counts points with external canonical `Connection` occupancy, excluding
same-object internal links, and never counts `NetworkInterface`s. Map
memberships are only explicit `MapPlacement` facts joined to `SavedMap`; they do
not participate in topology resolution. Cable records are emitted only when a
canonical Cable and its one Connection
exist. Exact two endpoints are the Connection's two ConnectionPoints; no
endpoint is guessed. The endpoint order is stable but has no
directional meaning. This read model is bulk-resolved from canonical and
presentation query boundaries, not by L1 projection or per-object/map detail
requests. `/infrastructure/objects` now uses this datasource exclusively: one
guarded catalog load per initial/retry/authoritative post-delete refresh, with
no topology-projection fallback. The Catalog has Equipment and Cables tabs.
Equipment shows class, trustworthy `connected / total` port occupancy (or an
unknown state), explicit SavedMap links, and bounded client-side
name/class/map search and filters. Cables show only proven Cable-backed
Connection endpoints; cable search and resolution filtering are client-side.
Map links use the placed object and map identity directly:
`/map?map=<SavedMap UUID>&view=physical&focus=<PhysicalObject UUID>`.
Deletion preserves the existing cable-specific confirmation and reloads the
authoritative catalog only after a successful operation.

Catalog additionally provides a bounded PhysicalObject display rename on both
tabs. `PUT /v1/topology/physical-objects/<PhysicalObject UUID>/display-name`
updates or creates exactly one `EntityMetadata(key="alias.display")` value;
it never changes the canonical PhysicalObject UUID, class metadata, points,
connections, blueprint provenance, or map placements. A successful Catalog
write is followed by an authoritative catalog reload rather than a local row
mutation, so labels, natural ordering, search, and Cable endpoint labels
are refreshed together. If that reload fails, the last confirmed document is
shown with an explicit retry/error state rather than presenting the rename as
authoritatively refreshed.

Object Detail загружает authoritative
`PhysicalObjectDetailsDocument` и переиспользует W.2/W.3/W.6/W.6.1/W.7 detail
sections/datasources. Primary full-page creation materializes exact immutable
Object Blueprint version; W.1 и W.5 остаются явным advanced/manual path. Это
frontend reuse текущих public boundaries, а не новый backend catalog API и не
frontend raw join.

Object Detail показывает Saved Map membership только из authoritative
`CatalogInventoryDataSource.equipment[].map_memberships`: каждая map link несёт
exact `SavedMap` identity, а отсутствие membership не превращается в generic
focus link. Cables не имеют explicit `MapPlacement` UI.

Object Detail может передать existing equipment на explicit SavedMap через
transient navigation intent `add=<PhysicalObject UUID>`. MapPage потребляет его
только после готовности Physical scene и coordinate bridge, требует user
confirmation и использует current viewport center; затем применяется existing
insertion lifecycle. Cables не являются explicit placement candidates.

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

`ApiTopologyDataSource` is the current production adapter. Fixture data remains
for isolated component tests and is not a canonical source of truth.

## B.UI.1 — public backend requirement

**IMPLEMENTED bounded API/DTO; broader layer/detail combinations remain future work**

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
    include_cable_continuations: bool = false
    grouping?
    filters?
```

`include_entities` содержит canonical refs. Scope entries образуют explicit include-set.

Текущий backend поддерживает `L1 / PHYSICAL_OBJECT` и `L2 / DEVICE`; пустые `include_entities` и
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
    l1_off_map_continuations?[]
```

## Layout ownership

**FIXED**

Logical topology API не возвращает обязательные screen coordinates.

Backend определяет nodes/edges и supporting facts. UI определяет их размещение на canvas.

`x/y/width/height` logical topology не являются canonical network facts. Saved
Maps now persist only placement coordinates per supported view; ordinary legacy
and fixture layouts remain frontend presentation state.

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
создаёт необходимые device `ConnectionPoint`, direct bindings, один canonical
`Connection` и optional Cable. Optional cable display metadata относится к
Cable, а не к `PhysicalObject`.

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
interfaces, incident connections и direct interface bindings. L1R.3a also
returns an operational presentation read model: a materialized object has
optional `blueprint_provenance` with `LIBRARY_RECORD` ObjectBlueprint and exact
ObjectBlueprintVersion refs plus `version_number` (manual objects have none).
Each ConnectionPoint retains its canonical ref/counts and adds `ordering_key`
(the stable blueprint `slot_key` for instances), factual `blueprint_slot`
(kind and anchor metadata), named direct interface bindings with evidence refs,
direct internal counterparts, and structured external attachments. Attachments
are exact `DIRECT_CONNECTION`, recognised `CABLE_BACKED_CONNECTION` with its
Cable and far endpoint, or honest `UNRESOLVED`; ambiguous topology never gets a
guessed far peer. The same canonical Cable-backed relation is shared with
ConfiguredTopologyProjectionResolver/off-map continuations.

UI предоставляет operation на full-page Catalog create flow, после success
переходит на canonical Object Detail route и показывает именованную точку через
bounded details API. Relevant `L1 / PHYSICAL_OBJECT` projection позднее
загружается обычным read flow. Optimistic physical nodes не создаются. Прежнее
размещение operation только в Physical map mode superseded.

### L1R.3b — operational Object Detail / Ports

Object Detail renders the existing `PhysicalObjectDetailsDocument` as a compact
operational Ports table rather than a card per `ConnectionPoint`. Active rows
show port, factual status, resolved external attachment(s), direct bound
interface(s), and compact labelled icon actions. The primary list uses natural
numeric-aware ordering only by the user-visible display label; `slot_key`, UUID
and other opaque identity/provenance values do not order it. Per-port technical
refs are not part of this primary table. Cardinality above one shows factual
connection counts only. An occupied cardinality-1 port offers confirmed
disconnect of its exact external canonical relation. For a Cable-backed
relation this atomically deletes the Cable and its Connection; a direct
Connection deletes only the Connection. Neither operation deletes participating
PhysicalObjects or ConnectionPoints. An acknowledged disconnect is followed
only by authoritative refresh/retry.

When every point forms one reciprocal direct internal counterpart, the UI
instead renders each exact pair once as a channel. Non-reciprocal or ambiguous
internal topology remains in the ordinary Ports table. Blueprint instances show
their exact version and link to that library version; they do not offer ordinary
per-instance add-point. The existing add-point operation remains an explicitly
manual/advanced action for non-blueprint objects. This UI consumes L1R.3a only;
it introduces no API, domain, or connectivity semantics.

### L1R.4 — physical cabling lifecycle

The primary W.6 UI is `source port → target PhysicalObject → free physical
port → optional cable name → connect`. It always submits a `CONNECTION_POINT`
endpoint with member `1`; canonical endpoint-kind selection is not exposed in
the normal flow. Existing L1 projection `connection_points` pre-filters target
objects to non-cable objects with a cardinality-1, externally free point other
than the exact source point. The selected object's authoritative details then
provide the naturally ordered, revalidated free-port picker. A label search
filters that bounded projection list. `NETWORK_INTERFACE` remains only as an
explicit advanced path for free interfaces. Backend occupancy errors remain
authoritative and no optimistic connection is materialized.

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
canonical точка. Затем та же transaction атомарно создаёт один canonical
`Connection` и optional Cable; Cable не получает собственных точек или
internal Connection.

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
значение; create physical object принимает optional `class`. Cable не является
PhysicalObject и не получает `class=cable`. Отсутствующий class остаётся
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
сохраняют provenance каждого instance. Current UI/library work builds on this
contract; it does not alter materialization or resolver semantics.

## BLUEPRINT.2 — Object Library and visual editor

Object Library читает public list и exact immutable version detail. Все refs
library records остаются `LIBRARY_RECORD`, а read operations не materialize
topology. Current UI provides list, create, latest-version edit, guarded delete
and instantiate flows; each write uses the matching public operation and reloads
authoritative library state. It does not expose a raw canonical join.

Visual editor создаёт только `RECTANGLE` presentation body с bounded dimensions,
fill `#RRGGBB`, endpoint groups и explicit pair-by-index operation. Groups не
являются persisted backend model: перед `POST` editor детерминированно разворачивает
их в explicit slots с non-overlapping anchor offsets и explicit internal links.
Geometry и side anchor никогда не создают connectivity. `BlueprintPreview` —
изолированный SVG renderer geometry/slots/links, не зависящий от ReactFlow и
готовый для будущего map-node use. После save Library перечитывается авторитетно;
optimistic invented blueprint отсутствует.

The current editor and DTOs intentionally remain this single-body,
`side`/`offset`/`span` contract. Future Port Block composition, `FRONT`/`REAR`
faces, visual face placement, and separate rendered-port/cable-attachment
geometry are architecture-only decisions in
[[architecture/blueprints/09-03-port-block-blueprint-architecture|09.3]]. They are not implemented by
this UI contract and do not add a map view, Saved Map membership, or a current
API field.

## BLUEPRINT.3a — viewport and version lifecycle foundation

`BlueprintPreview` остаётся reusable renderer. Editor помещает его в bounded
presentation viewport: Fit показывает весь real-ratio rectangle, zoom влияет
только на preview scale и никогда не меняет persisted width/height. Library cards
auto-fit в собственном bounded surface без controls.

Каждая immutable version может опционально хранить bounded authoring recipe:
ordered endpoint groups и pair recipes. Это library metadata, не topology fact,
не resolver/materialization semantics и не замена authoritative explicit
slots/internal links. Public create/version operations validate recipe against
generated explicit slots and link pairs; старые versions без recipe сохраняют
read/materialization behavior без попытки reconstruction.

`POST /v1/library/object-blueprints/{blueprint_id}/versions` creates a locked,
next immutable snapshot. List returns one deterministic item per blueprint using
its latest version plus `version_count`; historical details remain addressable.
`DELETE /v1/library/object-blueprints/{blueprint_id}` removes only unused library
records and rejects a blueprint with any materialized instance; it never cascades
into canonical topology.

## BLUEPRINT.3b — edit and safe-delete UI

Library cards expose the latest-version edit route and an explicitly confirmed
delete action. Editing hydrates only the exact version's persisted authoring
recipe; a legacy version without a recipe is clearly non-editable in the
structured editor and is never guessed from slot names. Save produces vN+1 via
the bounded version operation, preserving vN. An optional `blueprint_name` is
renamed atomically with that new version. Delete always reloads the authoritative
library and conflict leaves both the card and all canonical topology untouched.

## L1R.2 — Blueprint editor usability

The editor keeps its existing `BlueprintEditorState`, authoring recipe and
explicit generated slots/internal links, but its primary labels are
human-facing Russian: object type, schematic width/height, color and port
groups. `RECTANGLE` remains the sole current body form and is not a primary
control. A visual color picker and exact `#RRGGBB` input write the same existing
`fill_color` value. UI enum labels do not alter persisted slot kind or anchor
side values.

Pair-by-index is presented as an internal port-pair rule: port N in one group
connects to port N in another. It still produces the existing explicit internal
links and retains current validation. Preview zoom/Fit remains presentation-only
and its counts are Russian user-facing summaries.

## BLUEPRINT.4a — instantiate from Object Library

Library instantiation targets exactly the latest card's displayed immutable
`version_ref` through one public instantiate request. The dialog accepts only an
instance display name. Its strictly validated authoritative `physical_object_ref`
opens Object Detail; the frontend never synthesizes interfaces, points, or
connections. Materialization does not change blueprint versions or card state.

## L1R.1 — template-first object lifecycle

`/infrastructure/objects/new` is the primary Object Blueprint materialization
surface: it loads available library items, lets the user select the exact listed
immutable version, asks only for an instance name, then navigates to the returned
canonical Object Detail. Library card action `Создать объект` is a shortcut to
the same route with that exact blueprint/version preselected; materialization
logic is not duplicated.

If the library is empty, the primary CTA creates the first blueprint. Existing
W.1 NetworkDevice and W.5 PhysicalObject creation forms remain available only
under explicit `Создать вручную` advanced UI. This changes no backend/API/domain
contract and does not assert that a canonical PhysicalObject must have a
blueprint.

История ручного прохода по Object Library и Template Editor зафиксирована отдельно
в [[reviews/09-ui-ux-review|рабочем L1 UI/UX review]]. Открытая последовательность работ
по spatial foundation — в [[plans/09-01-l1-spatial-foundation-plan|плане L1S]]. Ни один
из этих документов не меняет implementation contract и не объявляет будущие
product capabilities реализованными.

## MAP-BLUEPRINT.1a — Physical projection presentation enrichment

Only `L1 / PHYSICAL_OBJECT` nodes for materialized instances expose bounded
`attributes.blueprint_presentation`: immutable library provenance, exact version
body, and persisted slot-to-canonical CP/optional NI mappings. Library refs never
enter `source_refs`. Physical aggregate edges expose deterministic endpoint pairs
oriented to `from_node_id` and `to_node_id`; these are canonical connection/member
facts, not geometry-derived handles. Every L1 `PHYSICAL_OBJECT` node additionally
exposes `attributes.internal_l1_links: []`, one record per canonical same-object
`ConnectionMember`: exact endpoint CP UUIDs/member indices, `connection_id`,
`connection_member_id`, and canonical `source_refs` for the object, both points,
connection, and member. The stored Connection A/B order is presentation-only;
it is not network direction. This field is independent of
`blueprint_presentation`, so manual objects and arbitrary/branched internal
topology use the same contract. Internal links remain internal and do not create
a self-edge.

## MAP-BLUEPRINT.1b — Physical map rendering

The Physical map renders `blueprint_presentation` rectangles in exact persisted
presentation units and places visible ports by canonical ConnectionPoint mapping.
Each aggregate edge expands only in the presentation layer into its exact member
segments; segment clicks still select the aggregate projection edge. A segment is
trace-emphasized only when public evidence includes its ConnectionMember. Manual
objects and unknown endpoints retain generic node/floating-boundary fallback.

For each Blueprint node, the renderer also reads only
`attributes.internal_l1_links`: a same-object member becomes an internal,
non-interactive SVG segment only when both canonical ConnectionPoint IDs map to
known persisted slot anchors. Side/offset is converted directly into the exact
body coordinate; missing geometry emits no guessed segment. The segment is
undirected, branches remain separate, selection emphasizes all rendered segments,
and selected-branch trace evidence emphasizes only the exact
`connection_member_id`. This presentation mechanism is intentionally reusable by
future L1S.4c wiring highlight, without introducing wiring state here.

`external_attachment` is not a second user-visible port marker. The sole visible
port marker remains at the slot's `rendered_position`. Saved Map cable routes
also use these rendered port positions as their endpoints; only explicit user
waypoints determine route bends.

## MAP-CONNECT.1b — route-aware visual wiring

Physical-map wiring keeps a local flow-coordinate waypoint draft after source
port selection. Pane clicks append draft waypoints; port/panel clicks do not.
Confirmation first creates the canonical Connection + optional Cable, then persists the explicit
route (including `[]`) by the returned canonical cable ref. These are separate
writes: route retry never repeats the atomic canonical create, and a failed projection
refresh retries only the projection read. During endpoint choice, only exact
same-object `internal_l1_links` adjacent to the source are highlighted as a
passive continuity hint; they do not change the canonical source endpoint.

## MAP-CONNECT.1a — blueprint-backed cable composition

`POST /v1/topology/physical-connections` may use an exact Object Blueprint for
the participating PhysicalObject endpoints. Blueprint materialization creates
only that object's ConnectionPoints/internal Connections; the cable-backed
operation itself atomically creates one canonical Connection and optional Cable.
Cable has no Blueprint, endpoints or internal link, and no legacy generic-cable
request is retained.

## MAPS.1 — persisted Saved Maps and scene lifecycle

**IMPLEMENTED**

Saved Maps are an explicit presentation scope over canonical
`PhysicalObject` refs. `MapPlacement` is membership only and excludes Cable;
`MapViewPosition` is a separate row per placement/view key. The public
map detail response exposes each placement as:

```text
physical_object_ref
positions:
    L1/PHYSICAL_OBJECT?: { x, y, locked }
    L2/DEVICE?: { x, y, locked }
```

`POST /v1/maps/{map_id}/placements` retains the compatibility `x/y` payload and
creates only the initial Physical position. `PUT .../positions/physical` and
`PUT .../positions/logical` are the explicit per-view writes. Missing Logical
coordinates mean frontend ELK initialization, not a copy of Physical position.

`locked` — presentation-only состояние конкретного placement/view со значением
по умолчанию `false`. `PUT .../locks/physical` и `PUT .../locks/logical`
меняют только этот флаг, не coordinates и не canonical topology. Locked node
остаётся selectable и inspectable, но React Flow отключает его drag; успешная
lock write обновляет local SavedMap state без reload projection или scene.

Final SavedMap drag проверяется локально в flow coordinates по footprint
размещённых normal nodes: blueprint использует размеры body, generic node —
существующие layout dimensions. Overlap при drop не начинает position write,
немедленно возвращает node к последней подтверждённой позиции и показывает
короткое сообщение; viewport и selection не меняются. Touching boundaries
допустимы.

Добавление на Physical Saved Map использует тот же footprint/intersection
contract. Toolbar, context menu, Object Detail и off-map continuation сначала
сохраняют свой requested anchor; для выбранного PhysicalObject frontend получает
scoped L1/PHYSICAL_OBJECT projection и берёт blueprint body или generic layout
footprint. Если anchor занят, deterministic bounded nearest-free search в flow
coordinates выбирает ближайшую свободную позицию, не двигая viewport и не меняя
существующие objects. Preflight не пишет placement при ошибке geometry/поиска;
после успешного write retry обновляет только SavedMap detail, без нового POST.

`TopologyCanvas` remains presentation-only: it receives a scene key,
position overrides and callbacks, not SavedMap API knowledge. Viewport control
belongs to scene initialization and explicit user layout/navigation actions,
never selection: same-scene drag, selection (including URL focus and trace
branch changes) and coordinate acknowledgement do not rerun layout or fit the
viewport. A failed write obtains authoritative positions through SavedMap detail
and applies an explicit rollback revision. Physical and Logical dragging are
both supported and persist independently; no viewport is persisted on the
server.

## MAPS.2a — topology-derived cable visibility

**IMPLEMENTED only for Saved Map Physical view**

Saved Map Physical projection requests opt into
`include_cable_continuations`. The resolver admits a Cable-backed Connection
when its two endpoint objects are already explicitly placed. Existing
presentation collapse renders the Cable-backed edge, retaining canonical Cable
and Connection refs for selection and trace highlighting. No cable placement or
cable position is created; the Logical view and canonical trace scope do not
opt in.

## MAPS.2b — L1 off-map continuation

**IMPLEMENTED only for Saved Map Physical view**

For the same Cable-backed Connection with exactly one placed endpoint, the opt-in L1
document returns `l1_off_map_continuations` with exact canonical refs for local
object/ConnectionPoint, cable, and remote object/ConnectionPoint. The remote
object is not a projection node and neither it nor the cable is added to map
membership. A custom presentation edge anchors a compact marker to the actual
local blueprint slot or generic ConnectionPoint where available. Selecting it
opens Quick Inspector details and permits only two bounded actions: add the
remote object through the existing placement API, or open that canonical object
in Catalog. Once added, the normal MAPS.2a collapse is used.

Quick Inspector L1 object summaries use the authoritative
`PhysicalObjectDetailsDocument`; Cable endpoints are read only from the
authoritative Cable-backed Connection. Primary map removal affects
only `MapPlacement`; canonical deletion remains an advanced destructive action.
When a continuation is selected from its marker/edge, its placement uses the
captured React Flow coordinate rather than a guessed topology coordinate.

This is not generic continuation: no off-map normal node, L2/L3 continuation,
multi-hop expansion, MapReference, regions, cable waypoints or map wiring is
materialized.

## MAPS.3 — Saved Map Regions

**L1S.7a model/persistence/API, L1S.7b.1 rendering/isolated mode, L1S.7b.2 session-local
polygon draft drawing, L1S.7b.3a Shift screen-axis constraint, L1S.7b.3b create/persistence,
and L1S.7b.4a/b laminar contract, derived tree and selection, and L1S.7b.4c/d
new-Region draft geometry editor and transient assisted geometry, and L1S.7b.4e existing-Region
geometry editing and L1S.7b.4f presentation/properties with authoritative lifecycle IMPLEMENTED**

The authoritative `SavedMapDocument` contains `regions[]`. Each item has a
SavedMap-scoped `MapRegionRef { entity_type: "MapRegion", entity_id }`, trimmed
non-empty non-unique `label`, ordered simple polygon `points[]` in Physical flow
coordinates, optional `label_position`, bounded fill/stroke style, and integer
`z_order`. A Region is available only for the Physical/L1 Saved Map scene. It is not a
`PhysicalObject`, `Location`, projection source, map placement, topology member, or
connectivity fact. Its geometry and lifecycle never alter canonical topology.

The Region set is a laminar presentation hierarchy derived only from `regions[]` geometry,
never persisted as a parent field. Two Regions must be disjoint or related by strict
containment; all boundary touching, coincident polygons, and partial overlap are invalid.
The immediate parent is the strictly containing polygon with minimum absolute area, while
siblings are necessarily spatially disjoint and nesting may have arbitrary depth. This is
not a Location or topology hierarchy and has no object-membership or movement semantics.
A future optional association with canonical `Location` is presentation assistance only:
members are objects at that Location or descendants, never polygon-contained objects.
Map movement does not mutate Location, and a consistency warning does not move objects,
rewrite Regions, or alter canonical state. Region creation assistance may suggest an
editable padded bounding draft from members already placed on the current map, or a
small default near the viewport/anchor when there are none; it is not auto-layout.

`POST /v1/maps/{map_id}/regions`, `PUT /v1/maps/{map_id}/regions/{region_id}`, and
`DELETE /v1/maps/{map_id}/regions/{region_id}` are the bounded write surface. Create
and replace carry the complete mutable Region presentation state; identity, owning map,
and view cannot change. Frontend transport treats successful writes as acknowledgements
and reloads the authoritative Saved Map rather than synthesizing local region state.
There is intentionally no independent Region list/detail read endpoint.

L1S.7b.1 renders persisted Regions as a non-interactive Physical presentation layer,
outside React Flow topology nodes and below topology objects, cables, ports and overlays.
It also provides an isolated frontend-session `Области` mode: topology interaction is
suppressed, cables are hidden, and real current object bounds/contours are the default
reference background with a bounded complete hide option. L1S.7b.2 adds a typed local draft
to that same layer, rather than synthesizing a `MapRegion`: canvas clicks add flow-coordinate
vertices; the layer shows vertices, segments, a pointer preview, and closure after three
points. L1S.7b.3b gives a completed draft a bounded label/save/cancel form and posts its trimmed
label, exact points, `null` label position, centralized default style, and next layer order. The
POST is only acknowledgement; the UI reloads the Saved Map and never synthesizes a Region. Failed
POST retries retain the local draft, while an acknowledged POST with failed refresh can retry only
the reload. Cancel, `Escape`, map/view/mode exit discard unacknowledged local draft state.
L1S.7b.3a constrains Shift-held current segments by dominant screen-space axis before converting
the endpoint to flow coordinates; preview and click use that same endpoint. L1S.7b.4d adds compact,
transient angle and flow-coordinate segment-length feedback and magnetic 10°/10-unit assistance to
new-draft drawing and vertex drags. The screen-space capture keeps it stable under zoom; Ctrl bypasses
automatic magnets and Shift retains its stronger screen-axis constraint. These are edit-time presentation
helps, not persisted engineering dimensions, physical length, or CAD semantics. L1S.7b.4c turns only a
closed new draft into a local geometry editor: real vertex and transient edge-midpoint handles can
move/insert/delete vertices or translate the whole polygon in flow coordinates. It validates one
simple polygon exactly (including self-contact), marks invalid drafts and disables save while keeping
them repairable. The overlay never makes persisted Regions pointer-interactive; no synthetic identity
or write occurs until create acknowledgement. L1S.7b.4b derives a
deterministic arbitrary-depth Region tree only from authoritative `regions[]`; its row selection is
session-only, and the selected persisted polygon highlight is presentation-only. Parent is never
persisted. L1S.7b.4e lets an explicitly selected existing Region enter the same local geometry
editor without mutating `activeMap.regions`; its passive target is suppressed beneath the active
overlay. Save performs one replace acknowledgement then authoritative Saved Map reload, never
synthesizing a Region. Existing non-geometry state is preserved, except a rigid polygon translation
translates explicit `label_position` by the same delta; vertex and topology edits leave it untouched.
PUT failure keeps the local editor repairable (including a localized spatial-conflict message), while
an acknowledged write with failed reload retries only reload. Tree hierarchy remains authoritative
until that reload. L1S.7b.4f provides a distinct local Region properties draft:
trimmed non-empty non-unique name, the existing bounded fill/stroke style,
automatic-or-explicit label color, and automatic-or-explicit label position. It
previews only locally and locks tree selection; neither `activeMap.regions` nor
geometry is mutated. The preview label alone is freely draggable in map
coordinates without assist/snap, and reset stores `null` to retain the existing
automatic centroid fallback. Save performs one complete `replaceRegion` with
unchanged points and `z_order`, then reloads authoritatively; failed PUT remains
retryable, while failed post-acknowledgement reload retries only reload. A
separate confirmation deletes only the selected Region by one DELETE, then uses
the same authoritative refresh-only retry contract; derived descendants remain.
An arbitrary user text annotation is still separate future presentation content,
not a Region label.

`MapReference` remains a future presentation object targeting another SavedMap for
hierarchical navigation. It is not a Location, Connection, topology fact, or
containment evidence.

## Future Fibre Channel compatibility boundary

**OPEN; no frontend/API/storage work is implied**

The current Physical presentation and Object Library are intentionally usable
with protocol-neutral `PhysicalObject`, `ConnectionPoint` and
`NetworkInterface` facts. Future design must stress these surfaces with a SAN
switch, storage array/storage controller and host HBA, while keeping their
physical path in the existing L1 model.

If a future Fibre Channel fabric view is added, it is a distinct presentation
over a separate FC semantic domain, not a reinterpretation of the current
Ethernet `L2/DEVICE` view. It may coexist conceptually with Physical and
Ethernet/logical views of the same canonical objects, but this document does not
reserve a new Saved Map view key, route, DTO, table or API. Ethernet L2
encapsulation/MAC/FDB controls must not be exposed as surrogate FC controls.
