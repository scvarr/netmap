# 08. UI implementation contract

## Статус

Рабочий implementation contract frontend NetMap. Документ не меняет network
semantics. Он фиксирует одновременно архитектурные boundaries и фактически
materialized subset на `main` после MAPS.2b; текст о будущих controls не следует
читать как описание уже существующего product surface.

### Фактический срез реализации

**IMPLEMENTED subset**

Canonical/resolver core существенно опережает UI. Backend materializes и
тестирует canonical L1/L2/L3, trace, routing, security, NAT, evidence и
projection contracts, но frontend пока не является универсальным editor или
trace workbench для всех этих domains. Реализованные UI surfaces: Saved Map
Physical/Logical presentation, Catalog/Object Detail, Object Library/Blueprint
editor и bounded L1 interface-physical Trace Command Bar. Карта не владеет
canonical topology: она читает public projection DTO и SavedMap presentation
state.

Связанные документы: [[05-presentation|05. Представление]], [[02-04-projections-aggregation|02.4 Projections]], [[07-workspaces|07. Workspace]], [[09-ui-ux-review|09. Рабочий L1 UI/UX review]].

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
    implemented bounded L1 interface-physical trace command
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
Equipment/Cables UI уже materialized отдельный inventory read model
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

Equipment is every `PhysicalObject` without an explicit `class="cable"`.
Occupancy is emitted only when every owned `ConnectionPoint` has cardinality
one; it counts points with external canonical `Connection` occupancy, excluding
same-object internal links, and never counts `NetworkInterface`s. Map
memberships are only explicit `MapPlacement` facts joined to `SavedMap`; they do
not participate in topology resolution. Cables are only explicit
`class="cable"` objects. Exact two endpoints are emitted solely when the
existing `simple_cable_semantics` recognises the cable; otherwise the item is
`UNRESOLVED` with no guessed endpoint. The endpoint order is stable but has no
directional meaning. This read model is bulk-resolved from canonical and
presentation query boundaries, not by L1 projection or per-object/map detail
requests. `/infrastructure/objects` now uses this datasource exclusively: one
guarded inventory load per initial/retry/authoritative post-delete refresh, with
no topology-projection fallback. The Catalog has Equipment and Cables tabs.
Equipment shows class, trustworthy `connected / total` port occupancy (or an
unknown state), explicit SavedMap links, and bounded client-side
name/class/map search and filters. Cables show only proven simple-cable
endpoints or an explicit unresolved state; cable search and resolution filtering
are client-side. Map links use the placed object and map identity directly:
`/map?map=<SavedMap UUID>&view=physical&focus=<PhysicalObject UUID>`.
Deletion preserves the existing cable-specific confirmation and reloads the
authoritative inventory only after a successful operation.

Catalog additionally provides a bounded PhysicalObject display rename on both
tabs. `PUT /v1/topology/physical-objects/<PhysicalObject UUID>/display-name`
updates or creates exactly one `EntityMetadata(key="alias.display")` value;
it never changes the canonical PhysicalObject UUID, class metadata, points,
connections, blueprint provenance, or map placements. A successful Catalog
write is followed by an authoritative inventory reload rather than a local row
mutation, so labels, natural ordering, search, and simple-cable endpoint labels
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
    include_interstitial_cables: bool = false
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
interfaces, incident connections и direct interface bindings. L1R.3a also
returns an operational presentation read model: a materialized object has
optional `blueprint_provenance` with `LIBRARY_RECORD` ObjectBlueprint and exact
ObjectBlueprintVersion refs plus `version_number` (manual objects have none).
Each ConnectionPoint retains its canonical ref/counts and adds `ordering_key`
(the stable blueprint `slot_key` for instances), factual `blueprint_slot`
(kind and anchor metadata), named direct interface bindings with evidence refs,
direct internal counterparts, and structured external attachments. Attachments
are exact `DIRECT_CONNECTION`, recognised `SIMPLE_CABLE` with cable and far
endpoint, or honest `UNRESOLVED`; ambiguous/non-simple passive topology never
gets a guessed far peer. The simple-cable predicate is shared with
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
interface(s), connect action for an externally free cardinality-1 point, and
collapsed technical refs. `ordering_key` is the primary natural ordering key;
the human label is the deterministic legacy fallback. Cardinality above one
shows factual connection counts only.

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

Первый ручной проход по Object Library и Template Editor зафиксирован отдельно
в [[09-ui-ux-review|рабочем L1 UI/UX review]]. Его findings — не изменение этого
implementation contract и не объявление будущих product capabilities
реализованными.

