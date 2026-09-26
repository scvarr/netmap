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

Current execution position: **Phase C — Representative real-world L1 semantic acceptance.**

В spatial strand P-UX-03A/B/C/D реализованы, ручная проверка P-UX-03D
пройдена. Bounded Cable route follow-up из 11-08 завершён. Следующий spatial
шаг — P-UX-03E final spatial acceptance/dead-code cleanup; до его собственного
acceptance он остаётся pending. Это не завершает spatial cutover или Phase C.

Первоначальная representative Phase C discovery уже выполнена: `C-*` findings
зафиксированы и остаются обязательным списком для контроля. Текущий active
clean repeat начинается с пустой тестовой БД и использует rack-first/service-path
synthetic scenario из 11-04; пользовательский проход идёт небольшими UI-шагами
с остановкой на первом существенном finding, bounded fix, review/merge и
повтором того же шага на сохранённом стенде.
`P-UX-01` ... `P-UX-19` — findings этого прохода; их реализация и ручная
проверка ведутся в [[plans/11-06-clean-start-ui-polish|11.6 Clean-start UI
polish]], а статус `C-*` — в [[plans/11-05-phase-c-acceptance-closure|11.5
Phase C acceptance closure]]. P-UX-03E остаётся pending. Новый fixture не
начинает Phase D и не закрывает `C-CAP-01`.

Promoted semantic gaps, включая `C-CAP-01`, закрываются через Phase D. Это не
означает, что Phase D целиком уже началась или завершена. Финальный clean
Phase C acceptance выполняется после необходимых обязательных fixes; только
после него Phase C считается закрытой. Spatial presentation следует
[[plans/11-07-hierarchical-location-presentation|11.7 plan]]: P-UX-03A/B/C/D
реализованы, P-UX-03D manual recheck пройдена, P-UX-03E остаётся следующим
pending spatial шагом. Cable route editor follow-up из
[[plans/11-08-cable-route-editor-completion|11.8 plan]] завершён. Общий порядок
Phase E–I не меняется.

### Phase B — Remaining bounded L1 capability families

1. `Cable.3`: optional mutable Cable label, deterministic fallback, clear,
   Cable-specific write boundary; label не меняет Cable identity, Connection,
   endpoints, routes или trace. Cable Details не создается только ради label.
2. **B.2 — hierarchical Location presentation — implemented through P-UX-03A/B/C/D; final acceptance pending in P-UX-03E.** Current target contract находится в
   [[architecture/presentation/09-spatial-location-mapreference-contract|09
   spatial document]] и строится вокруг canonical Location hierarchy, derived
   frames и presentation projection. MapComposite implementation superseded и
   удалён в P-UX-03A; он не является текущей capability. Полный generic scene
   engine не становится обязательным pre-L2 milestone.
3. **B.3 — MapComposite removal — IMPLEMENTED in P-UX-03A.**
   MapComposite не является target capability. `SavedMap` сохраняется как карта, а
   `MapPresentationVariant` — как её целевая именованная компоновка; варианты
   показывают одну карту по-разному без изменения topology или Location
   hierarchy. MapReference composition остаётся отдельным future direction.
4. **B.4 — MapCableRoute usability — IMPLEMENTED.** Overlap-safe exact trace
   presentation keeps `MapCableRoute` as SavedMap presentation state. Route
   editing continues until explicit Save/Cancel; ordinary selection and canvas
   clicks do not discard its local draft, while map/view exit does without a
   write. Enter saves and Escape cancels outside editable, control, and dialog
   contexts. Compact visual waypoints have a larger independent pointer target;
   straight segments retain exact-index insertion and use the shared Region
   geometry assistance (angles, lengths, Shift H/V, Ctrl bypass) with transient
   feedback. NetMap does not become a CAD editor.

Массовое сопоставление портов реализовано в C-CABLE-01: обязательный preview
пар и atomic canonical batch write входят в существующий workflow. Остальные
отдельные OPEN product directions, не входящие в B.2: физическое соединение
можно будет создавать выбором устройства через поиск по всему оборудованию с
последующим выбором свободного порта из прокручиваемого/поискового списка,
независимо от присутствия устройств на текущей SavedMap; текущий выбор порта
кликом по карте остаётся быстрым способом. Выбор физических концов и
задание маршрута линии на SavedMap — разные действия. Также жгуты остаются
OPEN presentation direction: canonical Cable отдельны, общий маршрут и
автоматическая «гребёнка» допустимы только как SavedMap presentation; общий
участок явно показывает количество кабелей, а trace одного Cable не делает
весь жгут его evidence. Отдельный Cable Bundle entity/persistence сейчас не
является запланированной следующей capability. Current target — визуально
совместное прохождение независимых `MapCableRoute` через geometry snapping:
каждый Cable сохраняет собственный route, а snapping не создаёт canonical или
SavedMap relationship между routes. Bundle/shared-route entity остаётся OPEN
только при доказанной потребности, которую нельзя выразить независимыми
совпадающими routes.

### Phase C — Representative real-world L1 semantic acceptance

Обязательный gate, не feature milestone. Representative dataset наращивается
постепенно (rack -> room/server room -> floor -> building/site при необходимости)
с реальными equipment, ports, Locations, wiring, Cable, SavedMaps,
hierarchical Location presentation, routes, internal continuity и L1 trace.
Expanded derived Location frames отражают текущую presentation scene и
реализованы в P-UX-03B.
Task-based workflow: найти, создать,
разместить, назначить Location, соединить, исправить presentation, выполнить
trace и понять результат без знания internal entities.

Живой acceptance testbed и порядок его использования зафиксированы в
[[plans/11-04-phase-c-representative-l1-testbed|11.4 Phase C representative L1
testbed]]. Этот документ задаёт representative scenario и границу между
подтверждёнными и неизвестными facts; он не является inventory source или
architecture spec.

Findings классифицируются как correctness, UX, visual/style,
performance/readiness или missing domain/authoring capability. Только конкретный
доказанный gap может быть явно promoted.

Optical patch panel — concrete evidence, не purely speculative; его
canonical member-aware L1 foundation уже существует, а Phase C acceptance
FANOUT-1x24 подтвердила, что текущие Blueprint/PortBlock
authoring/materialization не выражают cardinality/member-aware internal
connectivity beyond ordinary cardinality=1 / 1:1. Это зафиксировано как
confirmed `C-CAP-01`, candidate для bounded Phase D promotion. Phase D этим
roadmap не объявляется IMPLEMENTED и дальше не расширяется.

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
