# Spatial location presentation contract

## Статус и граница

Это главный целевой contract hierarchical Location presentation NetMap.
Целевой contract согласован; P-UX-03B expanded derived Location frames
реализован. P-UX-03A удалил development-stage `MapComposite` и manual
`MapRegion`; P-UX-03C/D реализованы, P-UX-03E остаётся **IMPLEMENTATION PENDING**.

NetMap pre-production. Если старые spatial models конфликтуют с этим
contract, они удаляются; compatibility layers, converters, fallback readers и
параллельная поддержка old/new моделей не создаются. Уже опубликованные
Alembic revisions не переписываются: удаление schema выполняется новой forward
migration.

## Canonical Location hierarchy

`Location` — canonical physical place с явной иерархией произвольной глубины.
`Location.type` остаётся optional arbitrary user-defined string; встроенная
taxonomy `building/floor/room/rack/unit` не вводится. `PhysicalObject ->
Location` остаётся canonical assignment. Map geometry, presentation state и
map routes никогда не создают и не изменяют Location facts.

Например, `SERVER-ROOM-808 -> RACK-811 -> U01 ... U42` состоит только из
обычных `Location`; U01/U42 не являются специальными rack entities.

## Карта и варианты компоновки

- `SavedMap` — карта; она содержит один набор размещённых объектов.
- `MapPresentationVariant` — компоновка этой карты.
- `Location` — местоположение.
- `derived Location frame` — вычисляемая область Location в конкретной
  компоновке карты.

Варианты показывают одну и ту же карту по-разному: всё раскрыто, часть
Locations свёрнута, часть непосредственных элементов оставлена видимой;
координаты и `MapCableRoute` могут различаться. Canonical topology и Location
hierarchy между вариантами не меняются.

## Location presentation state и непосредственные элементы

Для пары `MapPresentationVariant + Location` может существовать
presentation state:

- `collapsed` / `expanded`;
- набор непосредственно принадлежащих Location элементов, оставляемых
  представленными при collapse.

P-UX-03C хранит это в `map_location_states`: `variant_id`, `location_id`,
`collapsed` и список `{entity_type, entity_id}` с canonical UUID. Отсутствие
строки означает expanded с пустым visible set. Expanded сохраняет настроенный
set для следующего collapse. Ref проверяется при записи по текущей canonical
иерархии, а при чтении stale refs игнорируются. Состояние удаляется с variant
или Location; геометрия и membership здесь не хранятся. SavedMap detail
возвращает состояния только активного variant одним пакетным чтением; PUT
полного состояния конкретного Location идемпотентен. При копировании variant
его Location states копируются независимо.

Непосредственный элемент Location L — это только:

1. `PhysicalObject`, чей canonical `location_id == L`;
2. `Location`, чей canonical `parent_id == L`.

Collapse policy не выбирает произвольных глубоких descendants и не хранит
дублированный membership объектов. Для `SERVER-ROOM` с детьми `RACK-01` и
`UPS-01` выбор касается только этих двух элементов; `SW-01` внутри RACK-01
там не предлагается. Состояние дочернего Location применяется рекурсивно в
той же `MapPresentationVariant`.

## Hierarchical scene и collapse

Expanded Location показывает свои непосредственные элементы с рекурсивным
применением состояний дочерних Locations. Collapsed Location создаёт derived
presentation proxy с explicit grouping basis — конкретным Location. Proxy не
является canonical entity, `PhysicalObject`, `Connection` или Cable endpoint.
Collapse родителя не уничтожает и не переписывает state дочерних Locations.

Visible direct child Location рекурсивно применяет собственное состояние;
скрытые displayed descendants одного Location дают один компактный proxy.
Frame для partial collapse вычисляется по видимым direct representations и
этому proxy; при полном collapse остаётся только proxy. Скрытый endpoint
PhysicalObject определяется по canonical direct membership, а не по геометрии.
Реальные Cables сохраняют собственные identity и exact evidence: same-proxy
кабель не рисуется, остальные подключаются к текущему proxy anchor.
`MapCableRoute.waypoints` не изменяются из-за collapse/expand. L1 off-map
continuation использует proxy anchor скрытого локального объекта. Trace
подсвечивает proxy, если скрытый объект был подсвечен.

Boundary connectivity остаётся основанной на exact canonical evidence.
Presentation aggregation не создаёт topology relation, не меняет endpoint и не
расширяет trace truth.

## Dynamic Location frame

Frame geometry всегда derived из текущей hierarchical presentation scene и не
persisted. Она меняется при movement, resize, collapse и expand; вложенные
Locations дают вложенные presentation areas. Пустой Location без отображаемого
содержимого не получает guessed geometry.

Для expanded presentation полный frame рисуется при двух или более
непосредственных отображаемых элементах (PhysicalObjects и непустых дочерних
Locations). Unary Location сохраняется в компактном path label единственного
descendant, без отдельного слоя frame padding/header; цепочка таких Locations
даёт один path на branching frame или как вторичный label в nameplate
единственного PhysicalObject.
Это не меняет canonical hierarchy или membership.
Expanded frame bounds — union отображаемых объектов и retained child frames с
небольшим одинаковым padding. Label лежит на границе frame и не резервирует
отдельный header. Unary object label — только presentation context внутри
существующего node header; он не меняет footprint или bounds родительского frame.

Если дочерний Location свёрнут в компактный proxy, frame родителя вычисляется
по этому текущему presentation, а не по скрытым развёрнутым объектам.

Frame не является polygon Location, не имеет persisted x/y/width/height и не
создаёт Location facts.

## Group move

