# 09. Рабочий L1 UI/UX review

## Статус и границы

**WORKING PRODUCT/UX REVIEW / IMPLEMENTATION PENDING.** Эта заметка сохраняет
завершённый ручной проход по текущему L1 product workflow: Object Library,
Blueprint authoring/versioning, PhysicalObject instantiation, Catalog, Object
Detail, physical ports/connections, Saved Maps, L1 trace и Quick Inspector. Она
не меняет canonical domain model, resolver semantics, API, persistence или
runtime. Наблюдения ниже разделяют реализованный subset, UX-проблемы,
согласованное направление и открытые product/domain вопросы; они не являются
готовым implementation plan.

Canonical и presentation boundaries остаются в [[01-domain-model|domain model]],
[[05-presentation|presentation contract]] и
[[08-ui-implementation|UI implementation contract]]. Canonical uniformity не
должна означать UI uniformity: строгие `PhysicalObject`, `ConnectionPoint`,
`NetworkInterface`, physical bindings, counts и source refs остаются разными
canonical facts, но human-facing projection должен отвечать на вопросы «что это
за объект», «какие порты», «что и куда подключено», «на каких картах объект» и
«как физически связаны устройства».

Review покрывает полный текущий lifecycle:

```text
Object Library -> Blueprint -> PhysicalObject -> Catalog -> Object Detail
    -> physical ports/connections -> Saved Map -> L1 trace -> Quick Inspector
```

## Подтверждённый работающий foundation

Ручной проход подтвердил полезность уже materialized blueprint model и editor
как authoring surface.

- Endpoint groups — удачная authoring abstraction: ими быстро описываются простой
  PC, outlet, telephone, 24/48/52-port switch, patch panel, SAN switch и storage
  с несколькими группами портов.
- Массовое создание endpoint slots заметно лучше масштабируется, чем ручное
  создание каждого порта.
- Patch panel — особенно быстрый сценарий: несколько groups вместе с generator
  pair-by-index позволяют массово создать пары front/rear.
- Blueprint versions immutable: edit создаёт новую version, а уже
  materialized objects предыдущей version не уничтожаются и не меняются неявно.
- Live schematic preview полезен как концепция и уже помогает authoring.
- SAN switch описывается текущими protocol-neutral `NETWORK_PORT` slots. На
  границе L1/`NetworkInterface` editor не требует Ethernet-specific port type.

Последнее наблюдение согласуется с FC compatibility boundary в
[[01-01-l1|L1]], [[01-02-network-interface|NetworkInterface]],
[[01-03-l2|Ethernet L2 boundary]] и [[05-presentation|presentation]]. Оно не
создаёт FC primitive, FC resolver или FC UI.

## Entry flow: template-first, но не новый canonical invariant

### Наблюдаемая проблема

В полностью пустой системе пользователь попадает на пустую Saved Map и видит
«Добавить объект». UI не объясняет нормальный путь:

```text
создать blueprint/template
    -> создать canonical object from blueprint
    -> добавить object на Saved Map
```

### Согласованное направление

Primary user workflow должен быть template-first. Empty states для отсутствующих
templates, objects и map placements должны быть разными и state-aware; на пустой
системе интерфейс должен вести к созданию или выбору шаблона, а не ограничиваться
«Добавить объект».

### Открытый product question

Это не означает запретить `PhysicalObject` без blueprint. Manual/advanced
creation path остаётся отдельным product decision; template-first — направление
основного UI path, не canonical invariant.

## Терминология и authoring controls

### Язык интерфейса

Template Editor сейчас смешивает русский и английский (`Live schematic preview`,
`Fill color`, `Body kind`, `Endpoint groups`, `Internal link generator`,
`Pair groups by index`). Это UX-проблема. Целевое направление —
терминологически целостный русскоязычный интерфейс.

### Маркировка и stable identity

