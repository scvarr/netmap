# Spatial presentation contract: Location, derived frames, SavedMap, MapComposite и MapReference

## Статус

Действующий целевой архитектурный contract для пространственной семантики NetMap.
Derived Location frames — **CONTRACT AGREED / IMPLEMENTATION PENDING**. Текущая
реализация manual SavedMap Region / MapRegion пока существует; её удаление из
кода, API и БД относится к отдельным implementation milestones. Этот contract
не описывает миграцию и не объявляет удаление выполненным.

## Location

`Location` — canonical физическое место, независимое от SavedMap и canvas.
Location образуют иерархию произвольной глубины с явными parent relations.
`Location.type` остаётся optional arbitrary user-defined string: нет fixed
taxonomy и backend interpretation типов вроде site, floor, room или rack.
`PhysicalObject -> Location` — явное canonical назначение. Canonical Location
и эти назначения являются source of truth; выводить их из карты запрещено.

## Derived Location frame

Derived Location frame — вычисляемое для конкретной SavedMap представление
canonical Location subtree. Это не canonical entity, не SavedMap-owned
persisted entity и не replacement record для MapRegion. У frame нет собственной
сохраняемой polygon geometry; его нельзя создавать или редактировать вручную.

Membership определяется только canonical Location facts. Для Location L в
frame входят размещённые на текущей SavedMap PhysicalObject, назначенные
непосредственно L или любому canonical descendant L на любой глубине. Поэтому
объект в RACK-811 участвует во frames RACK-811, SERVER-ROOM-808, FLOOR-8 и
SYNTH-L1-LAB. PhysicalObject без Location не входит ни в один frame. Если в
subtree нет relevant размещённых объектов этой SavedMap, frame не показывается.

Geometry вычисляется из текущей отображаемой геометрии соответствующих
MapPlacements с presentation padding. Значение padding и visual styling этим
contract не фиксируются. Presentation geometry меняется при перемещении,
добавлении или удалении объекта на карте, изменении отображаемого размера
объекта и изменении relevant cable route; frame динамически пересчитывается,
не меняя canonical Location. Изменение canonical assignment отражается во
frames после authoritative refresh.

Cable учитывается относительно конкретного Location subtree. Если оба
физических endpoint принадлежат объектам внутри subtree L, Cable internal
относительно L и участвует в frame geometry. Если только один endpoint внутри,
Cable boundary/external и frame L не расширяет. Поэтому Cable между ROOM-A и
ROOM-B не расширяет frame каждой комнаты, но может участвовать в frame общего
FLOOR. Используется отображаемая геометрия текущей SavedMap: сохранённый
MapCableRoute, если он есть, иначе обычная отображаемая геометрия Cable. Если
endpoint или его Location нельзя определить точно, такой Cable не используется
для расширения frame.

## SavedMap

`SavedMap` — сохранённая presentation scope canonical topology. Она содержит
размещения canonical topology objects и presentation state, включая
MapPlacement, MapPresentationVariant, MapCableRoute, MapComposite и text
annotations. Одна topology может отображаться в разных SavedMaps.
MapPresentationVariant может иметь независимую placement/presentation geometry,
но не дублирует topology или Location membership. Размещение на карте не
меняет canonical topology, Location или PhysicalObject -> Location. Location
frame вычисляется динамически для конкретной SavedMap и текущего variant; frame
не становится persisted entity.

## MapComposite

`MapComposite` принадлежит одной SavedMap и группирует только её существующие
MapPlacement. Это presentation-only arbitrary grouping; он не является
PhysicalObject, Location, Connection endpoint или canonical containment и не
заменяется Location frame. Один placement входит не более чем в один composite;
overlap и nesting не поддерживаются. Удаление composite не удаляет placement,
PhysicalObject, Cable или Connection.

Membership composite общее для всех `MapPresentationVariant`. В collapsed state
real PhysicalObject автоматически видим, если его реальная отображаемая связь
пересекает границу composite. Explicit rule `Показывать при сворачивании`
сохраняется для конкретного composite и также общее для variants; effective
visibility = boundary OR explicit. Explicit-visible object не становится
boundary object. Без exact endpoint evidence продолжение связи не угадывается.
Видимые objects остаются реальными topology nodes; composite frame — только
presentation container. Его перемещение не переписывает member MapViewPosition.
Coordinates, collapsed state, frame geometry и Cable routes принадлежат
variant; create-copy клонирует этот variant-specific presentation state.

## MapReference

MapReference composition между SavedMap не реализуется в B.3 и остаётся future
optional navigation между независимыми картами. Его schema, API и interaction
здесь не проектируются. MapReference не является Location, не доказывает
physical containment и не является canonical topology aggregate.

## Relationship matrix

| Понятие | Роль | Граница семантики |
| --- | --- | --- |
| `Location` | canonical physical place | произвольная явная иерархия; источник canonical physical facts |
| Derived Location frame | вычисляемое presentation | рекурсивная геометрия размещённых объектов subtree для одной SavedMap |
| `SavedMap` | presentation scope | представление canonical topology; не physical hierarchy |
| `MapComposite` | presentation grouping | произвольная группировка placements; не Location frame |
| `MapReference` | future navigation | ссылка между независимыми SavedMaps |
| `Region` / `MapRegion` | существующая реализация, удаление pending | не является целевой product capability |

## Инварианты границ

- Направление зависимости: canonical Location hierarchy -> canonical
  PhysicalObject -> Location assignment -> current SavedMap placement and
  presentation geometry -> derived Location frame. Никогда наоборот.
- Canvas placement, cable geometry и frame geometry не создают и не изменяют
  canonical Location или assignment.
- Ни SavedMap, MapComposite, MapReference, ни derived frame не являются
  доказательством physical containment.
- Universal parent и новая canonical сущность не вводятся. Location и другие
  domain relations независимы.
- Text annotations семантически отдельны от Region и остаются в целевой модели.

Pipeline: canonical Location/topology facts -> projection -> presentation scene
and derived Location frames -> layout/presentation -> canvas. Схемы/API
implementation, frame rendering details beyond this contract, padding и styling
этим документом не фиксируются.
