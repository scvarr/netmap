# 05. Представление и UX

## Статус

Рабочий presentation contract NetMap.

Эта заметка фиксирует уже согласованные принципы визуального представления и interaction model, не превращая текущие идеи компоновки в окончательный pixel/UI specification.

Статусы решений в этой заметке:

```text
FIXED
    согласованный UX/presentation invariant;

WORKING HYPOTHESIS
    предпочтительное текущее решение, которое нужно проверить визуальным прототипом;

OPEN
    вопрос сознательно оставлен до появления реального UI/fixture.
```

Связанные заметки:

- [[02-03-derived-graphs|02.3 Derived graphs и evidence]];
- [[02-04-projections-aggregation|02.4 Projections и aggregation]];
- [[03-02-l2-trace|03.2 L2 Trace]];
- [[03-03-l3-trace|03.3 L3 Trace]];
- [[03-04-packet-flow-trace|03.4 Packet Flow Trace]];
- [[00-implementation-constraints|00. Ограничения реализации]].

## Назначение UI

**FIXED**

NetMap UI предназначен не только для просмотра красивой topology map.

Основная пользовательская задача:

> понять, как устроена сеть, проверить прохождение traffic и быстро увидеть точку, где доказанный путь заканчивается, блокируется или становится неопределённым.

UI является presentation/read layer.

Базовая цепочка остаётся:

```text
canonical facts
    -> EvaluationView
    -> resolvers
    -> TraceArtifact / Evidence DAG
    -> Projection
    -> UI
```

UI не создаёт параллельную topology model и не становится source of truth.

## Язык интерфейса

**FIXED**

Пользовательский интерфейс NetMap по умолчанию русскоязычный.

На английском остаются:

- общепринятые сетевые обозначения;
- protocol/vendor terms, которые естественнее читаются в исходной форме;
- технические идентификаторы;
- machine-readable codes в расширенных технических деталях.

Примеры терминов, которые обычно не переводятся:

```text
L1 / L2 / L3
VLAN
MAC
NAT
TCP/443
VRF
ECMP
FDB
interface names
vendor rule IDs
```

Backend enum/code не должен автоматически становиться основной пользовательской подписью.

Например:

```text
POLICY_ORDER_INCOMPLETE
```

может быть показан в технических деталях, но основное сообщение пользователю должно быть сформулировано естественно, например:

```text
Недостаточно данных о порядке применения правил.
```

## Topology является projection

**FIXED**

Любой объект, показанный на topology scene, является presentation object / projection result.

Он может представлять:

- один canonical object;
- несколько canonical objects;
- один exact relation;
- aggregate нескольких relations/path fragments;
- часть TraceArtifact.

Aggregate presentation object не становится canonical network entity.

Aggregate edge не должен визуально или семантически утверждать наличие одного canonical `Connection`, если он на самом деле представляет несколько supporting paths/relations.

По запросу пользователя meaningful aggregate должен раскрываться до supporting canonical/evidence refs.

## Layer и detail независимы

**FIXED**

Выбор network layer и степень детализации являются независимыми измерениями UI state.

Недопустима жёсткая модель:

```text
zoom out = L3
zoom in  = L2
zoom max = L1
```

Допустимы, например:

```text
L1 / site overview
L1 / exact fiber member

L2 / site overview
L2 / interface detail

L3 / site overview
L3 / route/next-hop detail
```

При смене layer UI по возможности сохраняет:

- текущий scope;
- выбранный объект;
- активный trace;
- выбранный trace step/frontier;
- detail/aggregation level.

Смена projection не означает запуск нового trace.

## Hide и collapse

**FIXED**

UI различает:

```text
hide
    объект не показывается в текущем presentation;

collapse
    объект участвует в aggregate presentation object.
```

Если скрытые intermediate entities входят в показанный trace/path, предпочтителен `collapse`, потому что он сохраняет объяснимость.

Collapsed path должен иметь возможность раскрыться до supporting path/evidence.

## Основной рабочий экран

**WORKING HYPOTHESIS**

Основной интерфейс NetMap рассматривается как единое рабочее пространство исследования сети, а не как набор полностью изолированных экранов.

Topology остаётся главным пространственным контекстом.

На ней могут существовать:

