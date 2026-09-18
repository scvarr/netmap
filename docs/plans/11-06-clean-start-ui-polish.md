# 11.6 Полировка UI при чистом старте

## Цель и порядок работы

Этот журнал фиксирует замечания, найденные при последовательном ручном
проходе продукта от первого экрана после авторизации до полностью собранного
representative L1 стенда.

Правило прохода: ручной шаг → первое замечание → остановка → bounded fix →
повторная ручная проверка → продолжение того же стенда.

Существующие замечания `C-*` из
`docs/plans/11-05-phase-c-acceptance-closure.md` остаются обязательными и не
заменяются этим документом. Новые замечания этого прохода получают
идентификаторы `P-UX-*`.

## Реестр

### P-UX-01 — первое пустое состояние карты

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — **ПРОЙДЕНА**.

**Замечание.** Пустое состояние первой карты не соответствует визуальному
языку приложения и не воспринимается как явная стартовая точка.

**Согласованный контракт.** При `maps.length === 0` блок с «Создайте первую
карту» и кнопкой «Создать» расположен по центру доступной рабочей области
карты по горизонтали и вертикали. CTA переиспользует существующий класс
`.primary-action`; отдельный контейнер empty state допускается для
центрирования и небольшой локальной стилизации. Нажатие CTA по-прежнему
открывает существующий диалог создания карты. Не меняются создание и
сохранение `SavedMap`, datasource/API, toolbar карты, переключение
Logical/Physical, состояние уже существующей пустой карты, другие empty state
экраны и общий дизайн `MapPage`.

### P-UX-02 — лишнее сообщение на пустой созданной карте

**Статус: IMPLEMENTED.** Ручная перепроверка — **ПРОЙДЕНА**.

**Замечание.** После создания `SavedMap` без объектов canvas уже
самодостаточно показывает пустое рабочее пространство; отдельное сообщение
«Карта „{name}“ пока пуста» избыточно и мешает интерфейсу.

**Согласованный контракт.** Сообщение полностью убрать без замены; остальной
интерфейс и поведение пустой созданной карты не менять.

### P-UX-03 — связь spatial workflow с canonical Locations

**Статус: CONTRACT AGREED / IMPLEMENTATION PENDING.**

**Замечание.** После создания первой карты spatial workflow недостаточно
связан с canonical Locations.

**Согласованное product/architecture решение.** Отказаться от manual Regions
как целевой capability и отображать canonical Location hierarchy на карте
через derived dynamic Location frames. Membership и направление зависимости
определяются spatial contract:
[[architecture/presentation/09-spatial-location-mapreference-contract|derived Location frames]].
Canonical Location остаётся source of truth; текущая Region реализация ещё
существует до отдельного removal milestone.

### P-UX-04 — sidebar автоматически сворачивается на карте

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — **ПРОЙДЕНА**.

**Замечание.** На основном рабочем экране `/map` навигация принудительно
превращается в набор иконок; для нового пользователя их назначение неочевидно.

**Согласованный контракт.**

- expanded по умолчанию;
- никакого route-driven auto-collapse;
- ручное collapse/expand;
- локальное сохранение предпочтения;
- labels скрываются только по явному выбору пользователя;
- collapsed icons имеют tooltip/accessibility labels.

### P-UX-05 — первый рабочий шаг после создания SavedMap

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — **ПРОЙДЕНА**.

**Согласованный контракт.** Когда существует хотя бы один `SavedMap` и
успешно загруженный `CatalogInventoryDataSource` возвращает пустой
`equipment`, на canvas показывается небольшой блок «Создайте первое
оборудование» с пояснением и CTA «Создать первое оборудование». CTA ведёт в
существующий normal workflow `/infrastructure/objects/new`. Состояние
определяется только по реальному inventory: пустота текущей карты не является
признаком first-run, а при `equipment.length > 0` блок не показывается даже на
пустой карте. Пока inventory загружается или загрузка завершилась ошибкой,
блок не показывается. Не вводятся persisted onboarding state и изменения
backend/API/DB; first-map CTA при `maps.length === 0` остаётся без изменений.

### P-UX-06 — progressive discovery при отсутствии групп портов

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — **ПРОЙДЕНА**.

**Согласованный контракт.** При создании нового Object Blueprint успешная
пустая библиотека Port Blocks показывает prerequisite state вместо обычного
editor. Loading и ошибка загрузки не считаются пустой библиотекой. CTA открывает
существующий Port Block editor; после успешного создания первой группы портов он
возвращает пользователя на `/library/object-blueprints/new`, где библиотека
перечитывается authoritative datasource. Глобальная валидность Object Blueprint
без Port Block не меняется; backend/API/DB не меняются.

