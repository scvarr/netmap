# L1 Roadmap Review Log

Временный последовательный журнал текущего docs-only review перед
пересборкой roadmap NetMap до L2.

## Статус normalization

Intake review завершен на текущем checkpoint. Согласованные decisions
normalized в canonical target docs; текущий execution roadmap —
[[plans/11-03-pre-l2-product-completion|11.3 Pre-L2 product completion]]. Этот
файл остается audit trail/provenance. Новые L1 observations могут породить
новые bounded review items, но canonical docs и roadmap 11.3 остаются source
of truth.

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

## RVR-007 — Composite/hierarchical presentation capability family

- Краткое описание: flat SavedMap scene заставляет пользователя вручную
  воспроизводить пространственную и составную структуру, уже частично
  известную из domain facts: Location hierarchy, PhysicalObject composition,
  nested SavedMap и будущие hosting/virtualization relations. Эти relations
  имеют разную semantics и не должны сводиться к одному universal parent.
- Тип: architecture change / new presentation capability family.
- Architectural priority: HIGH.
- Влияние на L1 completion: это изменение направления, а не обязательство
  реализовать весь generic scene engine до L2. Полная generic capability не
  является blocker L1 COMPLETE / перехода к L2.
- Blocker до L2: нет для полной capability. До standalone MapReference
  implementation необходимо сначала согласовать его место в общем
  composite/hierarchical presentation contract; bounded pre-L2 subset будет
  определен только после завершения review.
- Зависимости: existing Projection/Aggregation contract; MapReference должен
  быть архитектурно reconciled до standalone implementation.
- Согласованное решение: зафиксировать концептуальную pipeline
  `canonical/derived facts → Projection → hierarchical/composite scene →
  layout/presentation → canvas`. Общим является только presentation mechanism;
  точная граница Projection DTO и scene document остается OPEN.
- Fixed invariants: не вводить universal canonical `Object.parent`; сохранять
  независимыми Location parent hierarchy, `PhysicalObject.parent_object`,
  SavedMap/MapReference composition и будущие hosting relations. Composite node
  остается derived presentation object; one-way flow не выводит domain facts из
  position, resize, container geometry, collapse/expand, auto-layout или
  overrides. Collapsed boundary connectivity выводится из supporting
  canonical/derived topology/evidence, не создает synthetic Connection и
  сохраняет refs/explainability.
- Дополнительные границы: Location может быть composition basis без
  canonical containment; rack layout — specialized policy без интерпретации
  `Location.type` как fixed Rack taxonomy и без rack occupancy domain model;
  PhysicalObject composition не смешивается с Location; MapReference остается
  presentation-only consumer общего contract; Region остается отдельной
  manual SavedMap-owned geometry; future VM/VirtualSwitch/hosting domain не
  вводится этим item.
- OPEN: persisted composite/scene object; принадлежность hierarchy Projection
  или отдельному scene layer; сохранение geometry/overrides; rack occupancy и
  layout policies; boundary attachment algorithm; simultaneous hierarchies;
  manual-vs-auto layout; grouping UX; incomplete/conflicting data behavior и
  future virtualization semantics.
- Roadmap impact: standalone MapReference нельзя начинать только потому, что
  он следующий в старом roadmap. После полного review будет решено, какой
  bounded consumer, если вообще какой, нужен до L2. Item является umbrella
  capability/decomposition item, не огромным implementation milestone.
- Статус: RECORDED.

## RVR-006 — Русская терминология PortBlock

- Краткое описание: в русской пользовательской локализации PortBlock сейчас
  называется «Портовый модуль / Портовые модули», что звучит неестественно.
- Тип: terminology / localization polish.
- Severity: LOW.
- Влияние на L1 completion: обязательный UI polish до L1 COMPLETE; correctness
  не блокирует.
- Blocker до L2: да. Это не correctness blocker, но переход к L2 предполагает
  закрытие обязательного L1 terminology polish.
- Зависимости: нет.
- Semantic/domain/API changes: нет.
- Согласованное решение: во всех русских user-facing PortBlock strings,
  включая navigation, library, breadcrumbs, create/version editor, errors,
  confirmations, accessibility labels и hints, использовать «Группа портов»
  в singular и «Группы портов» во plural с корректным склонением по контексту.
  Английскую локализацию не менять.