- поиск/переход к объекту;
- выбор source/destination;
- layer selector;
- detail/aggregation control;
- текущий configured/effective/time context;
- trace overlay;
- краткая информация по выбранному объекту или проблемной точке.

Точная компоновка панелей, inspector и controls пока не фиксируется.

## Простая трассировка на основном экране

**FIXED как interaction direction; внешний вид остаётся WORKING HYPOTHESIS**

Обычная трассировка должна запускаться просто.

Пользователь:

1. выбирает или ищет источник;
2. выбирает или ищет назначение;
3. при необходимости задаёт packet/flow параметры;
4. запускает трассировку.

Conceptual control:

```text
[ Откуда ] -> [ Куда ]   [ TCP/443 ]   [ Трассировать ]
```

Источник и назначение можно выбирать не только через отдельную форму, но и непосредственно из topology context.

После запуска результат показывается поверх текущей projection как trace overlay.

UI не должен автоматически переводить пользователя на максимальную детализацию только потому, что trace содержит интерфейсы/правила/кабели.

## Анимация trace

**WORKING HYPOTHESIS**

Для быстрого чтения результата trace overlay может использовать анимацию движения marker/"огонька" по подтверждённой части пути.

Цель анимации не декоративная.

Она должна быстро показать:

- откуда начинается flow;
- по какой части topology он подтверждённо проходит;
- где достигает target;
- где встречает известный terminal blocker;
- где заканчивается доказательная цепочка.

UI не обязан анимировать каждую Evidence DAG transition буквально.

Collapsed segment может визуально представлять несколько underlying trace steps.

## Подробная трассировка

**FIXED**

Помимо простого overlay должен существовать отдельный detailed trace view / режим подробной трассировки.

Основной topology screen не обязан постоянно показывать все:

- route lookups;
- recursive next-hop resolution;
- security stages;
- matched rules;
- NAT transformations;
- PacketState lineage;
- evidence refs;
- warnings;
- conflicting branches;
- gaps.

Подробная трассировка предназначена для причинного анализа результата.

Она должна уметь представить TraceArtifact в удобной человеку форме, не обязательно как буквальный DAG.

Пример conceptual detail:

```text
source
  -> L2 path
  -> FW01
       security rule 17: PERMIT
       DNAT rule 40
       route selected
       security rule 153: PERMIT
       SNAT: identity
  -> next L2 segment
  -> destination
```

## Topology и evidence graph не одно и то же

**FIXED**

Evidence DAG не должен автоматически рисоваться как основной topology graph.

UI визуально различает как минимум:

- topology objects;
- network/packet states;
- decisions;
- transformations;
- terminal outcomes;
- unknown frontiers.

Но presentation может сворачивать несколько evidence nodes в один понятный processing step.

Например firewall на topology может оставаться одним topology object, а подробный trace раскрывает stages, которые packet прошёл внутри него.

## Security, routing и NAT в presentation

**FIXED**

Security rules, route decisions и NAT transformations не обязаны становиться постоянными topology nodes.

Предпочтительное представление при trace:

```text
FW01
    security ...
    DNAT ...
    route ...
    security ...
    SNAT ...
```

Конкретный порядок stages берётся из TraceArtifact / PacketProcessingPlan semantics и не придумывается UI.

PacketState до и после NAT являются различными states и в detailed trace должны быть различимы, когда это нужно для объяснения решения.

## Результаты trace нельзя сводить к красному/зелёному

**FIXED**

UI обязан различать как минимум:

```text
CONFIRMED / DELIVERED / REACHABLE
KNOWN BLOCK / NOT DELIVERED / UNREACHABLE
UNKNOWN / недостаточно данных
STALE DATA
CONFLICTING DATA
MODEL/INTERNAL ERROR
```

Конкретные пользовательские подписи могут зависеть от trace kind.

Один generic красный marker для всех отрицательных/неполных состояний недопустим.

## UNKNOWN не означает отсутствие пути

**FIXED**

Ключевой UX-инвариант:

```text
UNKNOWN != UNREACHABLE
```

Если trace дошёл до `FW02`, но дальнейшая security evaluation невозможна из-за неполного snapshot, UI не должен показывать это как обрыв кабеля, отсутствующую topology relation или доказанный DROP.

