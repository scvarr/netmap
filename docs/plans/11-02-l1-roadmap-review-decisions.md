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
