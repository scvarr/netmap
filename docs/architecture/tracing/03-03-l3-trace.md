# 03.3 L3 Trace

## Статус

Согласованная концептуальная state machine L3-трассировки.

Она определяет:

- разницу между `L3 Reachability` и `IP Packet Trace`;
- нормализацию origin и destination;
- routing-context normalization и explicit selected-table boundary;
- route lookup и longest-prefix match;
- configured/effective routing views;
- recursive next-hop resolution;
- ECMP branching;
- neighbor resolution;
- L3 -> L2 handoff;
- переход к следующему routing context;
- terminal outcomes;
- общий verdict `REACHABLE / UNREACHABLE / UNKNOWN`;
- cycle detection, completeness и explainability.

NAT и firewall/security processing этой state machine не выполняются. Они будут добавлены композиционно в `Packet Flow Trace`.

Связанные заметки:

- [[architecture/l3/01-04-l3|01.4 L3 — routing model]];
- [[architecture/l3/01-07-policy-routing|01.7 Policy Routing]];
- [[architecture/tracing/03-02-l2-trace|03.2 L2 Trace]];
- [[architecture/l2/01-03-03-mac-fdb|01.3.3 MAC и FDB]];
- [[architecture/l2/01-03-02-l2-operational-state|01.3.2 L2 Operational State]].

## Две операции

Как и на L2, нужно различать:

```text
L3 Reachability
```

и:

```text
IP Packet Trace
```

Они используют одну routing semantic core, но требуют разной точности observed state.

## L3 Reachability

Отвечает:

> существует ли подтверждённый L3-путь от origin к destination IP в выбранном configured/effective представлении?

Это структурный запрос.

Он может:

- исследовать все допустимые ECMP next hops;
- использовать известные `InterfaceAddress`/next-hop identities;
- проверять L2-достижимость между L3 attachments;
- не требовать уже существующей ARP/NDP cache entry;
- возвращать несколько допустимых branches.

L3 reachability не утверждает, что firewall разрешит traffic.

## IP Packet Trace

Отвечает:

> как будет форвардиться конкретный IP packet?

Для него требуется `IPPacketDescriptor`.

Минимально:

```text
IPPacketDescriptor
    source_ip?
    destination_ip
    address_family
```

Позднее packet descriptor может включать:

```text
protocol
source_port
destination_port
DSCP
flow_label
ttl / hop_limit
```

только когда эти поля реально участвуют в routing, ECMP, security или NAT semantics.

Local mark/fwmark не является packet descriptor field. Он принадлежит transient `LocalProcessingState` и участвует в отдельном `PACKET_MARK -> ROUTING_POLICY` processing contract.

Packet trace может требовать:

- selected effective route;
- exact ECMP/member selection;
- concrete neighbor MAC;
- `L2 Frame Trace`;
- current operational state.

Поэтому exact packet trace чаще деградирует в `UNKNOWN`, чем structural reachability.

## Направленность

L3 reachability направленная:

```text
reachable(A -> B)
```

не означает:

```text
reachable(B -> A)
```

Reverse path является отдельным запросом.

Наличие прямого route ничего не говорит о маршруте ответа.

## TraceRequest

Концептуально запрос содержит:

```text
L3TraceRequest
    origin
    destination_ip
    table_selections?
    mode
    trace_kind
    packet_descriptor?
    at_time?
```

`mode`:

```text
configured
effective
```

`trace_kind`:

```text
reachability
packet
```

Точная API-схема будет определена при реализации.

`table_selections` conceptually позволяет standalone configured query получить explicit already-selected `RoutingTable` для каждого traversed `RoutingContext`. Packet-flow execution вместо этого получает selection из preceding `ROUTING_POLICY` stage. Ни один вариант не делегирует выбор table самому `ROUTE_DECISION`.

## Origin

Origin может быть указан как:

```text
RoutingContext
L3Binding
NetworkInterface
InterfaceAddress / source IP
```

До запуска основной state machine origin нормализуется в начальный `RoutingState`.

## Source IP не определяет context глобально

Запрос:

```text
from 10.0.0.10
```

недостаточен, если этот адрес существует в нескольких routing contexts.

Resolver должен использовать:

```text
explicit context
InterfaceAddress facts
source object scope
```

Если нормализация неоднозначна и query не даёт достаточного scope:

```text
UNKNOWN
reason = AMBIGUOUS_ORIGIN
```