`Key prefix` и `Display prefix` неясны без знания внутренней blueprint model.
Stable slot identity может быть важна для backend/version migration, но primary
authoring UI не должен заставлять пользователя мыслить внутренними keys без
необходимости. Предпочтительная форма пользовательского представления:

```text
Маркировка портов
Префикс: A
Начать с: 1
Количество: 24
```

Stable/internal key следует генерировать или скрывать, где это возможно. Если
изменение identity может быть destructive, будущий UI должен явно показывать
его последствия.

### Создание groups

Сейчас первая endpoint group появляется автоматически, а ниже есть «Добавить
группу»; неясно, создаёт ли кнопка текущую или ещё одну group. Предпочтительное
направление: изначально пустая секция «Группы портов» и явное добавление первой
group. Точная microcopy пока не зафиксирована.

### Цвет и schematic geometry

Hex-only ввод цвета неудобен. Primary UI должен предлагать visual color picker
или palette; hex допустим как optional/advanced exact value.

Текущие Width/Height воспринимаются как абсолютный map-size (например,
`480 x 40`), хотя blueprint должен описывать local/normalized schematic geometry:
форму, aspect ratio и расположение endpoint groups. Фактический display size на
Map — задача renderer/presentation. Это target concept, не решение о storage
schema.

## Endpoint-group arrangement и preview

### Group placement

Текущих сторон `TOP`, `BOTTOM`, `LEFT`, `RIGHT` недостаточно. Например, storage
может иметь Controller A с FC ports справа сверху и MGMT слева сверху, а
Controller B — FC ports справа снизу и MGMT слева снизу. Направление — `side`
плюс relative position/offset along side либо эквивалентная normalized
presentation geometry, без enum explosion (`LEFT_TOP`, `LEFT_CENTER`, ...).
Точная persistence model не фиксируется.

### Различимость groups

Несколько switch groups на одной стороне (например 24 access ports и 2 uplinks)
сейчас визуально сливаются в непрерывную последовательность endpoints. Будущий UX
должен делать clusters различимыми: gap, labels, highlighting, selectable
clusters и/или relative placement/span — это варианты, не финальный visual
design.

Live preview в перспективе должен стать инструментом schematic arrangement, а
не только passive preview: selection/highlighting group и, возможно, её
перемещение вдоль стороны. Это direction, а не требование реализовать drag
сейчас.

## Internal links

Pair-by-index generator полезен, особенно для patch panel, но терминология
должна до выполнения явно объяснять, что создаётся:

```text
groupA[1] <-> groupB[1]
groupA[2] <-> groupB[2]
...
```

Future authoring capability должна позволить просмотреть generated internal
links, исправить отдельную связь, создать нестандартное соответствие и увидеть
ошибочное mapping. Для этого достаточно в том числе table/manual editing;
graphical drag-and-drop не является обязательным решением. Нельзя выдавать
текущий generator за покрытие всех internal-link scenarios.

## Blueprint version lifecycle: future controlled upgrade

Текущий lifecycle технически безопасен:

```text
Blueprint v1 -> existing objects
edit blueprint -> immutable Blueprint v2
existing objects remain on v1
```

Но пользователю не видно, что появилась новая version, какие objects остались
на старой и как их перевести. Нужна future product capability controlled object
upgrade: увидеть instances старой version, выполнить dry-run compatibility
analysis, увидеть changes и blockers, затем явно применить upgrade к выбранным
или всем compatible objects.

Пример blocker: если v2 удаляет `Gi1/0/48`, но `SW07/Gi1/0/48` имеет external
connection, instance нельзя silently upgrade. После устранения blocker analysis
и apply должны быть повторяемыми.

Ключевой будущий invariant: upgrade blueprint version не означает
delete/recreate `PhysicalObject`. Canonical identity объекта и, насколько это
возможно, identity совпадающих generated slots сохраняются. Existing topology,
connections, placements, references, future L2/L3 facts и history не должны
теряться только из-за upgrade.

Для будущего compatibility planner полезна product-level классификация, а не
окончательная algorithm specification:

