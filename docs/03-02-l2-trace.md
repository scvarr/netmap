# 03.2 L2 Trace

## Статус

Согласованная концептуальная state machine L2-трассировки.

Эта заметка определяет:

- отличие L2 reachability от trace конкретного Ethernet frame;
- состояния trace engine;
- допустимые типы переходов;
- ветвление;
- правила работы с `NetworkInterfaceRealization`;
- configured/effective режимы;
- условия завершения;
- правила `REACHABLE`, `UNREACHABLE` и `UNKNOWN`;
- требования к completeness/provenance.

Конкретный API, язык реализации и алгоритмическая оптимизация пока не фиксируются.

Связанные заметки:

- [[01-02-network-interface|01.2 NetworkInterface]];
- [[01-03-l2|01.3 L2 — forwarding model]];
- [[01-03-01-l2-binding-encapsulation|01.3.1 L2Binding и Encapsulation]].

## Две разные операции

NetMap не должен смешивать:

```text
L2 Reachability
```

и:

```text
L2 Frame Trace
```

Они используют одну state machine и одни topology facts, но отвечают на разные вопросы.

## L2 Reachability

`L2 Reachability` отвечает:

> существует ли допустимая L2-достижимость между исходной и целевой точкой?

Пример:

```text
может ли NetworkInterface A находиться в одной effective L2-области
с NetworkInterface B?
```

Для этого не требуется выдумывать конкретный destination MAC.

Алгоритм исследует все допустимые forwarding branches согласно выбранному режиму и строит область достижимости.

FDB не должна использоваться как ограничение топологии в этом режиме.

Именно эта операция является основой для вычисляемого:

```text
L2ReachabilityDomain
```

## L2 Frame Trace

`L2 Frame Trace` отвечает:

> куда пойдёт конкретный Ethernet frame?

Для него может потребоваться descriptor:

```text
EthernetFrameDescriptor
    source_mac
    destination_mac
    ...
```

Точный набор полей будет расширяться только при появлении forwarding semantics, которым эти поля реально нужны.

Frame trace может использовать:

- FDB;
- тип destination: known unicast / unknown unicast / broadcast / multicast;
- runtime forwarding state;
- active LAG members;
- другие operational facts.

Следовательно:

```text
Reachability != Frame Trace
```

Отсутствие FDB не мешает вычислять структурную L2 reachability, но может сделать точный frame trace неопределённым.

## Режимы configured и effective

Trace request должен явно иметь семантический режим.

### Configured

```text
mode = configured
```

Использует известную конфигурационную topology и semantic rules.

Временное operational state не должно молча удалять configured paths из этого представления.

Этот режим отвечает примерно на вопрос:

> какой L2-путь допускает известная конфигурация?

### Effective

```text
mode = effective
```

Накладывает на configured topology известное актуальное operational state.

Например:

```text
STP blocked
interface down
LAG member inactive
binding disabled
```

могут убрать переход из effective forwarding graph.

Если необходимое operational state отсутствует или недостаточно достоверно, engine обязан сохранить неопределённость.

Он не должен автоматически считать configured state фактическим.

## Нормализация входа

Пользовательский запрос может начинаться с разных сущностей:

```text
ConnectionPoint
NetworkInterface
L2ForwardingContext
MAC address
```

Canonical L2 state machine не обязана поддерживать все эти формы непосредственно.

Перед запуском trace request нормализуется в одно или несколько начальных L2-состояний.

Например:

```text
ConnectionPoint
    -> L1 resolution
    -> InterfacePhysicalBinding
    -> NetworkInterface
```

или:

```text
MAC
    -> MacBinding / observed facts
    -> NetworkInterface or L2 context
```

Если нормализация сама неоднозначна, эта неопределённость сохраняется в результате.

## Типы состояния

L2 trace использует типизированные состояния, а не один универсальный vertex ID.

Минимально нужны три формы.

## BoundaryState

Состояние frame на boundary `NetworkInterface`:

```text
BoundaryState
    interface_id
    direction
    encapsulation_stack
```

`direction`:

```text
ingress
egress
```

Пример:

```text
BoundaryState(
    interface = Gi1/0/48,
    direction = ingress,
    stack = [dot1q:100]
)
```

Ingress и egress состояния не эквивалентны.

## ContextState

Состояние внутри локального forwarding context:

```text
ContextState
    forwarding_context_id
    ingress_binding_id?
```

`ingress_binding_id` сохраняется, потому что forwarding behavior может зависеть от того, через какой binding frame вошёл в context.

Например это может понадобиться для:

```text
split horizon
не отправлять обратно в ingress
protocol-specific forwarding constraints
```

