# Действующие архитектурные контракты

Состояние реализации отделено в [PROJECT_STATE](PROJECT_STATE.md), будущие
решения — в [OPEN_DECISIONS](OPEN_DECISIONS.md). Этот документ не расширяет scope.

## Источники истины и identity

Canonical topology — runtime source of truth. Canonical facts, presentation
state и derived read context — три разные категории. Projection, scene geometry,
layout, cache и trace artifact не становятся canonical input. Blueprint и Port
Block — authoring/provenance/presentation, не runtime topology entities; obsolete
авторские API не сохраняются ради исторической читаемости.

Identity задают стабильные canonical IDs и opaque definition keys, никогда
имя, номер, порядок, координаты или layout. Публикуемые ревизии и сохранённые
immutable snapshots не редактируются. Перемещение/переименование не пересоздаёт
endpoint. Exactly-once write: после успешной mutation и ошибки refresh повторяют
только read. Canonical aggregate locks и повторная проверка защищают от races.
Строгие DTO и finite coordinates не допускают тихой подмены повреждённых данных.

## PhysicalObject, endpoints, Cable и Connection

PhysicalObject — физический объект, ConnectionPoint — физическая точка;
NetworkInterface — отдельная сетевая сущность. CONNECTION_POINT materializes
point; NETWORK_PORT materializes point и interface с ownership/binding.
Passive object может иметь points без interfaces. Interface realization graph
описывает составные/логические интерфейсы и не заменяет physical connectivity.

Location — canonical физическое место с optional parent; циклы запрещены.
PhysicalObject имеет не более одного непосредственного Location, unknown/null
допустим. Location hierarchy и физическая вложенность оборудования не одно
дерево; Location не выводится из карты, panel/bay или координат.

Connection — недирективная continuity между двумя различными points; один
Connection имеет cardinality и уникальные member mappings в обе стороны.
Cable имеет уникальный connection_id: одному Connection соответствует не более
одного Cable; Cable ID и Connection ID — разные identity.
Connection — continuity между points; ConnectionMember — точный mapping
адресуемых членов. Point cardinality — число независимо трассируемых members,
а не число проводников по справочнику. Member indices должны быть в диапазоне;
неполный mapping не дополняется предположениями. Trace state включает point и
member; разные members не сливаются только из-за общего endpoint.

Cable — самостоятельная optional domain relation к Connection, а не
PhysicalObject с двумя выдуманными ports. Обычный Cable соединяет разные
PhysicalObjects; internal continuity не требует Cable. Create/delete внешней
связи сохраняет Cable/Connection/member lifecycle атомарно; Cable label не
меняет identity, endpoints, route или evidence. Cable-specific label/history
не является generic application activity journal.

Ordinary UI write поддерживает cardinality=1/member=1; общий member-aware core
не выдаётся за multichannel authoring. C-CAP-01 не закрывается 24 фиктивными
кабелями/входами или линиями без member identity. Технологии/connector/speed
не определяют автоматически cardinality или continuity.

## Шаблоны, ревизии и установки

BaseTemplate задаёт базовое оборудование; ModuleTemplate — устанавливаемый
модуль. Конфигурация конкретного PhysicalObject не является отдельным assembled
шаблоном. ModuleInstallation принадлежит объекту, имеет собственную identity;
definition keys endpoints интерпретируются внутри installation. Две установки
одного шаблона имеют разные canonical endpoints.

Persisted server draft -> frozen candidate + impact analysis -> publication.
Возврат к редактированию инвалидирует прежний analysis; stale analysis не
авторизует потерю данных. Публикация не переписывает pinned конфигурации
экземпляров. Reconcile повторно проверяет фактические зависимости под locks.

Сохраняются IDs неизменённых logical definitions, user data, connections и
bindings. Добавления и удаление неиспользуемых endpoints допустимы; наличие
зависимостей требует intervention и оставляет старую конфигурацию. «Неиспользуемый»
не означает только отсутствие внешнего кабеля. Недостаточная compatible capacity
не допускает частичной потери установок. Перемещение в совместимое место сохраняет
installation и endpoints. Сначала сохраняются допустимые позиции, затем opaque
keys определяют deterministic relocation; labels/coordinates не определяют выбор.

Логические module places имеют count/capacity и stable identity; графический
bay rectangle — presentation placement. Open compatibility value задаёт
совместимые места, не PCIe lanes/power/mechanical/port technology. Module geometry
и composition layout отделены от installation identity; pinned historical
composition не заменяется текущим mutable preview. Runtime topology после
materialization authoritative; provenance не является повторным resolver.

## Справочники

Пользовательские классификации открыты, не фиксируются vendor taxonomy в code.
PortType — reusable identity, name/color/archive status. Template endpoint
требует существующий активный тип; использованный архивный тип остаётся читаемым.
Текущие name/color применяются без новой публикации immutable template revision.
State highlight и hit target независимы от цвета/формы. NETWORK_PORT квадратный,
CONNECTION_POINT круглый; manual untyped points нейтральны.