- обычно presentation-safe: color, schematic geometry, group position,
  display labels;
- обычно structurally additive: add slot, add group;
- potentially destructive / требует compatibility analysis: remove slot,
  remove group, change slot identity, modify internal connectivity.

## Создание объекта из blueprint

### Что уже работает

После выбора blueprint flow `Name -> Create` простой и удачный; его следует
сохранить. Button «Создать объект» на blueprint card — полезный shortcut, если
он использует тот же основной flow с уже выбранным blueprint.

### UX / information-architecture problem

`Infrastructure -> Objects -> Create` сначала предлагает internal concepts
«Сетевое устройство» и «Физический объект», а Library отдельно предлагает
«Создать объект». Так возникают конкурирующие mental models creation.

### Согласованное направление

Один primary flow должен выглядеть так:

```text
Создать объект -> выбрать Blueprint -> имя -> создать
```

Перед созданием достаточно показать blueprint name, version, маленький preview и
краткую structural summary. Manual creation без blueprint может оставаться
advanced path; это не отменяет canonical capability.

## Saved Map: naming, membership и insertion

### Map action naming

Текущая кнопка «Добавить объект» фактически не создаёт canonical object: она
создаёт `MapPlacement` для существующего `PhysicalObject` и его position на
current Saved Map. Это misleading. Предпочтительная формулировка — «Добавить на
карту». Если creation начат из map context, «Создать объект из шаблона» может
после canonical creation создать placement на current map; создание из
Library/Catalog не должно автоматически помещать object на map.

### Object Detail и map membership

После blueprint instantiate Object Detail предлагает «Показать на карте», даже
когда placement отсутствует. Это **functional defect candidate**. Map membership
должна быть явной user-facing information:

```text
На картах: нет
[Добавить на карту...]

Первая      [Открыть]
Серверная   [Открыть]
[Добавить на другую карту]
```

### Insertion position

Новый object может появиться в arbitrary/unpredictable месте; это терпимо для
трёх, но не для сотен объектов. Target spatial interaction: context menu пустого
canvas помещает выбранный object в cursor coordinates, toolbar add — в центр
current viewport, а future action continuation — рядом с marker. Picker нужен
search; future bulk add может использовать простой grid вокруг insertion anchor.
Это не требование внедрить auto-layout.

## Catalog

### UX / information-architecture problem

Catalog — плоский список всех `PhysicalObject`: cables смешаны с equipment,
cable rows не показывают endpoints, нет rename, map membership, search/filter;
колонки `ConnectionPoints`/`NetworkInterfaces`, class и visible development
placeholder ориентированы на backend, а не на inventory work.

Canonical correctness «Cable is PhysicalObject» не требует показывать cable как
обычную equipment row. Target IA — `Инфраструктура` с разными views
`[Оборудование] [Кабели]`:

```text
Equipment: Название | Тип | Подключение/занятость | Карты | Actions
Cable:     Название | Конец A | Конец B | Карты/presentation context
```

Например `SW1 | Switch | 17 / 52 | Первая, ЦОД`, а
`C-001 | SW1/A17 | PP1/A17`. Objects должны переименовываться без canonical
delete/recreate. Для реального inventory нужны search/filter по name, type,
Saved Map, connected/free state и в будущем Location. Точные columns и pixel
design не зафиксированы.

## Object Detail и ports

### UX / information-architecture problem

Одна большая card на `ConnectionPoint` не масштабируется на 48/52-port device.
Она подчёркивает cardinality, counters, bindings и technical refs, но не отвечает
на основной вопрос: куда подключён этот порт.

### Согласованное направление

Object Detail должен стать operational object page с sections/tabs, например
`Overview`, `Ports`, future `L2`, future `L3`, `Technical`. Overview показывает
name/rename, classification, blueprint/version, map memberships и summary total,
connected и free ports. `Ports` — compact searchable table; `Technical` оставляет
UUID, source refs и raw canonical details.

