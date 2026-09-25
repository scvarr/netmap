# 11.8 Cable route editor completion

## Граница

Bounded follow-up по результатам ручной spatial acceptance P-UX-03D.
Canonical state включает Cable identity, Connection и endpoints. Presentation
state включает `MapCableRoute`, его waypoints, Location boundary anchors и
transient editor geometry/snap feedback. Не вводить cross-Cable canonical
relation.

## Ordered milestones

### C-ROUTE-01 — Cable selection precision and stacking

**NEXT / IMPLEMENTATION PENDING.** Следующий implementation milestone после
merge P-UX-03D.

- Обычный Cable не перехватывает click соседнего Cable широкой невидимой
  selection area; interactive hit width соответствует видимой линии.
- Selected Cable визуально выше всех non-selected Cable независимо от порядка
  insertion/render; editing Cable выше selected Cable.
- Wiring draft сохраняет наивысший editing emphasis.
- Cable selection не меняет canonical state или route persistence.

### C-ROUTE-02 — Cross-route geometry snapping

**OPEN.** Выполняется после C-ROUTE-01.

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
