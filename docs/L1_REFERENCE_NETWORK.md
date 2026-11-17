# L1-REFERENCE-01 — Reference Network & Portability Contracts

Статус: **DECIDED TARGET, не IMPLEMENTED** (12.11.2026).
[Архитектура](ARCHITECTURE.md), [состояние](PROJECT_STATE.md),
[backlog](BACKLOG.md), [решения](OPEN_DECISIONS.md), [L1](L1_CONNECTIVITY.md).
Это воспроизводимый acceptance specification, не результат запуска стенда.

## Независимые карты

CURRENT: SavedMap — presentation scope над общей canonical topology implicit
workspace; независимое владение топологией картами ещё не реализовано.
TARGET: каждая карта — самостоятельная сеть. PhysicalObject, ConnectionPoint,
NetworkInterface, Connection, ConnectionMember, Cable и Location принадлежат
конкретной карте. Между картами нет общих физических объектов, соединений или
местоположений; canonical topology изолирована. Одинаковые имена допустимы.
Общие библиотеки: BaseTemplate, ModuleTemplate, PortType и будущий CableType.
MapPresentationVariant — компоновка одной карты, не другая сеть; переключение
не изменяет topology. NetworkWorkspace обеспечивает application isolation,
права и организацию работы, не отменяя независимость сетей карт.
Копирование частей карт и импорт фрагментов — отдельные будущие capabilities
с remapping identities. DB schema, FK migration strategy и API не выбраны.

## Переносимые определения

Отдельные файлы: PortType catalog, будущий CableType catalog, BaseTemplate,
ModuleTemplate. Это определения создаваемых сущностей с необходимыми
зависимостями через локальные семантические ключи, не экспорт таблиц и не
workspace snapshot/export-import v7. Исходные UUID не становятся identity новых записей.

Импорт проверяет файл, версию, определения и зависимости; сопоставляет типы
с текущими справочниками, предлагает создать отсутствующие, показывает preview
и конфликты. Существующие типы автоматически не перезаписываются. Импорт
шаблона заполняет редактор создания нового шаблона; persisted записи создаются
только после подтверждения. Ошибка согласованной операции не оставляет частично
созданных типов или шаблонов. Сохраняются cardinality, member_mappings, geometry,
module places и PortType assignments. Неподдерживаемое редактором определение
явно блокируется, а не упрощается. Неподдерживаемую старую версию можно явно
отклонить; универсальная legacy compatibility не требуется. JSON schema,
маршруты API и UX-компоненты требуют будущих implementation contracts.

## CableType

CableType — общий пользовательский справочник физической конструкции кабеля.
Каждый новый Cable обязан ссылаться на существующий тип. Cable — identity
конкретного физического изделия; ConnectionMember задаёт точное соответствие
каналов. Число жил, пар или волокон не обязательно равно числу независимых
сетевых линий. Изменение описательного имени/цвета может отражаться на всех
связанных кабелях. Используемую физическую конструкцию нельзя менять так,
чтобы незаметно менялась физическая семантика существующих Cable.
Исторические кабели требуют контролируемого перехода к обязательному типу.
Vendor taxonomy, закрытый enum, schema/API здесь не задаются.

## Синтетический стенд и локальные ключи

Все модели синтетические, без vendor specifications. Ключи ниже — стабильные
ключи сценария, не UUID, имена или координаты. Диапазоны раскрываются включительно;
каждая пара в диапазоне — отдельное определение/соединение, если не указано иначе.
Location hierarchy: site → F02 → room201, corridor, comm → F02-R01 (под comm);
site → F01 → serverroom → F01-R01, F01-R02, F01-R03.

| Location | Ключи PhysicalObject и BaseTemplate |
|---|---|
| room201 | pc: BT-PC; phone: BT-PHONE; printer: BT-PRINTER; outlet: BT-OUTLET3 |
| corridor | ap: BT-AP |
| F02-R01 | access: BT-ACCESS; patch02: BT-PATCH; odf02: BT-ODF24; pair02: BT-PAIR4 |
| F01-R01 | srv1, srv2: BT-SERVER |
| F01-R02 | storage: BT-STORAGE; shelf1, shelf2: BT-SHELF; nas: BT-NAS |
| F01-R03 | core: BT-CORE; optical: BT-OPTICAL; opticalSwitch: BT-OPTICAL-SWITCH; sanA, sanB: BT-SAN; router: BT-ROUTER; firewall: BT-FW; mgmt: BT-MGMT; odf01: BT-ODF24; patch01: BT-PATCH; pair01: BT-PAIR4 |

### Определения портов и модулей