Для Switch/SAN-like object row может содержать `Port | Status | Connected to |
Network interface` и позже L2/L3 columns. Пользователь обычно видит один
`Port A01`, но это human-facing projection над отдельными physical
`ConnectionPoint A01` и network `NetworkInterface A01`; их canonical identities
нельзя сливать.

Для paired passive device, например patch panel, естественная единица — channel
`A01 <-> B01`, а не две несвязанные cards. Table может показывать `Channel |
Side A | Side B` и использовать blueprint group labels (`Front/Rear`, `A/B`),
не hardcode Front/Rear.

### Template-derived structure

Для blueprint instance текущая «+ Добавить точку» подрывает lifecycle versioning.
Ordinary UI не должен давать arbitrary per-instance add/remove endpoint: normal
structural change проходит через edit blueprint, новую immutable version и future
controlled instance upgrade. Manual non-blueprint object может сохранить
advanced structural CRUD до появления явной override model.

### Cross-cutting port ordering

Порядок `B06, B03, A18, A21` выглядит arbitrary. Natural ordering —
cross-cutting presentation requirement: он должен сохранять meaningful
blueprint/group order (`A01 ... A24`, затем `B01 ...`, затем `UplinkA01 ...`),
а не только lexical sorting.

## Physical cabling workflow

### Что уже работает

Когда выбран правильный destination path, basic interaction разумна:

```text
Connect -> destination object -> destination port -> optional cable name -> Connect
```

### Functional defect candidates

Диалог предлагает «Интерфейс устройства» либо «Точка подключения». Это раскрывает
canonical distinction там, где пользователь создаёт cable. Наблюдаемая
асимметрия: switch -> patch panel через `ConnectionPoint` работает, но passive
point -> switch через device interface не находит free interfaces, поскольку
template-generated `NetworkInterface` уже bound к собственным points.

Physical cabling UX должен выбирать connectable physical endpoints: user-facing
port объекта -> underlying `ConnectionPoint`. `NetworkInterface` может быть
associated information, но не alternative cable endpoint; logical-only loopback,
SVI и tunnel не должны попадать в picker.

Destination picker также показывает object, у которого все compatible endpoints
заняты. По умолчанию такие objects нужно скрывать либо disabled с причиной «Нет
свободных портов»; на масштабе нужны search и sensible filtering.

Connected port сейчас показывает counters, но не neighbour. Primary information
должна быть `A01 -> PP1/B01`, `cable C-001` с actions открыть destination,
отключить и переподключить; raw counters — в technical details.

### Destructive semantics

Map selection cable/edge и «Удалить» фактически разрушает canonical physical
connection, хотя visually это похоже на presentation removal. Это должно быть
явным «Разорвать соединение» с confirmation о topology consequences и отличаться
от «Убрать объект с карты», удаляющего только `MapPlacement`.

## Saved Maps и L1 presentation

### Что уже работает

Manual test подтверждает понятность основного Physical Saved Map behavior:
explicit placements, MAPS.2a derived simple cable visibility, MAPS.2b off-map
continuation marker, добавление related placed object и independent map scope.
Этот review не меняет SavedMap model или presentation contracts.

### Functional defect candidate

При switching Saved Maps object иногда возвращается/перемещается в top-left
вместо сохранённой позиции. Зафиксировано как кандидат:

```text
persisted MapViewPosition / scene restoration is not reliably stable across
Saved Map switching
```

Причина пока не диагностируется: future implementation должна определить,
не загружается ли position, перезаписывается ли она, выигрывает ли fallback
layout либо scene lifecycle сбрасывает local state.

### Future enhancement

Marker MAPS.2b «ВНЕ КАРТЫ» уже полезен. Возможное future interaction — по click
показать linked remote object, remote port и cable, позволить добавить related
object на current map или открыть карту, где он уже размещён. Это enhancement,
не defect и не реализация MapReference.

## L1 trace

### Что уже работает

`trace PC1 SW1 l1` способен доказать physical path и highlight его на Physical
map. Вызов L1 trace из Logical view переключает Map в Physical view; сам physical
result presentation полезен.

