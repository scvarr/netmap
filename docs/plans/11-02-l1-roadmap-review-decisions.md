# L1 Roadmap Review Decisions

Временный реестр только новых или измененных semantic, product и UX
contracts, выявленных текущим review. Обычные bugs без contract impact сюда не
добавляются.

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
