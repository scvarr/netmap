# L1 Connectivity — L1-CONTRACT-02

Инвентаризация L1-CONTRACT-01 сохранена; её проверенная база:
`31aa415ca1983af5a0a5270324d99b4bd58369a6` (историческая база инвентаризации).
База консолидации L1-CONTRACT-02: `51353a99a900fb5a0a6bde10ea767f3a9529ff17`.
Это инвентаризация и принятый продуктовый контракт, не новая canonical schema и не
разрешение реализации. FANOUT-1x24 — representative пример независимых каналов.
Действующий контракт: [ARCHITECTURE](ARCHITECTURE.md),
[BACKLOG](BACKLOG.md), [OPEN_DECISIONS](OPEN_DECISIONS.md).

Статусы: IMPLEMENTED — подтверждён пользовательский путь в указанном scope;
CORE ONLY — выразимость core без полноценного authoring;
PARTIAL — реализована часть категории; OPEN — семантика/поддержка не доказана.
Наличие теста ниже означает проверяемое свидетельство, не запуск в этой ревизии.

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
  points cardinality=1 и BaseTemplate internal links 1:1 без Cable.
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

## Матрица механизмов

В таблице «trace» означает exact point/member continuity с evidence, а не
передачу, мощность или протокольную работоспособность сигнала. Ограничения
обычного write и reconcile из предыдущего раздела применяются ко всем строкам.

| Механизм / статус | Физическая семантика и пример | Canonical выразимость | UI/API и authoring/materialization | Lifecycle/reconcile | Trace/evidence и пробел |
|---|---|---|---|---|---|
| Обычное 1:1 — IMPLEMENTED | Patch cord между двумя портами | Два points, один mapping, optional Cable | Обычный create, bulk, disconnect | Атомарный внешний lifecycle | Exact member=1; не доказывает сигнал |
| N:N — CORE ONLY | Независимые волокна MPO trunk | Один Connection с N уникальными mappings | Обычный write и template materialization только 1 | Multichannel editing/reconcile OPEN | Каждый member отдельно; нет пользовательского полного цикла |
| Перестановка — CORE ONLY | Полярность оптического trunk, 1→3, 2→1, 3→2 | Явные пары, не порядок endpoints | Нет общего mapping editor | Сохранение identity при изменении mapping OPEN | Следовать записанной паре, не номеру/геометрии |
| Частичное соответствие — CORE ONLY | Из 12 волокон подключены 4 | Connection cardinality=4, subset point members | Нет multichannel authoring | Отключение одного канала и capacity edits OPEN | Неподключённые members не получают путь |
| N независимых каналов → N points — CORE ONLY | Задний MPO-24 → 24 лицевых гнезда | N Connections от разных rear members к front member=1 | BaseTemplate не материализует rear cardinality=N | Reconcile таких связей OPEN | Exact rear i → front i, без смешения; C-CAP-01 |
| Internal passive — PARTIAL | Проходной адаптер | Same-object Connections без Cable | BaseTemplate 1:1 есть; ModuleTemplate internal materialization не доказана | Добавление 1:1; удаления не выводятся из provenance | Passive chain подтверждена; общий template contract OPEN |
| Патч-панели и кроссы — PARTIAL | Задняя/передняя коммутация | Композиция internal/external continuity | 1:1 путь есть, multichannel core only | Сохранение существующих связей; общая смена распайки OPEN | Все canonical hops; тип «панель» не создаёт связь |
| Муфты, сварки, переходники — PARTIAL | Сварка двух волокон внутри муфты | Парная continuity выражается | Пассивные points/links; специализированный splice workflow не доказан | Отдельный lifecycle сварки не доказан | Путь есть при explicit links; степень требуемой provenance OPEN |
| Реальный splitter — OPEN | Оптический PLC 1:8 | Несколько Connections с общим member технически образуют граф | Полноценный splitter authoring не доказан | Правила общей занятости/изменений OPEN | Reachability не доказывает деление сигнала, потери, направленность |
| Несколько окончаний — OPEN | Один breakout cable с общей оболочкой и тремя концами | Граф пар возможен, один Cable не охватывает несколько Connections | Пользовательский aggregate lifecycle отсутствует в проверенном пути | Текущий Cable identity двухточечный | Нельзя доказать принадлежность всех ветвей одному Cable |
| Сборки и многоточечная среда — OPEN | Жгут; коаксиальная шина с taps | Отдельные парные continuity не доказывают общую среду/сборку | Общий authoring не доказан | Atomic aggregate edits OPEN | Нет доказанной семантики taps/общего носителя |
| Активные границы — PARTIAL | Switch, media converter | Физические endpoints/bindings есть; преобразование не Connection | NETWORK_PORT materialization есть | Endpoint lifecycle есть; контракт преобразования OPEN | L1 не должен создавать transit через активный объект по одному типу |

## Принципиальные границы

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

Cable — identity одного Connection с двумя points. Отсутствие сущности окончания
и aggregate связи нескольких Connections с одним Cable не позволяет заявить
поддержку одного многоконцевого кабеля. Не обходить это фиктивными endpoints,
Cables или геометрическими линиями.

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

## Обязательные проверочные сценарии

Это acceptance предложения для будущей реализации, не результаты запуска.

| Сценарий | Выразимость сейчас | Что проверять exact L1 trace |
|---|---|---|
| Patch cord | Да, обычный UI/API | member 1→1, Connection/Member refs, после удаления UNKNOWN |
| Многоканальный кабель с перестановкой | Core да; пользовательский цикл нет | Для каждой пары только заданный target, чужие members не соединены, reload |
| Один rear-24 → 24 front | Core композиция да; template materialization нет | rear i→front i/1, остальные front недостижимы; один внешний trunk Cable |
| Неполное подключение | Core subset да; UI нет | Подключённые пары REACHABLE; пропуски UNKNOWN, не автодополнение |
| Несколько пассивных объектов | Парная цепь да, отдельный passive hop подтверждён тестом | Все hops и refs, точная member identity через каждый объект, разрыв цепи |
| Один сигнал → несколько выходов | Граф выразим, физическая семантика OPEN | До решения нельзя принимать graph REACHABLE за signal split; проверить output→output смысл |
| Кабель с несколькими окончаниями | Как один Cable корректно не выражен | После решения проверять общую cable identity и ветви; сейчас pair paths этого не доказывают |

## Последовательность C-CAP-01 — OPEN implementation milestones

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