### P-UX-07 — очистка русскоязычного UI от внутренней терминологии

**Статус: IMPLEMENTED.** Ручная перепроверка ожидается после merge.

**Замечание.** В русских сообщениях и технических подписях интерфейса
показывались внутренние названия слоёв, структур данных и связей приложения.

**Согласованный контракт.** Пользовательские подписи и описания используют
понятные названия объектов сети, подключений и схем. Имена типов, API-поля и
английская локаль не переименовываются.

### P-UX-08 — единая оболочка страниц и визуальная иерархия

**Статус: IMPLEMENTED.** Ручная перепроверка ожидается после merge.

**Согласованный контракт.** Все обычные страницы, кроме специализированной
`/map`, используют единый page shell с одинаковыми max-width, полями,
вертикальным ритмом и responsive-поведением. Shared header размещает eyebrow,
`h1`, description и optional notice в одной текстовой колонке, а optional
actions — рядом с ней и ниже на узких экранах. Description ограничено
читаемой шириной, а shared `h1` использует компактный application-scale
`clamp(22px, 2vw, 24px)`. Shared breadcrumbs присутствуют на всех ordinary
non-map pages: hierarchy отражает section / parent / current page; only current
leaf получает `aria-current`, полезный parent — ссылка, одинаковые URL не
дублируются. Section label без landing route остаётся non-link intermediate
element. Eyebrow имеет page-level роль и не использует sidebar typography.
Create/edit Object Blueprint используют общий header в editor component; Port
Block editor использует тот же shared header.

### P-UX-09 — стабильная левая ось ordinary non-map pages

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — **ПРОЙДЕНА**.

**Согласованный контракт.** Shared page shell left-anchored относительно
правой границы sidebar. Page-specific `max-width` ограничивает только правую
границу и не центрирует содержимое. Breadcrumbs, header и основной content
сохраняют одинаковый left origin на всех ordinary non-map pages; `/map`
исключён.

### P-UX-10 — стабильный page chrome при async loading библиотеки групп портов

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — ожидается.

**Согласованный контракт.**

- PageShell/Breadcrumbs/PageHeader существуют во всех loading/error/empty/ready states;
- async state меняет только content area;
- никакой full-page replacement во время `loadPortBlocks()`;
- datasource/navigation semantics не меняются.

### P-UX-11 — компактная рабочая область Object Blueprint composition editor

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — ожидается.

**Согласованный контракт.** Visual viewport composition editor имеет bounded
height. Aspect ratio Blueprint body сохраняется, а body целиком вписывается
через meet/contain semantics. Normalized placement, persistence и semantics
drag/resize/alignment не меняются; viewport больше не растягивает страницу
вслед за aspect ratio body.

### P-UX-12 — desktop workspace layout Object Blueprint editor

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — **ПРОЙДЕНА**.

**Согласованный контракт.** Desktop editor использует левую authoring rail и
правую composition workspace, используя доступную ширину PageShell вместо
глобального ограничения в 760px. Левая rail содержит свойства Blueprint,
internal links, validation и Save. Правая workspace содержит chooser, face
controls, bounded canvas и compact controls выбранного instance. Большой
`PortBlockStructurePreview` внутри selected-instance editor UI отсутствует.
На узком viewport layout сворачивается в одну колонку. Authoring semantics и
persistence не меняются.

### P-UX-13 — компактный выбор Object Blueprint при создании объекта

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — ожидается.

**Согласованный контракт.** Create-object Blueprint picker представлен
semantic compact table: одна строка — один Blueprint. Library
`.blueprint-card` для него не переиспользуется. Table использует только данные
`ObjectBlueprintListDocument`, без дополнительных version/detail loads, и
содержит колонки name, object type, version, ports, internal links и action.
Компактное action открывает существующий `BlueprintInstantiationDialog`. На
узком viewport table сохраняется внутри horizontal wrapper. Search, filter,
sort и pagination не входят в этот milestone. Instantiation semantics не
меняются; ручное создание остаётся отдельным fallback ниже picker.

### P-UX-14 — Location при создании Blueprint-backed object

**Статус: IMPLEMENTED.** Ручная перепроверка после merge — ожидается.

**Замечание.** Текущий create-from-Blueprint workflow запрашивает только имя
экземпляра. Canonical `Location` можно назначить лишь после создания объекта
через отдельную карточку.

**Согласованный product contract.** После выбора Object Blueprint пользователь
попадает в полноценное состояние создания `PhysicalObject`. Форма показывает
выбранный `Blueprint` и его выбранную версию, read-only summary текущего
`Blueprint` (user-facing представление типа/класса, количество портов и
внутренних связей), обязательное имя экземпляра и optional canonical
`Location`. Неизвестное местоположение допустимо и не блокирует создание.
Для выбора `Location` переиспользуется существующий hierarchical Location UX,
поиск и canonical Location model; фиксированная таксономия `Location.type` не
вводится.

