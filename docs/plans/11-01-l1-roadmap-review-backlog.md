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

### L1R-007 — Composite/hierarchical presentation capability family

- ID: `L1R-007`
- Категория: architecture change / presentation capability family.
- Severity: N/A (не bug).
- Architectural priority: HIGH.
- До L2: НЕТ для полной generic implementation.
- Зависимости: existing Projection/Aggregation contract.
- Специальная зависимость: архитектурно согласовать общий
  composite/hierarchical presentation contract до standalone MapReference
  implementation.
- Краткий contract: canonical/derived facts проходят через Projection в
  hierarchical/composite scene, затем layout/presentation и canvas. Location,
  `PhysicalObject.parent_object`, SavedMap composition и future hosting
  relations сохраняют собственную semantics; universal canonical
  `Object.parent` не вводится. Composite nodes derived/presentation-only,
  one-way и evidence-preserving.
- Implementation scope: `NEEDS DECOMPOSITION after roadmap review`.
- Acceptance будущей decomposition: общий contract согласован до начала
  standalone MapReference design; fixed invariants и OPEN boundaries из review
  item сохранены; не создается generic scene-engine milestone автоматически.
- Placement note: не определяет окончательный milestone order и не является
  обязательством полной реализации до L2.
- Статус: TODO.

### L1R-006 — Русская терминология PortBlock

- ID: `L1R-006`
- Категория: terminology / localization polish.
- Severity: LOW.
- До L2: ДА.
- Зависимости: нет.
- Краткий contract: все русские user-facing PortBlock strings используют
  естественный термин «Группа портов / Группы портов» с контекстным
  склонением; английская локализация остается без изменений.
- Acceptance: исправлены navigation, library, breadcrumbs, create/version
  editor, errors, confirmations, accessibility labels и hints; в русском UI
  нет «Портовый модуль / Портовые модули»; `PortBlock` identity и implementation
  terminology не меняются.
- Scope: terminology-only cleanup без semantic/domain/API changes. Отдельно от
  L1R-005 по смыслу; возможна совместная реализация как дешевого L1 UI-polish.
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

### L1R-005 — Compact Port Block library table

- ID: `L1R-005`
- Категория: UX debt / visual consistency / library usability.
- Severity: LOW.
- До L2: ДА.
- Зависимости: нет.
- Краткий contract: основной Port Module / Port Block catalog использует
  компактную таблицу с колонками name, current version, version count, port
  count и actions; partial port thumbnails из catalog удаляются.
- Acceptance: table surface без card/grid previews; все обязательные колонки
  присутствуют; New version сохраняет текущий authoring flow; Delete сохраняет
  lifecycle/conflict semantics; list API не расширяется.
- Placement note: кандидат в bounded L1 UI-polish перед real-world
  acceptance, не отдельная architecture capability и без изменения
  immutable version/identity/provenance semantics.
- Статус: TODO.
