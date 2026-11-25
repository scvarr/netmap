# Действующие архитектурные контракты

**CURRENT** описывает доступную реализацию и её границы. **DECIDED TARGET**
фиксирует принятые требования. **OPEN** отмечает нерешённую семантику, реализацию
или проверку в указанном объёме.

Физический контракт и L1-O1–L1-O10 ведутся в [L1_CONNECTIVITY](L1_CONNECTIVITY.md),
взаимодействие и IA — в [UX_IA_CONTRACT](UX_IA_CONTRACT.md), итоговый стенд и
переносимость — в [L1_REFERENCE_NETWORK](L1_REFERENCE_NETWORK.md).
[PROJECT_STATE](PROJECT_STATE.md) фиксирует состояние, [BACKLOG](BACKLOG.md) —
очередь и gates, [OPEN_DECISIONS](OPEN_DECISIONS.md) — вопросы к следующим этапам.

## Источники истины и identity

Canonical topology — runtime source of truth. Canonical facts, presentation
state и derived read context разделены. Projection, scene geometry, layout,
cache и trace artifact не становятся canonical input. Blueprint и Port Block
служат authoring, provenance и presentation.

Identity задают стабильные canonical IDs и opaque definition keys независимо
от имени, номера, порядка, координат и layout. Перемещение и переименование
сохраняют endpoints. Опубликованные ревизии и сохранённые immutable snapshots
не редактируются. Runtime topology после materialization authoritative,
provenance закрепляет происхождение и не пересчитывает topology при чтении.
Строгие DTO и finite coordinates не допускают тихой подмены повреждённых данных.

Location задаёт каноническое физическое место с необязательным parent.
Циклы запрещены. PhysicalObject имеет не более одного непосредственного
Location, null допустим. Location hierarchy и вложенность оборудования
независимы. Назначение меняется явной операцией, координаты его не определяют.

## Шаблоны, ревизии и установки

Persisted server draft → frozen candidate с impact analysis → publication.
Возврат к редактированию инвалидирует analysis. Publish сохраняет pinned
конфигурации экземпляров. Reconcile повторно проверяет фактические зависимости
под locks, сохраняет IDs неизменённых definitions, user data, connections и
bindings. Удаление допустимо для endpoints без зависимостей, включая зависимости
помимо внешних Cable. Если требуется intervention или не хватает совместимой
вместимости, прежняя конфигурация сохраняется целиком.

При допустимом переносе модуля сначала сохраняются совместимые позиции, затем
opaque keys задают детерминированный выбор остальных мест. Installation и
endpoints сохраняют identity. Координаты PLACED задают место установки,
логические module places задают вместимость. Pinned historical composition
сохраняется независимо от mutable preview.

MOD-01 хранит модульный порт BaseTemplate как существующий PLACED ModuleBay.
В ModuleTemplate модульные порты хранятся отдельной коллекцией определений
в draft, candidate и immutable revision. Ромб наследует правила координат
и масштабирования остальных маркеров. Ключи не зависят от названия и координат.
Эти определения не участвуют в materialization endpoints.

Исторические прямоугольники отображаются ромбом в центре сохранённой области.
Неизменённая область сохраняется в workspace v17 и используется для расчёта
initial layout. Явное перемещение ромба сохраняет в новом черновике точку
вместо области. Для места с X/Y начальный layout вписывает корпус в область
30% панели по каждой оси и ограничивает его границами панели. Уже сохранённые
layout и ревизии остаются привязаны к своим экземплярам.

MOD-02A хранит для каждой ModuleInstallation UUID и закреплённую ревизию.
Корень занимает место BaseTemplate в ObjectConfiguration, потомок занимает
локальное место закреплённой ревизии родителя в той же конфигурации. Идентификатор
потомка и canonical endpoints сохраняются при чтении и переносе workspace.
В API корни остаются в `bays`, а `nested_installations` хранит потомков с
`parent_installation_id`. Каждое `module_places` ссылается на занятую установку
по UUID. Такой формат передаёт дерево без роста глубины JSON. Локальная
компоновка сохраняется, а `global_layout`, положение места и координаты
окончаний вычисляются в координатах панели из цепочки поворотов и размещений.

## Транзакции и согласование записей