Underlying topology за точкой UNKNOWN может оставаться видимой.

Trace overlay заканчивается в месте, где заканчивается доказанная цепочка.

## Unknown frontier

**FIXED**

`unknown_frontier` является первой-class presentation concept.

Frontier отвечает на вопрос:

> до какого места NetMap смог доказать прохождение и почему анализ нельзя корректно продолжить дальше?

Для frontier UI должен иметь возможность показать:

- location / processing point;
- human-readable reason;
- machine-readable gap code в technical details;
- какие данные уже известны;
- какие данные отсутствуют/неполны/устарели/конфликтуют;
- `required_fact_scope`, если backend его предоставляет;
- evidence/provenance refs;
- какое действие по сбору данных потенциально позволит продолжить анализ.

Визуальный marker frontier не должен совпадать с known blocker marker.

## Known blocker

**FIXED**

Если trace доказанно завершается отрицательно, UI показывает terminal outcome как известный результат.

Примеры:

```text
security DROP/REJECT
NO_ROUTE с достаточной completeness
route DISCARD
L2 unreachable
loop detected
```

Known blocker визуально отличается от UNKNOWN frontier.

Краткая карточка должна по возможности показать first known blocker и дать переход к detailed trace/evidence.

## Technical error отдельно

**FIXED**

`MODEL_ERROR`, validation failure и internal execution error не отображаются как network `UNKNOWN`.

Пользователь должен понимать разницу между:

```text
NetMap корректно выполнил trace и данных недостаточно
```

и:

```text
NetMap не смог корректно выполнить trace из-за ошибки модели/системы
```

## Source/destination selector шире topology node

**FIXED**

Поля `Откуда` и `Куда` не ограничиваются только визуальными topology nodes.

В качестве selector могут выступать, в зависимости от поддерживаемого trace kind:

- конкретный объект;
- NetworkInterface / binding;
- IP address;
- MAC address;
- routing context;
- subnet/prefix;
- reusable normalized address set / vendor address-list projection;
- иные явно поддерживаемые selectors.

Selector не обязан становиться canonical topology entity только ради UI.

## Prefix и address set не обязаны быть topology node

**FIXED**

Подсеть/prefix или address list могут отображаться как aggregate/source selector в UI, но из этого не следует, что backend должен создавать для них искусственный physical/network topology node.

Presentation может показать такой selector как один aggregate visual object, если это удобно для trace result.

## Group / aggregate trace

**FIXED как interaction semantics; конкретный backend API остаётся будущим implementation вопросом**

Проверка source selector, содержащего множество адресов, не означает обязательный trace каждого адреса.

NetMap должен стремиться построить небольшой набор **репрезентативных concrete packet cases**.

Базовая идея:

```text
source selector
    -> relevant semantic partition
    -> one concrete witness per relevant non-empty class
    -> ordinary Packet Flow Trace x N
    -> aggregate presentation result
```

Таким образом group trace остаётся объяснимым через обычные concrete traces.

## Representative classes

**FIXED**

Репрезентативные случаи формируются не просто по принципу:

```text
один адрес из подсети
один адрес из каждого address list
```

Потому что один адрес может одновременно принадлежать нескольким relevant sets.

Различаться должны комбинации membership, которые могут изменить routing/security/NAT outcome для исследуемого flow.

Пример:

```text
S = 192.168.0.0/24
N = NO_INTERNET
A = ADMINS
```

Если все варианты реально существуют и relevant для данного flow, могут понадобиться классы:

```text
S без N и A
S ∩ N без A
S ∩ A без N
S ∩ N ∩ A
```

Каждый такой класс может иметь свой concrete witness address.

## Только relevant membership

**FIXED**

Group trace не должен строить комбинаторное произведение всех address sets, известных NetMap.

Membership учитывается только если он потенциально влияет на semantics исследуемого flow, например участвует в:

- security predicates;
- NAT predicates;
- routing/policy decisions;
- иных processing stages конкретного trace.

Нерелевантный для данного flow address list не должен создавать дополнительный representative case.

## Witness address

**FIXED**

Каждый representative class, который NetMap заявляет как проверенный concrete scenario, должен иметь конкретный witness address и достаточный origin/context для запуска обычного Packet Flow Trace.

