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