Если context достигнут через internal injection, ingress binding также может быть известен.

## InternalInterfaceState

Для attachment без wire representation:

```text
InternalInterfaceState
    interface_id
    direction
```

Пример — SVI или другой internal interface.

Такое состояние принципиально не содержит `EncapsulationStack`.

```text
internal != untagged
```

## Payload trace

State machine может нести дополнительный trace payload.

Для reachability это может быть минимальный marker без конкретного MAC.

Для frame trace payload содержит `EthernetFrameDescriptor`.

Payload является частью состояния настолько, насколько его поля влияют на дальнейший forwarding decision.

Это важно для cycle detection и memoization: нельзя объединять состояния, если разные payload дают различное forwarding behavior.

## Основные переходы

Trace engine рассматривает переходы как semantic operations.

Минимальный набор:

```text
INGRESS_DECODE
LOCAL_FORWARD
EGRESS_ENCODE
REALIZATION_UP
REALIZATION_DOWN
PHYSICAL_TRANSPORT
INTERNAL_ATTACH
```

Конкретные имена enum в коде пока не фиксируются.

## INGRESS_DECODE

Переход:

```text
BoundaryState(ingress)
        |
        | match L2IngressRule
        v
L2Binding
        |
        v
ContextState
```

Concrete `EncapsulationStack` сопоставляется effective ingress rules интерфейса.

Возможны результаты:

```text
one match
no match
multiple unresolved matches
unknown because rule coverage is incomplete
```

### One match

Создаётся один `ContextState`.

### No match

Если engine знает, что ingress rules данного interface **полны**, ветка может завершиться как известная недопустимая.

Если completeness не известна, отсутствие найденного rule даёт `UNKNOWN`.

### Multiple unresolved matches

Если несколько rules одновременно подходят и canonical semantics не разрешает их приоритет, ветка становится неопределённой/ambiguous.

Engine не выбирает произвольный context.

## LOCAL_FORWARD

Переход:

```text
ContextState
    |
    | forwarding decision
    v
one or more egress L2Binding
```

`L2 Reachability` и `L2 Frame Trace` работают здесь по-разному.

### Reachability

Исследуются все egress bindings, которые допустимы выбранным configured/effective state.

FDB не сужает этот набор.

### Frame trace

Forwarding decision может использовать frame descriptor и FDB.

Для known unicast при достоверной FDB может быть выбран конкретный egress.

Для broadcast или подтверждённого unknown unicast может быть создано несколько branches.

## FDB completeness

Отсутствие MAC в полученном наборе FDB-записей ещё не означает `unknown unicast`.

Чтобы сделать такой вывод, engine должен знать, что snapshot FDB для соответствующего context достаточно полный и актуальный.

Различаются:

```text
MAC absent in complete/current FDB
```

и:

```text
FDB data unavailable/incomplete/stale
```

В первом случае допустима semantic unknown-unicast forwarding.

Во втором точный frame trace должен сохранить `UNKNOWN`.

## EGRESS_ENCODE

После выбора egress binding:

```text
ContextState
        |
        | L2EgressRule
        v
BoundaryState(egress, concrete stack)
```

Для external binding должен быть получен concrete `EncapsulationStack`.

Если egress encoding необходим, но неизвестен, дальнейший физический trace не должен угадывать stack.

Ветка становится `UNKNOWN`.

## INTERNAL_ATTACH

Для internal binding:

```text
ContextState
        |
        v
InternalInterfaceState(egress)
```

или в обратном направлении:

```text
InternalInterfaceState(ingress)
        |
        v
ContextState
```

Этот переход не создаёт wire stack.

При дальнейшем packet-flow trace internal interface может стать точкой handoff в L3.

Для чистого L2 trace он может быть:

- target;
- граничной точкой результата;
- началом отдельной ветки следующего уровня.

## NetworkInterfaceRealization

`NetworkInterfaceRealization` находится между логической L2 boundary и физикой.

Примеры:

```text
eth0.100 -> eth0
Port-Channel10 -> Eth1
Port-Channel10 -> Eth2
```

Trace engine должен уметь проходить realization graph в обе стороны.

## REALIZATION_UP

Ingress со стороны нижнего интерфейса может подниматься к upper interface:

```text
lower interface
        |
        | realization
        v
upper interface
```

Concrete encapsulation stack сохраняется, если отдельная semantic rule не говорит иначе.

Например:

```text
physical eth0 ingress [dot1q:100]
        |
        v
eth0.100 ingress [dot1q:100]
        |
        | ingress rule
        v
Context A
```