Все неоговорённые endpoints имеют capacity 1. NETWORK_PORT активен и имеет
NetworkInterface; пассивные endpoints — CONNECTION_POINT без interface.
PortType keys: pt-rj45, pt-fiber, pt-multipair, pt-pair-terminal, pt-fc. Тип не доказывает continuity.
CableType keys: ct-rj45 (4 пары, одна сетевая линия), ct-fiber24 (24 волокна),
ct-fiber1 (одно волокно), ct-pair4 (4 пары с независимыми пассивными окончаниями),
ct-fc-line (синтетическая FC линия; не спецификация duplex optics).

| BaseTemplate / ModuleTemplate | Порты, места и явная внутренняя continuity |
|---|---|
| BT-PC, BT-PHONE, BT-PRINTER, BT-AP | eth: pt-rj45 NETWORK_PORT |
| BT-OUTLET3 | front1..3, rear1..3 RJ45; rear i/1 ↔ front i/1 |
| BT-PATCH | front1..8, rear1..8 RJ45; rear i/1 ↔ front i/1 |
| BT-ACCESS | eth1..8 RJ45 NETWORK_PORT; opt1..2 fiber NETWORK_PORT |
| BT-ODF24 | rear capacity 24 fiber; front1..24 fiber; rear/i ↔ front i/1, 24 отдельных internal Connections |
| BT-PAIR4 | rear capacity 4 multipair; front1..4 pt-pair-terminal — пассивные окончания целых пар; rear/i ↔ front i/1 |
| BT-SERVER | два места nic, hba с capacity/count для одной установки каждого; встроенный mgmt RJ45 NETWORK_PORT |
| MT-NIC | eth1..2 RJ45 NETWORK_PORT; установка nic в каждом srv |
| MT-HBA | a, b FC NETWORK_PORT; установка hba в каждом srv |
| BT-STORAGE | controllerA.fcA/fcB и controllerB.fcA/fcB FC NETWORK_PORT; mgmt RJ45; контроллеры — явно именованные секции синтетического корпуса |
| BT-SHELF | inventory-only корпус, физические SAS endpoints/связи не создаются |
| BT-NAS | eth1..2 и mgmt RJ45 NETWORK_PORT |
| BT-CORE | eth1..8 RJ45, opt1..4 fiber NETWORK_PORT |
| BT-OPTICAL | пассивный оптический кросс: in1..2, out1..2 fiber CONNECTION_POINT; in i/1 ↔ out i/1 |
| BT-OPTICAL-SWITCH | opt1..2 fiber NETWORK_PORT; internal continuity между портами отсутствует |
| BT-SAN | fc1..8 FC NETWORK_PORT; mgmt RJ45 NETWORK_PORT |
| BT-ROUTER, BT-FW | eth1..4 RJ45 NETWORK_PORT |
| BT-MGMT | eth1..12 RJ45 NETWORK_PORT |

Многопарный сценарий проверяет пассивную continuity целых пар между блоками,
не RJ45 Ethernet и не проводники внутри RJ45. front1..4 — реальные пассивные
окончания пар; дополнительные Ethernet patch cords к ним не создаются.

ModuleTemplate internal continuity не требуется этим активным NIC/HBA;
его поддержка не выводится из BaseTemplate materialization.

### Точные внешние связи

Каждая строка/элемент диапазона имеет Cable key, производный от указанного ключа
строки и индекса. Для capacity 1 mapping всегда 1→1. Internal связи выше Cable не имеют.

| Cable key | Endpoints / mapping / CableType |
|---|---|
| desk.i (i=1..3) | pc.eth, phone.eth, printer.eth соответственно → outlet.front i; ct-rj45 |
| horizontal.i (1..3) | outlet.rear i → patch02.rear i; ct-rj45 |
| access.i (1..3) | patch02.front i → access.eth i; ct-rj45 |
| ap-link | ap.eth → patch02.rear4; ct-rj45 |
| ap-patch | patch02.front4 → access.eth4; ct-rj45 |
| backbone | odf02.rear → odf01.rear; один ct-fiber24, mappings 1→2, 2→1, i→i для 3..20; 21..24 не подключены |
| uplink02.i (1..2) | access.opt i → odf02.front i; ct-fiber1 |
| uplink01.i (1..2) | odf01.front i → optical.in i; ct-fiber1 |
| core-opt.i (1..2) | optical.out i → core.opt i; ct-fiber1 |
| multipair | pair02.rear → pair01.rear; один ct-pair4, 1→3, 3→1; members 2,4 свободны |
| optical-switch-in | core.opt3 → opticalSwitch.opt1; ct-fiber1 |
| optical-switch-out | opticalSwitch.opt2 → core.opt4; ct-fiber1 |
| srv-eth.i (1..2) | srv i.nic.eth1 → patch01.rear i; ct-rj45 |
| srv-core.i (1..2) | patch01.front i → core.eth i; ct-rj45 |
| san-a.i (1..2) | srv i.hba.a → sanA.fc i; ct-fc-line |
| san-b.i (1..2) | srv i.hba.b → sanB.fc i; ct-fc-line |
| storage-a.i (1..2) | controllerA.fcA, controllerB.fcA → sanA.fc3, fc4 соответственно; ct-fc-line |
| storage-b.i (1..2) | controllerA.fcB, controllerB.fcB → sanB.fc3, fc4 соответственно; ct-fc-line |
| nas-core | nas.eth1 → core.eth3; ct-rj45 |
| edge-core | core.eth4 → router.eth1; ct-rj45 |
| edge-fw | router.eth2 → firewall.eth1; ct-rj45 |
| management.i (1..5) | srv1.mgmt, srv2.mgmt, storage.mgmt, sanA.mgmt, sanB.mgmt → mgmt.eth2..6; ct-rj45 |

