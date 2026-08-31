# 09. Рабочий L1 UI/UX review

## Статус и назначение

Документ отделяет исходный ручной обзор от выполненного исправления на текущем
`main` и от настоящего открытого списка работ. Он не меняет каноническую модель
предметной области, семантику resolver, API или persistence. Это historical
audit trail; current canonical execution order находится в
[[plans/11-03-pre-l2-product-completion|11.3 Pre-L2 product completion]].
[[plans/09-01-l1-spatial-foundation-plan|09.1 L1 spatial foundation]] остается
spatial foundation/history/contract document, но не current global completion
roadmap.
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
- Ports представлены рабочей таблицей с состоянием и доказанным соседним
  endpoint; natural ordering, компактная primary presentation и окончательное
  исключение технических данных из списка остаются scope активного
  [[plans/09-04-l1-product-ux-completion|09.4 UX completion]].
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
- Разрыв физической связи определён как отдельное destructive действие и не
  смешивается с удалением объекта с карты; полностью доступный в primary UX
  disconnect workflow с подтверждением остаётся scope активного 09.4.

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

## Historical/open backlog at time of this review

### L1 spatial foundation

L1S.1–L1S.6 завершены. Перед Regions выполняется активный
[[plans/09-04-l1-product-ux-completion|09.4 L1 Product UX completion]] pass;
после него остаются L1S.7 Regions, L1S.8 MapReference и L1 acceptance по
[[plans/09-01-l1-spatial-foundation-plan|плану L1S]]. До конкретных milestones
остаются открытыми окончательные storage/API/DTO shape, collision policy и
точный visual design.

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

После 09.4, L1S.7–L1S.9 и обязательной до-L2 stabilization L2 не следует
понимать как L1 map с VLAN labels. Это отдельная
semantic projection с объяснимой aggregation/collapse, supporting evidence refs
и раскрытием к individual endpoints/interfaces/facts. L1 главным образом
масштабируется через spatial hierarchy и detailed Saved Maps, L2 — через semantic
aggregation. Точные grouping heuristics намеренно отложены до L2 UI work; принцип
зафиксирован в [[architecture/presentation/05-presentation|presentation contract]].

## Не является automatic gate для L2

После 09.4, L1S.7–L1S.9, обязательной до-L2 stabilization и pre-L2
productization L2 не следует понимать как L1 map с VLAN labels. Optical/
fiber-member capability теперь имеет concrete optical patch-panel use case:
gap находится в Blueprint/PortBlock authoring/materialization поверх уже
member-aware canonical L1 foundation. Capability пока не promoted; promotion
решается на representative real-world L1 acceptance, если без нее нельзя
truthfully моделировать target equipment. Другие speculative extensions без
конкретной необходимости не становятся обязательными автоматически.

## Нормализация review status

Этот исторический review остаётся audit trail. Текущий canonical execution
order находится в [[plans/11-03-pre-l2-product-completion|11.3 Pre-L2 product
completion]].
