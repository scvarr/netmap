# L1 Roadmap Review Decisions

Временный реестр только новых или измененных semantic, product и UX
contracts, выявленных текущим review. Обычные bugs без contract impact сюда не
добавляются.

## Статус normalization

Intake review завершен на текущем checkpoint. Decisions normalized в
canonical target docs; текущий execution roadmap —
[[plans/11-03-pre-l2-product-completion|11.3 Pre-L2 product completion]]. Этот
файл остается audit trail/provenance, а новые decisions проходят отдельный
bounded review.

## D-001 — Exact-evidence invariant для trace presentation

- Решение: визуальная подсветка выбранной L1 trace branch следует exact
  canonical evidence. Общий projection/presentation edge между
  `PhysicalObject` недостаточен для доказательства конкретного Cable.
  Подсветка Cable-backed связи ограничивается exact Cable / `ConnectionMember`,
  доказанным выбранной branch. Это же правило действует для direct
  `ConnectionMember` и internal passive continuity. Presentation collapse
  никогда не расширяет canonical trace result.
- Характер: изменяемый UX/semantic invariant; поведение-preserving
  исправление корректности представления.
- Будущая синхронизация canonical docs: после завершения review потребуется
  синхронизировать `docs/architecture/tracing/03-tracing.md`.

## D-002 — Mutable optional Cable label semantics

- Решение: Cable поддерживает optional mutable user-facing label. Label можно
  задать, изменить и очистить; отсутствие label допустимо и отображается через
  deterministic technical fallback. Fallback не становится canonical user
  label автоматически. Label не меняет Cable identity, linked Connection,
  endpoints, `MapCableRoute` references, trace semantics или topology.
  Rename/write boundary Cable-specific и не использует PhysicalObject rename
  API. До отдельно согласованной Cable Details surface label остается plain
  text в catalog.
- Характер: уточнение product/UX contract существующей Cable.3 capability.
- Будущая синхронизация canonical docs: после завершения review потребуется
  синхронизировать `docs/architecture/l1/01-01-02-cable.md` и
  `docs/product/09-02-post-l1-product-roadmap.md`.

## D-003 — Location.2 assignment tree/search/inline-create UX semantics

- Решение: основной PhysicalObject Location picker — search-first
  collapsible tree, а не длинный плоский select. Case-insensitive search
  работает минимум по Location name и full hierarchical path и сохраняет
  необходимые ancestor nodes в результатах. При открытии раскрывается path
  текущего assignment; selection single-choice. В раскрытой ветке доступно
  создание direct child, на root level — root Location create.
- Lifecycle invariant: inline create использует существующие canonical
  `name + optional arbitrary user-defined type + explicit parent` semantics.
  После успешного create выполняется authoritative reload и новый Location
  становится draft candidate, но association PhysicalObject не изменяется до
  отдельного явного Save. Create и assignment — отдельные canonical writes.
  Create failure не изменяет association, а post-create refresh retry повторяет
  только refresh. Picker не предоставляет edit/reparent/delete.
- Характер: уточнение Location.2 product/UX contract; canonical semantics и
  backend capability не изменяются.
- Будущая синхронизация canonical docs: после завершения review потребуется
  синхронизировать `docs/architecture/presentation/09-spatial-location-mapreference-contract.md`
  и релевантный Location/L1 completion plan или product roadmap, выбранный при
  финальной раскладке review.

## D-004 — Composite/hierarchical presentation contract direction

- Решение: использовать общую концептуальную pipeline
  `canonical/derived domain facts → Projection → hierarchical/composite scene
  → layout/presentation → canvas`. Composite scene node является derived
  presentation object и может концептуально нести source/evidence refs,
  member/child presentation refs, explicit grouping/composition basis,
  expanded/collapsed state, layout policy, optional overrides и boundary
  connectivity representation. Exact schema и persisted entity пока не
  фиксируются.
- Fixed invariants: universal canonical `Object.parent` не вводится;
  Location parent hierarchy, `PhysicalObject.parent_object`, SavedMap/
  MapReference composition и future hosting relations независимы. Presentation
  flow односторонний: position, resize, container geometry, collapse/expand,
  auto-layout и presentation overrides сами по себе не меняют canonical facts.
  Collapse может скрыть internal detail, но crossing connectivity выводится из
  supporting canonical/derived topology/evidence, не создает synthetic
  canonical Connection, сохраняет refs и должна быть explainable.
- Fixed boundaries: Location — один возможный composition basis без canonical
  containment; rack layout остается specialized policy без fixed taxonomy из
  `Location.type` и без rack occupancy domain model; PhysicalObject composition
  не смешивается с Location; MapReference остается presentation-only consumer
  общего contract; Region остается отдельной manual SavedMap-owned geometry;
  future virtualization/hosting domain не вводится.