`Location` — canonical факт физического места, а `SavedMap`, размещение на
карте, координаты и другая presentation state не входят в create-object
contract и не смешиваются с ним. Object instantiation и optional initial
`Location` должны восприниматься пользователем как одна create operation.
Frontend sequence не должен допускать успешное создание `PhysicalObject` с
последующей отдельной ошибкой Location write, при которой повтор create может
создать duplicate object. Предпочтительная семантическая граница —
Blueprint instantiation с optional initial `Location` либо эквивалентная
transactional application command. Точный backend/API механизм определяется
implementation milestone после проверки текущего write path.

**Границы.** P-UX-14 не закрывает и не дублирует отдельный `C-UX-02` о штатном
создании `PhysicalObject` через `Blueprint` и не меняет его требования к
отсутствию штатного ручного создания. В него также не входят map placement,
interface/port editing, IP/L2/L3 data, generic onboarding или unrelated
create-object redesign.

**Ручная проверка после implementation.** Выбрать `PC-1ETH`, в одном create
workflow указать имя `PC1` и существующий `Location`, создать объект и перейти
в его карточку. Убедиться, что объект создан один раз, `Location` уже назначен,
а повторная загрузка сохраняет association.

### P-UX-15 — информационная архитектура карточки PhysicalObject

**Статус: CONTRACT AGREED / IMPLEMENTATION PENDING.**

**Замечание.** Текущая карточка `InfrastructureObject` складывает identity и
basic data, `SavedMap` membership/actions, `Location`, Blueprint provenance и
upgrade state, `ConnectionPoints` и физические подключения,
`NetworkInterfaces` и interface-level operations в одну длинную страницу.

**Согласованный product contract.** Карточка `PhysicalObject` становится
object shell с устойчивым header и отдельными semantic tabs/routes. Начальный
набор: `Обзор`, `Физика`, `Интерфейсы`. Header кратко показывает display name,
понятное user-facing представление типа/класса, краткий Blueprint provenance
и Location context при наличии; полный detail dump в header не размещается.

**Обзор** содержит object-level информацию и lifecycle/navigation actions:
display name, user-facing type/class presentation, canonical `Location`;
имя Blueprint, instantiated version и current/update state, если он уже
поддерживается существующим backend; действие открыть Blueprint и доступный
для объекта существующий Blueprint upgrade workflow; `SavedMap` memberships,
открытие существующего размещения и существующее действие добавления объекта
на карту; summary с количеством ports, connected/free и interfaces. Полные
списки ports и interfaces здесь не дублируются.

Будущее переименование `PhysicalObject` из `C-UX-04` естественно относится к
object-level Overview/lifecycle surface, но P-UX-15 не реализует и не закрывает
`C-UX-04` автоматически.

**Физика** — L1 physical workspace объекта: `ConnectionPoints`, их status и
free/connected state, external physical attachments, Cable/Connection
presentation, direct `InterfacePhysicalBinding` presentation, internal
physical continuity для passive objects, connect/disconnect и другие уже
существующие L1 physical actions.

**Интерфейсы** содержит `NetworkInterfaces`, physical realization/bindings,
существующие interface actions и поддерживаемые interface hierarchy/realization.
L2/L3 facts не переносятся сюда произвольно только из-за их связи с
интерфейсом. `NetworkInterface` и `ConnectionPoint` остаются разными canonical
concepts: passive objects могут иметь `ConnectionPoints` без
`NetworkInterfaces`.

Object detail navigation должна допускать будущие отдельные semantic
L2/L3 sections/tabs/routes без нового redesign. В P-UX-15 пустые L2/L3 tabs не
создаются, новые L2/L3 semantics и изменения domain model не вводятся.

**Routing/navigation.** Overview является default object route, а semantic
tabs имеют addressable route/deep-link semantics, не только transient React
state. Концептуальные пути: `/infrastructure/objects/<id>` для Overview,
`/infrastructure/objects/<id>/physical` для `Физика` и
`/infrastructure/objects/<id>/interfaces` для `Интерфейсы`. Точная реализация
определяется implementation milestone после проверки текущей routing
structure. Generic tabs framework для всего приложения не вводится.

**Границы.** `SavedMap` membership и размещение остаются presentation state,
тогда как canonical `Location` остаётся фактом физического места.
`ConnectionPoint` и `NetworkInterface` не объединяются. P-UX-15 задаёт место
для будущего rename action из отдельного `C-UX-04`, не закрывая его; он также
не меняет domain model или semantics ради будущих L2/L3 tabs.