Нельзя выбирать первый найденный IP assignment.

## Host routing тоже routing

NetMap не должен автоматически предполагать default gateway endpoint-хоста по subnet.

Если трассировка начинается на host:

```text
host RoutingContext
    |
0.0.0.0/0 via gateway
```

должен быть представлен теми же route primitives, что и router forwarding.

Если host routing facts отсутствуют, trace от самого host может быть `UNKNOWN`.

Это лучше, чем скрытая эвристика:

```text
если destination не в /24, отправить на какой-то известный gateway
```

## RoutingState

Основное состояние packet на L3 boundary:

```text
RoutingState
    routing_context_id
    ingress_l3_binding_id?
    packet_descriptor
```

`ingress_l3_binding_id` полезен для:

- будущего policy routing;
- объяснимости;
- security handoff;
- исключения неверного context transition.

Для origin state ingress может отсутствовать.

## LookupState

Route lookup вынесен в отдельное semantic state:

```text
LookupState
    routing_context_id
    routing_table_id
    lookup_address
    original_destination
    egress_constraint?
    purpose
```

`purpose`:

```text
PACKET_DESTINATION
NEXT_HOP_RESOLUTION
```

Ключевой инвариант:

```text
original_destination
```

не меняется при recursive next-hop resolution.

Меняется только:

```text
lookup_address
```

`routing_table_id` сохраняется на всей recursion chain.

## Почему это важно

Пример:

```text
packet dst = 203.0.113.7

route:
203.0.113.0/24 via 192.0.2.1
```

При recursion resolver ищет route к:

```text
lookup_address = 192.0.2.1
```

но packet по-прежнему имеет:

```text
destination_ip = 203.0.113.7
```

Нельзя переписать packet destination на gateway.

Это было бы NAT-подобным изменением и разрушило бы дальнейшую packet semantics.

## Selected-table boundary

Standalone L3 route lookup начинается с уже выбранной `RoutingTable`.

Table selection находится выше selected-table L3 resolver и определена отдельно в [[architecture/l3/01-07-policy-routing|01.7 Policy Routing]]:

```text
PACKET_MARK
    ->
ROUTING_POLICY
    -> selected RoutingTable
    ->
ROUTE_DECISION
```

Для существующего configured backend selected table может быть explicit input caller/query.

Если packet-flow layer не может выбрать table, `TABLE_SELECTION_UNKNOWN` возникает **до** `ROUTE_DECISION`.

`ROUTE_DECISION` не выбирает table по имени `main`, номеру, минимальному ID, display alias или insertion order. Explicit primary/default table может быть evidence table-selection stage, но не hidden fallback route resolver.

## Effective query-scoped lookup

Полный snapshot таблицы не является единственным способом доказать selected route.

Adapter может предоставить authoritative result операции вроде:

```text
route lookup destination X in context C at T
```

Такой query-scoped fact может быть достаточным evidence даже без полного materialized table snapshot.

Это полезно для платформ, где FIB lookup проще и надёжнее, чем импорт всей RIB.

## ROUTE_LOOKUP

Для destination-based table:

```text
LookupState
    |
    | match destination prefixes
    | longest-prefix match
    v
RouteLookupResult
```

Минимальные результаты:

```text
ROUTE_FOUND
NO_ROUTE_CONFIRMED
UNKNOWN
CONFLICTING
```

## Partial table и LPM

Найденный route в partial table ещё не обязательно является selected route.

Пример NetMap знает:

```text
10.0.0.0/8
```

но snapshot неполный.

Для destination:

```text
10.20.30.40
```

может существовать неизвестный:

```text
10.20.30.0/24
```

Поэтому:

> наличие matching route в неполной table не доказывает selected route, если источник не даёт отдельного authoritative selection result.

Это более сильное правило, чем простая проверка отсутствия route.

## ROUTE_FOUND

`ROUTE_FOUND` означает, что resolver может доказать selected/effective route или selected route set.

Evidence может быть:

```text
complete table snapshot + selection semantics
```

или:

```text
authoritative query-scoped FIB lookup
```

или:

```text
configured semantic route set с достаточной completeness
```

## NO_ROUTE_CONFIRMED

Допустим только когда relevant lookup coverage достаточна для отрицательного вывода.

Пример:

```text
complete fresh table
no applicable prefix
```

или authoritative lookup:

```text
no route
```

