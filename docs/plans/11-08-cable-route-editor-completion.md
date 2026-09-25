# 11.8 Cable route editor completion

## Граница

Bounded follow-up по результатам ручной spatial acceptance P-UX-03D.
Canonical state включает Cable identity, Connection и endpoints. Presentation
state включает `MapCableRoute`, его waypoints, Location boundary anchors и
transient editor geometry/snap feedback. Не вводить cross-Cable canonical
relation.

## Ordered milestones

### C-ROUTE-01 — Cable selection precision and stacking

**IMPLEMENTED.**

- Interactive hit area обычного Cable соответствует видимой толщине линии;
  большие hit targets для route-editor segment insertion и waypoint drag сохранены.
- Selected Cable отображается выше non-selected независимо от исходного render
  order; editing Cable отображается выше selected, а wiring draft сохраняет
  верхний editing priority.
- Foreground Cable поддерживает обычный click и существующее context menu.
  Правая кнопка на editor segment или waypoint не вызывает insert/drag.
- Geometry feedback сохраняет screen-stable размер; короткие и конфликтующие
  подписи подавляются, а feedback отображается поверх остальных элементов route
  editor.
- Targeted validation: 58 targeted frontend tests passed; frontend build passed;
  `git diff --check` passed.

### C-ROUTE-02 — Cross-route geometry snapping

**OPEN — NEXT CONTRACT TO AGREE.** Обсудить и согласовать контракт после
C-ROUTE-01 перед началом реализации.

- Drag/insert waypoint текущего Cable может snap к waypoint или ближайшей
  точке segment другого отображаемого Cable.
- Capture threshold измеряется в screen pixels и сохраняет одинаковое
  ощущение при изменении zoom; target geometry получает transient visual
  feedback.
- Save записывает только координаты route текущего Cable. Нет persisted
  dependency/reference на другой Cable или waypoint; дальнейшее изменение
  другого route не двигает текущий.
- Location boundary anchor остаётся ограничен собственным frame и принимает
  foreign-route snap только если итоговая точка лежит на этой boundary.

### C-ROUTE-03 — Route templates

**OPEN; contract required before implementation.**

Направления editor action: Straight / «Прямая», Horizontal → Vertical,
Vertical → Horizontal. Возможный Auto 90° остаётся OPEN. Template генерирует
обычную route geometry и не является persisted route type. Алгоритм Auto 90°
здесь не проектируется.

## Вне границы

Cable Bundle entity/schema, shared-route persistence, marquee/multi-select,
middle-button pan, P-UX-03E implementation, general CAD framework и L2 work.