Если у одного lower interface несколько upper interfaces:

```text
eth0
├── eth0.100
└── eth0.200
```

trace может временно разветвиться, после чего ingress rules отфильтруют несовместимые branches.

## REALIZATION_DOWN

На egress upper interface должен быть реализован через lower interface(s):

```text
upper
   |
   v
lower
```

При одном lower переход детерминирован.

При нескольких lower выбор зависит от semantics реализации.

Например для LAG:

```text
Port-Channel10
├── Eth1
└── Eth2
```

`NetworkInterfaceRealization` сам по себе не говорит, какой member понесёт конкретный frame.

## Realization resolver

Для составных interfaces нужен отдельный semantic resolver, использующий:

```text
realization graph
configured member set
operational member state
frame attributes, если они нужны
```

На этом уровне не фиксируется отдельная сущность LAG/LACP.

### Reachability через LAG

Для structural reachability достаточно исследовать активные допустимые members.

Если хотя бы один member гарантированно usable, topology может продолжаться через него.

### Frame trace через LAG

Если конкретный member зависит от hash, а hash semantics или необходимые frame fields неизвестны, exact physical path может остаться `UNKNOWN` или ветвиться как набор возможных paths.

Engine не должен выдавать один произвольный member.

## PHYSICAL_TRANSPORT

Если egress interface имеет `InterfacePhysicalBinding`, trace передаёт управление L1 resolver.

```text
BoundaryState(
    interface A,
    egress,
    stack X
)
        |
        | InterfacePhysicalBinding
        | L1 trace through passive topology
        v
BoundaryState(
    interface B,
    ingress,
    stack X
)
```

Пассивная L1 topology не изменяет `EncapsulationStack`.

L1 resolver должен вернуть:

- найденный следующий active `NetworkInterface`;
- сам физический path как evidence;
- либо причину остановки/неопределённости.

L2 engine не обязан повторно реализовывать алгоритм прохода розеток, патч-панелей, волокон и кабелей.

## Несколько физических ветвей

Если L1 resolution возвращает несколько физически возможных выходов, L2 trace создаёт branches.

Это не означает автоматически, что сеть реально реплицирует frame.

Причина branching сохраняется как часть trace evidence.

## Reachability traversal

Структурная L2 reachability выполняет обход допустимого effective/configured graph:

```text
start
  |
Boundary/Internal state
  |
Context
  |
all permitted egress bindings
  |
realization
  |
L1
  |
next ingress
  |
...
```

Операция может иметь target predicate или работать без target и строить всю достижимую область.

Результат без target может использоваться для вычисления `L2ReachabilityDomain`.

## Frame forwarding classes

Для frame trace минимально различаются:

```text
known unicast
unknown unicast
broadcast
multicast
```

### Known unicast

При достоверной forwarding information может быть выбран конкретный egress или известный набор egress.

### Unknown unicast

При подтверждённом отсутствии destination MAC в полной актуальной FDB применяется unknown-unicast behavior context.

Обычно это приводит к branching/flooding, но конкретная semantic policy context должна быть источником истины.

### Broadcast

Может реплицироваться во множество egress branches.

### Multicast

Точная multicast semantics откладывается.

До появления соответствующей модели engine не должен выдавать выдуманный точный multicast path.

## Branch

Trace result является не обязательно линейным путём, а графом/деревом branches.

Концептуально:

```text
TraceBranch
    steps[]
    termination
    gaps[]
```

Branch может:

- достигнуть target;
- закончиться известным запретом/тупиком;
- остановиться из-за неизвестных данных;
- разветвиться;
- слиться с уже исследованным эквивалентным state;
- обнаружить loop.

## TraceStep

Каждый существенный переход должен быть объясним.

Концептуально:

```text
TraceStep
    from_state
    transition
    to_state
    evidence_refs[]
```

`evidence_refs` могут указывать на:

```text
L2Binding
L2IngressRule
L2EgressRule
L2ForwardingState
FDBEntry
NetworkInterfaceRealization
InterfacePhysicalBinding
L1 Connection path
```

И через них — на provenance/source/observed_at.

Trace engine должен быть способен ответить:

> почему ты считаешь этот переход допустимым?

## Termination reason

Причина окончания ветки хранится отдельно от общего verdict.

Примеры:

```text
TARGET_REACHED
NO_INGRESS_MATCH
FORWARDING_BLOCKED
NO_EGRESS
L1_DEAD_END
NO_ACTIVE_REALIZATION_MEMBER
MISSING_DATA
CONFLICTING_DATA
LOOP_DETECTED
LAYER_HANDOFF
SEARCH_LIMIT
```

