# Spatial presentation contract: Location, Region, SavedMap и MapReference

## Статус

Действующий архитектурный contract для пространственной семантики NetMap.
Документ фиксирует границы понятий; конкретные DB columns, API endpoints,
DTO и algorithm details здесь намеренно не определяются.

Location.1 implemented the minimal canonical foundation: stable Location
identity, arbitrary-depth explicit parent hierarchy, arbitrary user-defined
optional type and explicit optional `PhysicalObject -> Location` assignment.
Location.2 implements the Location management tree and PhysicalObject assignment
UX over that API, with authoritative reload after each acknowledged write. It
does not implement Region association/assistance, MapReference or any fixed
Location taxonomy.

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
objects и не меняет их Location. В будущем Region может иметь explicit
association с Location для presentation assistance, но это не превращает
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

`SavedMap` — уже существующий presentation scope. Она содержит размещения
canonical topology objects и реализованные presentation records текущего
contract, включая Regions и text annotations. SavedMap не является canonical
physical hierarchy и не является topology container.

Будущий `MapReference` будет SavedMap-owned presentation composition одной
SavedMap внутри другой; текущая persisted SavedMap не содержит таких
compositions.

Membership объекта в SavedMap — это membership представления, а не membership
в Location. Одна и та же canonical topology может представляться несколькими
разными SavedMaps; изменения размещения на карте не изменяют canonical topology
или Location.

### MapReference

`MapReference` — presentation composition одной SavedMap внутри другой SavedMap.
Например, подробная SavedMap стойки может отображаться на карте помещения как
один collapsed/composite presentation object. На родительской карте внутренние
объекты и внутренние связи target-map скрыты; наружу представляются только
canonical connectivity crossings между объектами target SavedMap и
canonical objects вне её membership.

Внешнее представление не создаёт новые `Connection`, `PhysicalObject` или
другие topology facts. Внешние connections должны следовать из canonical
topology и membership target SavedMap, а не из вручную придуманной отдельной
topology. Точный algorithm external-port derivation, API и schema пока не
фиксируются.

Drill-down/open target map является частью этого composite presentation
concept. Отдельный параллельный объект «простой hyperlink MapReference» не
вводится.

MapReference не является Location, не доказывает physical containment, не
является Region и не является отдельным canonical topology aggregate.

## Relationship matrix

| Понятие | Роль | Граница семантики |
| --- | --- | --- |
| `Location` | canonical physical place | независим от карт; отвечает, где физически находится объект |
| `Region` | presentation | geometry одной SavedMap; не создаёт canonical containment |
| `SavedMap` | presentation scope | выбранное представление canonical topology; не physical hierarchy и не topology container |
| `MapReference` | presentation composition | collapsed representation другой SavedMap; crossing connectivity остаётся derived из canonical topology + membership |

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

Location.2 canonical/API foundation остается implemented, но assignment UX
имеет pre-L2 refinement: search-first collapsible tree, ancestor context и
inline direct-child/root create. Canonical Location semantics не меняются:
`Location.type` остается optional arbitrary user value, без fixed taxonomy.

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