Успешная mutation и refresh имеют разные состояния. После ошибки refresh
клиент повторяет только read. Canonical aggregate locks и повторная проверка
ожидаемого состояния защищают от races. Preview фиксирует ожидаемое состояние для проверки при подтверждении.
Конфликт batch отклоняет его целиком. Location series создаёт только Locations,
в одной транзакции после проверки диапазона, шага и единой серии символов `#`
в шаблоне.

Записи physical position/add, geometry и group move блокируют hierarchy
`FOR SHARE` в порядке Location ID, затем свой variant `FOR UPDATE`, затем
presentation rows. Shared hierarchy lock позволяет независимые variant writes.
Canonical assignment блокирует hierarchy `FOR UPDATE`, затем PhysicalObject,
затронутые variants в UUID order и зависимые presentation rows. Locks берутся
до position DML/flush. Canonical create/series/reparent/delete согласуют
затронутые сохранённые структуры в той же транзакции.

Назначение PortType блокирует строку типа `FOR SHARE` до commit.
Проверка линии блокирует используемые PortType. Изменение
отметки матрицы блокирует оба PortType в порядке UUID. Структурная правка,
архивация и удаление блокируют строку `FOR UPDATE`. Проверка ссылок на
PortType читает черновики, кандидатов и все ревизии одним SQL-запросом
после получения lock. Смена стадии публикации сохраняет ссылку атомарно.

Reconnect блокирует Cable, её Connection, уникальные исходные и новое
ConnectionPoint в порядке UUID, затем ConnectionMember, с `NOWAIT`.
Под блокировками проверяются ожидаемые адреса, внешняя занятость member и
совместимость. Одна транзакция меняет point ID и member index выбранной
стороны. Внутренняя continuity сохраняется и не расходует внешнюю ёмкость.

При замене физического трансивера MOD-03C-2 блокировка таблицы ревизий
сериализует операцию с публикацией. Блокировка целевого шаблона предшествует
блокировкам объекта, конфигурации и исходной установки, как при reconcile.
Проверка демонтажа использует порядок MOD-03C-1 с блокировками mappings,
аппаратной ассоциации, NetworkInterface, ConnectionPoint и физических привязок.
Проверка внешней коммутации выполняется под блокировкой окончания, общей
с созданием и reconnect Cable. Демонтаж и создание новых физических
сущностей с привязкой к прежнему интерфейсу входят в одну транзакцию.

## SavedMap, варианты и spatial isolation

**CURRENT.** SavedMap — presentation scope над общей canonical topology
implicit workspace. Placement задаёт membership объекта в карте, все canonical
Locations доступны каждой SavedMap. MapPresentationVariant принадлежит одной
карте и хранит именованную компоновку, позиции по view, locks и Location state.
Варианты разделяют membership, topology и Location assignment. Physical и
Logical scene coordinates независимы. Copy variant копирует настройки и
presentation state независимо. MapTextAnnotation — отдельная presentation
capability. Persisted NetworkWorkspace и полная изоляция сетей не реализованы.