Frame Location является интерактивной управляющей поверхностью. Перемещение
Location применяет одинаковый delta ко всем `MapPlacement` PhysicalObject,
принадлежащим canonical subtree Location в текущем variant, включая скрытые
collapse-ом placements. Canonical topology и Location assignment не меняются.

Collision validation учитывает все перемещаемые placements. Если итоговое
положение пересекается с объектом вне subtree, операция отклоняется; automatic
re-layout не выполняется.

P-UX-03D перемещает только позиции L1/PHYSICAL_OBJECT активного variant через
drag заголовка отображаемого frame. Locked member отклоняет весь gesture.
Клиент посылает один displacement и текущую geometry evidence; сервер заново
разрешает canonical subtree, сверяет активные позиции и проверяет конечные
прямоугольники перед атомарной записью. Отсутствующие позиции не создаются.
После записи клиент повторно читает authoritative variant; при ошибке чтения
повторяется только чтение.

## Cable route semantics при group move

Для перемещаемого subtree Cable классифицируется так:

- **internal** — оба endpoint внутри: objects и свободные waypoints сохранённой
  route получают тот же delta; boundary anchors разрешаются из новой derived
  geometry связанных frames;
- **external** — оба endpoint снаружи: не меняется;
- **boundary** — ровно один endpoint внутри: свободные waypoints до первого
  выхода через границу движутся с subtree, внешний suffix остаётся на месте.
  Boundary anchor остаётся привязанным к LocationFrame и следует за его новой
  derived geometry; connecting участок перестраивается.

Если `MapCableRoute` отсутствует, renderer пересчитывает обычную линию от
нового endpoint. Persisted group move, затрагивающий positions и routes,
является одной пользовательской операцией с атомарной server-side write
boundary. `MapCableRoute.waypoints` активного variant допускает обычные `{x,y}`
и boundary anchor `{x,y,anchor:{location_id,edge,offset}}`, где edge —
`top|right|bottom|left`, offset нормализован в `0..1`. `x/y` у anchor служат
snapshot/fallback; при renderable frame его binding определяет положение.
Frame bounds не сохраняются. Редактор показывает anchor отличным маркером и
проецирует его drag на периметр связанного frame. При сохранении route
пересечения renderable frames нормализуются в anchors; повторное сохранение
не создаёт дубликатов. Явный anchor для конкретного Location имеет приоритет
над повторным geometric split этого Location; anchors других Locations
независимы. Несколько anchors одного Location пока означают unsupported
re-entry и отклоняются. Legacy `{x,y}` route читается без mutation; открытие
редактора может нормализовать его только в transient draft, без persistence.
Persisted mutation выполняется только при Save route или group move. Если
group move требует anchor для legacy boundary route, сервер материализует его
в той же транзакции, что positions и route transform. При отсутствии explicit
anchor единственный geometric crossing материализуется; повторный выход и
re-entry одного Location пока отклоняется. Эти presentation waypoints не
меняют canonical topology, Cable endpoints или Location hierarchy.

## MapComposite и MapRegion: superseded

Удалённый `MapComposite` implementation superseded этой Location-driven
hierarchical presentation model и больше не является target product
capability. Его membership, API, schema и UI не сохраняются, не
конвертируются в Locations и не поддерживаются параллельно. Допустимо
переиспользовать отдельные алгоритмы boundary detection, collapsed proxy,
frame geometry, exact evidence и rendering helpers в будущих milestones.

Manual `MapRegion` также не является target capability и удалён без
конвертации development polygons в Location frames. `MapTextAnnotation`
остаётся самостоятельной presentation capability.

`MapReference` остаётся future optional navigation между независимыми
`SavedMap`; он не является Location, не доказывает physical containment и не
является canonical topology aggregate. Его schema, API и interaction здесь не
проектируются.

## Массовое создание Locations: P-UX-19

Ближайшая отдельная capability — **P-UX-19 — Location series creation**.
Пользователь задаёт parent, pattern, range и step, например `Parent: RACK-811`,
`Pattern: U##`, `From: 1`, `To: 42`, `Step: 1`, чтобы получить `U01 ... U42`.

Contract:

- pattern содержит одну непрерывную группу `#`;
- число `#` задаёт ширину: `# -> 1`, `## -> 01`, `### -> 001`;
- значение, не помещающееся в ширину, является ошибкой;
- preview показывается до записи, конфликты выявляются до записи;
- optional `Location.type` применяется ко всей серии;
- операция атомарна: создаются все Locations либо ни один;
- создаются только canonical Locations, без автоматического SavedMap или
  presentation state;
- persisted `LocationTemplate` сейчас не вводится.

Existing Cable label template model не является domain source. Общий
string-generation helper можно переиспользовать позднее, если это оправдано.

## Future / open boundaries

- **Ordered child layout.** Generic capability для rack units, chassis slots,
  shelves и cassette positions; без `Location.type == rack`.
- **Physical occupancy.** Отдельная будущая canonical capability вроде
  `anchor = U10; occupies U10..U13`; текущий assignment не становится
  many-to-many.
- **Selector-based collapse rules.** Позднее predicate может выбирать
  непосредственные элементы, но не меняет topology facts и не вводит taxonomy.
- **Reusable Location series templates.** OPEN; только при доказанной
  необходимости повторного использования.
- **Arbitrary non-physical grouping.** OPEN; MapComposite ради гипотетического
  use case не сохраняется, новая capability проектируется отдельно при
  реальной необходимости.

## Relationship boundary

Canonical Location/topology facts -> presentation projection -> hierarchical
scene and derived frames -> layout/presentation -> canvas. Presentation не
является topology evidence. `SavedMap`, variants, placements, routes,
Location state и text annotations — presentation concerns; `Location`,
PhysicalObject assignment, endpoints, Connections и Cables сохраняют свои
canonical semantics.
