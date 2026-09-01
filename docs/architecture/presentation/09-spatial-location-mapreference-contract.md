# Spatial presentation contract: Location, Region, SavedMap, MapComposite и MapReference

## Статус

Действующий архитектурный contract для пространственной семантики NetMap.
Документ фиксирует границы понятий; конкретные DB columns, API endpoints,
DTO и algorithm details здесь намеренно не определяются.

Location.1 implemented the minimal canonical foundation: stable Location
identity, arbitrary-depth explicit parent hierarchy, arbitrary user-defined
optional type and explicit optional `PhysicalObject -> Location` assignment.
Location.2 implements the Location management tree and PhysicalObject assignment
UX over that API, with authoritative reload after each acknowledged write. It
does not implement MapReference or any fixed Location taxonomy.

Location.3 implements the optional `MapRegion -> Location` presentation
association and bounded current-map focus assistance. The Region reference is
not containment: polygon geometry, Region movement and object placement never
derive or mutate canonical Location. SavedMap reads carry only live derived
canonical Location context beside each placed object, not MapPlacement-owned
Location state. A Region association uses `SET NULL` semantics on Location
deletion, while canonical PhysicalObject assignments retain their Location.1
deletion blocker semantics. MapReference remains a separate OPEN family.

## Четыре разных понятия

### Location

`Location` — отдельное canonical понятие физического местоположения. Оно
отвечает на вопрос: «где физически находится объект?». Location существует
независимо от SavedMap и canvas/presentation coordinates.

Location образуют произвольную физическую иерархию любой глубины, ltree-like
по смыслу. Конкретная технология хранения (например, `ltree`, adjacency list
или другая) пока не фиксируется. `Location.type` — optional arbitrary
user-defined string. Никакого enum, fixed taxonomy или backend-interpreted
classification нет: «город», «этаж», «стойка», `Room`, `Rack` и `RackUnit` —
лишь пользовательские строковые значения, а не фундаментальные backend-типы.

`PhysicalObject` имеет явную optional canonical association с Location. Эта
association и сама иерархия Location являются canonical facts;
они не выводятся из карты. Положение объекта на SavedMap никогда не создаёт и
не изменяет Location. Region geometry также никогда не создаёт и не изменяет
Location.

### Region

`Region` — только SavedMap-owned presentation geometry для одной Physical/L1
карты: polygon, label, style и label position. Hierarchy Regions derives only
from geometry; она не является canonical physical hierarchy.

Region не имеет canonical containment/member semantics: объект внутри polygon
не становится member Location или Region. Движение Region не двигает canonical
objects и не меняет их Location. Region имеет optional explicit association с
Location для presentation assistance, но это не превращает
polygon в источник canonical truth. It may optionally reference one canonical
Location solely to focus current-map objects at that Location or explicit
canonical descendants; unrelated objects may be dimmed, never hidden.

Фактически реализованный Region family включает persistence/API, rendering,
isolated mode, draft creation, geometry editor, assisted geometry, laminar
hierarchy, existing Region edit, properties/style/label drag/delete,
произвольные текстовые annotations и consolidated presentation authoring panel.
Это не означает, что глобальный UI polish завершён: cross-app visual
unification остаётся отдельной будущей задачей.

### SavedMap

`SavedMap` — одна полная сохранённая presentation scope. Она содержит размещения
canonical topology objects и реализованные presentation records текущего
contract, включая Regions и text annotations. SavedMap не является canonical
physical hierarchy и не является topology container.

Варианты presentation одной и той же SavedMap могут иметь независимую geometry,
но не дублируют topology или membership. B.3 не использует одну SavedMap как
вложенную стойку, комнату или контейнер другой карты.

Membership объекта в SavedMap — это membership представления, а не membership
в Location. Одна и та же canonical topology может представляться несколькими
разными SavedMaps; изменения размещения на карте не изменяют canonical topology
или Location.

### MapComposite

`MapComposite` принадлежит одной SavedMap и содержит только её уже существующие
MapPlacement. Это presentation-only grouping: не PhysicalObject, Location,
Region, Connection endpoint или canonical containment. Один placement входит
не более чем в один composite; overlap и nesting не поддерживаются. Удаление
composite не удаляет placement, PhysicalObject, Cable или Connection.

В collapsed variant внутренние non-boundary members и связи между ними могут
быть скрыты. Связь member с object вне composite остаётся реальной связью между
реальными PhysicalObject, а member остаётся boundary node. Это derived scene
context до layout, а не topology fact или layout heuristic.

### MapReference

MapReference composition между SavedMap не реализуется в B.3. Если
MapReference когда-либо понадобится, это может быть отдельная будущая
навигационная ссылка между независимыми картами; её schema, API и interaction
не проектируются этим contract.

MapReference не является Location, не доказывает physical containment, не
является Region и не является отдельным canonical topology aggregate.

## Relationship matrix

| Понятие | Роль | Граница семантики |
| --- | --- | --- |
| `Location` | canonical physical place | независим от карт; отвечает, где физически находится объект |
| `Region` | presentation | geometry одной SavedMap; не создаёт canonical containment |
| `SavedMap` | presentation scope | выбранное представление canonical topology; не physical hierarchy и не topology container |
| `MapComposite` | presentation grouping | collapsed representation placement в одной SavedMap; boundary остаётся реальными PhysicalObject |
| `MapReference` | future navigation | не является B.3 composition contract |

## Инварианты границ

- Canvas placement, Region geometry и MapReference composition не создают и не
  изменяют canonical Location.
- Ни Region, ни SavedMap, ни MapReference не являются доказательством
  physical containment.
- Presentation records могут помогать навигации и чтению topology, но
  canonical topology остаётся source of truth.
- Location foundation и MapReference/composed SavedMaps — разные будущие
  capability families; они не объединяются в одну иерархию.

## Normalized review boundaries

Location.2 canonical/API foundation and assignment UX remain implemented:
collapsible arbitrary-depth tree with current-path expansion, search by Location
name/full path, ancestor context, and inline root/direct-child creation.
Canonical Location/API semantics не меняются; create Location и assign
PhysicalObject остаются двумя отдельными writes, а authoritative reload и
refresh-only retry semantics сохраняются. `Location.type` остается optional
arbitrary user value, без fixed taxonomy.

MapReference является bounded consumer общего hierarchical/composite
presentation mechanism, а не standalone parallel composition architecture.
Pipeline: canonical/derived facts -> Projection -> hierarchical/composite scene
-> layout/presentation -> canvas. Universal parent не вводится; Location и
другие domain relations независимы. Region остается отдельной manual
SavedMap-owned presentation geometry. MapReference schema/API и exact boundary
algorithm остаются OPEN до bounded milestone.

Rack layout может быть specialized presentation policy, но `Location.type` не
становится backend-interpreted Rack taxonomy и rack occupancy semantics не
фиксируются этим contract.