- Границы: внутренний `PortBlock` implementation/domain термин не
  переименовывается; не меняются types/interfaces, entity names, API, routes,
  filenames, database/schema и immutable version semantics. Пункт отдельный от
  RVR-005, хотя при финальной decomposition они могут выполняться вместе как
  дешевый L1 UI-polish.
- Acceptance: в русском UI отсутствуют user-facing «Портовый модуль» и
  «Портовые модули»; используются «Группа портов» и «Группы портов»;
  implementation/domain identity `PortBlock` и английская локализация не
  изменены.
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

## RVR-008 — Pre-L2 UI/UX audit and shared design system

- Краткое описание: frontend развивался несколькими bounded passes и ощущается
  как набор independently evolved surfaces; следующий крупный визуально-UX
  этап требует audit и controlled migration, а не локального CSS cleanup.
- Тип: product/UX architecture direction.
- Severity: N/A.
- Влияние на L1 completion: обязательная product-readiness работа до final
  product acceptance / L1 PRODUCT COMPLETE; это не network-semantics blocker и
  не correctness blocker.
- Blocker до L2: да. Это обязательная product-readiness boundary до перехода к
  L2, хотя не является network-semantics или correctness blocker.
- Зависимости: нет.
- Согласованное решение: один shared design system с несколькими page
  archetypes: inventory/list, object detail, form/editor, catalog/library,
  canvas/workspace и modal/task flow. Shared primitives покрывают typography,
  spacing, actions, forms, tables, dialogs, inspectors, selection states,
  loading/error/empty/destructive states и keyboard/focus conventions.
- Границы и метод: NetBox/Nautobot допустимы как UX reference для
  inventory/admin surfaces, но не как visual clone. Map и Blueprint editor
  сохраняют canvas/workspace patterns при общих primitives/state semantics.
  Big-bang rewrite не планируется: audit → primitives/archetypes → controlled
  surface-by-surface migration. Usability validation task-based; UX defects
  (не найдено действие, непонятен термин/state, ошибка workflow) имеют приоритет
  над visual/style defects.
- Roadmap placement: после достаточного functional/semantic freeze L1 и до
  final product acceptance / L1 PRODUCT COMPLETE. Работа не создает сейчас
  новый canonical документ или отдельный implementation milestone.
- Статус: RECORDED.

## RVR-011 — Pre-L2 product readiness / L1 PRODUCT COMPLETE boundary

- Краткое описание: L1 semantic completion недостаточен для перехода к L2;
  NetMap должен сначала стать practically usable standalone/multi-user
  application.
- Тип: product architecture / roadmap direction.
- Severity: N/A.
- Architectural/product priority: HIGH.
- Влияние на L1 completion: вводит обязательную product-readiness boundary
  между semantic completion и L1 PRODUCT COMPLETE.
- Blocker до L2: да.
- Зависимости: decomposition существующих L1 readiness, workspace, identity,
  access, sharing, accountability, UI/UX и acceptance concerns.
- Согласованное решение: различать pipeline `L1 semantic completeness →
  pre-L2 productization → L1 PRODUCT COMPLETE → L2 semantic expansion → L3`.
  L1 semantic completeness означает достаточную physical-domain foundation и
  основные L1 workflows; L1 PRODUCT COMPLETE означает practically usable
  standalone application. L2 начинается только после L1 PRODUCT COMPLETE.
- Обязательные product families до L2 (без exact milestones/schemas): L1
  readiness и promoted real-world gaps; persisted NetworkWorkspace как
  application isolation boundary и завершение implicit-default transition;
  application identity/authentication; workspace-context authorization/access
  control без user/ACL semantics в resolvers; practically usable sharing;
  sufficient multi-user activity/audit accountability; UI/UX audit, shared
  design system, controlled migration и task validation; final standalone/
  multi-user end-to-end product acceptance.
- Scope discipline: наличие capability в `docs/architecture/workspaces/07-workspaces.md`
  само по себе не делает ее pre-L2 requirement. Fork/merge/compare,
  export/import, library packages, comments/annotations, PUBLIC_READ/public
  links, groups, optimized copy-on-write, map templates/cloning и иные
  collaboration/portability features требуют отдельной product-necessity
  оценки. Capability обязательна до L2 только если без нее приложение нельзя
  разумно считать practically usable согласно итоговому product contract.
- OPEN: exact milestone order; auth provider; ACL/storage strategy; sharing
  semantics; optional collaboration/portability scope; точный final
  public-release gate. Item — umbrella/decomposition, не один implementation
  milestone и не основание для бесконечного расширения scope.