Отсутствие matching record в partial dataset даёт `UNKNOWN`.

## CONFLICTING

Если несколько источников дают несовместимые selected-route conclusions и precedence policy не разрешает конфликт:

```text
UNKNOWN
flag = CONFLICTING_DATA
```

с evidence конфликтующих facts.

## ROUTE_DISPOSITION

После route selection:

```text
Route
    |
    +-- LOCAL
    +-- DISCARD
    +-- FORWARD
```

## LOCAL

Если destination packet считается локально доставляемым:

```text
LOCAL_DELIVERY
```

Для target destination это может означать:

```text
TARGET_REACHED
```

Если query требует более высокий layer:

```text
LAYER_HANDOFF
```

в local stack/service/security semantics.

L3 resolver не симулирует приложение.

## DISCARD

Найденный route с:

```text
disposition = DISCARD
```

является подтверждённым routing decision.

Branch:

```text
termination = ROUTE_DISCARD
```

Это известная negative branch, а не `UNKNOWN`.

## FORWARD

Для `FORWARD` resolver получает один или несколько `RouteNextHop`.

## NEXT_HOP_SELECT

При одном usable next hop transition детерминирован.

При нескольких:

```text
Route
├── NH1
├── NH2
└── NH3
```

структурный L3 reachability исследует все допустимые candidates.

Exact packet trace может использовать ECMP selection policy.

Если exact policy неизвестна:

```text
possible branches
```

могут быть возвращены как множество кандидатов, но backend не имеет права объявлять один из них фактическим случайным выбором.

## ECMP и verdict

Если хотя бы один candidate next hop даёт полностью подтверждённый путь:

```text
L3 Reachability = REACHABLE
```

даже если другой branch blocked/unknown.

Для exact packet trace ситуация тоньше:

- если packet selection однозначно выбирает reachable branch -> `REACHABLE`;
- если exact member неизвестен и среди candidates есть reachable и unreachable outcomes -> exact result может быть `UNKNOWN`;
- UI может отдельно показать set possible paths.

## NEXT_HOP_RESOLVE

`RouteNextHop` может быть:

```text
gateway only
interface only
gateway + interface
```

Resolver должен получить:

```text
DirectEgressState
    egress_l3_binding_id
    adjacency_mode
        GATEWAY
        DIRECT_DESTINATION
    gateway_address?
    original_destination
```

## Interface-only route

Если route к текущему `lookup_address` задаёт только egress:

```text
out Eth1
```

то:

```text
purpose = PACKET_DESTINATION
    -> adjacency_mode = DIRECT_DESTINATION

purpose = NEXT_HOP_RESOLUTION
    -> adjacency_mode = GATEWAY
    -> gateway_address = lookup_address
```

Для primary packet lookup concrete neighbor target намеренно вычисляется позднее
из текущего `PacketState.destination_ip`. Для recursive lookup terminal
interface-only route сохраняет текущий gateway как `gateway_address`.

## Gateway + interface

Если:

```text
via G out Eth1
```

получаем:

```text
egress = Eth1 L3Binding
adjacency_mode = GATEWAY
gateway_address = G
```

Recursion для выбора interface не нужна, если semantic route уже задаёт достаточный direct scope.

## Gateway-only

Если:

```text
via G
```

без egress:

```text
lookup_address := G
purpose := NEXT_HOP_RESOLUTION
```

и выполняется новый route lookup в том же routing context и той же selected `RoutingTable`.

## Multi-level recursion

Пример:

```text
D via G1
G1 via G2
G2 directly connected out Eth1
```

Resolution:

```text
packet dst D
    |
lookup D
    -> via G1
lookup G1
    -> via G2
lookup G2
    -> out Eth1
    |
DirectEgress(
    Eth1,
    adjacency_mode = GATEWAY,
    gateway_address = G2
)
```

На wire next-hop MAC будет принадлежать G2, а IP packet destination останется D.

## Recursive evidence

Trace сохраняет всю resolution chain:

```text
Route R1 -> NextHop G1
Route R2 -> NextHop G2
Route R3 -> Eth1
```

Пользователь должен видеть, почему gateway оказался достижим через конкретный egress.

## Recursive loop

Visited key минимум включает:

```text
routing_context
routing_table_id
lookup_address
egress_constraint
purpose
```

Повтор эквивалентного unresolved state означает:

```text
LOOP_DETECTED
```

Engine не продолжает бесконечную recursion.

