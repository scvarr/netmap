# L1 Roadmap Review Backlog

Временный нормализованный список implementation items, выявленных текущим
review. Окончательный порядок и принадлежность к milestone появятся только
после завершения review.

## TODO items

### L1R-001 — Исправить exact-evidence подсветку L1 trace

- ID: `L1R-001`
- Категория: bug / correctness regression / trace presentation.
- Severity: HIGH.
- До L2: ДА.
- Зависимости: нет.
- Краткий contract: trace presentation должна подсвечивать только Cable,
  `ConnectionMember` и internal passive continuity, доказанные выбранной
  canonical trace branch; общий projection/presentation edge не является
  достаточным доказательством конкретного Cable. Presentation collapse не
  расширяет canonical trace result.
- Acceptance: при нескольких Cable между одной парой `PhysicalObject`, когда
  selected trace branch использует один Cable, highlighted только exact
  evidenced Cable/`ConnectionMember`; остальные parallel Cable не highlighted.
- Статус: TODO.