Классификация, техническая capability, compatibility и canonical connectivity
не взаимозаменяемы. Технические поля, immutable-field locking и остальные
справочники не считаются реализованными; решения перечислены отдельно.

CURRENT. PortType — реализованный справочник. PhysicalObject class хранится
строкой, BaseTemplate может задавать default class. Location.type — optional
пользовательская строка. CableType — DECIDED TARGET / OPEN. Формы оборудования
предлагают hardcoded presets и произвольное значение. От строковых классов
зависят подписи, акценты и фильтры списка оборудования. Presets обслуживают
эти сценарии интерфейса и не образуют самостоятельный справочник.

TARGET. Пользовательские типы PhysicalObject и Location без закрытой taxonomy.
Типы отделены от canonical identity. Тип Location не ограничивает parent/children.
Тип оборудования не задаёт connectivity, endpoints или member mappings.

[Открытые решения по типам](OPEN_DECISIONS.md#справочники-и-техническая-совместимость).

## SavedMap, варианты и spatial isolation

SavedMap — presentation scope в implicit workspace. Placement задаёт membership
PhysicalObject в карте. MapPresentationVariant принадлежит одной карте и хранит
именованную компоновку: позиции по view, locks, cable routes, Location state.
Membership общий для вариантов; topology и canonical Location assignment не
меняются переключением варианта. Physical и Logical scene coordinates независимы.
MapTextAnnotation — отдельная presentation capability.

C-UX-10-01: все canonical Locations доступны в каждой SavedMap, без membership
и map isolation. Каждый Location имеет самостоятельный прямоугольный frame,
включая пустой и unary; каждый дочерний frame находится внутри непосредственного
canonical parent с отступом 20 и местом для заголовка 40. В заголовке непосредственное имя; полный canonical path доступен в tooltip.
MapLocationState.geometry хранит x/y/width/height и edge/offset обязательной
виртуальной точки отдельно для variant. Nullable manual_bounds хранит явно
заданный resize прямоугольник как нижнюю границу занимаемой области; копируется
с variant и переносится вместе с контейнером. Автоматические bounds пересчитываются
по содержимому и могут сокращаться, сохраняя manual_bounds, детей и оборудование.
До первого сохранения чтение возвращает
детерминированную иерархическую компоновку (порядок по immutable ID), без записи
в БД и без зависимости от количества оборудования. Пустой Location — компактный
горизонтальный frame высотой 64; ширина 140..360 учитывает имя и controls.
Соседи при инициализации не пересекаются.
Новый ребёнок размещается после существующих детей; предки расширяются,
соседние ветви при необходимости получают место без пересечений. Это разрешённое
начальное presentation размещение, а не canonical containment из координат.
Create/series/reparent canonical Location согласуют уже сохранённые variant layouts:
выделение места переносит затронутые соседние рамки вместе с оборудованием/routes
в той же транзакции; locked конфликт не оставляет частичных canonical/presentation writes.
Boundary identity — UUIDv5(namespace=SavedMap ID, name=Location ID), одна на пару
map/Location, не зависит от variant/геометрии. Отдельного create/delete точки нет.
Geometry PUT валидирует finite coordinates, положительные размеры и perimeter,
Location и ownership variant до записи. Copy variant копирует геометрию;
FK CASCADE удаляет presentation state при удалении variant/Location.
Geometry PUT блокирует canonical hierarchy и variant, переносит ветвь рамок
вместе со всеми существующими L1 placements её subtree (включая скрытые).
Physical position/add, geometry и group move берут hierarchy `FOR SHARE`
(Location ID order), затем свой variant `FOR UPDATE`, затем зависимые
placements/positions, routes и frame state. Это не сериализует layout writes
разных variants на hierarchy. Canonical assignment сохраняет hierarchy
`FOR UPDATE` → PhysicalObject → все затронутые variants в UUID order →
presentation rows. Hierarchy/variant locks получаются до position DML/flush;
поздний повторный lock не заменяет предварительную блокировку.
Существующий group-move core сохраняет внутренние free waypoints и внутренний
prefix boundary route; внешний suffix не переносится. Обязательная точка
Location и route anchors — разные presentation bindings.
Расширение дочерней рамки/содержимого увеличивает предков, в том числе влево/вверх,
не сжимая вручную увеличенные границы. При пересечении соседний контейнер получает
место ниже вместе с содержимым; неподвижные объекты сохраняют позиции, когда это
возможно. Locked placements, object collisions и неоднозначная boundary evidence
отклоняют всю транзакцию. Недопустимый parent shrink не обрезает содержимое:
размер сохраняется достаточным для детей и оборудования.
Сохранение фиксирует frames, positions и routes одной транзакцией и возвращает
SavedMapDocument. UI: единый drag заголовка создаёт preview рамок и оборудования,
resize и drag точки также создают draft; Save явно сохраняет, Cancel отменяет.
Отдельная кнопка group move убрана; core/API group move сохранён. Controls используют
локальный NetMap style с radius=0; увеличение масштаба не раздувает кнопки/подписи.

Назначение PhysicalObject Location согласует все существующие физические позиции
этого объекта во всех SavedMaps/variants одной транзакцией. Добавление уже назначенного
объекта и создание его physical variant position также размещают его в canonical
Location. Размер объекта определяется pinned composition panels и display_width,
включая фактически отрисованный nameplate (max(14, 12% высоты наименьшей панели));
frontend collision/layout и backend используют полный footprint
(обычный объект 212x144); свободное место выбирается детерминированно с учётом
объектов/дочерних рамок, предки расширяются согласованно. Missing placements/positions
не создаются назначением. При переносе одного объекта следуют free lead waypoints
до первого route anchor; без anchor следует первый waypoint со стороны объекта.
Canonical assignment задаётся только явной операцией, никогда координатами.
Cable/Connection/endpoints не пересоздаются и не переподключаются.
Position PUT возвращает полный authoritative SavedMapDocument: positions, frames
и routes. Клиент применяет его только к исходным map/variant; ошибка восстанавливает
подтверждённые позиции, без повторного write. Выход объекта за прежние bounds
согласует рамки и соседние ветви атомарно, не меняя canonical assignment.
Полный collapse показывает один компактный proxy с той же boundary identity,
скрывая expanded frame, все дочерние frames, proxies и оборудование, включая
пустые subtree. Expand восстанавливает persisted expanded geometry: compact bounds
производны и не записываются. При partial collapse выбранные direct elements
остаются видимыми внутри frame; скрытые endpoints используют невидимый route target
без второго подписанного proxy. Direct children доступны и без оборудования.
Внешний полный collapse приоритетен; channel-aware collapse не реализован.
MapComposite/MapRegion не поддерживаются.

Group move переносит одинаковым delta все имеющиеся L1 позиции canonical
subtree в активном variant, включая скрытые. Сервер заново разрешает subtree,
сверяет geometry evidence, locks и collision со внешними placements. Locked
member или collision отклоняет всё; отсутствующие позиции не создаются.
Positions и затронутые routes сохраняются атомарно, без automatic re-layout.

## C-UX-10 — TARGET виртуальной инфраструктуры

[Основной контракт](OPEN_DECISIONS.md#c-ux-10--automatic-location-cable-channels)
остаётся OPEN, не IMPLEMENTED. Каждый Location, включая пустой, получает ровно
одну обязательную виртуальную точку со стабильной identity; это не ConnectionPoint.
Маршрут следует граничным точкам последовательных уровней Location hierarchy.
В одном непосредственном Location переход через другие Location не требуется.
Прямой Channel произвольной пары без иерархического пути не принят. Инфраструктура не разделяется между картами; геометрия
принадлежит presentation variant. Foundation frames/points реализован в C-UX-10-01;
Channel schema/DTO/API остаются OPEN.

Cable сохраняет реальные окончания и canonical identity. Его путь динамически
составляется из индивидуальных подводов и общих участков иерархического пути без копирования.
Preview и подтверждение предшествуют persistent изменениям; ошибки не оставляют
частичных изменений. Используемый общий участок защищён от удаления, неиспользуемый сохраняется
до ручного удаления. Перемещение оборудования сохраняет окончания и пересчитывает
маршрут для новых непосредственных Location. Collapse скрывает структурные
участки; проекция внешних каналов на общего родителя не создаёт persisted Channels.
Expand восстанавливает геометрию без перезаписи. Пустой Location получает видимую
presentation область. Ничто из этого не создаёт topology evidence или exact L1 path.

## Routes и boundary anchors

CURRENT: MapCableRoute — presentation конкретного Cable в карте/variant. Internal route
(оба конца внутри subtree) переносит свободные waypoints; external не меняется;
boundary route переносит внутренний prefix до выхода, сохраняя внешний suffix.
Route anchor следует самостоятельному Location frame; это не обязательная точка Location. Без сохранённой route линия строится от endpoints.

Waypoint — {x,y} либо {x,y,anchor:{location_id,edge,offset}}; edge top/right/bottom/left,
offset 0..1. x/y у anchor — snapshot/fallback, renderable frame определяет binding.
Frame bounds сохраняются в Location presentation state. Anchor drag ограничен периметром; явный anchor
приоритетен перед повторным split того же Location, другие Locations независимы.
Повторный выход/re-entry одного Location пока отклоняется. Сохранение нормализует
пересечения без дублирования anchors. Чтение обычной route не мутирует storage;
нормализация при открытии только в draft. Group move материализует нужный anchor
в общей транзакции. Save пишет draft, Cancel возвращает persisted geometry.

Обычный selection не отменяет draft; выход из map/view отменяет без записи.
Enter/ Escape действуют вне editable/control/dialog contexts. Compact waypoint
имеет независимый увеличенный pointer target. Numeric length finite >0 меняет
выбранный ordinary waypoint вдоль направления от неподвижного соседнего конца;
не создаёт persistent constraints. Boundary anchor measurements read-only.
Snapping разных routes не создаёт общей persisted зависимости или CableBundle.

Bulk pairing требует ordered preview и atomic canonical batch validation,
независимую от SavedMap. Создаёт отдельные Cables/Connections; автоматически
маршруты не создаёт. Location series имеет один contiguous # pattern, range/step,
preview и проверку conflicts до all-or-nothing write; создаёт только Locations.

## Resolver, evidence и L1/L2/L3 boundaries

L1 решает physical continuity, L2 — forwarding в context/binding с encapsulation,
L3 — routing в routing context. NetworkInterface physical realization не означает
L2 forwarding; address ownership не означает reachability. Security PERMIT не
равен глобальному разрешению пути; NAT — преобразование packet, не route.
Packet processing plan определяет порядок stages; policy routing выбирает table,
route lookup не подменяет policy evaluation.

Configured/effective views и operational observations различаются. EvaluationView
фиксирует coherent data revision, time/source/completeness; external lookup не
дополняет truth молча. UNKNOWN отличается от UNREACHABLE/BLOCKED, confirmed absence
от отсутствия данных; MODEL_ERROR отделён от сетевого verdict. Partial table/FDB
и stale/conflicting evidence не превращаются в доказанный отрицательный ответ.

Trace/evidence derived: воспроизводимые query/view/version, точные canonical refs,
branches, gaps и verdict. Geometry overlap, aggregate edge или подсветка соседних
attached cables не расширяет evidence. L1 trace не берёт connectivity из routes,
Location frames, labels или шаблонного preview. Projection aggregation не скрывает
UNKNOWN и сохраняет dereference evidence. Cache — только optimization: scope,
view fingerprint и resolver/compiler version входят в ключ; invalidation после
commit, старый artifact не источник актуальной truth. Query memo не меняет semantics.

L2/L3 backend core существует; полный пользовательский продукт остаётся будущим.
L1 PRODUCT COMPLETE обязателен до продуктового L2; архитектурный контракт не
является утверждением о доступности UI.

## Runtime, данные и миграции

Docker-only runtime, pinned dependencies, migrations до startup; PostgreSQL.
Тестовая БД изолирована от runtime. UI по умолчанию RU, EN через typed i18n.
API-first core не зависит от React state, user/ACL semantics не протекают в network core.
Persisted NetworkWorkspace/auth/sharing ещё не реализованы.

Применённые Alembic revisions immutable: исправления только forward migration.
Сохраняются canonical user/network data, stable identity и retained immutable
snapshots; development-stage authoring/runtime compatibility не является целью.
Workspace export v7 не означает автоматическую поддержку любых старых пакетов;
исторические snapshots читаются только в пределах явно реализованного контракта.
Не добавлять old/new fallback, shadow models или translation shims ради obsolete
API. Reset данных — явная destructive операция, не побочный эффект чтения.

## Сетевые контракты core при дальнейшем развитии

L2ForwardingContext локален; одинаковый VLAN label не доказывает общий broadcast
domain. L2Binding соединяет interface и context; encapsulation stack имеет
локальный boundary смысл, не глобальную network identity. Ingress decode и egress
encode раздельны; отсутствие правила не означает identity transform. Untagged и
internal attachment различаются. Несколько допустимых ingress/FDB candidates
сохраняются как ambiguity/conflict, не выбираются по случайному порядку.
LAG/realization transport и forwarding eligibility различны; STP/LACP operational
state не записывается на Connection. MAC assignment не является FDB, FDB target —
binding. FDB set completeness, scope, freshness и confirmed absence обязательны
для отрицательного вывода. Known unicast, unknown-unicast flood и broadcast
сохраняют отдельные ветви; loop не доказывает достижимость.

L3 IP address/prefix существуют в routing context/address family; source IP не
выбирает глобально единственный context. L3Binding связывает interface и context.
Route table выбирается явно; longest-prefix lookup в partial table не доказывает
NO_ROUTE. LOCAL, DISCARD и FORWARD — разные dispositions; next hop resolution
учитывает gateway/interface, recursion, neighbor completeness, scope и циклы.
ECMP сохраняет candidates/branches, не обещает конкретный dataplane hash. L3
reachability и packet trace — разные queries, обратный путь не следует из прямого.

Security policies имеют attachments/stages и ordered first-match с three-valued
predicates. UNKNOWN более раннего правила не разрешает безусловно взять позднее.
Explicit default, coverage и отсутствующая policy не взаимозаменяемы. PacketState
immutable на шаге; NAT создаёт новую lineage, не переписывает исходную evidence.
Hypothetical pool allocation не является фактом существующей NAT binding.

PacketProcessingPlan — typed control-flow, не универсальный vendor pipeline.
Plan attachment/traffic class выбираются явно; transitions не должны скрывать
ambiguity. PACKET_MARK — local processing metadata, не сетевой заголовок;
ROUTING_POLICY выбирает table до ROUTE_DECISION. Изменивший routing basis NAT
требует явного reroute semantics, не скрытого повторного lookup. На межузловой
handoff local metadata не переносится как packet facts. Повреждённые plan/refs
дают MODEL_ERROR, а не сетевой BLOCKED. Эти границы применяются к core;
открытые persistence/UI extensions остаются будущими решениями.

## Принятые L1 инварианты — L1-CONTRACT-02

Продуктовый контракт L1-CONTRACT-02 от 11.11.2026. Это target, а не
подтверждение соответствия текущих API, materialization, reconcile или trace.
Доказательная инвентаризация выше сохраняет отдельные статусы реализации.

- **L1-O1:** L1 охватывает сетевые кабельные соединения меди и оптики.
  Для меди канал — независимо подключаемая сетевая линия, для оптики — волокно.
  Проводники RJ45 отдельно не моделируются. Количество каналов задаётся данными.
- **L1-O2:** единый механизм соответствий для внутренних связей и внешних кабелей:
  автоматическое прямое, обратное или заданное упорядочивание, обязательный preview,
  ручная корректировка, частичные mappings, проверка занятости и атомарное сохранение.
- **L1-O3:** member имеет не более одного внешнего и одного внутреннего соединения.
  Разные members одного ConnectionPoint независимы. Конфликт не удаляет старую
  связь автоматически. Исключения настоящих разветвителей вне базовой модели.
- **L1-O4:** PON splitter остаётся в предметной области, но требует отдельного этапа.
  Обычные ConnectionMember не имитируют деление. Оптический бюджет вне C-CAP-01.
- **L1-O5:** физический кабель имеет одну Cable identity, включая несколько окончаний
  с разным числом каналов. Многоконцевые сборки требуют расширения текущей
  двухточечной модели; фиктивные Cable недопустимы.
- **L1-O6:** BaseTemplate определяет физическую конструкцию и внутреннюю разводку.
  Физическая переделка требует нового BaseTemplate и нового PhysicalObject;
  индивидуальная переделка внутренней конструкции экземпляра не поддерживается.
  Исправления описаний, имён и геометрии представления этим не ограничиваются.
- **L1-O7:** изменение физической конструкции модуля требует нового ModuleTemplate.
  Internal continuity модулей — отдельная задача реализации, не готовая возможность.
- **L1-O8:** активное оборудование завершает L1 trace; автоматического transit между
  портами нет. Пассивное продолжение требует явных внутренних связей.
  L2 forwarding и active conversion не подменяют L1.
- **L1-O9:** изменение физической конструкции создаёт новую identity оборудования;
  внешняя перекоммутация сохраняет identity. Старые подключения автоматически
  не переносятся. Исправления ошибочных данных — отдельный случай; частичная
  потеря canonical dependencies недопустима.
- **L1-O10:** отдельный канал возвращает точный подтверждённый canonical evidence путь.
  Группа независимо оценивает members; полнота считается относительно явно заданных
  ожидаемых соответствий. Резервные каналы автоматически не ошибка.
  REACHABLE не означает измеренную исправность физической линии.

Нет фиксированной hardware taxonomy и специальных схем 1x24/1x48.
PortType не определяет connectivity; presentation state не canonical topology.
C-CAP-01 остаётся OPEN Phase D; L1 PRODUCT COMPLETE обязателен до L2/L3.


## C-CAP-01-01 — definitions и materialization

BaseTemplate endpoint definition хранит положительную `cardinality` (по умолчанию
1; NETWORK_PORT только 1, верхний технический предел PostgreSQL int: 2147483647).
Internal link хранит `member_mappings`: явные пары `from_member_index` /
`to_member_index` относительно `from_slot_key` / `to_slot_key`. Отсутствующие
mappings исторических 1:1 definitions означают пару 1→1. Порядок пар не задаёт
связность. Повторная внутренняя занятость member запрещена во всём definition.
Материализация создаёт canonical ConnectionPoint/Connection/ConnectionMember
без Cable, в savepoint; resolver использует сохранённые индексы.

Опубликованная физическая конструкция неизменна: endpoint keys/kind/cardinality,
внутренняя разводка и keys/kind/compatibility module places требуют копии
BaseTemplate. Сервер отклоняет structural publication независимо от наличия
экземпляров. Reconcile разрешённых описательных/presentation изменений сохраняет
canonical identities и connections; физическая миграция старых экземпляров
запрещена. Координаты, цвет, подписи не входят в физическую сигнатуру.

Существующий графический редактор блокирует edit/copy multichannel definitions
с объяснением; API сохраняет mappings и cardinality, archive сохраняет их
roundtrip. Генератора mappings нет. C-CAP-01 остаётся **OPEN Phase D**;
C-CAP-01-02/03/04 не реализованы этим этапом. Внешний multichannel write,
occupancy lifecycle, ModuleTemplate continuity и splitter вне scope.


C-CAP-01-01 corrective: `draft/check` сравнивает physical structure с опубликованной
ревизией до создания candidate. Физические изменения возвращают
`PHYSICAL_STRUCTURE_IMMUTABLE` с предложением создать копию; независимая защита
в publish сохраняется для ранее выданных candidates и прямых API-вызовов.

Историческая внутренняя разводка с повторной занятостью одного member несовместима
с O3. Чтение/review/materialization возвращают доменную ошибку
`INTERNAL_MEMBER_OCCUPANCY`; reconcile сообщает эту причину без изменения объекта.
Импорт такого архива явно отклоняется до восстановления данных, в том числе при
отсутствующих полях cardinality/mappings старого 1:1 формата. Links не удаляются,
continuity не синтезируется, автоматической коррекции и splitter support нет.
Корректные исторические 1:1 definitions остаются поддержаны. C-CAP-01 — OPEN Phase D.

## L1-REFERENCE-01 — DECIDED TARGET

[Reference Network & Portability Contracts](L1_REFERENCE_NETWORK.md) закрепляет
независимые карты, переносимые определения, CableType и безопасную demo initialization.
Это TARGET, не IMPLEMENTED: текущий SavedMap остаётся presentation scope общей
topology implicit workspace. Общие библиотеки не означают общую topology карт.
MapPresentationVariant остаётся компоновкой одной сети. NetworkWorkspace отвечает
за application isolation/права, не отменяя map ownership. Schema/FK/API не выбраны.

### AUTO-LOC-01 — automatic Location composition

**CURRENT.** Следующий DOC-LOC-03 описывает частично реализованный TARGET.

L1 Physical variants explicitly opt into `automatic_layout` (nullable JSONB on
MapPresentationVariant). Null retains the existing manual contract and data.
Settings contain `hide_empty` and per-container direction plus an ordered mixed
sequence of `Location:<id>` / `PhysicalObject:<id>`. `root` is a technical
presentation container, never a canonical Location. Missing entries default to
VERTICAL; unspecified/new children follow immutable-ID order. Copying a variant
copies settings, collapse and routes independently.

The frontend measures full rendered equipment footprints including nameplates,
then composes frames bottom-up and places contents top-down with header/padding.
Manual x/y/frame sizes are not automatic position inputs. Empty subtree detection
uses current SavedMap placements; hiding removes its entire space. Full collapse
uses a compact rectangle; partial-collapse visibility semantics remain unchanged.
Boundary identity stays map/Location UUIDv5; edge/offset anchors resolve against
current displayed frames. Routes remain variant-owned. Drag/resize/free movement
are disabled in automatic mode; server rejects explicit geometry/position writes.
Canonical assignment and connectivity remain independent of presentation.

### AUTO-LOC-02 — compact automatic geometry

**CURRENT.**

Automatic composition measures visible direct children bottom-up. VERTICAL
aligns Location widths to the group's maximum required width; HORIZONTAL aligns
Location heights to its maximum required height. Direct equipment participates
in that maximum with its complete rendered footprint (including nameplate),
but retains its own dimensions. Main-axis dimensions remain content-sized.
Each nested group is measured independently, including full/partial collapse;
hidden empty subtrees reserve no space. Empty frames have a 100-unit minimum
width (increased for their label) and a 32-unit minimum height.

Automatic-only spacing uses 12 flow units for side/bottom clearance and vertical
sequence gaps, 24 only between nested border headings, and 20 between
horizontal siblings, retaining the existing container interval. Equipment starts
12 units below the border; no separate header row is reserved. The technical
root has no heading. Geometry does not depend on viewport zoom. Frames alone
stretch; contents are not scaled or distributed into spare space. Boundary
identity, edge/offset and stored route/free waypoint data remain inputs;
anchors resolve against the resulting frames. No settings, server contract,
migrations or manual geometry change.


Automatic Location boundary editing uses the variant-owned MapLocationState:
`PUT .../locations/{location_id}/boundary-placement` accepts only edge/offset,
validates finite offset in [0,1], and returns authoritative SavedMap state.
It locks hierarchy, then variant, then state; only the boundary placement is
updated. An absent geometry is materialized from its existing effective bounds;
manual_bounds, equipment positions and cable routes are never written.
Automatic frames remain derived; the geometry endpoint still rejects automatic
frame edits. Point preview has Save/Cancel and error rollback. Boundary identity
and independent cable route anchors are preserved. Manual editing is unchanged.


## DOC-LOC-03 — TARGET структурной компоновки Location

**PARTIAL.** AUTO-LOC-01/02 и SLOC-01–04 в main: uniform-grid, стрелочная
расстановка и сортировка дочерних Location. Порядок и ориентация непосредственных
PhysicalObject и grid-specific partial-collapse UX остаются OPEN.
[Открытые вопросы](OPEN_DECISIONS.md#doc-loc-03--structural-location-composition).

Location допускают строки, столбцы и комбинированную плиточную структуру внутри
одного родителя: здание с этажами, этаж с кабинетами плиткой, серверная с группами
стоек и несколькими рядами. Location остаётся универсальным: фиксированной
taxonomy «стойка», «этаж», «кабинет», «U» не вводится.

Пользователь включает режим «Расстановка», выбирает Location и перемещает его
стрелками вверх/вниз/влево/вправо по адресам соседних ячеек таблицы.
Соседство локально соответствующей строке или столбцу: размещение справа от
элемента не растягивает его на высоту всей группы. Ручной ввод абсолютных X/Y
и обязательный выбор HORIZONTAL/VERTICAL технического root не требуются.
Root допустим как presentation-контейнер, но не canonical Location.

Непосредственные PhysicalObject одного Location образуют простую горизонтальную
либо вертикальную последовательность с изменяемым порядком; смешанное двумерное
дерево для них не требуется. Например, стойка содержит вертикальную
последовательность Location U, а один U — три устройства горизонтально.

Размеры прямоугольников определяет дочернее содержимое: строка согласует высоту,
столбец — ширину; более крупный элемент расширяет соответствующую группу.
Выравнивание локально группе, не глобально карте. Дополнительное пространство
не масштабирует физическую панель BaseTemplate; в трёхзонном PhysicalObject
ширина может отдаваться правой кабельной зоне согласно [OBJECT-UX-01](OBJECT-UX-01.md).

Структура размещения и визуальные группы принадлежат MapPresentationVariant.
Группы стоек/кабинетов не создают автоматически canonical Location. Canonical
hierarchy, PhysicalObject assignment и connectivity не выводятся из геометрии.
Перемещение внутри одного Location меняет только presentation; перенос
PhysicalObject в другой canonical Location — отдельная явная операция.
Скрытие пустых Location и collapse/expand сохраняют существующую смысловую
разницу; перекомпоновка видимых элементов не уничтожает сохранённую структуру.

### TARGET кабельной геометрии

Отдельный согласованный TARGET, не реализация: объектная точка выхода на правой
границе, автоматическая расчёска над/под корпусом, общий визуальный жгут и
относительная к объекту геометрия подводов. Дополнительных верхних/нижних полос
внутри PhysicalObject нет; подводы могут выходить за корпус в свободное
пространство Location. Физические Cable остаются независимыми, общий жгут
не объединяет identity или trace evidence. Это presentation, не новые endpoints.
[Channel и составная маршрутизация C-UX-10](OPEN_DECISIONS.md#c-ux-10--automatic-location-cable-channels)
остаются отдельной OPEN capability; расчёска также не IMPLEMENTED.

### SLOC-01 — isolated uniform Location table core

`frontend/src/topology/locationGridLayout.ts` implements a pure, typed measurement
core used by the SLOC-02 runtime adapter.
Its ephemeral input supplies canonical direct children as a sparse row/column
table, canonical direct object footprints, minimum frame sizes and collapse.
This is not a persistent schema. All populated visible cells share the maximum
required width AND height across their entire table. Population includes objects
in any canonical descendant, even collapsed ones; empty descendants alone do not
count. Empty frames do not contribute to uniform maxima. Track extents include
compact empty frames to prevent overlaps. Wholly invisible tracks are omitted;
holes in active tracks retain their slot. Collapse uses minimum measured size
before parent-table equalization. Nested tables retain independent inner sizes.
Equipment footprints are retained without scaling; only Location frames expand.
Coordinates are parent-local flow units, with no zoom or prior positions.
AUTO-LOC-01/02 remain unchanged. DOC-LOC-03 partially implemented by SLOC-01–04; remaining capabilities and manual acceptance stay OPEN.

### SLOC-02 — uniform grid runtime integration

**IMPLEMENTED / MERGED.** L1 variants explicitly
select manual, legacy sequence or uniform grid in the existing controls.
The JSONB contract is `{mode: "uniform_grid", version: 1, hide_empty, tables}`;
`tables` maps canonical parent UUIDs (or technical `root`) to arrays of rows of
Location UUID/null cells. Legacy direction/order JSON and null manual settings
retain their contract. Switching to grid initializes an ID-sorted single column,
without interpreting legacy direction/order. No migration is required.

Runtime reconciliation retains surviving direct-child addresses, clears stale
references, then inserts new direct children in immutable-ID order into the first
free cell or appends a row. Reconciliation never mutates stored settings; the next
settings save materializes the reconciled structure. Canonical create/series,
reparent and empty-Location delete also reconcile every stored grid variant in
the canonical transaction, under hierarchy then UUID-ordered variant locks.
Surviving cells retain addresses; stale cells become null, deleted-parent tables
are removed, and missing children fill the first free cell or append a row.
Manual and legacy settings are untouched; user saves remain strictly validated. New equipment uses an
ID-sorted vertical sequence within its canonical Location. Complete rendered
footprints feed SLOC-01; panels and objects retain dimensions. Populated siblings
share both maxima; nested tables measure independently.

Hide-empty/full collapse preserve stored cells. Partial collapse filters existing
visible_direct_elements without changing legacy semantics; a grid-specific
selection editor remains OPEN. Boundary anchors reuse existing frame-relative
edge/offset resolution. Grid changes never write placements, boundary identity,
cable routes or free waypoints. Variant copies deep-copy JSON. Server save and
workspace validation reject duplicate/foreign children, invalid cells and cycles
before writes. SLOC-03 interactive insertion is described below.

### SLOC-03 — uniform-grid arrangement mode

**IMPLEMENTED / MERGED; manual acceptance отдельно.**
L1 uniform grid has an explicit «Расстановка» / Arrange mode in the existing
«Компоновка» panel, off by default; Done and Cancel sit beside it. MapPage owns
one arrangement draft shared by that panel and TopologyCanvas.
Select a Location heading (including a collapsed label) to show four compact
arrows for that Location only. The toolbar measures the rendered heading and
actions, sits on the selected frame top edge to their right, and uses a compact
outside-corner placement when space is insufficient. It follows geometry and
zoom in the foreground layer, with rectangular styling. Collapse/configure and boundary editing remain
separate. Manual and legacy sequence behavior is unchanged. Structural pointer
drag, ghost and coordinate hit testing have been removed.

`moveGridLocation` uses the canonical parent's table address, never screen
proximity. An arrow swaps with an occupied neighbor or moves into a free cell.
At an outer edge it adds a row/column only if the normalized result differs;
otherwise that arrow is disabled. Selection survives successive operations.
`normalizeLocationTable` removes all wholly empty rows and columns, retaining
nonempty track order and interior holes. This includes older empty tracks.
Entering arrangement reconciles and normalizes a client working copy of the
variant's tables; ordinary reads and variant switches do not normalize storage.
Hidden/collapsed Location identities and cells survive, hide_empty is unchanged.
Nested tables and equipment retain contents and independent layout sizing.

Every arrow updates only the working copy, rendered via uniformGridPresentation
and SLOC-01, with no separate geometry, fitView or per-arrow API writes.
«Готово» / Done saves the complete working settings through the existing active
variant automatic-layout API once, blocks repeat requests until confirmation,
and exits. Even entry-only cleanup is persisted only by Done. Cancel discards
all changes. Variant, layout/settings or scene changes discard the draft without
saving; drafts cannot cross variants. API failure restores authoritative settings
and displays an error. Server confirmation supplies the authoritative display.
Boundary identity/edge/offset, canonical hierarchy/assignments, Cable and routes
are untouched. Manual acceptance remains OPEN;
PhysicalObject movement, routing and cable combing remain separate capabilities.

### SLOC-04 — child Location sorting

**IMPLEMENTED / MERGED.** Uniform-grid Location
settings expose a Layout section alongside the unchanged collapse controls.
The Layout panel exposes the technical root table. R1/C1 headers select indexed
rows/columns; Entire table selects row-major or column-major traversal.
Empty cells are explicit. Natural numeric name comparison uses the fixed Russian
collation locale and immutable UUID ties; both ascending and descending are supported.
Names remain arbitrary strings. No row/cell identities or taxonomy are introduced.

A row/column sort changes only its region and sends nulls to its end. Whole-table
sorting permutes occupied addresses only, retaining shape and the empty mask.
All canonical children participate, including hidden/collapsed children; nested
tables, assignments and geometry contracts remain unchanged. Sorting never runs
on rename. The first sort atomically creates and updates the shared MapPage draft
without entry normalization; subsequent sorts include arrow edits. Settings-dialog
closure leaves this draft open. Only common Done writes once; Cancel and save
failure restore authoritative settings. No backend/API/schema changes.

Validation: targeted computational, hook, controls and canvas tests plus Chromium
smoke on the real tiled canvas fixture. The fixture uses in-memory persistence;
server round-trip/reload for SLOC-04 is not verified by that smoke. Manual acceptance remains OPEN.

SLOC-04 corrective UI: Location settings use separate Collapse/Layout tabs under
“Settings: <Location name>”. Switching tabs retains mounted controls and the shared
draft. Compact sort actions stay above a bounded table viewport with independent
vertical/horizontal scrolling and sticky R/C headers. The dialog is constrained to
the viewport. Layout explains that closing only reveals the preview; map-panel
Done/Cancel remains the sole sorting persistence boundary. Collapse save retains
its existing direct-reference behavior. Chromium checks cover 42 direct children,
single/multiple columns at 1024×768 and 1600×900, including measured scroll offsets,
visible actions, tab switching, close/preview, Cancel without writes and Done once.