## Direct egress operational gate

Перед link-layer handoff проверяется usable state egress `NetworkInterface`/`L3Binding`.

Существующая interface eligibility используется повторно.

Если:

```text
INELIGIBLE
```

branch получает:

```text
FORWARDING_BLOCKED
```

Если required state unknown в strict effective mode:

```text
UNKNOWN
```

## Два способа link-layer handoff

Здесь `L3 Reachability` и `IP Packet Trace` снова расходятся.

## Reachability adjacency resolution

Structural reachability может разрешать `neighbor_target_ip` через identity/configured facts:

```text
neighbor target IP
    |
InterfaceAddress lookup in relevant context/link scope
    |
candidate target L3Binding / NetworkInterface
    |
L2 Reachability
```

Живой ARP/NDP cache для этого не обязателен.

Это моделирует вопрос:

> может ли next-hop быть достигнут по известной topology?

а не:

> есть ли прямо сейчас cache entry?

## Packet neighbor resolution

Exact packet trace требует concrete link-layer destination:

```text
neighbor_target_ip
    |
Neighbor resolver
    |
destination MAC
    |
L2 Frame Trace
```

Источником MAC может быть:

```text
NeighborEntry
static neighbor
authoritative controller data
other normalized neighbor evidence
```

## NeighborResolutionResult

Минимально:

```text
RESOLVED
DYNAMIC_RESOLUTION_REQUIRED
FAILED_CONFIRMED
UNKNOWN
CONFLICTING
```

## RESOLVED

Concrete usable MAC известен.

Trace формирует Ethernet frame descriptor и вызывает L2 frame resolver.

## DYNAMIC_RESOLUTION_REQUIRED

Current cache не содержит usable mapping, но это само по себе не failure.

Реальное устройство могло бы выполнить:

```text
ARP
NDP
```

при отправке packet.

Поскольку базовый trace engine не симулирует protocol exchange, exact immediate frame trace может завершиться:

```text
UNKNOWN
reason = DYNAMIC_NEIGHBOR_RESOLUTION_REQUIRED
```

Structural L3 reachability при наличии topology/identity evidence может продолжаться отдельно.

## FAILED_CONFIRMED

Требуется явное authoritative evidence того, что neighbor resolution сейчас не может быть использован.

Просто отсутствие entry даже в complete cache **недостаточно**.

Примеры будущего evidence:

```text
explicit failed neighbor state
negative controller resolution
known link-layer impossibility
```

Branch становится известной negative только при достаточной semantics.

## UNKNOWN

Нет достаточных данных ни для concrete mapping, ни для authoritative failure.

## CONFLICTING

Несколько neighbor facts дают несовместимые MAC/target conclusions.

Случайный MAC не выбирается.

## Complete neighbor cache без entry

Это означает:

```text
на момент snapshot mapping не закэширован
```

но не:

```text
host недостижим
```

В отличие от FDB `ABSENT_CONFIRMED`, отсутствие dynamic neighbor cache entry не превращается автоматически в известный negative forwarding result.

Это принципиальное различие между learning cache и topology reachability.

## L2 Reachability handoff

Для structural L3 reachability:

```text
current egress NetworkInterface
    |
L2 Reachability
    |
candidate next-hop NetworkInterface
```

Если L2 verdict:

```text
REACHABLE
```

resolver может перейти к следующему L3 endpoint/context.

Если:

```text
UNREACHABLE
```

branch известным образом не достигает next hop.

Если:

```text
UNKNOWN
```

L3 branch также не может считаться подтверждённо reachable.

## L2 Frame handoff

Для packet trace:

```text
egress NetworkInterface
neighbor dst MAC
source MAC if known/required
    |
L2 Frame Trace
```

L2 resolver возвращает:

- reached destination attachment(s);
- physical/L2 path evidence;
- branch verdict/unknowns.

L3 engine не повторяет:

```text
FDB
STP
LAG
encapsulation
L1
```

семантику.

## NEXT_ROUTING_CONTEXT

После успешного L2 handoff нужно определить, что находится на принимающем `NetworkInterface`.

Возможны:

```text
target endpoint
next router/routing context
local/internal termination
ambiguous ownership
unknown ownership
```

## Destination endpoint

Если reached interface имеет `InterfaceAddress`, соответствующий original destination в корректном scope/context, branch может завершиться:

```text
TARGET_REACHED
```

