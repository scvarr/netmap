# L1 Roadmap Review Log

Временный последовательный журнал текущего docs-only review перед
пересборкой roadmap NetMap до L2.

Окончательный порядок implementation items по milestone здесь не фиксируется.

## RVR-001 — Exact-evidence подсветка L1 trace branch

- Краткое описание: при L1 trace, если между одной парой `PhysicalObject`
  существуют несколько отдельных `Cable`, выбранная trace branch может
  визуально подсвечивать лишние parallel Cable.
- Тип: bug / correctness regression.
- Severity: HIGH.
- Влияние на L1 completion: прямое нарушение корректности trace presentation;
  L1 completion блокируется до устранения.
- Blocker до L2: да.
- Behavior-preserving: да.
- Benchmark: нет.
- Зависимости: нет.
- Подтвержденная фактическая причина: Cable presentation может опираться на
  общий supporting projection edge, а trace highlighting использует этот общий
  edge как достаточное условие. Поэтому exact branch через один Cable
  расширяется на соседние Cable между той же парой объектов.
- Согласованное решение: визуальная подсветка выбранной L1 trace branch
  следует exact canonical evidence. Общий projection/presentation edge между
  `PhysicalObject` недостаточен для доказательства конкретного Cable. Для
  Cable-backed связи подсвечивается только exact Cable / `ConnectionMember`,
  доказанный выбранной branch; parallel Cable не подсвечиваются только из-за
  общего projection edge. То же правило exact evidence применяется к direct
  `ConnectionMember` и internal passive continuity. Presentation collapse
  никогда не расширяет canonical trace result.
- Acceptance: при нескольких Cable между одной парой `PhysicalObject`, если
  selected trace branch использует один Cable, highlighted остаются только
  exact evidenced Cable/`ConnectionMember`; остальные parallel Cable не
  highlighted.
- Статус: RECORDED.

## RVR-004 — Location assignment tree/search/inline-create UX

- Краткое описание: PhysicalObject Location assignment использует плоский
  select с полными Location paths. Для arbitrary-depth hierarchy, например
  «здание → помещение → стойка → U01...U42», такой picker плохо масштабируется.
  Для создания отсутствующего Location пользователь вынужден покидать object
  workflow и переходить на отдельную Locations page.
- Тип: UX debt / Location.2 workflow completion.
- Severity: MEDIUM.
- Влияние на L1 completion: Location assignment workflow не завершен для
  больших иерархий; L1 completion блокируется.
- Blocker до L2: да.
- Зависимости: существующие Location.1/Location.2 API и semantics.
- Backend/domain capability: не требуется; canonical semantics сохраняются.
- Согласованное решение: заменить длинный плоский select основным
  tree/search picker. Первой строкой является case-insensitive поиск минимум по
  name и full hierarchical path; результаты сохраняют context через
  необходимые ancestors. Ниже показывается collapsible tree с accessible
  expand/collapse controls; дерево не обязано раскрываться целиком, но путь
  текущего assigned Location раскрывается при открытии picker. Selection
  остается single-choice.
- Согласованное решение (create): в каждой раскрытой ветке после children
  доступно «Добавить» для direct child, а на root level — создание root
  Location. Inline create использует существующую canonical семантику
  `name + optional arbitrary user-defined type + explicit parent`, без fixed
  taxonomy или presentation-owned Location.
- Согласованное решение (write lifecycle): после успешного create
  authoritative tree reloads, новый Location становится selected candidate в
  текущем draft, но PhysicalObject не переназначается автоматически. Create и
  assignment остаются двумя отдельными canonical writes; association меняется
  только явным «Сохранить». Ошибка create не меняет association, а retry после
  acknowledged create и failed refresh повторяет только refresh.
- Границы: picker не получает edit/reparent/delete; эти actions остаются на
  полноценной Locations management surface.
- Acceptance: большая hierarchy просматривается collapsed tree; current path
  раскрывается; поиск `U42` показывает U42 с ancestors; Add под стойкой создает
  child именно стойки; новый child после reload выбран как draft candidate;
  association не меняется до Save; Save назначает Location; create failure и
  refresh retry не меняют association и retry не повторяет create; edit,
  reparent и delete в picker отсутствуют.
- Статус: RECORDED.

## RVR-002 — Broken Cable catalog link

- Краткое описание: во вкладке «Кабели» имя Cable отображается как clickable
  link; клик ведет в PhysicalObject Details и завершается ошибкой
  `PhysicalObject does not exist`.
- Тип: bug / regression после Cable-as-PhysicalObject cutover; UX/correctness
  navigation.
