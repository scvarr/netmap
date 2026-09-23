# 11.7 Hierarchical Location presentation

## Статус и граница

Это компактный последовательный implementation plan для spatial cutover.
NetMap pre-production; P-UX-19 и P-UX-03A/B реализованы, P-UX-03C..E остаются **IMPLEMENTATION PENDING**. Не
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

**IMPLEMENTED.** Physical SavedMap показывает derived nested frames по canonical Location catalog, live placement `location_ref` и текущим node rectangles. Frame geometry пересчитывается при drag, rollback, resize и смене variant; пустые branches не рисуются. Targeted frontend validation пройдена; collapse и group move остаются отдельными milestones.

Derive direct membership и canonical subtree; построить nested dynamic frames.
Movement и resize объектов обновляют frames, но frame geometry не persisted.
Не выбирать произвольных глубоких descendants вместо direct elements.

### P-UX-03C — Variant-specific Location collapse

Ввести Location presentation state для каждой пары
`MapPresentationVariant + Location`: collapsed/expanded и explicit visible
direct elements. Применять recursive child Location presentation, exact
boundary evidence и derived proxies. Collapse родителя не уничтожает child
state; membership объектов не дублировать.

### P-UX-03D — Interactive Location group move

Добавить frame handle/context action. Перемещать canonical subtree одним delta,
включая скрытые placements; валидировать collisions и отклонять пересечение с
внешним объектом без automatic re-layout. Классифицировать internal/external/
boundary routes, сохранить internal geometry и деформировать boundary route по
contract. Positions и routes сохранять одной atomic server-side write
operation.

### P-UX-03E — Spatial acceptance and dead-code cleanup

Провести representative manual validation hierarchical collapse, nested frames,
group move, collisions, exact boundary evidence и route semantics. Удалить
оставшиеся obsolete helpers/styles/types, затем обновить связанные `C-*`
statuses только после проверки. Зафиксировать завершение spatial cutover.

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