При этом canonical address set сам по себе не обязан содержать перечисленный individual host/address только ради UI.

Требование относится к проверяемому representative case, а не к форме хранения canonical address set.

Если NetMap не может получить корректный witness для relevant non-empty class, он не должен молча считать этот класс проверенным.

## Пример group trace

**FIXED как reference scenario**

Пользователь хочет проверить:

```text
source: 192.168.0.0/24
purpose: Internet access
expected/interesting gateway or processing point: 192.168.42.42
```

Также существует address list:

```text
NO_INTERNET
```

и, например, дополнительный list:

```text
SPECIAL
```

NetMap может выделить representative cases вроде:

```text
обычный адрес subnet
адрес subnet ∩ NO_INTERNET
адрес subnet ∩ SPECIAL
адрес subnet ∩ NO_INTERNET ∩ SPECIAL
```

но только для реально существующих и relevant combinations.

Каждый case трассируется concrete packet trace.

На основном экране результат может оставаться aggregate:

```text
192.168.0.0/24 -> Internet

частично доступно

3 сценария проходят
1 сценарий заблокирован
```

По переходу в details пользователь видит representative cases, witness addresses и причины различий.

## Aggregate group result не заменяет individual evidence

**FIXED**

Aggregate result group trace является presentation/read result.

Он не должен терять individual verdicts/evidence.

Например summary:

```text
3 PASS
1 BLOCKED
1 UNKNOWN
```

не означает, что source selector имеет один canonical status.

Пользователь должен иметь возможность раскрыть каждый distinct representative outcome.

## Aggregation не скрывает uncertainty

**FIXED**

Если representative cases дают:

```text
3 delivered
1 unknown
```

aggregate UI не должен показывать просто:

```text
доступно
```

без индикатора uncertainty.

То же относится к conflicting/stale cases.

## Отдельный detailed group view

**WORKING HYPOTHESIS**

Для group trace подробный экран может сначала группировать cases по outcome/reason, а не показывать длинный список почти одинаковых трасс.

Например:

```text
Проходят
    обычные адреса
    SPECIAL

Заблокированы
    NO_INTERNET
        FW01 rule 31

Недостаточно данных
    NO_INTERNET + SPECIAL
        policy snapshot partial
```

После этого пользователь раскрывает concrete witness trace.

## Визуальное представление group selector

**WORKING HYPOTHESIS**

На topology scene subnet/address set может показываться как один aggregate source object с summary результатов.

Не требуется постоянно рисовать N одинаковых линий для N representative cases.

Например:

```text
192.168.0.0/24
4 сценария
    |
    +--> common path --> FW01
                         |
                         +--> 3 PASS
                         +--> 1 BLOCKED
```

Distinct branches раскрываются по запросу пользователя.

## Ручной ввод и постепенное уточнение модели

**FIXED**

Ручной ввод NetMap не требует сначала построить полную иерархию сети сверху вниз.

Пользователь может создать минимально описанный объект, сразу работать с ним, а позднее добавить контекст:

```text
создать объект
    -> добавить дочерние physical objects
    -> добавить ConnectionPoint
    -> добавить NetworkInterface
    -> связать интерфейс с физикой
    -> указать местоположение
    -> дополнить metadata
```

Порядок этих действий не является обязательным workflow. Пользователь добавляет только те факты, которые известны сейчас.

Частично описанный standalone object является нормальным состоянием модели, а не ошибкой или незавершённым wizard step.

### Иерархия не является условием существования объекта

**FIXED**

Не требуется workflow вида:

```text
площадка
    -> здание
        -> этаж
            -> помещение
                -> стойка
                    -> устройство
                        -> модуль
                            -> порт
```

до того, как можно сохранить нижележащий объект.

Допустим обратный процесс:

```text
NIC-01
    -> позже помещён в Server-01

Server-01
    -> позже расположен в Rack R12 / Unit 17

Rack R12
    -> позже включён в дерево Location
```

Пользователь может остановиться на любом уровне детализации и продолжать работать с уже известными объектами.

### Physical composition и Location остаются разными операциями

**FIXED**

UI может использовать естественные человеку действия вроде:

