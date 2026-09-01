# 11.3 Pre-L2 product completion roadmap

## Статус и граница

**CANONICAL CURRENT EXECUTION ROADMAP** для последовательного движения от
текущего состояния до `L1 PRODUCT COMPLETE` и начала semantic L2. Этот документ
задает ordered capability families и gates, но не является implementation spec
конкретных DB/API schemas.

Главная граница:

```text
L1 semantic completeness
    -> pre-L2 productization
    -> L1 PRODUCT COMPLETE
    -> L2 semantic expansion
    -> L3
```

`L1 semantic completeness` и `L1 PRODUCT COMPLETE` — разные checkpoints. L1
semantic completeness означает достаточную physical-domain foundation и
основные L1 workflows. `L1 PRODUCT COMPLETE` означает practically usable
standalone/multi-user application. L2 не начинается до второго checkpoint.

## Последовательный порядок

### Phase A — Known L1 correctness / workflow completion

**IMPLEMENTED — Phase A complete.**

Закрыть bounded items: exact-evidence trace highlighting, исправление broken
Cable catalog navigation, Location assignment tree/search/inline-create,
compact Port Block table и RU terminology «Группа портов / Группы портов».
Компактная таблица Port Block и RU terminology могут быть
одним cheap UI-polish slice, но остаются отдельными acceptance items. Это не
общий design-system rewrite.

- **A.1 — exact-evidence L1 trace highlighting — IMPLEMENTED.**
- **A.2 — Cable catalog navigation fix — IMPLEMENTED.**
- **A.3 — Location assignment tree/search/inline-create — IMPLEMENTED.**
- **A.4 — compact Port Block catalog + RU terminology — IMPLEMENTED.**
  Compact table uses «Группа портов» / «Группы портов», separate «Точки
  подключения» and «Сетевые порты» columns, and counts for the current
  immutable PortBlockVersion without one version-details load per row.

Current execution position: **Phase B.3 — MapComposite and presentation variants (in progress).**

### Phase B — Remaining bounded L1 capability families

1. `Cable.3`: optional mutable Cable label, deterministic fallback, clear,
   Cable-specific write boundary; label не меняет Cable identity, Connection,
   endpoints, routes или trace. Cable Details не создается только ради label.
2. **B.2 — hierarchical/composite presentation reconciliation — IMPLEMENTED.**
   Фактически реализованная граница:

   ```text
   TopologyProjectionDocument
       -> PresentationSceneDocument
       -> layout
       -> canvas
   ```

   Сцена является временным клиентским представлением; semantic reconciliation
   выполняется до layout. Cable-backed endpoint pairs и off-map continuations
   формируются на уровне сцены, layout отвечает за геометрию, а точная
   Cable/ConnectionMember evidence сохраняется. Зафиксирован минимальный
   scene-only контракт будущего composite: composite не является физическим
   endpoint. B.3 MapReference остаётся следующим отдельным milestone.
   Reconcile composite/hierarchical presentation через
   `canonical/derived facts -> Projection -> hierarchical/composite scene ->
   layout/presentation -> canvas`; no universal `Object.parent`. Свёрнутый
   composite block остаётся только представлением: он не становится концом
   физического `Connection`/`Cable`. Реальное устройство с внешней связью
   доступно как boundary device с его реальной внешней связью; внутренние
   устройства и связи, не пересекающие границу, могут быть скрыты. Связь двух
   свёрнутых блоков по-прежнему идёт между реальными устройствами внутри них.
   Это не добавляет canonical `Object.parent` или новых topology facts; точный
   `MapReference` contract остаётся отдельным B.3. Полный generic scene engine
   не становится обязательным pre-L2 milestone.
3. **B.3 — MapComposite и presentation variants.** Одна SavedMap остаётся
   полной картой; уже размещённые PhysicalObject могут быть объединены в
   presentation-only MapComposite внутри этой же карты. Composite не является
   endpoint, не меняет topology и не допускает overlap/nesting. Пользовательские
   варианты представления той же SavedMap хранят независимые координаты,
   collapsed-composite geometry и маршруты Cable. MapReference composition между
   SavedMap в B.3 не реализуется.
4. Закрыть MapCableRoute usability: overlap-safe exact trace presentation,
   compact edit handles, straight preview, initial angular snapping/feedback и
   justified presentation-only magnets. Режим редактирования продолжается до
   явного Сохранить/Отмена; selection и клик по полотну его не отменяют,
   Enter может сохранить, Esc — отменить. Опорные точки визуально лишь немного
   толще линии, при существенно большей области захвата. Применяются общие
   геометрические правила редактора Region (прямые сегменты, углы, длины,
   angular snapping/feedback, добавление и перемещение точек). NetMap не
   превращается в CAD.

