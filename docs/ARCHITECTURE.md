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

## SavedMap, варианты и spatial isolation

SavedMap — presentation scope в implicit workspace. Placement задаёт membership
PhysicalObject в карте. MapPresentationVariant принадлежит одной карте и хранит
именованную компоновку: позиции по view, locks, cable routes, Location state.
Membership общий для вариантов; topology и canonical Location assignment не
меняются переключением варианта. Physical и Logical scene coordinates независимы.
MapTextAnnotation — отдельная presentation capability.

Hierarchy берётся из canonical Locations, frames derived из текущей scene,
не persisted polygons. Expanded branching frame — union видимых непосредственных
objects/retained child frames с padding; unary chain даёт compact path label.
Пустому Location не придумываются bounds. Collapse рекурсивен: скрытое содержимое
и сохранённая геометрия не удаляются; proxy и boundary connectivity сохраняют
exact canonical refs. Выбор видимых непосредственных элементов — presentation,
не смена canonical membership. MapComposite/MapRegion не поддерживаются.

Group move переносит одинаковым delta все имеющиеся L1 позиции canonical
subtree в активном variant, включая скрытые. Сервер заново разрешает subtree,
сверяет geometry evidence, locks и collision со внешними placements. Locked
member или collision отклоняет всё; отсутствующие позиции не создаются.
Positions и затронутые routes сохраняются атомарно, без automatic re-layout.

## Routes и boundary anchors

MapCableRoute — presentation конкретного Cable в карте/variant. Internal route
(оба конца внутри subtree) переносит свободные waypoints; external не меняется;
boundary route переносит внутренний prefix до выхода, сохраняя внешний suffix.
Anchor следует derived frame. Без сохранённой route линия строится от endpoints.

Waypoint — {x,y} либо {x,y,anchor:{location_id,edge,offset}}; edge top/right/bottom/left,
offset 0..1. x/y у anchor — snapshot/fallback, renderable frame определяет binding.
Frame bounds не сохраняются. Anchor drag ограничен периметром; явный anchor
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