```text
поместить NIC-01 в Server-01
расположить Server-01 в Rack R12 / Unit 17
```

но они не должны сливаться в одну canonical relation.

Физическая композиция:

```text
Server-01
└── NIC-01
```

означает `PhysicalObject.parent_object`.

Местоположение:

```text
Площадка
└── Здание
    └── Этаж
        └── Помещение
            └── Стойка R12
                └── Unit 17
```

с размещённым там `Server-01` относится к `Location`.

Стойка, помещение, этаж и здание не обязаны становиться `parent_object` устройства только потому, что пользователь визуально помещает устройство внутрь них.

### Работа с атомарным уровнем

**FIXED**

Пользователь должен иметь возможность работать с максимально низким practically useful уровнем, не создавая заранее всю окружающую структуру.

В L1 canonical atom физического соединения — `ConnectionPoint`, но он принадлежит `PhysicalObject`.

UI не должен создавать orphan `ConnectionPoint` только ради удобства формы.

Если пользователь начинает фактически с одной точки подключения, UI может одной high-level операцией создать минимальный owning `PhysicalObject` и его `ConnectionPoint`, не заставляя пользователя вручную проходить две отдельные backend-формы.

Позднее этот owning object может быть помещён в более крупный physical object или получить Location без изменения identity созданной точки.

### NetworkInterface не равен физической точке

**FIXED**

Ручной UI не должен сливать:

```text
ConnectionPoint
NetworkInterface
```

в одну canonical сущность.

`NetworkInterface` можно создать до того, как известна его физическая реализация.

Физическую привязку можно добавить позднее через существующую semantics `InterfacePhysicalBinding` / `NetworkInterfaceRealization`.

При этом UI может предложить удобный составной workflow для типичного active port, но результат должен оставаться набором явных canonical facts.

### Минимальное создание объекта

**FIXED как interaction principle; конкретная форма остаётся OPEN**

Создание `PhysicalObject` не должно требовать заполнения полей, которые не являются обязательными canonical facts.

Минимальный UI должен позволять создать объект с человекочитаемым именем/alias и доступной на данный момент metadata.

Поля вроде:

```text
class
vendor
model
inventory_id
role
```

не должны становиться обязательными только ради формы.

Позднее возможны templates/presets:

```text
сервер
коммутатор
сетевая карта
патч-панель
SFP
кабель
```

но preset является удобством UI и не создаёт новый фундаментальный backend type.

### Общий принцип progressive modeling

**FIXED**

Иерархия организует уже известные объекты, но не является условием их существования.

NetMap должен позволять:

```text
сохранить то, что известно сейчас
    -> использовать это в доступных projections/traces
    -> позднее добавить недостающий контекст
```

без необходимости пересоздавать объект или менять его identity.

## Location как произвольное дерево местоположений

**FIXED**

UI использует ту же базовую модель местоположений, что и canonical backend:

```text
Location
    id
    parent_id?
    path
```

Иерархические уровни не зашиваются в UI или schema как обязательные типы:

```text
здание
этаж
помещение
стойка
unit
```

Это обычные узлы одного произвольного дерева. Человекочитаемое название, класс и дополнительный смысл задаются aliases/metadata.

Допустимы структуры любой формы, например:

```text
Площадка
└── Здание
    └── Этаж
        └── Кабинет 101
```

или:

```text
Площадка
└── Улица
    └── Колодец 17
        └── Муфта 17-3
```

UI не должен предполагать фиксированную глубину или допустимую последовательность классов Location.

### Location можно создать без родителя

**FIXED**

Как и PhysicalObject, Location поддерживает progressive modeling.

Если пользователь сейчас знает только:

```text
Кабинет 101
```

он может создать этот Location как корневой узел и сразу размещать в нём известные объекты.

Позднее существующий узел можно встроить в более полную иерархию:

```text
Главный корпус
└── 2 этаж
    └── Кабинет 101
```

и затем, например:

```text
Мурманск
└── Площадка 1
    └── Главный корпус
        └── 2 этаж
            └── Кабинет 101
```

Перемещение Location в дереве не меняет его stable identity.

PhysicalObject, ConnectionPoint и другие сущности, которые уже ссылаются на этот Location, не должны требовать ручной перепривязки только из-за изменения его parent/path.