SAN Fabric A/B физически независимы: никаких A↔B связей. B — подключённый
резервный путь, не ошибка полноты. sanA/B.fc5..8 и srv1/2.nic.eth2 свободны.
Backbone 3..20 подключены как резервные волокна без активных окончаний;
21..24 свободны. Неполный mapping не дополняется автоматически.

## Приёмка и evidence — будущий запуск

- pc.eth → access.eth1: REACHABLE через outlet и patch02, точные refs всех
  Connection/ConnectionMember/Cable и members; printer не попадает в evidence.
- access.opt1 → core.opt2: REACHABLE через backbone 1→2 и optical канал 2;
  access.opt1 → core.opt1 не имеет подтверждённого пути (UNKNOWN). Evidence
  успешного пути включает оба ODF, backbone member 1→2 и явный internal mapping
  optical.in2/1→out2/1. core.opt3→opticalSwitch.opt1 и opticalSwitch.opt2→core.opt4
  по отдельности REACHABLE; core.opt3→core.opt4 через opticalSwitch — UNKNOWN:
  активные NETWORK_PORT завершают L1, transit, conversion и L2 forwarding не выводятся.
- rear/i → front i/1 каждого ODF: только указанный member, без соседних front.
  Backbone member21 и multipair member2 не дают пути; это свободные каналы.
- pair02.front1/1 → pair01.front3/1: REACHABLE через internal rear/1,
  один Cable multipair с mapping 1→3 и internal rear/3 противоположного блока.
  Evidence содержит эти members, internal Connections и внешний Cable/Connection.
  pair02.front3/1→pair01.front1/1 — отдельный путь mapping 3→1;
  pair02.front1/1→pair01.front1/1 и pair02.front2/1→pair01.front2/1 — UNKNOWN, без
  автоматического дополнения и без Ethernet-коммутаторов в evidence.
- srv1.hba.a → sanA.fc1 и hba.b → sanB.fc1: отдельные evidence.
  Через SAN switch к storage L1 transit нет, как и через access/core/router/firewall.
  Физическая connected резервная B не означает автоматический failover или L2/L3.
- Повторная внешняя занятость member, индекс вне capacity, повтор member внутри
  mapping, cross-map связь отклоняются атомарно, прежние связи сохраняются.
- Внешний lifecycle: preview create/edit permutation/subset, конфликт без частичной
  записи; disconnect backbone удаляет только внешний Cable/continuity, сохраняет
  internal ODF mapping; reconnect — новая явно созданная Cable identity.
- Save/reload сохраняет IDs, capacities, mappings, установки, типы и evidence;
  variants меняют только компоновку. Две карты с одинаковыми labels независимы.
- Portable roundtrip сохраняет все определения; неизвестный тип требует решения,
  неподдерживаемый editor/version явно отклоняет файл, ошибка не оставляет записей.

C-CAP-01 остаётся OPEN Phase D; 02/03/04 этим документом не закрыты.
Текущий редактор multichannel не поддерживает: недоступные шаги фиксируются как
blocker, не обходятся API/DB writes при пользовательской приёмке.

## Future / OPEN

Многоконцевой MPO→LC breakout требует одной Cable identity и настоящих окончаний;
PON splitter — отдельной семантики деления; физическая SAS-связность полок —
отдельного контракта. Duplex optics: соответствие двух физических волокон одному
NetworkInterface остаётся OPEN; синтетические fiber1/FC endpoints не решают его.
Эти сценарии не инициализируются фиктивными портами, Cable или connections.

## Будущая demo initialization

Декларативный сценарий использует локальные ключи и общие библиотеки, создаёт
самостоятельную карту с новыми canonical identities. Автоматический запуск только
при безопасной первоначальной инициализации; повторный запуск не создаёт дубликатов.
Пользователь создаёт независимые карты; demo не меняет пользовательские данные.
Повторное восстановление требует отдельного явного действия и политики конфликтов.
Unsupported capabilities не создают fake topology. Критерий безопасной первоначальной
инициализации, conflict policy и loader требуют implementation contract.
Отдельный bounded milestone map isolation обязателен до включения demo initialization.
Loader и map isolation здесь не реализуются; Phase A–I не переставляются.