Список может расширяться.

Эти причины не являются глобальным ответом на reachability.

## Почему BLOCKED не verdict

Например:

```text
         path A -- STP blocked
source <
         path B ---------------- target
```

Общий результат:

```text
REACHABLE
```

при этом одна branch имеет:

```text
termination = FORWARDING_BLOCKED
```

Поэтому `BLOCKED` не должен заменять общий verdict.

## Общий verdict

Верхнеуровневый результат L2 reachability использует три значения:

```text
REACHABLE
UNREACHABLE
UNKNOWN
```

## REACHABLE

Есть полностью подтверждённый допустимый путь до target в семантике выбранного query/mode.

Путь не должен зависеть от неразрешённого missing/conflicting fact на самой доказательной цепочке.

## UNREACHABLE

Engine исследовал все релевантные possibilities и может доказать отсутствие пути.

Это значение разрешено только при достаточной completeness данных для отрицательного вывода.

Пример:

```text
ingress rules complete
stack [100] не совпадает ни с одним rule
```

может дать известную остановку.

Но просто:

```text
в базе нет ingress rule
```

без completeness assertion недостаточно для `UNREACHABLE`.

## UNKNOWN

Engine не может доказать ни `REACHABLE`, ни `UNREACHABLE`.

Типичные причины:

```text
missing configuration
unknown operational state
stale required observation
incomplete FDB
unresolved ingress ambiguity
unknown LAG member semantics
unknown L1 continuation
search/resource limit
```

`UNKNOWN` является нормальным и полезным результатом, а не ошибкой алгоритма.

## Ambiguity

`AMBIGUOUS` лучше хранить как condition/flag или branch reason, а не как четвёртый reachability verdict.

Например два conflicting ingress rules могут породить:

```text
verdict = UNKNOWN
flag = AMBIGUOUS
```

Если при этом существует независимый полностью подтверждённый путь, engine может вернуть `REACHABLE` и отдельно показать конфликт в другой branch.

Точная агрегация complex ambiguities может уточняться при реализации.

## Completeness / coverage

Чтобы отличать:

```text
факт отсутствует
```

от:

```text
подтверждено, что такого факта нет
```

NetMap потребуется cross-cutting модель coverage/completeness.

Примеры возможного coverage:

```text
полная L2-конфигурация interface
полный список L2 bindings context
полная L1 connectivity конкретного ConnectionPoint
полная FDB snapshot context на момент T
полный operational member state LAG
```

Точная сущность будет определена в ветке источников данных.

Инвариант уже фиксируется:

> Отрицательный вывод нельзя строить только на отсутствии записи, если completeness соответствующего набора facts неизвестна.

## Freshness

Operational facts имеют время наблюдения.

Effective trace должен учитывать, что:

```text
observed_at = T
```

не означает вечную актуальность.

Конкретная политика freshness зависит от типа источника и факта и будет определена позже.

Если факт необходим для точного effective trace, но считается stale, результат должен деградировать в `UNKNOWN` или явно показывать использование stale evidence согласно выбранной политике.

Backend не должен незаметно выдавать старое состояние за текущее.

## Cycle detection

Broadcast topology, ошибочная конфигурация или неполное operational state могут создавать циклы.

Trace engine обязан иметь cycle detection.

Эквивалентность state должна учитывать все поля, влияющие на дальнейшее forwarding:

```text
state kind
interface/context identity
direction
encapsulation stack
relevant payload
relevant ingress binding
```

Если тот же semantic state повторно встречается в branch, дальнейший бесконечный обход не нужен.

Ветка может завершиться/слиться с:

```text
LOOP_DETECTED
```

или уже исследованным state.

## Search limits

Кроме semantic cycle detection реализация должна иметь защитные limits:

```text
max states
max branches
max depth
```

Конкретные значения не являются частью domain model.

Если limit исчерпан до доказательства результата, engine **не имеет права** возвращать `UNREACHABLE`.

Результат:

```text
UNKNOWN
reason = SEARCH_LIMIT
```

## Deduplication и merge

При flooding несколько branches могут прийти в один и тот же semantic state.

Engine может объединять такие ветви для предотвращения combinatorial explosion.

При этом provenance альтернативных путей не должен теряться.

То есть internal execution graph может быть DAG, даже если пользовательская визуализация показывает дерево.

## Порядок поиска

BFS, DFS, bidirectional search, precomputed components и другие оптимизации не являются частью семантики.

Корректный результат не должен зависеть от порядка обхода.

Для пользовательского объяснения backend может дополнительно выбирать:

