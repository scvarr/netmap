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
  большой hit target route-editor segment insertion сохранён. Editable waypoint
  принимает drag только в пределах своего видимого marker.
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

**IMPLEMENTED.**

- Drag/insert waypoint текущего Cable snap к waypoint или ближайшей projection
  point видимого segment другого Cable, включая прямой Cable без saved route и
  resolved Location boundary anchors маршрутизированного Cable.
- Foreign snap targets имеют компактные пассивные markers, отличимые от
  editable waypoints. Waypoint capture ограничен visible marker footprint при
  текущем zoom, без дополнительного halo; segment capture — 8 screen pixels.
  Waypoint имеет приоритет над segment; foreign geometry — над 45°/15° assist.
- Foreground editor показывает transient highlight на snapped point и подсветку
  target segment. Feedback не принимает pointer events и очищается при release,
  cancel и закрытии route editor.
- Location boundary anchor принимает только допустимую точку собственной
  boundary. Его `location_id`, `edge`, `offset` вычисляются для собственного
  frame; metadata другого Cable не копируется.
- Save записывает только собственные coordinates/anchor route текущего Cable.
  Cross-Cable reference/dependency не сохраняется; последующее изменение
  другого Cable не двигает текущий route.
- Targeted validation: 73 geometry/editor tests and 14 route lifecycle tests
  passed; frontend build and `git diff --check` passed.

### C-ROUTE-03 — Numeric segment geometry

**OPEN.** Числовое задание длины segment меняет координаты waypoint; persistent
constraint не создаётся.

### C-CABLE-01 — Bulk port pairing

**OPEN; после C-ROUTE-03.** Выбор source ports → Enter → равное число
destination ports → preview pairs → Enter → atomic batch Cable/Connection
creation. Optional generated labels используют существующий
`CableLabelTemplate`. Route generation в bulk operation не входит.

## Вне границы

Cable Bundle entity/schema, shared-route persistence, marquee/multi-select,
middle-button pan, P-UX-03E implementation, general CAD framework и L2 work.