Для structural reachability concrete MAC мог вообще не требоваться.

## Next router

Если reached interface имеет applicable `L3Binding` другого forwarding hop:

```text
NetworkInterface
    |
L3Binding
    |
RoutingContext
```

создаётся новый:

```text
RoutingState
```

с тем же IP packet destination.

Routing lookup начинается снова.

## Multiple L3 bindings

Если ingress interface имеет несколько possible L3 contexts и available facts не определяют, какой получает packet:

```text
UNKNOWN
reason = AMBIGUOUS_L3_HANDOFF
```

или несколько possible branches с соответствующей uncertainty.

Backend не выбирает context по имени VRF.

## Missing handoff identity

L2 trace может привести frame до edge/port, но NetMap может не знать endpoint object или L3 binding за ним.

Тогда известная трасса сохраняется до последней точки:

```text
source -> ... -> SW2/Gi17
```

а результат:

```text
UNKNOWN
reason = MISSING_L3_HANDOFF
```

Это лучше ложного утверждения, что destination unreachable.

## Routed hop

Один полный L3 forwarding hop выглядит так:

```text
RoutingContext A
    + selected RoutingTable
    |
ROUTE_LOOKUP
    |
Route / NextHop
    |
recursive resolution
    |
DirectEgress
    |
neighbor / adjacency resolution
    |
L2 resolver
    |
next NetworkInterface
    |
RoutingContext B
```

Этот цикл повторяется до terminal state.

Для каждого нового routing context table снова должна быть выбрана higher-level caller/`ROUTING_POLICY`. Table предыдущего processing node не наследуется.

## TTL / Hop Limit

TTL/Hop Limit является реальным L3 packet state.

Но NetMap не должен придумывать исходное значение, если query его не указал.

Для `IP Packet Trace`, если lifetime известен:

1. каждый routed forwarding hop применяет соответствующую decrement semantics;
2. при исчерпании branch завершается:
   ```text
   TTL_EXPIRED
   ```
3. генерация ICMP Time Exceeded является отдельным обратным packet flow и пока не симулируется.

Для structural reachability TTL может не участвовать в query.

## Packet immutability на L3

Изменение packet identity моделируется отдельно в [[architecture/l3/01-06-nat|01.6 NAT — packet transformation]] и будет вызываться будущим `Packet Flow Trace`.

До появления NAT базовая L3 state machine не меняет:

```text
source_ip
destination_ip
protocol identity
```

кроме естественного TTL/Hop Limit.

Recursive gateway lookup также не изменяет packet destination.

Это создаёт чистую границу для будущего NAT engine.

## Security не оценивается

Security semantics определена отдельно в [[architecture/l3/01-05-security-policy|01.5 Security Policy]]. Её вызовет будущий `Packet Flow Trace` в корректных processing points.

Если L3 resolver нашёл путь:

```text
REACHABLE
```

это означает:

> routing + required lower-layer path существует в рамках L3 query semantics.

Это **не означает**:

```text
TCP/443 allowed
```

или даже:

```text
packet accepted by firewall
```

Security verdict появится только в `Packet Flow Trace`.

## Branch model

Как и L2 trace, L3 result может быть DAG/деревом branches.

Концептуально:

```text
L3TraceBranch
    steps[]
    termination
    gaps[]
```

Branch может разделиться из-за:

```text
ECMP
multiple adjacency candidates
multiple L2 paths
ambiguous handoff
partial knowledge
```

## TraceStep

Каждый шаг должен иметь evidence:

```text
TraceStep
    from_state
    transition
    to_state
    evidence_refs[]
```

Типичные evidence:

```text
RoutingTable
RoutingTableSnapshot
Route
RouteNextHop
InterfaceAddress
NeighborEntry
L2 trace result
L3Binding
NetworkInterface state
```

## Termination reason

Примеры:

```text
TARGET_REACHED
LOCAL_DELIVERY
ROUTE_DISCARD
NO_ROUTE
TABLE_SELECTION_UNKNOWN
ROUTE_SELECTION_UNKNOWN
NEXT_HOP_UNRESOLVED
DYNAMIC_NEIGHBOR_RESOLUTION_REQUIRED
NEIGHBOR_FAILED
L2_UNREACHABLE
L2_UNKNOWN
MISSING_L3_HANDOFF
AMBIGUOUS_L3_HANDOFF
FORWARDING_BLOCKED
TTL_EXPIRED
LOOP_DETECTED
CONFLICTING_DATA
SEARCH_LIMIT
LAYER_HANDOFF
```

