# L1 Connectivity — L1-CONTRACT-03

**DECIDED TARGET.** L1-CONTRACT-03 уточняет продуктовую семантику L1,
не меняя реализацию. База сверки: 8ecf5a47e9c3d2d4241939f48065865d61b436d4.
Историческая база инвентаризации L1-CONTRACT-01:
31aa415ca1983af5a0a5270324d99b4bd58369a6. База консолидации L1-CONTRACT-02:
51353a99a900fb5a0a6bde10ea767f3a9529ff17.

[ARCHITECTURE](ARCHITECTURE.md) сохраняет архитектурные инварианты и исходную
формулировку L1-CONTRACT-02. Для L1-O5/O7/O9 действуют уточнения ниже.
Исторические ссылки на пересмотр 02/03/04 читаются с учётом этого решения:
критерии C-CAP-01 сохранены, семантика многоконцевых сборок остаётся OPEN.
[PROJECT_STATE](PROJECT_STATE.md) фиксирует состояние реализации,
[BACKLOG](BACKLOG.md) — действующие этапы и gates,
[OPEN_DECISIONS](OPEN_DECISIONS.md#открытые-вопросы-l1-contract-03) — остаточные
продуктовые вопросы.

CURRENT описывает фактическое состояние базы. IMPLEMENTED относится к
реализованному scope, CORE ONLY — к выразимости core, PARTIAL — к частичной
реализации. DECIDED TARGET фиксирует принятые требования. OPEN обозначает
нерешённую семантику или незавершённую реализацию в явно указанном scope.
Ссылки на тесты указывают на существующие свидетельства.

## Подтверждённые инварианты и источники

- [models.py](../app/models.py) (`ConnectionPoint`, `Connection`, `ConnectionMember`):
  положительная cardinality, два различных points; уникальность index и каждого
  endpoint member внутри Connection. [repository.py](../app/repository.py)
  `add_connection` проверяет существование points, диапазоны members и равенство
  cardinality числу mappings. Cardinality Connection не обязана равняться
  cardinality каждого point: возможно частичное соответствие.
- `add_connection` не запрещает участие одного point member в нескольких
  Connections. DB uniqueness ограничена connection_id, глобальной уникальности
  занятости нет. Это необходимо отличать от правил пользовательского write.
- [physical_connections.py](../app/physical_connections.py)
  `create_endpoint_link` блокирует занятый внешний member, но отличает external
  от internal по владельцам points. Внутреннее продолжение и внешний кабель
  могут использовать один member. Этот write допускает только cardinality=1;
  bulk — 1..256 отдельных пар member=1, не один многоканальный Cable.
- `Cable.connection_id` — обязательный уникальный FK с CASCADE; Connection
  может существовать без Cable. Cable не PhysicalObject. `delete_cable` и
  `delete_external_connection` удаляют внешнюю связь атомарно с label lifecycle;
  internal connection этим внешним disconnect не удаляется. Label не identity.
- [hardware_catalog.py](../app/hardware_catalog.py) `create_object` создаёт
  points с cardinality из BaseTemplate и exact internal member mappings без Cable (C-CAP-01-01).
  `install_module` создаёт points/bindings cardinality=1; аналогичная
  materialization внутренних связей ModuleTemplate здесь не реализована.
  Нельзя переносить возможности BaseTemplate на ModuleTemplate по аналогии.
- [object_reconciliation.py](../app/object_reconciliation.py) сохраняет retained
  endpoint IDs, проверяет зависимости, добавляет допустимые internal links 1:1;
  без canonical provenance не удаляет существующие Connections и не переписывает
  capacity. [module_reconciliation.py](../app/module_reconciliation.py) — отдельный
  путь модулей, не доказательство multichannel reconcile.
- [resolver.py](../app/resolver.py) `L1Resolver`: state=(point_id,member_index),
  обход только adjacency из canonical members; достижимый путь REACHABLE,
  отсутствие доказанного пути UNKNOWN/L1_TOPOLOGY_INCOMPLETE. BFS возвращает
  один найденный путь, не все физические маршруты и не модель распространения
  сигнала. Evidence содержит Connection и ConnectionMember.
- [physical_object_l1_resolver.py](../app/physical_object_l1_resolver.py) перебирает
  participating member candidates и сохраняет отдельные branches/cycles.
  Объектный REACHABLE означает наличие пути хотя бы одной пары, не всех каналов.
- [schemas.py](../app/schemas.py) `ConnectionPointPhysicalEndpointRequest`
  ограничивает member_index Literal[1]; [main.py](../app/main.py) публикует
  POST `/v1/topology/physical-connections`, bulk и DELETE connection.
  [ConnectPhysicalEndpoint](../frontend/src/components/ConnectPhysicalEndpoint.tsx)
  и [MapPage](../frontend/src/pages/MapPage.tsx) отправляют member=1.
  Точная member адресация resolver не равна наличию multichannel editor.

Адресные свидетельства: [L1 invariants](../tests/test_l1_invariants_integration.py),
[L1 trace](../tests/test_l1_trace_e2e.py) (включая passive pass-through,
invalid cardinality, cycles), [object trace](../tests/test_physical_object_l1_trace_e2e.py)
(включая unused members и branches), [Cable constraints](../tests/test_cable_domain_constraints.py),
[Cable cutover](../tests/test_cable_domain_cutover_e2e.py),
[reconcile](../tests/test_object_reconciliation.py),
[UI wiring](../frontend/src/pages/MapPage.wiring.test.tsx).

В main также реализованы bulk delete и переподключение одного окончания.
Reconnect сохраняет Cable, Connection и ConnectionMember ID, меняя один
ConnectionPoint ID в рамках атомарной операции с проверкой занятости.
Табличный bulk create создаёт отдельные Cable, а выбор панели по `panel_key`
и производные маршруты SavedMap относятся к представлению. Подробности в
[ARCHITECTURE](ARCHITECTURE.md#кабельные-операции-и-панели-current).
Member-aware развитие PortType и физической совместимости описано в
[OPEN_DECISIONS](OPEN_DECISIONS.md#porttype-и-физическая-совместимость).

## Матрица механизмов

В таблице «trace» означает exact point/member continuity с evidence, а не
передачу, мощность или протокольную работоспособность сигнала. Ограничения
обычного write и reconcile из предыдущего раздела применяются ко всем строкам.

| Механизм / статус | Физическая семантика и пример | Canonical выразимость | UI/API и authoring/materialization | Lifecycle/reconcile | Trace/evidence и пробел |
|---|---|---|---|---|---|
| Обычное 1:1 — IMPLEMENTED | Patch cord между двумя портами | Два points, один mapping, optional Cable | Обычный create, bulk, disconnect | Атомарный внешний lifecycle | Exact member=1; не доказывает сигнал |
| N:N — PARTIAL | Независимые волокна MPO trunk | Один Connection с N уникальными mappings | BaseTemplate API/materialization поддерживают internal N:N; внешний write только cardinality=1 | Допустимый reconcile сохраняет конструкцию; внешний member occupancy/edit/disconnect OPEN | Каждый member отдельно; нет пользовательского полного цикла |
| Перестановка — PARTIAL | Полярность оптического trunk, 1→3, 2→1, 3→2 | Явные пары, не порядок endpoints | BaseTemplate API материализует internal permutation; общий mapping editor OPEN | Сохранение identity при изменении mapping OPEN | Следовать записанной паре, не номеру/геометрии |
| Частичное соответствие — PARTIAL | Из 12 волокон подключены 4 | Connection cardinality=4, subset point members | BaseTemplate API материализует internal subset; внешний multichannel authoring OPEN | Отключение одного канала и capacity edits OPEN | Неподключённые members не получают путь |
| N независимых каналов → N points — PARTIAL | Задний MPO-24 → 24 лицевых гнезда | N Connections от разных rear members к front member=1 | BaseTemplate материализует rear cardinality=N и N внутренних связей | Допустимый reconcile сохраняет конструкцию; смена распайки OPEN | Exact rear i → front i, без смешения; C-CAP-01 |
| Internal passive — PARTIAL | Проходной адаптер | Same-object Connections без Cable | BaseTemplate материализует exact internal mappings; ModuleTemplate internal materialization отсутствует | Допустимый reconcile сохраняет multichannel конструкцию; ограничения обычных добавлений 1:1 сохраняются | Passive chain подтверждена; общий template contract OPEN |
| Патч-панели и кроссы — PARTIAL | Задняя/передняя коммутация | Композиция internal/external continuity | Ordinary external 1:1 и BaseTemplate internal multichannel реализованы; внешний multichannel Cable OPEN | Сохранение существующих связей; общая смена распайки OPEN | Все canonical hops; тип «панель» не создаёт связь |
| Муфты, сварки, переходники — PARTIAL | Сварка двух волокон внутри муфты | Парная continuity выражается | Пассивные points/links; специализированный splice workflow не доказан | Отдельный lifecycle сварки не доказан | Путь есть при explicit links; степень требуемой provenance OPEN |
| Реальный splitter — OPEN | Оптический PLC 1:8 | Несколько Connections с общим member технически образуют граф | Полноценный splitter authoring не доказан | Правила общей занятости/изменений OPEN | Reachability не доказывает деление сигнала, потери, направленность |
| Несколько окончаний — OPEN | Один breakout cable с общей оболочкой и тремя концами | Граф пар возможен, один Cable не охватывает несколько Connections | Пользовательский aggregate lifecycle отсутствует в проверенном пути | Текущий Cable identity двухточечный | Нельзя доказать принадлежность всех ветвей одному Cable |
| Сборки и многоточечная среда — OPEN | Жгут; коаксиальная шина с taps | Отдельные парные continuity не доказывают общую среду/сборку | Общий authoring не доказан | Atomic aggregate edits OPEN | Нет доказанной семантики taps/общего носителя |
| Активные границы — PARTIAL | Switch, media converter | Физические endpoints/bindings есть; преобразование не Connection | NETWORK_PORT materialization есть | Endpoint lifecycle есть; контракт преобразования OPEN | L1 не должен создавать transit через активный объект по одному типу |

## Принципиальные границы

**CURRENT — canonical Foundation и её ограничения.**

Точное соответствие независимых каналов — частичная биекция в каждом Connection.
Перестановка и rear-to-front fanout сохраняют независимость каналов. Для N front
points нужны N парных Connections: это не N копий одного rear member.

Продолжение среды через пассивный объект можно задать последовательностью
Connections, повторно используя промежуточный member. Это подтверждено passive
trace тестом. Граф также позволяет степень больше двух, но из этого не следует,
что физический splitter или общая среда корректно моделируются такой композицией.
В одном Connection повтор одного source member запрещён; в разных Connections
он допустим core. Resolver тогда доказывает только графовую continuity, в том
числе потенциальный путь между выходами. Соответствует ли он реальному устройству
— OPEN. Передача, деление мощности, направленность и преобразование сигнала
не подтверждены ConnectionMember. Нельзя объявлять эти четыре механики равными.

CURRENT Cable имеет самостоятельную canonical identity и ссылается на один
Connection с двумя points. Отсутствие сущности окончания
и aggregate связи нескольких Connections с одним Cable не позволяет заявить
поддержку одного многоконцевого кабеля. Не обходить это фиктивными endpoints,
Cables или геометрическими линиями.

## L1-CONTRACT-03 — DECIDED TARGET

### Назначение, canonical truth и готовность

NetMap L1 — декларативная пользовательская модель физической инфраструктуры
организации: оборудование и местоположения, конструкция оборудования,
физические окончания, медные и оптические кабели, пассивная коммутация и
точные физические пути. L1 trace вычисляет задокументированную connectivity
по canonical topology. Stable IDs, неизменяемые опубликованные версии и
точные canonical refs в evidence сохраняются. SavedMap, layout, route geometry
и presentation не являются источниками connectivity. Blueprint и Port Block
остаются средствами authoring, provenance и presentation.

REACHABLE означает наличие задокументированного пути. Физическая проверка,
исправность линии и действующий Ethernet link из него не следуют. Наблюдения
мониторинга хранятся отдельно от canonical фактов. L2/L3 используют L1 как
источник физических фактов, а forwarding и reachability определяют в своих
контекстах по собственным данным. Неявного физического транзита через активное
оборудование нет.

- **L1 CONNECTIVITY COMPLETE** — модель достоверно представляет целевую медную
  и оптическую инфраструктуру и поддерживает необходимый authoring, lifecycle
  и exact trace. SNMP, SSH, мониторинг, optical budget, negotiated state и
  автоматическое обнаружение не являются условиями этого уровня.
- **L1 PRODUCT COMPLETE** дополнительно требует эксплуатационной пригодности UI,
  workspace isolation, auth/ACL, sharing, accountability, стабильности,
  масштабирования и финальной приёмки.

Это аналитическое разделение. Статусы, обязательные gates и порядок Phase A–I
сохраняются. Оба уровня на текущей базе не достигнуты. L1 PRODUCT COMPLETE остаётся gate
до продуктового L2/L3. Интеграция
с оборудованием и DSL импорта вне L1-CONTRACT-03. Схема, FK, DTO, API и стратегия миграций здесь не выбираются.

[L1-AUDIT-01](audits/L1_READINESS_AUDIT.md) подтвердил в своей выборке обычный
1:1, явное пассивное продолжение, отсутствие active transit и стабильность
проверенных IDs. Audit evidence содержал точные Connection/ConnectionMember
refs с сопоставлением Cable из экспорта. Это не полный пользовательский
multichannel trace/authoring. G01 (multichannel), G02 (workspace/access) и G04
(масштаб и финальная приёмка) остаются открытыми gates.

### Физические каналы и Cable

Cable имеет собственную canonical identity. ConnectionMember задаёт точное
соответствие независимо адресуемых каналов. Геометрический маршрут и
необязательная физическая или организационная группировка существуют отдельно
от connectivity. Несколько реальных независимых Cable могут идти по общей
геометрии. Общая оболочка 48 волокон сама по себе не требует одной 48-канальной
Cable entity. Настоящий двухточечный multichannel trunk может быть представлен
одним Cable с N mappings и остаётся обязательным сценарием C-CAP-01.

RJ45 моделируется как одна независимо подключаемая сетевая линия, без отдельных
проводников. Оптическое волокно — независимо трассируемый канал. Целевой контракт
сохраняет независимость members, subset, permutation, partial connectivity,
2↔2 и 2↔1+1, точную занятость, атомарное изменение и exact trace. 2↔1+1 может
выражать явную пассивную разводку либо две действительно независимые линии.
Это не определяет identity настоящей многоконцевой сборки. Обязательной
иерархии Fiber/Termination и новой группирующей canonical entity нет.
Фиктивные связи, окончания и Cable недопустимы.

### Пассивная инфраструктура

ODF, патч-панели, кроссы, муфты, сварки и разварки можно представлять пассивным
PhysicalObject с ConnectionPoint и явной парной internal continuity.
Существование объекта или совпадение типов не создаёт пути. Отдельная Splice
entity, редактор сварок, кассеты, измерения затухания и история сварочных работ
не обязательны для универсального L1. Специализированные расширения возможны
по отдельному контракту. PON splitter, CWDM/DWDM и другие специализированные
оптические механизмы требуют отдельного решения о семантике и обязательности.
Обычные парные Connections их не моделируют.

### Модульная конструкция

MODULE_PORT — конструктивное посадочное место в BaseTemplate или ModuleTemplate.
ModuleTemplate может определять свои NetworkInterface, физические окончания
и собственные MODULE_PORT. Вложенность допускается без фиксированной глубины
и без циклов. Каждая конкретная установка имеет стабильную identity.
Рекурсивный визуальный редактор не является немедленным требованием.

Линейная карта или сетевой адаптер предоставляют новые интерфейсы. Сменный
трансивер предоставляет физическое окончание существующего родительского
NetworkInterface, который сохраняет identity при замене трансивера. Дублирующий
интерфейс не создаётся. Характеристики встроенного RJ45 задаёт основное
оборудование. Для SFP/QSFP характеристики окончания задаёт установленный
трансивер с учётом возможностей оборудования. Число NetworkInterface задаёт
поддерживаемый аппаратный режим. Количество физических members не определяет
QSFP breakout автоматически. Демонтаж не должен неявно уничтожать, переносить
или перепривязывать зависимые canonical connections. Порядок замены при
подключённом Cable и смены аппаратного режима остаётся OPEN.

### Справочники и совместимость

Целевые расширяемые справочники поставляются с распространёнными стандартными
определениями. Примеры начального наполнения:

| Справочник | Что описывает | Примеры |
|---|---|---|
| PortType | Конструкцию порта и число независимо адресуемых members | RJ45, LC Simplex, LC Duplex, MPO-12, MPO-24 |
| ConnectorType | Физический разъём | RJ45/8P8C, LC, SC, FC, ST, MPO/MTP |
| CableType | Конструкцию и среду кабеля | Cat5e, Cat6, Cat6A, OS2, OM3, OM4, OM5 |

Примеры не образуют закрытый перечень или fixed enum. Структурные характеристики
используемого PortType защищены от изменения, в том числе при ссылках из
существующих шаблонов. Для другой конструкции создаётся новое определение.
Визуальные характеристики отделены от структурных и не меняют canonical
cardinality. Сервер разрешает известную совместимость, запрещает доказанную
физическую несовместимость, а при неизвестной требует предупреждения и явного
подтверждения для записи. Равная cardinality не доказывает совместимость.
Это проверка задокументированных окончаний, без вывода о состоянии линии,
скорости, Ethernet negotiation или optical budget. Точный минимум характеристик
и правила инициализации остаются OPEN. CAT-D — PRODUCT DECISION PENDING.

## Принятые решения L1-O1–L1-O10 — DECIDED

Пункты восходят к L1-CONTRACT-02 от 11.11.2026. Статус DECIDED относится
к приведённым целевым правилам. Открытые части указаны явно.

| Решение | Действующий смысл |
|---|---|
| L1-O1 | Независимая медная линия или оптическое волокно. Число каналов задаётся данными. |
| L1-O2 | Общие правила internal/external mapping: прямой, обратный или заданный порядок, preview, ручная коррекция, subset, occupancy и атомарное сохранение. |
| L1-O3 | В обычной модели один member допускает максимум одно внешнее и одно внутреннее соединение. Конфликты не удаляют старые связи. |
| L1-O4 | Парные mappings не моделируют splitter. Семантика и обязательность специализированной оптики решаются отдельно. |
| L1-O5 | L1-CONTRACT-02 исходил из одной Cable identity даже для многоконцевой сборки. Раздел «Физические каналы и Cable» уточняет независимые линии и один двухточечный trunk. Обязательность и семантика настоящих многоконцевых сборок остаются OPEN. |
| L1-O6 | Переделка базовой конструкции требует нового BaseTemplate и нового PhysicalObject. Instance overrides внутренней конструкции не допускаются. Описание и presentation можно исправлять отдельно. |
| L1-O7 | Изменение конструкции модуля сохраняет правило нового ModuleTemplate. Раздел «Модульная конструкция» уточняет состав и рекурсивные установки, а также различие интерфейсного модуля и трансивера. ModuleTemplate internal continuity остаётся отдельной задачей реализации. |
| L1-O8 | Активные порты завершают L1 trace. Пассивное продолжение требует явной continuity. |
| L1-O9 | Правило новой identity при переделке базового оборудования и сохранения identity при внешней перекоммутации сохраняется. Замена сменного трансивера родительского порта сохраняет NetworkInterface ID. Lifecycle при зависимостях и смене режима OPEN. Исправление ошибочных данных — отдельный случай. |
| L1-O10 | Exact canonical evidence для каждого отдельного member. Группа оценивает members независимо и сверяет полноту с явными ожидаемыми mappings. Резерв сам по себе не ошибка. |

## Обязательные проверочные сценарии

Это acceptance предложения для будущей реализации, не результаты запуска.

| Сценарий | Выразимость сейчас | Что проверять exact L1 trace |
|---|---|---|
| Patch cord | Да, обычный UI/API | member 1→1, Connection/Member refs, после удаления UNKNOWN |
| Многоканальный кабель с перестановкой | Core да; пользовательский цикл нет | Для каждой пары только заданный target, чужие members не соединены, reload |
| Один rear-24 → 24 front | BaseTemplate definitions/materialization реализованы; внешний trunk write и полный пользовательский цикл OPEN | rear i→front i/1, остальные front недостижимы; один внешний trunk Cable |
| Неполное подключение | Core subset да; UI нет | Подключённые пары REACHABLE; пропуски UNKNOWN, не автодополнение |
| Несколько пассивных объектов | Парная цепь да, отдельный passive hop подтверждён тестом | Все hops и refs, точная member identity через каждый объект, разрыв цепи |
| Один сигнал → несколько выходов | Граф выразим, физическая семантика OPEN | До решения нельзя принимать graph REACHABLE за signal split; проверить output→output смысл |
| Кабель с несколькими окончаниями | Как один Cable корректно не выражен | После отдельного решения проверять принятый контракт сборки; текущие pair paths не доказывают принадлежность ветвей одному Cable |

## Последовательность C-CAP-01 — OPEN implementation milestones

C-CAP-01-01 — IMPLEMENTED / MERGED. Строки 02/03/04 сохраняют действующие
обязательные критерии и статус OPEN. Сценарий одного двухточечного trunk
сохраняется независимо от открытой семантики многоконцевых сборок.

Каждый этап требует отдельного implementation contract до выбора DTO, таблиц и
миграций. Порядок 01 → 02 → 03 → 04 сохраняет небольшой scope каждого этапа.

| Этап / цель | Границы | Зависимости | Инварианты | Минимальная приёмка |
|---|---|---|---|---|
| C-CAP-01-01: multichannel definitions/materialization | BaseTemplate capacity и internal mapping; ModuleTemplate continuity отдельная задача | L1-O1–O10; контракт provenance и безопасного reconcile | Stable IDs, immutable revisions, без instance overrides и потери dependencies | Data-driven N, rear-N → N front, permutation/subset после materialization и reload; конфликт reconcile атомарно отклоняется |
| C-CAP-01-02: внешний write/occupancy/lifecycle | Один двухточечный multichannel Cable; create/edit/disconnect | 01; контракт internal/external roles | Одна Cable identity, occupancy по member, internal и external независимы; без автоматического удаления | N:N, permutation/subset; занятый member отклоняет всю операцию; свободный member того же point доступен; disconnect сохраняет internal continuity; reload |
| C-CAP-01-03: пользовательский authoring | Общий механизм internal/external mappings и согласованный UI | 01 и 02; существующие UI patterns | Preview обязателен, сохранение атомарно, presentation не evidence | Прямой/обратный/заданный порядок, ручная коррекция, subset, conflict feedback и reload; без фиктивных портов/Cables |
| C-CAP-01-04: exact trace и групповая приёмка | Member path/evidence, independent group evaluation; интеграционный цикл | 01–03; контракт ожидаемых соответствий | Нет неявного active transit, нет смешения members; REACHABLE не измерение | Rear-24/front-24 с одним внешним trunk, permutation, partial mapping, passive chain и active boundary после reload; резерв не ошибка, пропуск ожидаемой пары виден |

Многоконцевые Cable, PON splitter и специфическая active conversion остаются
отдельными будущими этапами с собственными контрактами, не входят в C-CAP-01.
ModuleTemplate internal continuity также требует отдельного bounded implementation
contract; её готовность не выводится из BaseTemplate и не закрывается этим планом.

## Проверка этой ревизии

Обзор ограничен актуальными документами и исходниками указанной базы; application
code/API/migrations не изменяются. Тесты приложения намеренно не запускаются.
Перед commit обязательны проверка ссылок, git diff --check и GitNexus detect_changes;
FINAL diff остаётся предметом внешней инспекции, не принят автоматически.


## C-CAP-01-01 — definitions и materialization

**IMPLEMENTED / MERGED в scope BaseTemplate.**
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