**DECIDED TARGET.** Карта владеет самостоятельной физической сетью, включая
объекты, Location, интерфейсы, окончания, соединения, members и Cable.
Cross-map canonical references запрещены. Одинаковые имена допустимы.
Общие библиотеки BaseTemplate, ModuleTemplate и типов не объединяют сети. MapPresentationVariant
остаётся компоновкой одной сети. NetworkWorkspace отвечает за application
isolation, доступ и организацию работы. Fixture проверяет эти границы.
[L1-REFERENCE-01](L1_REFERENCE_NETWORK.md#независимые-карты).

**OPEN.** До соответствующих write changes согласуются ownership boundaries и
сохранение существующих canonical identities. Schema/FK, API и стратегия
перехода открыты. Полноценные auth, ACL, sharing и activity входят в продуктовый
gate, их готовность не является общей предпосылкой для всех L1 engineering
milestones. Копирование фрагментов сетей с remapping identities — отдельный scope.

### Ручная компоновка и согласование с topology

В manual mode у каждого Location свой frame, включая пустой и unary. Frame
непосредственного ребёнка находится внутри canonical parent. До первого
сохранения чтение выдаёт детерминированные непересекающиеся рамки по immutable
ID без записи. Ручная начальная раскладка оставляет 20 flow units отступа и 40
под заголовок. Пустой frame имеет высоту 64, ширина 140–360 учитывает подпись. Manual bounds — сохраняемая нижняя граница размера, переносимая
вместе с ветвью. Расчётные bounds расширяются для children и equipment,
включая рост влево и вверх, и могут сокращаться с сохранением manual bounds.
Parent resize не обрезает содержимое.

Перенос frame перемещает существующие позиции всей canonical subtree одним
delta, включая скрытые элементы. Сервер повторно разрешает subtree и сверяет
geometry evidence. Canonical create/series/reparent выделяют место и при
необходимости сдвигают соседние ветви вместе с оборудованием. Assignment
согласует все существующие physical positions объекта во всех картах и
вариантах. Добавление размещения или позиции учитывает текущее назначение.
Отсутствующие позиции не создаются назначением или групповым переносом.
Locked placement или недопустимая коллизия отклоняют транзакцию целиком.
Выход за прежние bounds согласует frames и соседей, сохраняя назначение.

Geometry write валидирует конечные координаты, положительные размеры, perimeter,
Location и владение variant. Подтверждённый SavedMapDocument содержит связанные
frames и positions. Клиент применяет результат только к исходным map/variant.
Черновик, Save, Cancel и rollback описаны в [UX](UX_IA_CONTRACT.md).

## DOC-LOC-03 — TARGET структурной компоновки Location

**CURRENT.** L1 Physical variant выбирает manual, automatic sequence или
uniform grid. Automatic layout выводит размеры снизу вверх и размещает
содержимое сверху вниз из измеренных footprints. Ручные X/Y и bounds
не служат входом, сервер отклоняет ручные frame/position writes в automatic
mode. Технический root — presentation container.

- Automatic sequence использует направление и упорядоченный список
  непосредственных Location и PhysicalObject. По умолчанию вертикаль и порядок
  по immutable ID. Поперечное выравнивание локально группе, панели сохраняют
  размеры. Вложенные группы измеряются независимо. Пустая рамка имеет минимум
  100×32 с поправкой на подпись. Основной отступ и вертикальный интервал — 12,
  между вложенными заголовками — 24, между горизонтальными соседями — 20.
- Uniform grid хранит в variant `automatic_layout` с `mode: uniform_grid`,
  `version: 1`, `hide_empty` и `tables`. Таблица каждого canonical parent или
  root содержит прямых детей по адресам строк/столбцов в ячейках UUID/null.
  Новая сетка начинается с одного столбца в порядке UUID. Видимые занятые
  ячейки делят максимальные ширину и высоту своей таблицы. Наполненность
  учитывает оборудование в потомках, включая свёрнутых. Пустые рамки
  участвуют в размере дорожек, сохраняя компактность. Невидимые дорожки
  опускаются при отрисовке, дыры активных дорожек сохраняют место.
- Direct PhysicalObject образуют отдельную упорядоченную горизонтальную или
  вертикальную последовательность в Location или root, сохранённую в
  `object_sequences` как `direction` и упорядоченный список UUID. По умолчанию
  вертикаль по UUID. Child Location table измеряется независимо и начинается ниже.
  Membership берётся из placements, контейнер — из canonical assignment.
  Ориентация пустого контейнера сохраняется до его удаления.
- Read-time reconciliation сохраняет адреса и порядок surviving элементов,
  очищает отсутствующие ссылки и добавляет новых в порядке UUID. В таблице
  используется первая свободная ячейка либо новая строка. В object sequence
  используется конец списка. Чтение не меняет storage. Затронутые grid variants
  согласуются при canonical hierarchy changes, placement add/remove и canonical
  reassignment/deletion в транзакции записи. Save и import проверяют duplicates,
  foreign children/objects, containers, ячейки и циклы. Copy и workspace
  export/import сохраняют настройки.

**CURRENT.** Hide-empty убирает место пустых subtree по placements карты.
Collapse использует производные размеры, сохранённые таблицы и expanded geometry
сохраняются. Partial collapse оставляет выбранные direct elements, доступные
даже без оборудования. Скрытое окончание использует route target без второго
подписанного proxy. Expand восстанавливает представление из исходной структуры.

**DECIDED TARGET.** Полный collapse показывает один компактный proxy с той же
boundary identity и скрывает все дочерние frames, proxies и оборудование.
Внешний полный collapse имеет приоритет, внешний Cable route заканчивается на
видимой точке свёрнутого Location.

**OPEN / RECHECK.** В ручной карте сценарий полного collapse прошёл, в uniform
grid с пустым набором видимых элементов часть оборудования осталась видимой.
Исправление не подтверждено. Grid-specific UI выбора при partial collapse
остаётся OPEN. [L1A-01](audits/L1_READINESS_AUDIT.md#l1a-01--полный-collapse-в-uniform-grid-оставляет-дочернее-оборудование) ·
[GitHub issue #2](https://github.com/scvarr/netmap/issues/2).

## Виды и компоновка карты L1

### Трёхзонная геометрия PhysicalObject

**CURRENT.** Для объекта с опубликованной композицией рамка горизонтальная.
Левая зона identity занимает 72 flow units, средняя — композиция, правая —
кабельный резерв минимум 20. Подпись в левой зоне ограничена по ширине,
полное имя доступно при наведении. `display_width` задаёт ширину композиции.
Полный footprint включает обе боковые зоны, высота определяется пропорциями видимой
композиции с учётом минимальной высоты корпуса 24. Панели и внешний контур
отрисовываются без смещения портов.

В manual layout используется минимальный кабельный резерв, resize меняет
composition width на запрошенную дельту. В automatic sequence после
выравнивания Location остаток внутренней ширины может получить объект с
композицией, если он единственный видимый элемент Location. Вся добавленная ширина идёт в правый резерв.
Несколько объектов и сами панели не растягиваются. Это derived allocation
активного варианта, без записи `display_width` или Cable geometry.

Эффективный минимум ширины композиции учитывает 32 flow units, высоту каждой
видимой панели не менее 12 и расстояние между центрами портов не менее 10
хотя бы по одной оси. Footprint, packing, collision, явный resize и серверные
size writes применяют общую политику плотности. Совпадающие центры либо
требуемый минимум выше 960 дают явную ошибку. Read-time floor не меняет
сохранённый SavedMap. Физический marker занимает 6 flow units со stroke 0,5,
hit square — 8, внешний highlight не выступает более чем на 1 flow unit.
NETWORK_PORT квадратный, отдельный CONNECTION_POINT круглый. Для физического
трансивера сохраняются kind CONNECTION_POINT и UUID его реального окончания.
Признак `marker: TRANSCEIVER` задаёт квадрат с тонким серым контуром. Цвет
PortType, индикация Cable и trace используют то же окончание.

L1-проекция пакетно читает текущие ObjectConfiguration, установки, закреплённые
ревизии и физические bindings. `module_bodies` содержит корпуса установленных
плат в геометрии их панелей. Окончания платы и гнёзда используют общую с карточкой
«Физика» композицию layout и orientation. `module_sockets` содержит ромбы
гнёзд без физического окончания и не содержит якорей Cable. Когда у трансивера
появляется физическое окончание, соответствующий ромб заменяется квадратом.
После извлечения трансивера проекция снова показывает пустое гнездо с заданной
геометрией. UUID родительского интерфейса сохраняется в конфигурации оборудования.
Размер панели учитывает центры всех этих маркеров. Сторона платы и её элементов
наследуется от панели. Геометрия выводится из конфигурации при обновлении
проекции и не хранится в SavedMap.
Панели, внутренние связи, HTML-порт, foreground маркер и cable endpoint используют одну систему
координат с общим composition width и offset, в том числе при смене стороны.
Zoom не участвует в геометрии, identity или сохранении размеров.

### FACE-VIEW-01 — физические виды карты L1

**CURRENT.** Опубликованная панель может иметь сторону FRONT или REAR. Панель
без стороны видна в обоих видах, единственная панель видна всегда. Сторона
разрешается по override объекта, ближайшему canonical Location override и
`default_face` варианта (по умолчанию FRONT). Null означает наследование.
Измерение и нормализация относятся к видимым панелям и портам. Низкая
композиция центрируется внутри минимальной высоты корпуса, отсутствие видимых
панелей даёт компактный корпус. Смена стороны меняет derived dimensions:
grid пересчитывает ячейки, manual позиции сохраняются, Location frame может
расшириться в представлении.

Скрытый порт использует правый терминал объекта. При совпадении двух скрытых окончаний отметка на границе
остаётся доступной для выбора Cable. Временный показ точных
окончаний Cable или выбранной ветви trace меняет вид и derived footprint
без записи настроек или collapse. Trace имеет приоритет. Если нужны обе
стороны, полная композиция показывает каждый порт и панель один раз.
Снятие выбора, завершение trace, смена карты, варианта или слоя возвращают
обычное наследование.

## C-UX-10 — виртуальная инфраструктура

**CURRENT.** Каждый Location, включая пустой, имеет одну derived boundary point
с UUIDv5 от SavedMap ID и Location ID. Это presentation терминал, без
отдельного create/delete. Identity не зависит от variant или geometry.
Variant хранит edge/offset относительно отображаемого frame. Boundary write блокирует hierarchy, variant,
затем state и возвращает authoritative SavedMapDocument. Automatic mode
разрешает запись только boundary placement с finite offset в [0,1], сохраняя
manual bounds и позиции. Удаление Location или variant удаляет его state.

COMB-01 выводит локальные подводы от портов к верхней/нижней магистрали и правому
выходу объекта. Grid учитывает место под магистрали при измерении.
Для объекта без композиции подводы идут вдоль правого края. LOC-CHAN-01
вычисляет ортогональные деревья по отображаемой геометрии Location, включая
черновик. Входы — выходы прямого оборудования и точки видимых детей, корень —
boundary point Location или вход технического root. Маршрут учитывает препятствия
и коридоры, недоступный терминал или путь диагностируется с Cable ID и участком.

LOC-ROUTE-01 составляет путь реального Cable по canonical окончаниям: от объекта
через последовательные Location к ближайшему общему предку и обратно вниз.
Для одного Location используется его дерево, без общего Location — технический
root. Один снимок геометрии задаёт ordered segment refs для Cable и wiring
preview. Совпадающий участок рисуется один раз и хранит derived набор Cable IDs.
Persisted Channel и записи индивидуальной route geometry отсутствуют.
Перемещение, visibility и variant меняют геометрию, сохраняя Cable и endpoints.
Совместный участок и пересечение линий не дают continuity или evidence.

**OPEN.** Межобъектные жгуты требуют отдельного решения.
[Открытые вопросы карты](OPEN_DECISIONS.md#d-ux-и-карта).

## Кабельные операции и панели CURRENT

Физический lifecycle определён в [L1_CONNECTIVITY](L1_CONNECTIVITY.md#принципиальные-границы),
работа с панелями и Cable — в [UX_IA_CONTRACT](UX_IA_CONTRACT.md#физическая-карта-и-кабельные-операции).
Массовая внешняя коммутация создаёт отдельные Cable и Connection
cardinality=1 для точных адресов каналов. Порядок панелей, окончаний и каналов
в диалоге служит только для подготовки пар. После записи карта перечитывает
canonical projection в текущем контексте представления.
Границы приёмки зафиксированы в [PROJECT_STATE](PROJECT_STATE.md#пользовательская-приёмка-и-перепроверки).

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
[L1 PRODUCT COMPLETE](L1_CONNECTIVITY.md#назначение-canonical-truth-и-готовность)
обязателен до продуктового L2. Продуктовый L3 следует после продуктового L2.

## Runtime, данные и миграции

Docker-only runtime, pinned dependencies, migrations до startup; PostgreSQL.
Тестовая БД изолирована от runtime. UI по умолчанию RU, EN через typed i18n.
API-first core независим от React state. User/ACL semantics принадлежат application layer.

Применённые Alembic revisions immutable: исправления только forward migration.
Сохраняются canonical user/network data, stable identity и retained immutable
snapshots; development-stage authoring/runtime compatibility не является целью.
Workspace JSON v17 включает типы физических окончаний, симметричную
матрицу PortType, линии и характеристики закреплённых ревизий трансиверов.
Формат сохраняет ассоциации аппаратных NetworkInterface с местами, UUID
физических линий и точные `ConnectionMember` mappings. Импорт до записи
отклоняет индексы за пределами cardinality и повторную внешнюю занятость пары
`ConnectionPoint.id` и member index. Внутренняя continuity может использовать тот же канал. Исторические данные автоматически не исправляются.
Импорт принимает пакеты v17. Справочники ModulePortType и ModuleBayType, вид посадочного
места и UUID-ссылки сохраняются в ревизиях, черновиках, кандидатах и результатах review.
Исторические snapshots внутри пакета сохраняют
исходные определения.
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

Действующая редакция всех L1-O1–L1-O10 находится в
[L1-CONTRACT-03](L1_CONNECTIVITY.md#принятые-решения-l1-o1l1-o10--decided).

## C-CAP-01-01 — definitions и materialization

Действующая семантика BaseTemplate находится в
[L1_CONNECTIVITY](L1_CONNECTIVITY.md#c-cap-01-01--definitions-и-materialization).