- Severity: MEDIUM.
- Влияние на L1 completion: Cable catalog содержит неверную навигацию и
  вводит в заблуждение о domain identity; L1 completion блокируется.
- Blocker до L2: да.
- Behavior-preserving: да.
- Зависимости: нет.
- Подтвержденная фактическая причина: для Cable используется
  `item.cable_ref.entity_id`, имя оборачивается в `Link to={objectLink(id)}`,
  `objectLink()` ведет на `/infrastructure/objects/:id`, а этот route
  обслуживается `InfrastructureObjectDetailPage`. По действующему domain
  contract Cable не является `PhysicalObject`.
- Согласованное решение: Cable никогда не маршрутизируется через PhysicalObject
  Details. Пока отдельной Cable Details surface нет, Cable label в catalog —
  обычный текст без ссылки. Ссылки на PhysicalObject на концах Cable остаются.
  Отдельная Cable Details page сейчас не создается; при возможном появлении
  она должна иметь собственный Cable-specific route/lifecycle.
- Acceptance: в Cable row click-target на самом Cable label отсутствует;
  endpoint PhysicalObject links остаются рабочими; Cable identity не
  передается в `/infrastructure/objects/:id`.
- Статус: RECORDED.

## RVR-003 — User-editable Cable label

- Краткое описание: Cable отображается техническим именем вроде
  `Cable 3b710bd8`, и пользователь не может задать или изменить нормальное
  имя.
- Тип: UX gap / existing planned Cable.3 capability.
- Severity: MEDIUM.
- Влияние на L1 completion: обязательная usability-часть Cable.3 не завершена;
  L1 completion блокируется как часть Cable.3 product usability.
- Blocker до L2: да.
- Behavior-preserving: да.
- Benchmark: нет.
- Зависимости: Cable.3 metadata foundation.
- Подтвержденный контекст: действующий Cable.3 contract уже планирует optional
  `label`; catalog DTO допускает `label_source = TECHNICAL_FALLBACK`.
- Согласованное решение: Cable получает optional mutable user-facing label.
  Отсутствие label допустимо; тогда UI использует deterministic technical
  fallback, например существующий `Cable <short-id>`, который не становится
  canonical user label автоматически. Пользователь может задать, изменить и
  очистить label. Это не меняет Cable identity, linked Connection, endpoints,
  `MapCableRoute` references, trace semantics или topology. Write boundary
  должна быть Cable-specific и не переиспользовать PhysicalObject rename API.
  Основной Cable catalog предоставляет понятное rename/edit action. До
  отдельно согласованной Cable Details surface label остается plain text.
- Acceptance: (1) Cable без user label показывает technical fallback; (2)
  rename после authoritative refresh показывает user label; (3) clear label
  возвращает technical fallback; (4) Cable UUID, Connection, endpoints и
  routes не меняются; (5) PhysicalObject write boundary не используется.
- Статус: RECORDED.

## RVR-005 — Compact Port Block library table

- Краткое описание: Port Module / Port Block library сейчас использует grid
  карточек с миниатюрами портов. Preview показывает ограниченное число
  numbered cells и не является authoritative representation реального layout;
  при росте библиотеки карточки также занимают слишком много места.
- Тип: UX debt / visual consistency / library usability.
- Severity: LOW.
- Влияние на L1 completion: обязательный UI polish до финального L1
  real-world acceptance; correctness не блокирует.
- Blocker до L2: да. Это не correctness blocker, но обязательный L1
  UI-polish до real-world acceptance / L1 COMPLETE; переход к L2 предполагает
  его закрытие.
- Зависимости: нет.
- Backend/API capability: не требуется.
- Подтвержденный scope: существующий `PortBlockListItem` уже содержит `name`,
  `version_number`, `version_count` и `port_count`; list API расширять не
  требуется.
- Согласованное решение: основной catalog переводится на компактную таблицу
  NetMap с колонками Название, Текущая версия, Версий, Портов и Действия.
  Миниатюры из catalog удаляются. New version сохраняется как компактное row
  action, Delete — как компактное destructive action с tooltip и accessible
  label. Реальное visual/layout представление остается на version editor и
  composition surfaces для конкретной immutable `PortBlockVersion`.
- Границы: immutable version semantics, PortBlock identity, Blueprint
  provenance и deletion lifecycle не меняются. Это кандидат в bounded L1
  UI-polish перед real-world acceptance, не отдельная architecture capability.
- Acceptance: library отображается таблицей без card/grid previews; строки
  показывают name/current version/version count/port count; New version
  открывает текущий exact current-version authoring flow; Delete сохраняет
  lifecycle/conflict semantics; backend/API changes отсутствуют.
- Статус: RECORDED.
