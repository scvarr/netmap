# Текущее состояние NetMap

Срез состояния продукта с решениями и ручной проверкой от 11.11.2026. Это состояние продукта, не журнал разработки.
Контракты: [ARCHITECTURE](ARCHITECTURE.md); оставшаяся работа: [BACKLOG](BACKLOG.md);
обсуждения: [OPEN_DECISIONS](OPEN_DECISIONS.md).

## Реализовано и доступно пользователю

- Canonical L1: PhysicalObject, ConnectionPoint, NetworkInterface, физические
  bindings, Connection/ConnectionMember и Cable. Карточка объекта разделена на
  обзор, физику и интерфейсы. Обычный connect/disconnect и bulk pairing работают
  с ordinary endpoints cardinality=1; это не полное multichannel authoring.
- BaseTemplate и ModuleTemplate: библиотеки, создание и редактирование,
  persisted drafts, проверка candidate, impact review, публикация immutable
  revision, создание объектов и установка модулей, анализ и безопасное обновление
  объектов/установок. Недостаточная совместимая ёмкость требует вмешательства,
  без потери конфигурации. **HV-01 PASSED**.
- Геометрия оборудования: панели, порты, module body geometry, composition layout,
  ручная компоновка установок, логические модульные места с count/capacity.
  Установленный модуль — конфигурация объекта, не отдельный PhysicalObject.
- **PT-01/02/03 IMPLEMENTED / ACCEPTED / MERGED**. Справочник PortType,
  обязательный выбор активного типа для template endpoints; название и цвет
  читаются из актуального справочника, включая архивные используемые записи.
  NETWORK_PORT квадратный, CONNECTION_POINT круглый. PT-03 manual recheck PASSED.
  Новые PortType создаются в разделе «Справочники», не внутри редактора шаблона.
- Locations: произвольная canonical hierarchy, поиск и выбор родителя,
  назначение объекту, дерево с collapse/expand, массовое создание дочерней серии
  с preview и атомарным сохранением. Location.type — открытая optional строка.
- SavedMap и именованные MapPresentationVariant: placements, отдельные позиции
  физических/логических видов, presentation routes, text annotations.
  Spatial P-UX-03A–E реализован; **P-UX-03E ACCEPTED / MERGED / MANUAL RECHECK PASSED**.
  Derived Location frames, unary path labels, recursive collapse, выбор видимых
  непосредственных элементов, group move с collision rejection и route transform.
- Редактор кабельного маршрута: transient draft, Save/Cancel, добавление,
  перемещение и удаление waypoints через инспектор, snapping к чужой геометрии,
  angle/length assistance, числовое изменение длины сегмента, boundary anchors.
  Выбор другого элемента не теряет draft; выход из карты отменяет несохранённое.
  Полной Undo/Redo истории нет.
- Массовые операции: ordered port pairing с обязательным preview и одной
  canonical transaction; шаблоны Cable labels; массовое именование и spatial
  order endpoints, выравнивание/распределение в редакторах.
- L1 trace из карты и physical trace API с exact evidence; Cable highlight
  не выводится из пересечения линий. **C-COR-01, C-UX-08 replacement VERIFIED**;
  **C-UX-07 и C-UX-11 VERIFIED**.
- **C-UX-15 VERIFIED**: естественный порядок портов L1 trace, реальные имена
  панелей/портов и модульный контекст при совпадении; «Любой порт» первым,
  дубликаты сохраняют canonical IDs. Техническая реализация прошла external review
  (c4c04ed); пользователь 10.11.2026 подтвердил успешную ручную проверку.
- **C-COR-02 VERIFIED**: пользователь 10.11.2026 подтвердил распределение у
  границ панели, отклонение невозможной операции без частичных изменений,
  сохранение и повторное открытие.
- **C-VIS-03 VERIFIED**: foreground SVG перекрывал маркеры DeviceNode
  фиксированной заливкой; теперь foreground использует общий каталог PortType,
  включая архивные типы. Wiring-подсветка отделена от базового цвета.
  Адресные автоматические проверки пройдены. External review реализации
  daff76edce19424c6ba72004ee4b41f5b0d8772d и ручная приёмка пройдены
  10.11.2026: пользователь подтвердил сохранение цветов после операций
  с кабелями и в проверенных режимах карты.
- Export/reset/import текущего implicit workspace через настройки данных.
  Текущий Workspace JSON **v7** (`app/workspace_portability.py`), с geometry,
  layout и logical module places version 1. Это не persisted multi-workspace UI.

- **C-UX-02 VERIFIED**: штатное создание PhysicalObject из BaseTemplate с выбором
  initial Location, без обходных ручных операций. Пользователь 10.11.2026 подтвердил
  неоднократную успешную проверку. Это не приёмка picker preview или иных сценариев.