### Согласованное направление

Текстовая команда — developer scaffold. Product interaction ближе к:

```text
Откуда: PC1
Куда: SW1
Уровень: Physical/L1
[Трассировать]
```

Primary L1 trace должен принимать `PhysicalObject -> PhysicalObject` без
обязательного exact interface selection. UI/resolver может рассмотреть
applicable physically realized endpoints: одну proven branch показать сразу,
несколько — как alternatives. Exact port/interface остаётся optional refinement.
Evidence нельзя ослаблять или выдумывать «best» path.

Backend now materializes this bounded PhysicalObject L1 trace boundary; current
Trace Command Bar remains interface-oriented and its product control is still
future work.

Нужно различать одну branch, multiple endpoint branches, no proven path/unknown
frontier и cycle evidence; не требуется enumerate every graph path в cyclic
graph. Physical cycle — самостоятельный diagnostic fact, отличный от future L2
решения forwarding/STP. Перед automatic view switch следует сообщать: «L1 trace
отображается в Physical view».

`Show physical connectivity from this object/port` с component branches, dead
ends, loops и incomplete evidence — optional future investigation UX, не
обязательный следующий milestone.

## Quick Inspector

### UX / information-architecture problem

Сейчас Quick Inspector — почти debug summary: counts, links, technical details,
Open Object, Delete и Remove from Map. Он не отвечает «что это», «что
подключено» и «что можно сделать».

### Согласованное направление

Inspector должен кратко показывать object identity, relevant connectivity и
следующее действие, не копируя весь Object Detail. Для active object это может
быть `SW1`, `Switch · 52 ports`, `Connected: 2 / 52`, затем
`A01 -> PP1/A01`, `A02 -> PP1/A02`; actions — open, trace from object, remove
from map. Для patch panel допустим channel summary.

Для cable/edge primary content — endpoints (`SW1/A01 <-> PP1/A01`) и actions
open endpoints/disconnect, не aggregate/source-ref/projection IDs. Technical
evidence остаётся доступным отдельно.

`Удалить` и `Убрать с карты` имеют radically different semantics. Presentation
action остаётся доступной, а canonical delete должен уйти в explicit destructive
or advanced menu с confirmation о topology consequences.

## Deferred L2/domain questions

Current Object Detail exposes `L2 forwarding -> Создать untagged context` как
large unsorted checkbox list. После созданной L1 cable topology UI не объясняет,
что это отдельная optional higher-layer operation. Это выглядит как
implementation/test scaffold; natural ordering, grouping, search и bulk
operations требуют отдельного L2 UX review после L1 remediation. Данный review
не предлагает L2 redesign plan.

IP phone с uplink network port и downstream PC network port может иметь embedded
bridge/switch forwarding behavior. Это не обязательно passive L1 internal
continuity. Будущая L2 modeling должна рассмотреть этот случай отдельно и не
моделировать telephone passthrough passive cable только ради удобства UI.

## Классификация и завершение review

В этой заметке findings классифицируются как: **KEEP** (successful current
behavior), **UX/information-architecture problem**, **missing product
capability**, **functional defect candidate**, **future enhancement** и
**deferred L2/domain question**. Не каждый finding — bug. Явные functional
defect candidates: нестабильное восстановление MapViewPosition при switch map,
asymmetric/misleading physical endpoint selector, destination picker без
compatible free endpoints и «Показать на карте» без `MapPlacement`.

Manual L1 UI review завершён для current product subset:

```text
Blueprint -> object -> Catalog -> Object Detail -> ports -> physical cabling
    -> Saved Map -> L1 trace -> Quick Inspector
```

Следующий шаг — не немедленная implementation. Этот review служит входом для
отдельного bounded L1 UI remediation plan, который при необходимости сгруппирует
проблемы по user workflow, а не по React component/file. Эта заметка не вводит
milestone numbers, implementation order, новых architecture layers или изменений
canonical contracts.
