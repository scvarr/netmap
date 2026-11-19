# Открытые продуктовые и архитектурные решения

[Состояние](PROJECT_STATE.md) · [Контракты](ARCHITECTURE.md) · [Работы](BACKLOG.md)

Перечисленные направления обсуждались; незаданные schema/API/UX здесь не выбираются.
Принятый target не равен реализации. Разработка идёт по Phase A–I.

## Решения Phase C от 11.11.2026

C-UX-04 — VERIFIED: все шесть ручных проверок пройдены пользователем;
полный scope проверки зафиксирован в [BACKLOG](BACKLOG.md).

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

## Ближайшая очередь реализации — решение 11.11.2026

Историческая очередь BT-DRAFT-01 → BT-COPY-01 → C-CAP-01-01 выполнена в main. Текущая последовательность направлений — в [BACKLOG](BACKLOG.md#направления-и-зависимости); representative acceptance остаётся OPEN.
Это очередь реализации, не изменение последовательности gates Phase A–I.
L1 PRODUCT COMPLETE остаётся обязательным до продуктового L2/L3.

### BT-DRAFT-01 — локальное автосохранение BaseTemplate

**IMPLEMENTED / ACCEPTED / MERGED.** Один локальный черновик создания
и отдельный по template ID; localStorage, пауза 350 мс и flush при уходе.
Новый черновик предлагается продолжить; отказ требует подтверждения.
Существующий восстанавливается при совпадении server draft generation;
конфликт блокирует применение и не перезаписывает сервер.
Сохраняются параметры, панели, порты, геометрия, типы, имена, внутренние связи,
модульные места, активная панель, счётчики и порядок/параметры именования.
Выделение и временные состояния взаимодействия не сохраняются.
Очистка только после успешного server save той же версии; ошибки storage
и повреждение данных видимы. API, миграции и draft/candidate/publication без изменений.
Без синхронизации вкладок/устройств; локальные данные зависят от профиля браузера.

### BT-COPY-01 — копирование BaseTemplate

**IMPLEMENTED / MERGED; manual acceptance pending.** «Создать копию» в библиотеке из опубликованной ревизии создаёт новый
независимый BaseTemplate. Копируются определения, панели, порты, PortType refs,
геометрия, внутренние связи и модульные места. Не копируются PhysicalObject,
canonical endpoints, подключения и зависимости исходных экземпляров.
Исходный шаблон не изменяется. Источник закреплён template/revision ID в URL;
загрузка с повторной попыткой, штатный create API только при явном сохранении.
Копия использует BT-DRAFT-01; существующий черновик требует выбора и подтверждения
удаления. Архивные PortType сохраняются с предупреждением и ручной заменой.
«Отмена» для создания, копии и редактирования очищает только локальное состояние
после подтверждения; ошибка storage оставляет редактор открытым. Backend lifecycle
не изменён. Адресные component/model tests и Docker build; ручная проверка pending.

## C-CAP-01 — обязательный semantic gap Phase D

C-CAP-01 (единый пункт, ссылка из Phase C) — OPEN, обязательный semantic gap Phase D.
Canonical ConnectionPoint/Connection/ConnectionMember foundation существует, но
C-CAP-01-01 реализует BaseTemplate multichannel definitions/materialization; внешний multichannel Cable write и полный UI остаются OPEN (02/03/04).
Обязательный сценарий стенда: один задний многоканальный вход патч-панели,
24 независимо адресуемых канала, 24 отдельных передних порта, exact internal
member mapping 1..24, один физический многоканальный Cable и точный L1 trace
отдельного канала после reload. Не создавать Fanout entity, фиктивные порты
или 24 искусственных Cable для подмены одного физического.
Точные DTO/API, редактирование member mappings, lifecycle/reconcile и UX — OPEN;
foundation не означает IMPLEMENTED.

### P-UX-21 — представление PhysicalObject на карте

**Статус: OPEN / PRODUCT DIRECTION AGREED. Реализация не начата.**

Согласованное продуктовое направление для runtime Map:

1. Большой внешний контур на пользовательском эскизе обозначает Location,
   а не корпус PhysicalObject.
2. Отдельная горизонтальная полоса заголовка сверху убирается. Корпус визуально
   разделяется на левую вертикальную область названия PhysicalObject,
   центральную область оборудования и правую область дополнительной информации.
3. Непосредственный Location может отображаться справа, если его подпись не
   пересекается с кабельными линиями. Если правая область занята, Location
   допускается показывать под названием объекта слева. Точные правила выбора
   расположения подписи и обработки пересечений остаются OPEN.
4. Существующий spatial contract
   одиночных Location chains и derived path labels сохраняется. Это presentation
   context; новая модель принадлежности объектов не вводится.
5. Расположение и координаты портов, принадлежность панелям и модулям сохраняются.
   Маркеры портов должны стать визуально компактнее, по примеру редакторов
   шаблонов; область взаимодействия с портом при этом не уменьшается.
6. Формы NETWORK_PORT/CONNECTION_POINT и цвета PortType сохраняют
   контракт PT-03.
7. Кабельные маршруты не перестраиваются ради декоративных подписей.
8. Canonical topology, endpoint identity, connections, trace evidence, SavedMap
   и Location hierarchy не меняют семантику.
9. P-UX-21 не входит в P-UX-03E. Это отдельная будущая реализация;
   C-VIS-02 не закрывается автоматически.

### P-UX-22 — Взаимодействие с объектами на физической карте

**Статус: PRODUCT DECISION PENDING / PRODUCT DISCUSSION. Продуктовый контракт ещё не утверждён полностью.**

Наблюдения и направления будущего UX-обсуждения:

- Текущий курсор перемещения слишком крупный.
- Действие левой кнопки мыши не всегда очевидно: перемещается карта или элемент
  под курсором.
- При наведении на интерактивный объект желательно подсвечивать его контур.
- При наведении на порт желательно подсвечивать конкретный порт и показывать
  специализированный компактный курсор.
- Визуальная реакция должна отражать реальную доступность действия.
- Необходимо рассмотреть режимы выбора, перемещения карты и редактирования.

Конкретные режимы и горячие клавиши не утверждены. Space+drag, средняя кнопка
мыши и отдельные инструменты остаются вариантами будущего UX-обсуждения.
P-UX-22 — отдельная будущая работа вне P-UX-03E.


## C-UX-10 — Automatic Location Cable Channels

C-UX-10-01 foundation объединён в main:
самостоятельные прямоугольные frames всех canonical Locations на каждой карте
со spatial вложением по canonical parent, единым переносом контейнера с
оборудованием и ростом предков; назначение Location согласует существующие
placements всех карт/variants (corrective),
variant geometry и одна обязательная map-scoped виртуальная точка, Save/Cancel,
перемещение/resize и копирование variant. Геометрия не меняет topology/hierarchy.
Стабилизация foundation: полный authoritative ответ move (positions/frames),
автоматические bounds по полному rendered footprint с отдельным manual resize floor,
полный collapse пустых/заполненных subtree в один компактный элемент с прежней точкой,
expand без перезаписи expanded geometry и сохранение partial visible elements.
COMB-01, ROUTE-UX-01, CABLE-SELECT-01, LOC-CHAN-01 и LOC-ROUTE-01 —
IMPLEMENTED / MERGED / MANUALLY ACCEPTED. C-UX-10 остаётся OPEN для общих
межобъектных жгутов и остальных незавершённых возможностей. CableType и
пользовательские цвета Cable остаются OPEN. Статусы C-UX-11, Phase A–I и C-CAP-01
сохраняются.

### CURRENT и владение

CURRENT: COMB-01 вычисляет объектные пути и preview. Индивидуальная
геометрия Cable больше не хранится. Каждый Location, включая пустой, имеет
рамку и одну обязательную виртуальную точку. LOC-CHAN-01 вычисляет из variant
общий локальный граф для Location и технического корня независимо от Cable.
LOC-ROUTE-01 выводит из этих графов и подводов COMB-01 путь для показа и preview.
Preview и созданный Cable используют одни сегменты. SavedMap и
MapPresentationVariant — presentation state. Оба графа вычисляются, persisted
Channel отсутствует. При отсутствии связного пути карта показывает диагностику.

TARGET согласован с [независимыми картами](L1_REFERENCE_NETWORK.md#независимые-карты):
Location и виртуальная инфраструктура принадлежат одной карте и не разделяются
между независимыми картами. MapPresentationVariant — компоновка этой карты.
Геометрия относится к presentation variant; переключение вариантов и изменение
геометрии не меняют identity точки или canonical topology. Точная persistence
schema, DTO и API этим контрактом не выбираются.

### Обязательная граничная точка

Каждый Location имеет ровно одну обязательную виртуальную граничную точку,
автоматически создаваемую вместе с Location, в том числе пустым. Дополнительные
точки не поддерживаются; ручное удаление обязательной точки запрещено.
Положение настраивается в компоновке карты; identity не зависит от координат,
названия, порядка или переключения компоновок. Точка не является canonical
ConnectionPoint и не создаёт физических endpoints.

### Общий виртуальный Channel

СОГЛАСОВАНО: маршрут проходит через обязательные граничные точки последовательных
уровней Location hierarchy. Для объектов одного непосредственного Location
переход через другие Location не требуется. Прямой Channel произвольной пары
Location без иерархического маршрута не является принятым алгоритмом.
Общие участки переиспользуют presentation geometry; Channel не Cable и не
Connection, пересечение и общий участок не доказывают связность.
Preview предшествует подтверждению; отмена/ошибка не оставляет частичных записей.

### Составное отображение Cable

Физический Cable остаётся одной canonical сущностью с реальными окончаниями.
Отображаемый путь состоит из индивидуальных подводов и последовательности
участков через обязательные точки Location hierarchy. Для объектов одного
непосредственного Location путь соединяет объектные подводы. Общая presentation
geometry переиспользуется без копирования в маршруты Cables.

Hover индивидуального участка подсвечивает видимый путь и его физические
окончания. Клик по индивидуальному участку выбирает Cable, клик по общему участку
открывает список использующих его Cable. Выбор подсвечивает весь видимый
путь Cable. Exact L1 evidence каждого Cable сохраняется независимо.

### Lifecycle и перемещение оборудования

Занятость участков определяется по существующим Cable. Свободные участки
добавляются переключателем карты. Ручное управление общими участками
остаётся OPEN. Правки компоновки сохраняют Cable/Connection/ConnectionMember.

При перемещении оборудования сохраняются физическая Cable identity и реальные
окончания. Пересчитываются подводы, иерархический путь и используемые общие
участки. Прежние участки могут стать пустыми. Для будущего UX перемещения согласованы preview и подтверждение перед
сохранением операции целиком. Отмена и ошибка исключают частичные изменения,
а смена Location не удаляет физического подключения.

### Collapse / expand

Collapse скрывает внутренние участки по принадлежности к subtree, по иерархии. Внешние участки видны до обязательной точки свёрнутого
Location. Unary simplification сохраняет эту точку при пересечении границы.
При nested collapse приоритет у внешнего явно свёрнутого контейнера. Проекция
внешних участков потомков до его границы вычисляется для отображения. Expand
рекурсивно восстанавливает геометрию без записи новых общих участков и без
перезаписи Cable или исходной геометрии.

### Пустые Location

CURRENT: пустой Location сохраняет видимую область и обязательную точку.
Геометрия области относится к presentation state. Свободные сегменты
производного дерева доступны через переключатель карты. Ручное управление
общими участками, в том числе до размещения оборудования, остаётся OPEN.

### OPEN implementation decisions

Открыты общие межобъектные жгуты и ручное управление общими участками.
Для расширений C-UX-10 остаются открытыми детали preview и атомарного
сохранения пользовательских операций, включая конфликты, восстановление
после ошибки и влияние удаления или reparent Location. Текущий автоматический
путь поддерживает технический корень для объектов без непосредственного
Location и вычисляет collapse-проекцию. Ручные индивидуальные маршруты Cable
удалены.

## Справочники и техническая совместимость

CURRENT. PortType — реализованный справочник. PhysicalObject class хранится
строкой, BaseTemplate может задавать default class. Location.type — optional
пользовательская строка. CableType — DECIDED TARGET / OPEN. Формы оборудования
предлагают hardcoded presets и произвольное значение. От строковых классов
зависят подписи, акценты и фильтры списка оборудования. Presets обслуживают
эти сценарии интерфейса и не образуют самостоятельный справочник.

TARGET. Пользовательские типы PhysicalObject и Location без закрытой taxonomy.
Типы отделены от canonical identity. Тип Location не ограничивает parent/children.
Тип оборудования не задаёт connectivity, endpoints или member mappings.

OPEN: ID/reference model, перенос существующих строк и сохранение зависящего
от них UI, выбор/создание типов, update/archive/delete, правила изменения
используемых определений, типовые свойства, зависимости от шаблонов и порядок
реализации. Phase D определяет минимальные L1 classifications,
E охватывает UX, F — workspace/access.

## PortType и физическая совместимость

**CURRENT.** PortType — пользовательский справочник. Определение
NETWORK_PORT ограничено cardinality=1. C-CAP-01-01 уже поддерживает
многоканальные определения CONNECTION_POINT и их материализацию в
BaseTemplate. Внешние операции подключения и reconnect поддерживают
cardinality=1, member=1.

**TARGET.** Структура PortType задаёт cardinality порта, которую нельзя
произвольно переопределить в отдельном порте шаблона. Cardinality означает
число независимо адресуемых members. Названия TX/RX необязательны.
LC Simplex (1), optical duplex (2), MPO-24 (24) и RJ45 (1) — примеры
пользовательских типов. Системный enum для них не вводится.
NETWORK_PORT с cardinality > 1 входит в TARGET. Материализованный
ConnectionPoint сохраняет canonical cardinality при последующем
редактировании визуальных свойств типа.

Если хотя бы один BaseTemplate использует PortType, его структурные
характеристики заблокированы. Учитываются черновики, опубликованные,
архивные и другие существующие состояния шаблонов. Визуальные
характеристики редактируются. Для другой физической структуры создаётся
новый PortType. Автоматическое версионирование PortType не предусмотрено.

**TARGET для соединений.** Сервер запрещает подтверждённо несовместимые
соединения. При неизвестной совместимости требуется предупреждение и
явное подтверждение, которое сервер учитывает при записи. Равенство
cardinality само по себе не определяет совместимость. Будущий контракт
должен поддерживать 2↔2 и 2↔1+1, включая частичную коммутацию. Отсутствие
требуемых members определяется производной валидацией на основе
ожидаемого и фактического mapping. Новый canonical fact для этого не нужен.

**OPEN.** Физическая среда и интерфейс подключения — кандидаты на
минимальные характеристики PortType. Точный набор полей и структурных
характеристик, правила и taxonomy совместимости, формат подтверждения,
DTO и API требуют отдельного решения.

## CableType и member-aware модель

**TARGET.** CableType — будущий пользовательский справочник. Одно оптическое
волокно образует независимо трассируемый путь. Несколько отдельных Cable
могут использовать общую визуальную трассу, сохраняя независимую canonical
connectivity. Физическую группировку линий в магистраль можно рассмотреть
как отдельную необязательную возможность. Детальная иерархия
Cable/Fiber/Termination сейчас не требуется.

**OPEN.** Минимальные характеристики CableType ещё не утверждены. Требуется
пересмотреть L1-O5 и C-CAP-01-02/03/04. Ранее принятый L1-O5 требует одну
Cable identity для физической сборки с несколькими окончаниями, а текущие
критерии C-CAP-01 опираются на один внешний multichannel Cable. Нужно
согласовать, как эти критерии соотносятся с независимыми member paths,
подключениями 2↔1+1 и необязательной физической группировкой. До явного
решения действуют ранее согласованные обязательные gates и критерии
приёмки. C-CAP-01 остаётся OPEN Phase D, C-CAP-01-01 — IMPLEMENTED / MERGED.

## Spatial и оборудование

Ordered child layout (rack units/chassis/shelves), physical occupancy нескольких
мест, selector-based collapse, reusable Location series templates, arbitrary
nonphysical grouping — открытые отдельные capabilities. Current Location assignment
остаётся single immediate Location, не many-to-many; geometry не доказывает occupancy.
MapReference — будущая composition/navigation независимых SavedMaps с drill-down
и canonical-derived crossings, не Location/containment или простой hyperlink-object.
Scene schema/persistence, interaction и milestone placement не выбраны.
Nested modules, CPU/RAM/disks/PSU inventory и mechanical compatibility не реализованы;
scope/need открыты. Dense runtime map LOD остаётся отдельным измеряемым решением;
PT-03 уже решает базовые shape/color, не требует повторного проектирования.

## Workspace, multi-user и история

Согласовано: NetworkWorkspace — application isolation boundary над network core;
SavedMap — presentation внутри dataset, EvaluationView — coherent read, не workspace.
Persisted isolation/auth/access/sharing/activity нужны до L2 (Phase F), exact
bounded decomposition открыта. Auth provider, roles/groups/ACL inheritance,
SQLAlchemy scope и storage/schema strategy, provisioning/archive/soft-delete,
sharing permissions/public links, query/UI и release gate не выбраны.
Fork/merge/compare/rebase, copy-on-write, database-per-workspace, packages,
comments/annotations, map cloning/templates и общая portability не становятся MUST
автоматически. Текущий v8 export/reset/import не закрывает эту family.

Generic activity: append-only mutation journal, global feed и per-entity projection,
не event sourcing и не source of truth topology. Actor/workspace attribution после
соответствующих foundations; CableLabelHistory уже отдельное domain exception.
Открыты event taxonomy, persisted schema, before/after vs delta/snapshot,
transaction/correlation, actor integration, indexing, retention, query/filter/UI
и права чтения. Exact version/update alias rules нельзя переносить со старого
Blueprint API на новый template lifecycle без проверки текущего контракта.

## Media/capability, diagnostics и operational data

Согласовано различать stable media/configured component facts, capability,
configured link state и observed/negotiated state. Nominal Cable capacity не
равна interface capability, negotiated speed или throughput. Reusable profiles
открыты по schema/storage/API; не фиксировать универсальное Cat6=10G правило.
Path diagnostics могут учитывать transceiver/passive components/remote endpoint,
lanes/PHY/medium, не только ConnectionPoint.speed. Wireless/transport modelling,
capacity chain/bottleneck и standards scope требуют product use case; порядок
после обязательных gates уточняется отдельно.

Observations/collectors отделены от canonical truth: source/time/freshness/evidence,
явное reconciliation при conflict/drift. Historical/timeline support, scheduling,
observation storage, Dynamic Map query language/membership persistence и сохранение
layout остаются открытыми. Collector не запускается только ради одной карты.
Health overlays и problem-only modes — направления, не окончательные enums/API.
Secrets SNMP/API/SSH/monitoring — application secrets; VIEW не даёт credentials,
обычный workspace export не переносит их открытым текстом. Secrets storage и
permissions источников не выбраны.

## Дополнительные границы решений

- Степень/валидация физических points по типам, реальные пути Cable через
  промежуточные Locations, история переподключений и temporal states остаются
  открытыми; presentation channels не являются физическим inventory.
- Массовый multichannel member mapping и степень FANOUT authoring зависят от
  C-CAP-01. Canonical foundation есть; exact template/API решение не выбрано.
- Поиск всего оборудования и свободного порта для создания связи независимо от
  текущей карты — future product direction; map click остаётся быстрым способом.
- Application compression: сначала размеры текущего v8 и ZIP/GZIP, затем решение
  о собственном формате; старый v5 размер не основание архитектуры.
- RoutingPolicy/PACKET_MARK storage/predicate domains, direct-next-hop PBR,
  redirect, VRF leaking и effective observations требуют отдельного product scope;
  наличие backend resolvers не означает весь предполагаемый UI/persistence.
- API-002 missing-resource semantics, performance budgets и LOD выбираются на
  текущих измерениях и контрактах, не ради старой формы тестов.

Контракт [L1-CONTRACT-02](L1_CONNECTIVITY.md) закрепляет L1-O1–L1-O10 как DECIDED.
C-CAP-01 остаётся OPEN Phase D, L1 PRODUCT COMPLETE обязателен до L2/L3.
Решения не объявляют текущий core полным multichannel продуктом.

## Принятые решения L1-O1–L1-O10 — DECIDED

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
  двухточечной модели; фиктивные Cable недопустимы. Пересмотр этого принятого
  критерия остаётся [OPEN](#cabletype-и-member-aware-модель).
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

## Технические вопросы реализации — OPEN

DTO/API, schema/storage и миграции, stable member addressing/provenance,
internal/external role validation и concurrency occupancy, atomic lifecycle,
безопасный reconcile и исправление ошибочных данных, ModuleTemplate continuity,
UX preview/editing и контракт группового результата/ожидаемых mappings открыты.
Выбор выполняется в соответствующем implementation contract по
[последовательности C-CAP-01](BACKLOG.md), не в этой консолидации.

## Управление состояниями сети — PRODUCT DIRECTION AGREED / OPEN

1. Утверждённая текущая топология сети.
2. Создание независимой рабочей копии.
3. Редактирование и утверждение целевой топологии.
4. Выполнение физических изменений.
5. Утверждение новой текущей топологии.
6. Сохранение предыдущих состояний в истории.

Это отдельное будущее направление, не IMPLEMENTED и не MapPresentationVariant.
Текущий SavedMap не обеспечивает независимое версионирование canonical topology.
Хранение, сравнение, утверждение, переключение и разрешение конфликтов — OPEN;
техническое решение и milestone placement не выбраны.


## C-CAP-01-01 — definitions и materialization

Реализованы cardinality и exact internal member mappings BaseTemplate,
атомарная materialization и запрет публикации изменения физической конструкции.
Контракт хранения и границы: [ARCHITECTURE](ARCHITECTURE.md#c-cap-01-01--definitions-и-materialization).
Графический multichannel edit/copy блокируется без потери данных; API доступен.
C-CAP-01 остаётся **OPEN Phase D**; C-CAP-01-02/03/04 не реализованы.

## L1-REFERENCE-01 — DECIDED TARGET / implementation OPEN

[Полный контракт](L1_REFERENCE_NETWORK.md): независимые карты, CableType,
переносимые определения и demo initialization приняты, но не реализованы.
Уточнение прежнего workspace direction: CURRENT SavedMap — presentation над общей
topology; TARGET карта владеет независимой сетью внутри application isolation
NetworkWorkspace. MapReference не даёт межкартовых canonical соединений.
Открыты DB schema/FK transition/API map isolation, JSON/versioning и UX импорта,
сопоставление конфликтующих типов, controlled transition исторических Cable,
защита используемой конструкции CableType и безопасная initialization/conflict policy.
Отдельный bounded map isolation milestone предшествует включению demo.
MPO→LC breakout, PON splitter, SAS shelves и duplex fiber/interface realization
остаются OPEN. C-CAP-01 OPEN Phase D; 02/03/04 не закрыты; gates A–I неизменны.

AUTO-LOC-01 adds opt-in automatic composition of these frames per variant.
Technical root, direction, mixed order and hide-empty settings are presentation
only; they neither introduce Channel nor change the C-UX-10 channel target.


## DOC-LOC-03 — Structural Location Composition

**PARTIAL.** Продуктовый контракт принят в
[ARCHITECTURE](ARCHITECTURE.md#doc-loc-03--target-структурной-компоновки-location):
локальное соседство сверху/снизу/слева/справа, смешанные строки/столбцы Location
в одном родителе, простая упорядоченная последовательность непосредственных
PhysicalObject, автоматические размеры и локальное выравнивание. Технический
root не требует выбора направления. Визуальные группы и структура размещения
принадлежат variant, не canonical hierarchy; assignment меняется явно.
Скрытие и collapse не уничтожают структуру. CURRENT AUTO-LOC-01/02 не заменяется
этим документационным решением и не объявляется реализацией TARGET.

Отдельно согласована объектная кабельная геометрия: выход справа, расчёска
над/под корпусом, визуальный жгут, object-relative подводы с выходом в свободное
пространство Location без дополнительных полос внутри корпуса. Панель
BaseTemplate не масштабируется, правая зона OBJECT-UX-01 может принимать
дополнительную ширину. Локальный граф и его отображение реализованы в COMB-01.
Общий межобъектный жгут остаётся OPEN.
Автоматические составные маршруты реализованы. Оставшийся scope C-UX-10
открыт отдельно от структурной компоновки.

CURRENT. SLOC-01–04 находятся в main: uniform-grid хранится в variant
automatic_layout, Arrange/Done/Cancel поддерживает стрелочные перемещения
и swaps, сортировка дочерних Location использует тот же черновик. Сортировка
всей таблицы сохраняет маску пустых ячеек, переименование не запускает сортировку.
SLOC-04-SAVE добавляет «Сохранить компоновку» в настройки Location. Кнопка и
«Готово» сохраняют общий черновик активного variant. Настройки сворачивания
сохраняются отдельно. Действующий формат и взаимодействие описаны в ARCHITECTURE.

SLOC-05 в main добавляет порядок и ориентацию непосредственных
PhysicalObject для каждого Location и root. Эти правки входят в общий черновик.
OPEN: grid-specific partial-collapse selection UX. COMB-01 резервирует
место для верхней и нижней магистралей в uniform-grid.
Ручная приёмка SLOC-05 остаётся OPEN.
Ручная приёмка стрелочной расстановки и сортировки остаётся отдельной проверкой.
Для SLOC-04-SAVE сохранение и reload проверены в Chromium с реальным backend
и PostgreSQL. Второй вариант сохранил исходный порядок.
