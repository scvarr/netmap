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

### L1R-004 — Location assignment tree/search/inline-create UX

- ID: `L1R-004`
- Категория: UX debt / Location.2 workflow completion.
- Severity: MEDIUM.
- До L2: ДА.
- Зависимости: существующие Location.1/Location.2 API и semantics.
- Краткий contract: PhysicalObject assignment использует search-first
  collapsible hierarchical tree вместо длинного плоского select; поиск ищет по
  name и full path и сохраняет ancestors; single-choice selection раскрывает
  current path. Picker поддерживает direct-child и root inline create на
  существующей Location canonical semantics.
- Acceptance: collapsed large tree; current path expanded; `U42` с ancestors;
  Add создает child правильного parent; новый child selected как draft;
  association меняется только явным Save; create failure безопасен; refresh
  retry не повторяет create; edit/reparent/delete отсутствуют.
- Ограничение scope: backend/domain capability не требуется; не вводятся
  alternative Location model, fixed taxonomy или presentation-owned Location.
- Статус: TODO.

### L1R-002 — Убрать неверную Cable catalog navigation

- ID: `L1R-002`
- Категория: bug / regression / UX-correctness navigation.
- Severity: MEDIUM.
- До L2: ДА.
- Зависимости: нет.
- Краткий contract: Cable не маршрутизируется через PhysicalObject Details;
  до отдельной Cable Details surface label является plain text, а endpoint
  PhysicalObject links сохраняются.
- Acceptance: Cable label не является click-target; endpoint PhysicalObject
  links работают; Cable identity не попадает в `/infrastructure/objects/:id`.
- Статус: TODO.

### L1R-003 — Реализовать mutable optional Cable label

- ID: `L1R-003`
- Категория: UX gap / existing planned Cable.3 capability.
- Severity: MEDIUM.
- До L2: ДА.
- Зависимости: Cable.3 metadata foundation.
- Краткий contract: optional mutable user-facing Cable label с deterministic
  technical fallback; label не меняет identity, Connection, endpoints, routes,
  trace semantics или topology; write boundary Cable-specific.
- Acceptance: fallback для отсутствующего label; rename и clear с
  authoritative refresh; сохранение Cable UUID/Connection/endpoints/routes;
  отсутствие PhysicalObject rename API.
- Статус: TODO.