- Rename PhysicalObject доступен в списке оборудования: клиент вызывает
  `PUT /v1/topology/physical-objects/{physical_object_id}/display-name`;
  тесты покрывают обновление inventory и сохранение identity/связей.
  **C-UX-04 VERIFIED**: пользователь 11.11.2026 прошёл все шесть проверок:
  rename оборудования с портами, Cable, Location и SavedMap; новое имя в списке,
  карточке, карте и инспекторе; поиск и L1 trace; переходы, варианты карты и reload;
  сохранение canonical IDs, подключений и placements; отсутствие дублирования.

## Реализовано в canonical/resolver core, но не как полный UI продукта

Backend содержит L1 member-aware connectivity, interface realization,
L2 contexts/bindings/encapsulation, configured/effective forwarding и FDB,
L3 routing/next-hop/reachability, security, NAT, policy routing и packet-flow
orchestration. Реализацию задают `app/*resolver.py`, модели и соответствующие
backend tests. Наличие core не означает продуктовую готовность L2/L3.

Logical SavedMap и bounded interface/L2 actions существуют; полноценного
L2/L3 authoring/trace workbench, operational collection и multi-user приложения
нет. Продуктовая реализация L2 начинается только после L1 PRODUCT COMPLETE.

## Реализовано, но требует отдельной ручной проверки

C-UX-01/12/13/14 имеют отдельный
RECHECK PENDING. HV-01 не заменяет проверки визуальной компоновки F2b,
управления портами ModuleTemplate, pinned preview, адаптивной высоты таблицы
установок и faithful library preview. P-UX-07/08/11 и заменяющие сценарии
P-UX-13/14/15 сведены к C-UX-02/04/09 и проверке переходов вкладок, без повторного create acceptance. Подробнее — BACKLOG.

## Отсутствует и текущие ограничения

Phase C **OPEN**, Phase D не завершена, **L1 PRODUCT COMPLETE не достигнут**.
Не реализованы truthful FANOUT-1x24 authoring и multichannel connect через UI
(C-CAP-01), Location cable channels/comb (C-UX-10), route Undo/Redo (C-UX-16),
P-UX-21; контракт P-UX-22 ещё требует решения.
C-UX-03 — NOT REQUIRED: произвольных названий панелей достаточно, отдельная
FRONT/REAR-семантика не нужна; это не реализованная функция. C-UX-05 — OPEN:
направляющие runtime map нужны относительно размещённых объектов; bounded UX
открыт, отдельно от auto-layout. C-UX-06 — OPEN: Width/Height пока не реализовывать,
повторно оценить после P-UX-21, не VERIFIED. C-UX-09 — OPEN: нужен раскрываемый
графический preview при выборе BaseTemplate по примеру preview библиотеки.
C-VIS-01 — OPEN: общий совпадающий подсвеченный участок допустим, но evidence
отдельных Cables не смешивается и пересечение не доказывает connectivity.
C-VIS-02 — OPEN: отдельное исправление отложено до повторной проверки после
изменения маркеров P-UX-21; автоматически не закрывается.

Ближайшая очередь: BT-DRAFT-01 (OPEN / implementation not started), BT-COPY-01
(OPEN), C-CAP-01 (OPEN), продолжение representative L1 acceptance. Согласованные
границы BaseTemplate работ — в [BACKLOG](BACKLOG.md); это не смена gates A–I.
C-CAP-01 — обязательный semantic gap Phase D: один задний вход с 24 адресуемыми
каналами, 24 передних порта, exact internal mapping 1..24, один физический
multichannel Cable и точный trace канала после reload. Foundation существует,
но BaseTemplate authoring/materialization и обычный Cable UI ограничены cardinality=1.
DTO/API, member mapping editing, lifecycle/reconcile и UX открыты; не IMPLEMENTED.
Fanout entity, фиктивные порты и 24 искусственных Cable не подменяют этот сценарий.

Boundary route re-entry одного Location не поддерживается. Общие каналы,
endpoint-relative route sections, MapReference, physical occupancy, дополнительные
справочники и характеристики PortType — будущие возможности.
MapComposite и MapRegion удалены, поддерживаемыми моделями не являются.

## Условия завершения и границы обязательности

L1 PRODUCT COMPLETE требует gates C/D → E → F → G → H → I, включая persisted
workspace/auth/access/sharing/activity и обязательные PERF-002/003/004/005.
Состав необходимых fixes C/D и вопросы обязательности отдельных UX findings
явно разделены в [BACKLOG](BACKLOG.md).
Необязательные улучшения с «до L2: НЕТ» и будущие product decisions не становятся
blockers автоматически. Нового roadmap эта сверка не вводит.
FE-002 уточнён как OPEN: guard создания variant не защищает создание карты.