### Базовые действия с Location

**FIXED как interaction direction; конкретная форма остаётся OPEN**

UI должен позволять как минимум:

```text
создать Location
выбрать optional parent
переименовать
изменить metadata/class
переместить в другой parent
создать дочерний Location
выбрать Location при размещении объекта
```

Выбор местоположения должен поддерживать поиск и просмотр дерева.

Создание нового Location должно быть доступно непосредственно из workflow, где пользователь назначает объекту местоположение; не требуется заранее переходить в отдельный административный раздел и строить полное дерево.

## Что пока не фиксируется

**OPEN**

До первого визуального прототипа сознательно не фиксируются:

- конкретный frontend framework;
- точная компоновка topology/inspector/detail panels;
- постоянный или временный Trace Strip;
- конкретные цвета;
- конкретные формы иконок `UNKNOWN`, `BLOCKED`, `STALE`, `CONFLICT`;
- точная анимация trace marker;
- способ отображения больших ECMP/LAG/branch sets;
- способ layout topology при очень больших scopes;
- автоматический или пользовательский выбор witness address;
- механизм подтверждения, что representative class непуст;
- точный API group trace;
- symbolic trace без concrete witness;
- сравнение traces/config states;
- editing UI.

Эти решения должны проверяться на конкретных network fixtures и прототипах, а не определяться заранее только из текста.

## UX-инварианты

1. UI является projection/read layer, а не source of truth.
2. Presentation objects не становятся canonical entities автоматически.
3. Layer и detail/aggregation являются независимыми измерениями.
4. Смена layer не запускает новый trace и по возможности сохраняет investigation context.
5. Collapse сохраняет supporting path/evidence; hide и collapse различаются.
6. Основная трассировка должна запускаться простым выбором source/destination.
7. Trace показывается overlay поверх текущей topology projection.
8. Полный Evidence DAG не обязан отображаться буквально на основной карте.
9. Для причинного анализа существует отдельный detailed trace view.
10. Security/routing/NAT decisions могут отображаться как processing stages внутри hop/device context.
11. `UNKNOWN != UNREACHABLE/BLOCKED` визуально и текстово.
12. Unknown frontier показывает границу доказанного знания, а не обрыв underlying topology.
13. Known blocker, UNKNOWN, stale/conflict и system/model error различаются.
14. Пользователь должен иметь возможность понять, какие данные нужны для продолжения UNKNOWN trace.
15. Source/destination selector не ограничен topology nodes.
16. Prefix/address set может быть aggregate selector без создания искусственной canonical topology entity.
17. Group trace строится через ограниченный набор relevant representative concrete cases, а не обязательный перебор всех адресов.
18. Representative classes учитывают relevant пересечения memberships.
19. Каждый проверяемый representative class имеет concrete witness address/context.
20. Aggregate group result сохраняет individual verdict/evidence и не скрывает UNKNOWN/conflict.
21. Пользовательский интерфейс по умолчанию русскоязычный; технические общепринятые термины могут оставаться на английском.
22. Детали layout/визуального языка фиксируются только после проверки прототипом.
23. Ручной ввод не требует построения hierarchy сверху вниз.
24. Standalone и частично описанный объект является нормальным состоянием.
25. Объект можно позднее включить в physical composition и/или Location без изменения его identity.
26. Physical composition и Location являются разными пользовательскими операциями и разными canonical relations.
27. UI может начинать работу с атомарного уровня, но не создаёт orphan ConnectionPoint без owning PhysicalObject.
28. NetworkInterface и ConnectionPoint не сливаются; физическую реализацию интерфейса можно добавить позднее.
29. Templates/presets являются удобством ввода и не создают новые фундаментальные backend types.
30. Пользователь должен иметь возможность сохранять известные сейчас факты и постепенно уточнять модель.
31. Location является произвольным деревом stable-ID узлов без захардкоженных уровней.
32. Название, класс и смысл Location задаются aliases/metadata и не определяют его identity.
33. Location можно создать без родителя и позднее встроить в дерево без изменения identity и ручной перепривязки размещённых объектов.
34. Новый Location можно создать непосредственно из workflow назначения местоположения.