## MAP-BLUEPRINT.1a — Physical projection presentation enrichment

Only `L1 / PHYSICAL_OBJECT` nodes for materialized instances expose bounded
`attributes.blueprint_presentation`: immutable library provenance, exact version
body, and persisted slot-to-canonical CP/optional NI mappings. Library refs never
enter `source_refs`. Physical aggregate edges expose deterministic endpoint pairs
oriented to `from_node_id` and `to_node_id`; these are canonical connection/member
facts, not geometry-derived handles. Internal links remain internal and do not
create a self-edge.

## MAP-BLUEPRINT.1b — Physical map rendering

The Physical map renders `blueprint_presentation` rectangles in exact persisted
presentation units and places visible ports by canonical ConnectionPoint mapping.
Each aggregate edge expands only in the presentation layer into its exact member
segments; segment clicks still select the aggregate projection edge. A segment is
trace-emphasized only when public evidence includes its ConnectionMember. Manual
objects and unknown endpoints retain generic node/floating-boundary fallback.

## MAP-CONNECT.1a — blueprint-backed cable composition

`POST /v1/topology/physical-connections` optionally accepts an exact blueprint
and version for a simple inline cable: exactly two CONNECTION_POINT slots and one
link between them. Slot key order provides stable undirected source/target
assignment; anchors and classes do not determine L1 semantics. The operation
atomically materializes that version, its internal link, and two external links;
legacy generic-cable requests remain unchanged.

## MAPS.1 — persisted Saved Maps and scene lifecycle

**IMPLEMENTED**

Saved Maps are an explicit presentation scope over canonical
`PhysicalObject` refs. `MapPlacement` is membership only and excludes cable
objects; `MapViewPosition` is a separate row per placement/view key. The public
map detail response exposes each placement as:

```text
physical_object_ref
positions:
    L1/PHYSICAL_OBJECT?: { x, y }
    L2/DEVICE?: { x, y }
```

`POST /v1/maps/{map_id}/placements` retains the compatibility `x/y` payload and
creates only the initial Physical position. `PUT .../positions/physical` and
`PUT .../positions/logical` are the explicit per-view writes. Missing Logical
coordinates mean frontend ELK initialization, not a copy of Physical position.

`TopologyCanvas` remains presentation-only: it receives a scene key,
position overrides and callbacks, not SavedMap API knowledge. Same-scene drag,
selection and coordinate acknowledgement do not rerun layout or fit the
viewport. A failed write obtains authoritative positions through SavedMap detail
and applies an explicit rollback revision. Physical and Logical dragging are
both supported and persist independently; no viewport is persisted on the
server.

## MAPS.2a — topology-derived cable visibility

**IMPLEMENTED only for Saved Map Physical view**

Saved Map Physical projection requests opt into
`include_interstitial_cables`. The resolver admits a `class=cable` only when it
is an unambiguous simple two-ended cable whose two external endpoint objects are
already explicitly placed. Existing `physicalCablePresentation` then collapses
the cable node into the familiar edge, retaining cable node identity and
supporting edge IDs for existing selection and trace highlighting. No cable
placement or cable position is created; the Logical view and canonical trace
scope do not opt in.

## MAPS.2b — L1 off-map continuation

**IMPLEMENTED only for Saved Map Physical view**

For the same simple cable with exactly one placed endpoint, the opt-in L1
document returns `l1_off_map_continuations` with exact canonical refs for local
object/ConnectionPoint, cable, and remote object/ConnectionPoint. The remote
object is not a projection node and neither it nor the cable is added to map
membership. A custom presentation edge anchors a compact marker to the actual
local blueprint slot or generic ConnectionPoint where available. Selecting it
opens Quick Inspector details and permits only two bounded actions: add the
remote object through the existing placement API, or open that canonical object
in Catalog. Once added, the normal MAPS.2a collapse is used.

Quick Inspector L1 object summaries use the authoritative
`PhysicalObjectDetailsDocument`; cable endpoints are read only from proven
`CatalogInventoryDocument` simple-cable resolution. Primary map removal affects
only `MapPlacement`; canonical deletion remains an advanced destructive action.
When a continuation is selected from its marker/edge, its placement uses the
captured React Flow coordinate rather than a guessed topology coordinate.

This is not generic continuation: no off-map normal node, L2/L3 continuation,
multi-hop expansion, MapReference, regions, cable waypoints or map wiring is
materialized.

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
