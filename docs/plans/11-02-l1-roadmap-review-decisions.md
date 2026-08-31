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
