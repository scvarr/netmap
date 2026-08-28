# 09. Рабочий L1 UI/UX review

## Статус и назначение

Документ отделяет исходный ручной обзор от выполненного исправления на текущем
`main` и от настоящего открытого списка работ. Он не меняет каноническую модель
предметной области, семантику resolver, API или persistence. Конечный порядок дальнейших работ — в
[[plans/09-01-l1-spatial-foundation-plan|09.1 Плане завершения L1 spatial foundation]].
Product/presentation invariants — в [[architecture/presentation/05-presentation|05. Представление]],
реализованный frontend contract — в [[architecture/presentation/08-ui-implementation|08. UI implementation contract]].

## Исходные наблюдения review

Ниже сохранены полезные причины первоначального исправления; это не описание
текущего состояния продукта.

- Object Library и Blueprint authoring подтвердили полезность endpoint groups,
  materialized immutable versions, preview и bulk pair-by-index для типовых
  passive objects.
- Template-first путь должен быть основным: `Blueprint -> PhysicalObject ->
  Catalog -> Object Detail -> ports -> cabling -> Saved Map -> L1 trace`.
  Ручное создание без Blueprint остаётся допустимым расширенным путём, а не
  canonical запретом.
- Большие карточки `ConnectionPoint`, плоский Catalog и смешение канонического
  `NetworkInterface` с physical cable endpoint не давали рабочего ответа:
  какой это порт, с чем он связан и что можно сделать.
- У `Saved Map` нужно было различать membership, placement и canonical topology;
  insertion требовал понятной точки и устойчивого жизненного цикла координат.
- Blueprint authoring требовал русской терминологии, понятного цвета и объяснения
  pair-by-index; обычное structural editing конкретного instance конфликтовало
  с immutable version lifecycle.
- L1 trace требовал object-level взаимодействия без обязательного выбора
  `NetworkInterface`, evidence-based карты и честного отображения нескольких
  доказанных вариантов без «лучшего» пути.

## Что реализовано на текущем main

Эти пункты закрыты и не должны снова попадать в backlog как отсутствующие
возможности.

### Catalog, Object Detail и ports

- Catalog разделяет equipment и cables, показывает доказанные cable endpoints,
  поиск/фильтрацию, переименование и явные Saved Map memberships.
- Object Detail показывает map membership и позволяет добавить equipment на карту.
- Ports представлены компактной рабочей таблицей с natural ordering, состоянием и
  доказанным соседним endpoint; технические детали остаются вторичными.
- Paired passive device показывается через channels, а не через две несвязанные
  карточки портов.
- Ordinary per-instance structural editing Blueprint instance запрещено; обычное
  structural change идёт через новую immutable Blueprint version и будущий
  controlled upgrade.

### Blueprint и physical cabling

- Blueprint Editor использует русскую терминологию, visual color picker и exact
  `#RRGGBB`; pair-by-index объяснён как правило соединения соответствующих портов.
- Основной cabling workflow начинается с physical port/`ConnectionPoint`; сетевой
  interface не является альтернативным cable endpoint.
- Рабочий Quick Inspector показывает доказанные cable endpoints и понятные
  действия.
- Разрыв физической связи — отдельное destructive действие с явным смыслом; оно
  не смешивается с удалением объекта с карты.

### Saved Map и L1 trace

- Saved Map insertion создаёт только `MapPlacement` существующего объекта, не
  topology; жизненный цикл координат стабилен и независим для Physical/Logical
  view.
- `PhysicalObject -> PhysicalObject` L1 trace доступен в основном UI. Каждый
  endpoint может быть optional refined exact `ConnectionPoint`; «Любой порт»
  оставляет object-level запрос.
- Несколько доказанных branch показываются как явные alternatives. Physical map
  строит overlay только по canonical evidence выбранной branch, а не по geometry
  или самостоятельному graph traversal.

## Действительно открытый backlog

### L1 spatial foundation

Оставшиеся L1 работы имеют намеренно ограниченную последовательность L1S.1–L1S.9
в [[plans/09-01-l1-spatial-foundation-plan|плане L1S]]: control canvas, стабильное
размещение, внутренняя continuity, контракт/отрисовка маршрута кабеля/visual wiring,
завершение Blueprint authoring, controlled instance upgrade, regions, MapReference
и L1 acceptance. До конкретных milestones остаются открытыми окончательные
storage/API/DTO shape, collision policy и точный visual design.

### Blueprint authoring и version lifecycle

Открыты более точная geometry endpoint groups, различимость нескольких groups на
одной стороне, основной UX для stable keys и inspect/edit individual arbitrary
internal mappings. Pair-by-index остаётся удобным bulk generator, но не покрывает
все возможные mappings.

Controlled Blueprint instance upgrade также остаётся будущей возможностью: нужен
список instances старой version, dry-run compatibility analysis, compatible
changes/blockers и explicit apply. Upgrade сохраняет identity `PhysicalObject` и,
когда возможно, generated slots; connected/bound destructive changes не должны
применяться silently и upgrade не может быть delete/recreate объекта.

### L2 — отдельный следующий UI-трек

После L1S.9 L2 не следует понимать как L1 map с VLAN labels. Это отдельная
semantic projection с объяснимой aggregation/collapse, supporting evidence refs
и раскрытием к individual endpoints/interfaces/facts. L1 главным образом
масштабируется через spatial hierarchy и detailed Saved Maps, L2 — через semantic
aggregation. Точные grouping heuristics намеренно отложены до L2 UI work; принцип
зафиксирован в [[architecture/presentation/05-presentation|presentation contract]].

## Не является gate для L2

После выполнения L1S.1–L1S.9 старт L2 не должен ждать `PointMember`/`member_index`
UI refinement, полный optical/fiber-member UX, ducts/bundles, вычисление физической
длины кабеля или другие speculative L1 extensions без конкретного use case.