Причина branch termination отделена от общего verdict.

## Общий verdict

L3 reachability использует те же три верхнеуровневых значения:

```text
REACHABLE
UNREACHABLE
UNKNOWN
```

## REACHABLE

Существует хотя бы один полностью подтверждённый путь до target в рамках query semantics.

Для exact packet trace этот путь также должен быть совместим с известными packet-specific selection decisions.

## UNREACHABLE

Resolver доказал отсутствие допустимого пути после исчерпывающего анализа всех relevant branches.

Типичные доказанные причины:

```text
NO_ROUTE_CONFIRMED
ROUTE_DISCARD
confirmed unusable egress
L2_UNREACHABLE
TTL_EXPIRED for concrete packet
```

Но verdict `UNREACHABLE` допустим только если нет unresolved branch, которая ещё могла бы привести к target.

## UNKNOWN

Есть хотя бы одна релевантная неопределённость, из-за которой нельзя доказать ни reachability, ни unreachable.

Примеры:

```text
partial routing table
unknown table selection
unknown ECMP exact choice
dynamic neighbor resolution required for exact frame
unknown L2 path
ambiguous next routing context
stale observed state
conflicting routes
search limit
```

## Verdict aggregation

Упрощённо:

```text
если есть confirmed target path:
    REACHABLE

иначе если все relevant branches exhaustive
и каждая завершилась known negative:
    UNREACHABLE

иначе:
    UNKNOWN
```

Для exact packet trace branch, который routing policy/ECMP точно не может выбрать, не считается relevant.

## Configured mode

`configured` L3 trace использует:

- configured routing semantics;
- configured interface eligibility;
- known endpoint/interface assignments;
- configured L2 reachability.

Operational FIB/neighbor caches не должны молча менять configured result.

Configured trace отвечает на вопрос forwarding intent, а не current convergence.

## Effective mode

`effective` L3 trace предпочитает:

- installed/effective FIB facts;
- current interface state;
- current L2 effective state;
- current neighbor evidence для exact frame trace.

Если authoritative effective FIB уже выбран устройством, core не обязан заново симулировать OSPF/BGP selection.

## Route candidate vs installed route

Configured analysis может знать несколько protocol candidates.

Effective trace должен по возможности использовать:

```text
installed route / FIB result
```

а не самостоятельно выбирать между:

```text
OSPF
BGP
static
```

без модели protocol preference.

Если installed result неизвестен и candidates неоднозначны:

```text
UNKNOWN
```

## Completeness как query-scoped concept

Полнота нужна не обязательно «для всей таблицы устройства».

Достаточно доказать полноту именно для semantic вопроса:

```text
какой route выбран для destination D?
```

Поэтому coverage может быть:

```text
full table
prefix range
single exact lookup result
single context/address-family view
```

Модель источников данных должна позволять выразить такую область.

## Historical trace

При будущем:

```text
at_time = T
```

все observed subresolvers должны использовать согласованное temporal view насколько это возможно:

```text
routing snapshot
interface state
neighbor snapshot
L2 state/FDB
```

Если данные относятся к несовместимым временам и это влияет на вывод, result должен показывать uncertainty.

## Cycle detection между routers

Помимо recursive gateway loop возможен forwarding loop:

```text
R1 -> R2 -> R3 -> R1
```

Semantic visited key для packet routing минимум учитывает:

```text
routing_context
ingress_l3_binding
packet fields that affect forwarding
```

Повтор без packet mutation, меняющей дальнейшую semantics, считается loop.

После будущего NAT/PBR state key будет расширен.

## Search limits

Как и L2:

```text
max hops
max states
max branches
max recursion depth
```

являются защитными implementation limits.

Если limit достигнут до доказательства negative:

```text
UNKNOWN
reason = SEARCH_LIMIT
```

Нельзя превращать timeout/limit в `UNREACHABLE`.

## Deduplication

Несколько ECMP/L2 branches могут сходиться в один semantic `RoutingState`.

Execution graph может объединять их, сохраняя:

```text
all evidence paths
```

для explainability.

Это ограничивает combinatorial explosion.

## Пример полного L3 пути