Отдельные OPEN product directions, не входящие в B.2: физическое соединение
можно будет создавать выбором устройства через поиск по всему оборудованию с
последующим выбором свободного порта из прокручиваемого/поискового списка,
независимо от присутствия устройств на текущей SavedMap; текущий выбор порта
кликом по карте остаётся быстрым способом. Для patch panel -> switch нужен
будущий режим массового сопоставления портов с обязательным предварительным
просмотром пар; точная атомарность операции OPEN. Выбор физических концов и
задание маршрута линии на SavedMap — разные действия. Также жгуты остаются
OPEN presentation direction: canonical Cable отдельны, общий маршрут и
автоматическая «гребёнка» допустимы только как SavedMap presentation; общий
участок явно показывает количество кабелей, а trace одного Cable не делает
весь жгут его evidence. Exact persistence/schema/editor UX OPEN.

### Phase C — Representative real-world L1 semantic acceptance

Обязательный gate, не feature milestone. Representative dataset наращивается
постепенно (rack -> room/server room -> floor -> building/site при необходимости)
с реальными equipment, ports, Locations, wiring, Cable, SavedMaps, Regions,
routes, internal continuity и L1 trace. Task-based workflow: найти, создать,
разместить, назначить Location, соединить, исправить presentation, выполнить
trace и понять результат без знания internal entities.

Findings классифицируются как correctness, UX, visual/style,
performance/readiness или missing domain/authoring capability. Только конкретный
доказанный gap может быть явно promoted.

Optical patch panel — concrete evidence, не purely speculative; его
canonical member-aware L1 foundation уже существует, а Blueprint/PortBlock
authoring/materialization пока cardinality=1 / 1:1. Capability не обязательна
автоматически; если representative equipment нельзя truthfully моделировать,
ее можно promote как bounded `Blueprint endpoint cardinality + member-aware
internal connectivity/fan-out`.

### Phase D — Close promoted L1 gaps

Закрывать только bounded gaps, реально promoted Phase C. Не добавлять
speculative features. После этой фазы считать L1 network semantics/workflows
sufficiently frozen для productization.

### Phase E — Pre-L2 UI/UX foundation

Провести `UI/UX audit -> shared design-system primitives/archetypes` до
создания большого числа новых screens. Shared system и archetypes охватывают
inventory/list, object detail, form/editor, catalog/library, canvas/workspace и
modal/task flow. NetBox/Nautobot — reference only; Map/Blueprint остаются
canvas/workspace archetypes. Не делать big-bang rewrite: определить primitives,
state semantics, archetypes и migration slices.

### Phase F — Pre-L2 application productization

Umbrella family, которую нужно декомпозировать в bounded milestones перед
implementation:

1. persisted `NetworkWorkspace` как application isolation boundary; завершить
   implicit-default transition, independent datasets и workspace-scoped
   repository/session; network core не знает user/ACL semantics;
2. application authentication/user identity (provider contract OPEN);
3. workspace-context authorization/access control (ACL schema/roles OPEN);
4. practically usable sharing network workspaces/SavedMaps (exact semantics
   OPEN, отдельный contract обязателен);
5. **Application change history / activity**: append-only mutation journal,
   global activity feed и per-entity history projection. Attribution к actor и
   workspace появляется после соответствующих application foundations и
   multi-user writes; event sourcing не требуется. Domain-specific correctness
   history может появляться раньше generic history: `CableLabelHistory` — уже
   реализованный bounded пример такого исключения.

Не становятся MUST автоматически: fork, merge/compare, export/import, `.netmap`,
Blueprint packages, comments/annotations, `PUBLIC_READ`/public links, groups,
copy-on-write, map templates/cloning и другие collaboration/portability
features. Их placement требует отдельной product-necessity оценки.

### Phase G — Controlled UI migration / product polish

После design-system foundation и по мере productization surfaces мигрировать
активные surfaces к shared primitives, сохраняя подходящие canvas patterns,
устраняя inconsistent forms/tables/dialogs/actions/states и соблюдая
accessibility/focus/keyboard conventions. Не требуется pixel-perfect rewrite
исторических или неактивных surfaces; validation task-based.

### Phase H — Mandatory stabilization/performance gate

Закрыть все реально остающиеся items с `До L2: ДА` и явно promoted blockers.
`До L2: НЕТ` автоматически не повышаются. Performance blocker может быть
выполнен раньше по dependency; Phase H остается финальным gate.

### Phase I — Final product acceptance

Финально проверить standalone/multi-user application: workspace isolation,
login/auth, access/sharing, canonical writes, SavedMaps, L1 workflows, trace,
UI consistency, error/loading/destructive states, accountability/audit и
representative data scale. После успешного gate объявить `L1 PRODUCT COMPLETE`
и только затем начинать semantic L2.

## OPEN

Открыты exact phase/milestone decomposition; auth provider; ACL/storage;
sharing semantics; optional collaboration/portability scope; generic scene
schema/persistence; final public-release gate. Наличие capability в workspace
architecture само по себе не делает ее pre-L2 requirement: критерий — можно ли
без нее разумно считать NetMap practically usable согласно итоговому product
contract.

Этот roadmap самостоятельно является source of truth для execution order. Новые
bounded findings могут появляться в review, но не изменяют roadmap молча.