- Roadmap impact: текущая placement полноценной multi-user foundation после
  L2/L3 должна быть пересмотрена при final normalization.
- Статус: RECORDED.

## RVR-009 — Task-based real-world L1 acceptance gate

- Краткое описание: существующий real-world L1 acceptance stage требует
  уточнения execution/product-quality contract, чтобы проверять NetMap на
  representative network workflows, а не только на synthetic fixtures/tests.
- Тип: acceptance / product validation gate.
- Severity: N/A.
- Влияние на L1 completion: обязательная acceptance stage; L1 COMPLETE
  блокируется до ее прохождения.
- Blocker до L2: да.
- Зависимости: текущий roadmap acceptance stage и финальная L1 readiness.
- Согласованное решение: acceptance выполняется на постепенно наращиваемом
  representative dataset (например rack → room/server room → floor →
  building/site без фиксации taxonomy) с реальными equipment types, port
  layouts, physical connections и cable paths.
- Проверяемые workflows: найти и создать object; создать/выбрать Location;
  использовать ports; соединить equipment; построить/use SavedMap;
  редактировать Region/cable presentation где применимо; выполнить L1 trace;
  понять результат без знания internal implementation entities.
- Findings: отдельно классифицировать correctness bug/regression, UX defect,
  visual/style defect, performance/readiness issue и missing domain/authoring
  capability. Acceptance может явно promote конкретный gap в pre-L2 blocker,
  если representative workflow без него невозможно выполнить правдиво или
  приемлемо; остальные TODO автоматически не повышаются.
- Граница: это финальный acceptance gate, не feature/implementation milestone;
  цель — проверить также sufficiency domain model, authoring и presentation.
- Будущая синхронизация: при финальной normalization потребуется wording sync
  с `docs/product/09-02-post-l1-product-roadmap.md` и, только если нужно,
  policy/acceptance wording в `docs/plans/stabilization/10-02-stabilization-backlog.md`.
- Статус: RECORDED.

## RVR-010 — Optical patch panel member-aware Blueprint evidence

- Краткое описание: конкретный optical patch panel use case (24 front
  endpoints FP1...FP24, shared rear multi-member/splice side, trunk на rear и
  LC patch cords на front) требует member-aware internal fan-out:
  multifiber trunk → rear members → internal branches → front endpoints.
- Тип: concrete domain/authoring capability evidence.
- Severity: N/A (не bug).
- Architectural/product priority: MEDIUM pending representative acceptance.
- Влияние на L1 completion: concrete gap больше не purely speculative, но item
  не promoted в L1 blocker; promotion возможна только во время real-world L1
  acceptance, если representative equipment нельзя truthfully моделировать.
- Blocker до L2: нет пока.
- Подтвержденная граница: canonical L1 уже поддерживает
  `ConnectionPoint.cardinality`, `Connection.cardinality` и explicit
  `ConnectionMember` mapping. Текущая Blueprint/PortBlock authoring boundary
  не выставляет cardinality на `BlueprintSlot`, хранит internal link только как
  slot-to-slot keys, а materialization создает point/connection cardinality 1
  с member 1 → member 1.
- Рабочее название capability: Blueprint endpoint cardinality + member-aware
  internal connectivity / fan-out. Future fixture: multi-member rear endpoint
  → explicit member-aware internal mapping → multiple front endpoints.
  Возможные coarse (`rear cardinality 24`, member N → front N) и fiber-level
  (`rear cardinality 48`, pairs → duplex front members) формы — только examples,
  не fixed schema.
- Boundary: cardinality означает model resolution, а не обязательную universal
  physical resolution; cable/duplex/fiber detail может иметь разную глубину по
  требуемой tracing fidelity. Не проектируются сейчас DTO fields, PortBlock
  schema, UI, migration, upgrade compatibility или exact mapping authoring UX;
  всё это NEEDS BOUNDED CONTRACT.
- Будущая синхронизация: минимум `docs/reviews/09-ui-ux-review.md` для удаления
  или уточнения устаревшего purely-speculative предположения; при promotion/
  agreement — bounded boundary в
  `docs/architecture/blueprints/09-03-port-block-blueprint-architecture.md`
  и product placement в `docs/product/09-02-post-l1-product-roadmap.md` только
  если итоговый roadmap действительно разместит capability.
- Статус: RECORDED.