```text
Host A
RoutingContext host-A
    |
route 0.0.0.0/0 via 10.1.0.1
    |
neighbor target 10.1.0.1
    |
L2 path
    |
Router R1 / Context PROD
    |
route 10.20.0.0/16 via 172.16.0.2
    |
recursive/direct resolution
    |
L2 path
    |
Router R2 / Context PROD
    |
route 10.20.30.0/24 out Vlan300
    |
L2 reachability
    |
Host B 10.20.30.40
```

Trace evidence отдельно показывает:

- каждый selected route;
- каждый recursive resolution;
- каждый L2 segment;
- каждое переходное routing context;
- все unknown/conflicting facts.

## Пример missing data

Известно:

```text
R1:
10.20.0.0/16 via 172.16.0.2
```

L2 до next-hop подтверждён.

Но topology не содержит `L3Binding` принимающего router interface.

Результат:

```text
UNKNOWN

known path:
source -> R1 -> ... -> next-hop Ethernet attachment

reason:
MISSING_L3_HANDOFF
```

Не:

```text
UNREACHABLE
```

## Пример discard

```text
10.20.30.0/24
    disposition = DISCARD
```

Результат branch:

```text
termination = ROUTE_DISCARD
```

Если альтернативного route/branch нет и selected table подтверждена:

```text
UNREACHABLE
```

на L3 scope.

## Пример partial table

Known data:

```text
10.0.0.0/8 via R2
```

Но routing snapshot:

```text
completeness = PARTIAL
```

Destination:

```text
10.20.30.40
```

Нельзя доказать, что `/8` selected:

```text
UNKNOWN
```

потому что неизвестный `/24` мог бы выиграть LPM.

## L3ReachabilityDomain не нужен

В отличие от L2, глобальная derived сущность вроде:

```text
L3ReachabilityDomain
```

обычно мало полезна.

IP reachability зависит от:

```text
source routing context
destination
routing state
direction
policy
eventually security/NAT
```

Поэтому предпочтителен query/trace result, а не попытка разбить всю сеть на статические L3 connected components.

Subnet/prefix остаётся адресным понятием, а не готовым reachability domain.

## Использование L3 resolver внутри Packet Flow Trace

Полный `L3 Trace` остаётся самостоятельным запросом, но [[architecture/tracing/03-04-packet-flow-trace|03.4 Packet Flow Trace]] не обязан вызывать его как один неделимый monolithic step.

Для platform-specific processing order L3 semantics разбивается на reusable suboperations:

```text
ROUTE_DECISION
    selected RoutingTable as input
    route lookup in selected table
    recursive next-hop resolution in SAME table
    ->
    LOCAL / DISCARD / FORWARD

ADJACENCY_L2
    resolved FORWARD decision
    +
    current PacketState
    ->
    neighbor target
    ->
    L2 delivery
```

Это позволяет вставить между route decision и actual egress:

```text
security
NAT
other future packet-processing stages
```

не дублируя routing algorithm.

`ROUTE_DECISION` должен сохранять evidence, **над какой версией `PacketState` он был вычислен**.

Он также сохраняет `routing_table_id`, уже выбранный caller/`ROUTING_POLICY`. Table selection не является внутренним transition этого resolver.

Если packet позднее изменён NAT, selected route не пересчитывается автоматически. Повторный route lookup происходит только если `PacketProcessingPlan` явно содержит новый routing stage.

Повторный `ROUTE_DECISION` использует текущую selected table. Если platform должна повторно выполнить policy selection, plan обязан явно разместить новый `ROUTING_POLICY` перед ним.

Recursive lookup gateway address является внутренней работой одного `ROUTE_DECISION`, а не packet reprocessing. Он не создаёт новый `PacketState` и не запускает `PACKET_MARK`, `ROUTING_POLICY`, Security, NAT или entry point packet-processing plan.

Это принципиально: порядок обработки определяет platform semantics, а не интуитивное правило NetMap.

Для direct egress route forwarding decision должен хранить достаточно semantic information, чтобы последующий adjacency resolver мог определить link-layer target.

Концептуально:

```text
ResolvedForwardingDecision
    route_id
    egress_l3_binding_id
    adjacency_mode
    gateway_address?
    basis_packet_state_id
```

`adjacency_mode` минимум различает:

```text
GATEWAY
DIRECT_DESTINATION
```

При `GATEWAY` neighbor target фиксирован route next-hop gateway.

При `DIRECT_DESTINATION` neighbor target определяется из **текущего `PacketState.destination_ip` в момент adjacency stage**.