```text
shortest path
fewest active devices
fewest unknown segments
```

как ranking уже найденных paths.

Это отдельная политика представления результата.

## Target predicate

Target не обязан быть только exact interface ID.

Концептуально trace engine может завершать branch по predicate:

```text
specific NetworkInterface
specific L2ForwardingContext
specific internal interface
resolved MAC attachment
любая точка, удовлетворяющая query
```

Точная API-модель target будет определена при проектировании сервиса трассировки.

## L2ReachabilityDomain через trace engine

`L2ReachabilityDomain` не требует отдельного алгоритма истины.

Он может строиться как результат reachability traversal без конкретного target:

```text
start Context A
    |
explore all known permitted transitions
    |
set of reachable local contexts
```

Так domain остаётся derived projection тех же rules, которые используются обычной трассировкой.

Это предотвращает расхождение:

```text
карта говорит, что contexts связаны
trace engine говорит, что не связаны
```

Обе функции должны использовать одну semantic core.

## Configured vs effective domain

По той же причине возможны две derived проекции:

```text
ConfiguredL2ReachabilityDomain
EffectiveL2ReachabilityDomain
```

Они могут отличаться при:

```text
STP
disabled links
inactive LAG members
runtime failures
```

Названия concrete сущностей/кэшей пока не фиксируются.

## Связь с будущим L3 trace

Internal interface может стать handoff point:

```text
L2 Context
    |
SVI / routed NetworkInterface
    |
L3
```

L2 trace на таком переходе не должен сам выполнять routing.

Он возвращает:

```text
LAYER_HANDOFF
```

или достижение target, если internal interface являлся целью.

Будущий packet-flow engine сможет композиционно вызвать:

```text
L2 resolver
-> L3 resolver
-> Security resolver
-> next L2 resolver
```

без смешивания всех правил в один гигантский алгоритм.

## Объяснимость результата

Trace output должен содержать не только линию на карте, но и reasoning data уровня facts.

Например:

```text
SW1/Gi48 [100]
    -- ingress rule R17 -->
Context A
    -- effective forwarding -->
SW1/Po10 [100]
    -- active member Eth2 -->
L1 path ...
    -- ingress rule R91 -->
Context B
```

Для остановки:

```text
UNKNOWN at SW2/Gi17
reason:
    L2 configuration coverage unknown
known path:
    source -> ... -> SW2/Gi17
```

Это является основой будущей пользовательской инструкции и диагностики.

## Инварианты

1. `L2 Reachability` и `L2 Frame Trace` являются разными операциями.
2. Reachability не использует FDB как ограничение структурной L2 topology.
3. Frame trace может использовать FDB и frame descriptor.
4. Trace имеет явный `configured` или `effective` режим.
5. State machine различает ingress и egress boundary.
6. Internal attachment не имеет `EncapsulationStack`.
7. `NetworkInterfaceRealization` проходится отдельно от L2 binding.
8. Realization transition по умолчанию сохраняет concrete frame representation.
9. При нескольких lower interfaces exact member нельзя угадывать.
10. Пассивный L1 path сохраняет concrete encapsulation.
11. Trace result может ветвиться.
12. Каждая существенная transition должна иметь evidence.
13. Branch termination reason отделён от общего verdict.
14. Общий reachability verdict: `REACHABLE`, `UNREACHABLE` или `UNKNOWN`.
15. `UNREACHABLE` требует достаточной completeness для отрицательного вывода.
16. Отсутствие записи без coverage не является доказательством отсутствия пути.
17. Ambiguity/conflict не разрешается произвольным выбором.
18. Operational facts должны учитывать freshness.
19. Cycle detection обязателен.
20. Search limit не может приводить к ложному `UNREACHABLE`.
21. `L2ReachabilityDomain` должен использовать ту же semantic core, что и trace engine.
22. L2 resolver заканчивает работу на L3 handoff и не выполняет routing самостоятельно.

## Открытые вопросы

Следующие вопросы должны уточняться только при появлении соответствующих сценариев:

- точная API-модель `TraceRequest` и `TraceResult`;
- формальная сущность coverage/completeness;
- freshness policy для разных observed facts;
- структура runtime LAG/LACP member state;
- структура STP/RSTP/MSTP state;
- точная FDB model и aging;
- multicast forwarding;
- ranking нескольких найденных paths;
- cache/invalidation derived reachability domains;
- overlay handoff: VXLAN/EVPN и L3 underlay;
- граница между trace engine и security policy engine.

Следующим логичным шагом после этой state machine является определить минимальный operational state, реально необходимый для `effective L2 trace`: прежде всего LAG/LACP и STP.
