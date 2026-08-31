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

Закрыть bounded items `L1R-001` exact-evidence trace highlighting,
`L1R-002` broken Cable catalog navigation, `L1R-004` Location assignment
tree/search/inline-create, `L1R-005` compact Port Block table и `L1R-006` RU
terminology «Группа портов / Группы портов». `L1R-005` и `L1R-006` могут быть
одним cheap UI-polish slice, но остаются отдельными acceptance items. Это не
общий design-system rewrite.

### Phase B — Remaining bounded L1 capability families

1. `Cable.3`: optional mutable Cable label, deterministic fallback, clear,
   Cable-specific write boundary; label не меняет Cable identity, Connection,
   endpoints, routes или trace. Cable Details не создается только ради label.
2. Reconcile composite/hierarchical presentation через
   `canonical/derived facts -> Projection -> hierarchical/composite scene ->
   layout/presentation -> canvas`; no universal `Object.parent`. Полный generic
   scene engine не становится обязательным pre-L2 milestone.
3. Реализовать MapReference/composed SavedMaps как bounded consumer общего
   composite contract, только после отдельного bounded MapReference
   contract с exact API/schema/interaction decisions.
4. Закрыть MapCableRoute usability: overlap-safe exact trace presentation,
   compact edit handles, straight preview, initial angular snapping/feedback и
   justified presentation-only magnets. NetMap не превращается в CAD.

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

`L1R-010` optical patch panel — concrete evidence, не purely speculative; его
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
5. append-only activity/audit: who/what/when/workspace после multi-user writes;
   event sourcing не требуется.

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

Ссылки на review items — audit trail; текущим source of truth для execution
order является этот roadmap. Новые bounded findings могут появляться в review,
но не изменяют roadmap молча.