Это позволяет корректно выразить platform pipeline, где destination translation происходит после route selection, но до neighbor resolution.

Подробный orchestrator: [[architecture/tracing/03-04-packet-flow-trace|03.4 Packet Flow Trace]].

## Связь с Packet Flow Trace

Packet Flow orchestrator сможет выполнять:

```text
source packet
    |
L3 routing decision
    |
Security/NAT processing hooks
    |
neighbor + L2 delivery
    |
next routing context
    |
...
```

При этом текущий L3 resolver останется самостоятельным reusable компонентом.

Security/NAT не должны заставить переписать базовые:

```text
Route
RouteNextHop
RoutingContext
L2 resolver
```

primitives.

## Инварианты

1. `L3 Reachability` и `IP Packet Trace` являются разными операциями.
2. L3 trace всегда выполняется в explicit `RoutingContext`.
3. Source IP сам по себе не определяет routing context глобально.
4. Host forwarding использует ту же routing model; default gateway не выводится скрытой эвристикой.
5. Routing state сохраняет original packet destination при recursive next-hop resolution.
6. Recursive lookup меняет `lookup_address`, а не packet destination.
7. Routing table selection является отдельной higher-level semantic operation до `ROUTE_DECISION`.
8. Несколько tables без known selection policy не разрешаются произвольным выбором.
9. Partial routing table может быть недостаточна даже при наличии matching route из-за неизвестного more-specific prefix.
10. Authoritative query-scoped FIB lookup может заменить requirement полного table snapshot.
11. `NO_ROUTE_CONFIRMED` требует достаточной lookup completeness.
12. `LOCAL`, `DISCARD` и `FORWARD` являются route decisions; `NO_ROUTE` — lookup result.
13. ECMP candidates не являются exact packet path.
14. Exact ECMP choice нельзя угадывать.
15. Gateway-only next hop допускает recursive resolution.
16. Recursive next-hop resolution должна сохранять evidence chain.
17. Recursive resolution и forwarding traversal обязаны иметь cycle detection.
18. Structural L3 reachability не требует существующей dynamic ARP/NDP cache entry.
19. Complete neighbor cache без entry не доказывает недостижимость.
20. Exact packet frame trace требует concrete link-layer destination либо явно сохраняет uncertainty.
21. L3 reachability использует L2 Reachability; exact packet trace использует L2 Frame Trace.
22. L3 resolver не дублирует FDB/STP/LAG/L1 algorithms.
23. После L2 handoff следующий `RoutingContext` определяется через receiving interface/L3 binding, а не по имени устройства.
24. Missing L3 handoff identity даёт `UNKNOWN`, а не ложный negative.
25. Routing/L2 path является направленным.
26. Security allow/deny не входит в L3 verdict.
27. NAT не выполняется базовой L3 state machine.
28. TTL/Hop Limit учитывается только если packet trace имеет достаточное packet state; исходное значение не угадывается.
29. Trace result должен иметь evidence для selected routes, next hops и lower-layer transitions.
30. Общий verdict: `REACHABLE`, `UNREACHABLE`, `UNKNOWN`.
31. `UNREACHABLE` допустим только после исчерпывающего анализа всех relevant возможных branches.
32. Search limit не является доказательством unreachable.
33. Routing snapshots и other operational facts имеют temporal semantics.
34. L3 reachability не следует сводить к статическому глобальному connected-component domain.
35. `LookupState` содержит explicit `routing_table_id`.
36. Recursive next-hop resolution сохраняет selected table и не вызывает `ROUTING_POLICY`.
37. `ROUTE_DECISION` никогда скрыто не выбирает table.

## Открытые вопросы

Следующие ветки остаются намеренно отдельными:

- точная API-схема `L3TraceRequest`/result;
- concrete implementation согласованной routing-policy semantics;
- exact ECMP hashing;
- active ARP/NDP simulation/probing;
- proxy ARP / proxy NDP;
- IPv6 RA/on-link semantics;
- neighbor freshness and source precedence;
- unnumbered interface resolution;
- tunnel/overlay recursion;
- MPLS;
- packet TTL/ICMP generated flows;
- historical temporal alignment;
- NAT;
- firewall/security processing.

После этой state machine L1/L2/L3 semantic path может быть вычислен композиционно. Следующий крупный слой — Security / packet-flow policy, после чего можно формализовать end-to-end `Packet Flow Trace`.