- MapReference rule: standalone MapReference implementation не начинается
  только из-за его позиции в старом roadmap; сначала требуется reconciliation с
  общим contract. Bounded pre-L2 consumer будет выбран только после полного
  review.
- OPEN boundaries: persisted composite/scene object; Projection DTO versus
  scene layer; persisted geometry/overrides; rack occupancy/layout policies;
  external boundary attachment algorithm; simultaneous independent
  hierarchies; manual/automatic layout interaction; grouping UX;
  incomplete/conflicting source behavior; future hosting domain semantics.
- Характер: архитекторское направление и новая presentation capability family;
  не standalone implementation commitment до L2.
- Будущая синхронизация canonical docs: после завершения review потребуется
  синхронизировать `docs/architecture/graph/02-04-projections-aggregation.md`,
  `docs/architecture/presentation/05-presentation.md`,
  `docs/architecture/presentation/09-spatial-location-mapreference-contract.md`
  и `docs/product/09-02-post-l1-product-roadmap.md`. Возможно потребуется
  только ссылка/граница в `docs/architecture/l1/01-01-l1.md`; semantics
  `parent_object` менять не следует.

## D-005 — One design system, multiple page archetypes

- Решение: NetMap использует один shared design system и несколько page
  archetypes: inventory/list, object detail, form/editor, catalog/library,
  canvas/workspace и modal/task flow. Shared primitives/state semantics
  унифицируют typography, spacing, actions, forms, tables, dialogs,
  inspectors, selection, loading/error/empty/destructive states и
  keyboard/focus conventions. Exact component architecture остается OPEN.
- Product direction: Map и Blueprint editor могут иметь отличные canvas
  interaction/layout patterns, но используют общие primitives. NetBox/Nautobot
  — только UX reference, не visual clone. Migration идет controlled
  surface-by-surface после audit и functional freeze; big-bang rewrite не
  вводится. Validation task-based, UX defects приоритетнее visual/style defects.
- Характер: долговременное product/UX direction; design system не является
  L1/L2 network semantics, но является обязательной частью pre-L2
  product-readiness boundary. Semantic L2 начинается только после согласованной
  productization и final product acceptance.
- Будущая синхронизация canonical docs: после завершения review потребуется
  синхронизировать `docs/architecture/presentation/05-presentation.md` и
  `docs/product/09-02-post-l1-product-roadmap.md`. Отдельный design-system
  plan/document создавать только при активации работы.

## D-006 — Pre-L2 product-readiness gate

- Fixed direction: L1 network semantic completion и L1 PRODUCT COMPLETE —
  разные checkpoints. NetMap сначала доводится до полноценного practically
  usable standalone/multi-user application, и только затем начинается semantic
  expansion в L2/L3.
- До L2 по product strategy располагаются application concerns: L1 readiness
  и representative acceptance; persisted workspace/isolation; application
  identity/authentication; workspace-context authorization/access control;
  practically usable sharing; multi-user accountability/activity-audit; UI
  consistency/productization и final product acceptance. Network core не
  смешивается с user/workspace/presentation semantics.
- Product boundary: `L1 semantic completeness → pre-L2 productization → L1
  PRODUCT COMPLETE → L2 semantic expansion → L3`. Exact decomposition этих
  families выполняется bounded milestones позже; это не один implementation
  milestone.
- Scope discipline: capabilities, перечисленные в workspace architecture,
  не становятся pre-L2 автоматически. Fork/merge/compare, export/import,
  `.netmap`, Blueprint packages, comments/annotations, PUBLIC_READ/public
  links, groups, copy-on-write, map templates/cloning и иные optional
  collaboration/portability features обязательны до L2 только при явной
  product-necessity: без них приложение нельзя разумно считать practically
  usable по итоговому contract. Это предотвращает бесконечное расширение
  pre-L2 scope.
- OPEN: exact milestone order; auth provider; ACL/storage strategy; sharing
  semantics; required optional collaboration/portability capabilities; final
  public-release gate.
- Характер: обязательная product/roadmap boundary, не новая network semantics.
- Будущая синхронизация canonical docs: при final normalization потребуется
  пересмотреть `docs/product/09-02-post-l1-product-roadmap.md`, status/roadmap
  placement в `docs/architecture/workspaces/07-workspaces.md`,
  `docs/architecture/presentation/05-presentation.md` и релевантных final L1
  completion/readiness docs. В частности, текущую placement multi-user
  foundation после L2/L3 нужно пересмотреть.
