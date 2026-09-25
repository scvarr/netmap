# 11.7 Hierarchical Location presentation

## Статус и граница

Это компактный последовательный implementation plan для spatial cutover.
NetMap pre-production; P-UX-19 и P-UX-03A/B/C/D реализованы, P-UX-03E остаётся **IMPLEMENTATION PENDING**. Не
объединять их в одну implementation task и не объявлять выполненными до
targeted validation и, где указано, manual acceptance.

Главный contract: [[architecture/presentation/09-spatial-location-mapreference-contract|Spatial
location presentation contract]]. `Location` остаётся canonical physical
hierarchy; `SavedMap` — карта; `MapPresentationVariant` — её компоновка;
Location frames и hierarchical scene — derived presentation.

## Ordered milestones

### P-UX-19 — Location series creation

**IMPLEMENTED.** Targeted backend/frontend validation пройдена; дальнейшие
spatial milestones не затронуты.

Создать atomic canonical Locations под выбранным parent по pattern/range/step.
Поддержать одну непрерывную группу `#`, numeric width validation, preview до
записи, предварительную проверку конфликтов и optional `Location.type` для всей
серии. Запись создаёт все элементы либо ни один; presentation state, SavedMap и
persisted `LocationTemplate` не создаются. Провести targeted backend/frontend
validation для preview, range/pattern errors, conflicts и atomicity.

### P-UX-03A — Destructive spatial cleanup

**IMPLEMENTED.** MapComposite и MapRegion удалены; targeted backend/frontend
validation и проверка forward migration выполнены. Spatial cutover продолжается
в P-UX-03B..E.

Удалить `MapComposite` UI/API/model/persistence/tests и `MapRegion`
UI/API/model/persistence/tests. Сохранить `SavedMap`, variants, placements,
Cable routes, Locations, PhysicalObjects и `MapTextAnnotation`. Создать новую
forward migration для удаления schema. Не добавлять compatibility/conversion
layers, fallback readers или параллельные old/new contracts.

### P-UX-03B — Expanded hierarchical Location presentation

**IMPLEMENTED.** Physical SavedMap показывает derived nested frames по canonical Location catalog, live placement `location_ref` и текущим node rectangles. Frame geometry пересчитывается при drag, rollback, resize и смене variant; пустые branches не рисуются. Unary Location chains представлены компактным path label без повторных frame shells. Targeted frontend validation пройдена; collapse и group move остаются отдельными milestones.

Derive direct membership и canonical subtree; построить nested dynamic frames.
Movement и resize объектов обновляют frames, но frame geometry не persisted.
Не выбирать произвольных глубоких descendants вместо direct elements.

### P-UX-03C — Variant-specific Location collapse

**IMPLEMENTED.** Variant + Location state хранит `collapsed` и typed canonical
UUID refs прямых элементов; отсутствие state означает expanded. PUT валидирует
canonical direct membership, SavedMap detail возвращает состояние активного
variant без N+1, копирование variant создаёт независимые states. Клиент строит
рекурсивное partial collapse, компактные derived proxies и перепривязывает
только presentation anchors реальных Cables/continuations, сохраняя routes.
Targeted backend/frontend проверки и typecheck выполнены. P-UX-03D не включён.

Ввести Location presentation state для каждой пары
`MapPresentationVariant + Location`: collapsed/expanded и explicit visible
direct elements. Применять recursive child Location presentation, exact
boundary evidence и derived proxies. Collapse родителя не уничтожает child
state; membership объектов не дублировать.

### P-UX-03D — Interactive Location group move

**IMPLEMENTED. Ручная перепроверка — ПРОЙДЕНА.** Drag заголовка
отображаемого `LocationFrame` отправляет один displacement для canonical
subtree активного L1 variant. Во время drag transient derived preview
показывает выбранный frame и изменившиеся ancestor frames. Все размещённые
members subtree, включая скрытые collapse-представлением, получают одинаковый
delta; внутреннего re-layout нет. Locked member или collision с внешним
PhysicalObject отклоняют операцию целиком. Positions и затронутые mutable
routes записываются одной server transaction. После успешной записи выполняется
authoritative reload; при его ошибке повторяется только read, displacement не
повторяется.

Boundary Cable routes используют variant-specific Location boundary anchors в
`MapCableRoute.waypoints`. Явный anchor перемещаемого Location является
authoritative splitter; anchors других Locations независимы и не создают
ambiguity. Несколько anchors того же moving Location пока означают unsupported
re-entry и отклоняют операцию. Legacy route получает anchor только при явной
mutation — сохранении трассы или group move; чтение не пишет данные. Открытие
route editor сразу нормализует transient draft и показывает anchors без write;
Save сохраняет draft, Cancel его отбрасывает. Anchor разрешается из текущей
derived frame и при drag остаётся на её периметре. Для него действуют 45°/15°
geometry assistance и feedback угла/расстояния. Видимые route points компактны,
а удобная большая hit area сохраняется. Геометрия Location не сохраняется.

### P-UX-03E — Spatial acceptance and dead-code cleanup

**IMPLEMENTATION PENDING.** Перед final spatial acceptance закрываются
bounded cable-route UX findings, обнаруженные в ручном проходе P-UX-03D и
вынесенные в [[plans/11-08-cable-route-editor-completion|11.8 Cable route
editor completion]]. Этот follow-up не меняет canonical Location semantics и
не означает завершение spatial cutover. После него провести representative
manual validation hierarchical collapse, nested frames, group move, collisions,
exact boundary evidence и route semantics. Удалить оставшиеся obsolete
helpers/styles/types, затем обновить связанные `C-*` statuses только после
проверки. Зафиксировать завершение spatial cutover только после acceptance.

## No-legacy policy

Старая development-stage реализация удаляется, если мешает принятой
архитектуре. Не сохранять тестовые MapComposite/MapRegion данные, не писать
adapters/shims/fallback readers и не поддерживать old/new contracts
одновременно. Исключения только из `AGENTS.md`: canonical data, stable
identity, immutable historical snapshots или отдельно утверждённый внешний
compatibility contract. Published Alembic revisions не переписывать; schema
удалять новой forward migration.

## Future boundaries

Этот plan не реализует ordered child layout, physical occupancy,
selector-based collapse rules, reusable Location series templates или arbitrary
non-physical grouping. Эти направления остаются отдельными future/open
capabilities без type-specific Location taxonomy и без сохранения MapComposite.
