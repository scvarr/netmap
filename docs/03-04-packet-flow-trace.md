# 03.4 Packet Flow Trace

## Статус

Согласованная концептуальная модель end-to-end packet-flow orchestrator.

Эта ветка не вводит ещё один независимый forwarding layer.

Она композиционно объединяет уже определённые primitives и resolvers:

- [[01-04-l3|L3 routing model]];
- [[01-07-policy-routing|Policy Routing]];
- [[03-03-l3-trace|L3 resolver]];
- [[01-05-security-policy|Security Policy]];
- [[01-06-nat|NAT]];
- [[03-02-l2-trace|L2 resolver]];
- L1 physical trace.

Главная новая сущность — `PacketProcessingPlan`: platform-specific нормализованный control-flow graph, который определяет **в каком порядке и при каких outcomes** вызываются routing, security, NAT и lower-layer stages.

## Назначение

`Packet Flow Trace` отвечает на вопрос:

> Что произойдёт с конкретным IP packet/flow от origin до network delivery target, включая routing, firewall policy, NAT и lower layers?

Типичный запрос:

```text
10.1.20.15:51234
    ->
10.5.10.8:443
TCP
```

Желаемый explainable output:

```text
Host A
    route default via 10.1.20.1

L2
    reached FW01 inside

FW01
    ingress ACL:
        PERMIT rule 17

    DNAT:
        identity

    route:
        10.5.10.0/24 -> SERVERS

    zone policy:
        PERMIT rule 153

    SNAT:
        identity

L2
    reached 10.5.10.8

destination network stack reached
```

Или:

```text
FW01
    zone policy rule 77
    DROP

result:
    NOT_DELIVERED
    reason = SECURITY_BLOCK
```

## Scope

Первый `Packet Flow Trace` ориентирован на IP packet flow.

Pure Ethernet-only question остаётся задачей:

```text
L2 Frame Trace
```

Приложение/сервис выше transport layer пока не симулируется.

Даже successful network delivery:

```text
DELIVERED
```

не означает автоматически:

```text
TCP handshake succeeded
application responded
service is healthy
```

Это отдельные higher-layer semantics.

## Почему нужен orchestrator

Нельзя корректно выразить packet path только последовательностью:

```text
L3 trace
then security
then NAT
```

Потому что реальные platforms отличаются.

Возможны:

```text
DNAT
-> route lookup
-> security
-> SNAT
```

или:

```text
security
-> route lookup
-> security
-> source NAT
```

или:

```text
route lookup
-> destination rewrite
-> no reroute
-> egress filtering
```

Canonical Security/NAT/L3 models специально не фиксируют universal order.

Этот порядок принадлежит `PacketProcessingPlan`.

## План — control-flow graph, а не список

Простой список stages недостаточен.

Route decision сам создаёт ветвление:

```text
ROUTE_DECISION
    |
    +-- FORWARD -> egress processing
    |
    +-- LOCAL -> local-input processing
    |
    +-- DISCARD -> terminal
    |
    +-- UNKNOWN -> uncertainty
```

Поэтому:

```text
PacketProcessingPlan
```

является directed control-flow graph.

Минимально:

```text
PacketProcessingPlan
    id

ProcessingStage
    id
    plan_id
    kind
    payload

ProcessingTransition
    from_stage_id
    outcome
    to_stage_id / terminal
```

Точная SQL representation не фиксируется.

## Canonical plan может быть DAG

Для первого backend normalized local processing plan должен по возможности быть DAG.

Это упрощает:

- validation;
- explainability;
- termination;
- adapter testing.

Native platform recirculation/loops лучше нормализовать как explicit handoff в другой processing context/plan.

Если реальную semantics невозможно выразить без local cycle, модель позже может быть расширена, но trace engine всё равно обязан иметь cycle detection.

## Plan не является vendor class

Core не должен иметь:

```text
FortiGateProcessingPlan
PaloAltoProcessingPlan
LinuxNetfilterPlan
CiscoASAPlan
```

Adapter создаёт обычный `PacketProcessingPlan` и сохраняет:

```text
vendor
platform
software version
adapter version
native hook names
```

как provenance.

## Reusable plan

Один normalized plan может использоваться несколькими routing contexts/instances, если processing semantics одинаковы.

Например:

```text
plan: basic-router-v1
```

может быть attached к множеству simple routing contexts.

Identity plan не зависит от display name устройства.

## PacketProcessingPlanAttachmentSet и PacketProcessingPlanAttachment

Configured selection coverage задаётся отдельным canonical set:

```text
PacketProcessingPlanAttachmentSet
    routing_context_id
    traffic_class
    configured_completeness

PacketProcessingPlanAttachment
    attachment_set_id
    plan_id
    scope
```

`AttachmentSet` фиксирует selection domain `(RoutingContext, TrafficClass)` и
сохраняет completeness даже при нуле attachment rows. Поэтому только `COMPLETE`
пустой set может доказать `NO_PLAN_CONFIRMED`; отсутствие set означает `UNKNOWN`.

Attachment scope в первой concrete representation уточняет только ingress:

```text
{}
ingress_network_interface_ids
ingress_l3_binding_ids
```

Traffic class и routing context не дублируются внутри attachment scope.

## Traffic class

Используется уже определённая базовая классификация:

```text
LOCAL_OUTPUT
TRANSIT
LOCAL_INPUT
```

### LOCAL_OUTPUT

Packet создан local stack.

### TRANSIT

Packet принят и маршрутизируется далее.

### LOCAL_INPUT

Packet направляется в local stack.

Plan может иметь разные entry points для этих traffic classes.

## Plan entry point

Plan определяет explicit entry stage:

```text
entry(LOCAL_OUTPUT)
entry(TRANSIT)
entry(LOCAL_INPUT)
```

Не все plans обязаны поддерживать все classes.

Если query попал в traffic class без known entry point:

```text
UNKNOWN
reason = PROCESSING_ENTRY_UNKNOWN
```

если completeness не позволяет доказать, что обработки действительно нет.

## Typed stage

`ProcessingStage.kind` является semantic operation.

Минимальное ядро:

```text
PACKET_MARK
ROUTING_POLICY
ROUTE_DECISION
SECURITY
NAT
ADJACENCY_L2
LOCAL_DELIVERY
TERMINATE
```

Позднее могут появиться:

```text
TUNNEL_ENCAPSULATION
TUNNEL_DECAPSULATION
MPLS
SERVICE_CHAIN
```

Но core не добавляет их заранее.

`PACKET_MARK`, `ROUTING_POLICY` и `ROUTE_DECISION` являются distinct current stage kinds. Их contract определён в [[01-07-policy-routing|01.7 Policy Routing]].

## PACKET_MARK stage

Stage получает:

```text
current PacketState
current LocalProcessingState
current local context
```

и возвращает:

```text
same PacketState
new LocalProcessingState
```

`PACKET_MARK` не выбирает table, не выполняет route lookup и не является NAT. Его result/evidence explicit; hidden global fwmark запрещён.

## ROUTING_POLICY stage

Stage получает:

```text
current PacketState
current LocalProcessingState
current local context
```

и производит:

```text
selected_routing_table_id
```

либо typed uncertainty/conflict.

`ROUTING_POLICY` не производит `Route` или next hop. Selected table сохраняется в `FlowExecutionState` и затем является input `ROUTE_DECISION`.

## SECURITY stage

Stage вызывает Security resolver над:

```text
current PacketState
current local context
specific SecurityPolicyAttachment
```

или нормализованным security-stage target.

Stage outcomes минимум:

```text
PASS
BLOCKED
UNKNOWN
```

`PASS` следует transition дальше.

`BLOCKED` ведёт к terminal negative.

`UNKNOWN` сохраняет uncertainty.

## Почему stage может ссылаться на attachment

На одном processing point возможны:

```text
ingress ACL
zone policy
egress ACL
```

между которыми могут находиться NAT/routing stages.

Поэтому full plan должен уметь размещать **конкретный semantic SecurityPolicyAttachment** в конкретном месте graph.

Локальный `stage_order` внутри Security model остаётся полезным для standalone security evaluation, но PacketProcessingPlan является конечным источником inter-layer order.

## NAT stage

NAT stage вызывает NAT resolver над:

```text
current PacketState
current local context
specific NATPolicyAttachment
```

Outcome:

```text
IDENTITY
TRANSFORMED_EXACT
TRANSFORMED_CONSTRAINED
UNKNOWN
CONFLICTING
```

`IDENTITY` сохраняет exact current `PacketState`. `TRANSFORMED_EXACT` создаёт новый exact immutable `PacketState`. `TRANSFORMED_CONSTRAINED` создаёт отдельный `NATPacketConstraint`/symbolic packet result, а не fake exact `PacketState`.

Если следующая stage не умеет reasoning над constraint, packet-flow branch становится `UNKNOWN`. Representative address/port выбирать запрещено.

## ROUTE_DECISION stage

Stage вызывает L3 route-decision subresolver.

Selected `RoutingTable` уже должна присутствовать в `FlowExecutionState`.

Stage выполняет:

```text
route lookup in selected RoutingTable
recursive next-hop resolution in SAME selected RoutingTable
```

но **не выполняет сразу L2 handoff**.

Result минимум:

```text
FORWARD
LOCAL
DISCARD
NO_ROUTE
UNKNOWN
CONFLICTING
```

Для `FORWARD` создаётся:

```text
ResolvedForwardingDecision
```

с selected route/egress/adjacency semantics.

`ROUTE_DECISION` не запускает `ROUTING_POLICY`, не выбирает table по имени/default/min-ID и не выполняет hidden reselection. Если selected table отсутствует, `TABLE_SELECTION_UNKNOWN` возникает до route lookup.

## Route decision хранит basis packet

Каждый route decision должен ссылаться:

```text
basis_packet_state_id
```

на PacketState, по которому он был вычислен.

Пример:

```text
P0 dst=203.0.113.10

ROUTE_DECISION(P0)
    -> egress WAN

NAT(P0)
    -> P1 dst=10.0.0.10
```

Selected route остаётся evidence:

```text
route based on P0
```

Он не пересчитывается автоматически.

## Нет автоматического reroute

Это критический invariant.

Если NAT после route decision меняет destination:

```text
P0
-> route
-> NAT -> P1
```

NetMap не должен рассуждать:

> destination изменился, значит я сам заново запущу routing.

Повторный route lookup происходит только при explicit следующем:

```text
ROUTE_DECISION
```

в processing plan.

Так adapter может точно выразить реальную platform semantics.

## Route decision не мутирует PacketState

`ROUTE_DECISION` создаёт forwarding decision/evidence.

Он не меняет:

```text
source IP
destination IP
ports
```

TTL/Hop Limit processing рассматривается как forwarding side effect и уточняется отдельно.

## Recursive lookup не является packet reprocessing

Gateway recursion — внутренняя работа одного `ROUTE_DECISION`:

```text
lookup destination D in selected table T
    -> gateway G
lookup G in SAME table T
```

Она меняет internal `lookup_address`, но не создаёт новый `PacketState` и не запускает `PACKET_MARK`, `ROUTING_POLICY`, Security, NAT или plan entry. `original_destination` и `selected_routing_table_id` сохраняются на всей recursion chain.

## LOCAL outcome

Если route disposition:

```text
LOCAL
```

plan может перейти:

```text
ROUTE_DECISION
    -- LOCAL -->
LOCAL_INPUT security stages
    ->
LOCAL_DELIVERY
```

Это причина, почему plan должен быть graph.

## DISCARD outcome

Route disposition:

```text
DISCARD
```

обычно ведёт:

```text
NOT_DELIVERED
reason = ROUTE_DISCARD
```

Если platform имеет отдельную generated response semantics, она может позже создать дочерний flow.

## NO_ROUTE outcome

Authoritative no-route result:

```text
NOT_DELIVERED
reason = NO_ROUTE
```

Partial/incomplete route knowledge остаётся:

```text
UNKNOWN
```

через сам L3 resolver.

## ADJACENCY_L2 stage

Этот stage выполняет фактический переход с routed processing point на next link-layer attachment.

Он использует:

```text
ResolvedForwardingDecision
current PacketState
```

и вызывает:

```text
neighbor/adjacency resolver
L2 Frame Trace или L2 Reachability
L1 trace
```

в зависимости от query mode.

## Adjacency mode

Forwarding decision минимум несёт:

```text
GATEWAY
DIRECT_DESTINATION
```

### GATEWAY

Neighbor target:

```text
selected gateway address
```

независимо от последующего изменения конечного packet destination.

### DIRECT_DESTINATION

Neighbor target определяется из:

```text
current PacketState.destination_ip
```

в момент `ADJACENCY_L2`.

Это позволяет корректно выразить post-route destination transformations.

## Почему route и adjacency разделены

Например platform semantics:

```text
route selects interface based on P0
DNAT changes P0 -> P1
neighbor resolution uses P1 destination on selected interface
```

Ни monolithic L3 trace, ни hidden reroute не выразят это корректно.

Разделение:

```text
ROUTE_DECISION
NAT
ADJACENCY_L2
```

выражает буквально.

## ADJACENCY_L2 result

Минимально:

```text
NEXT_PROCESSING_POINT
TARGET_ATTACHMENT_REACHED
L2_UNREACHABLE
UNKNOWN
```

Successful L2 handoff должен вернуть:

```text
receiving NetworkInterface
L2/L1 evidence path
```

а не просто boolean.

Оба successful outcome завершают **текущий local plan** только через explicit:

```text
ADJACENCY_L2
    -- NEXT_PROCESSING_POINT / TARGET_ATTACHMENT_REACHED -->
TERMINATE { outcome = CONTINUE_TO_NEXT_HOP }
```

Здесь `CONTINUE_TO_NEXT_HOP` означает продолжение execution в новом local
processing context, а не обязательное продолжение IP forwarding. Future
multi-hop orchestrator после этого terminal выполняет plan selection для уже
сформированного receiving context.

`NEXT_PROCESSING_POINT` создаёт receiving context с
`traffic_class = TRANSIT`. `TARGET_ATTACHMENT_REACHED` создаёт receiving
context с `traffic_class = LOCAL_INPUT`. В обоих случаях сохраняются receiving
`RoutingContext`, `NetworkInterface`, `L3Binding` и current packet value.

Критически:

```text
TARGET_ATTACHMENT_REACHED != NETWORK_DELIVERY
```

Он доказывает L2 arrival к attachment текущего direct destination, но local
Security/NAT processing ещё может заблокировать или изменить packet. Только
последующий `LOCAL_DELIVERY` в выбранном `LOCAL_INPUT` plan подтверждает передачу
в local network stack.

## Next processing point

После arrival на receiving interface orchestrator определяет:

```text
L3Binding / routing context
```

и создаёт новый local execution context.

Current packet state сохраняется.

Создаётся новый local execution context. Local route decision, selected table, egress state и local-only mark предыдущего hop очищаются.

## FlowExecutionState

Runtime orchestrator state концептуально:

```text
FlowExecutionState
    original_packet_state
    current_packet_state / current_packet_constraint?
    packet_lineage

    routing_context_id
    traffic_class

    ingress_l3_binding_id?
    ingress_network_interface_id?

    local_processing_state
    selected_routing_table_id?
    current_route_decision?
    egress_l3_binding_id?

    connection_state?
    ephemeral_session_state?

    plan_id
    current_stage_id
```

Не все поля всегда заполнены.

`selected_routing_table_id` является execution-local state. Он не process-global и не наследуется автоматически следующим processing node.

## Original и current packet

Нужно всегда сохранять:

```text
original_packet_state
current_packet_state
```

Например:

```text
P0:
198.51.100.20:50000 -> 203.0.113.10:8443

DNAT

P1:
198.51.100.20:50000 -> 10.0.0.10:443

SNAT

P2:
10.0.0.1:55000 -> 10.0.0.10:443
```

Каждый stage получает именно current state.

## Packet lineage

Trace должен хранить directed lineage:

```text
P0
 |
 | NAT rule 10
 v
P1
 |
 | NAT rule 40
 v
P2
```

Security/routing steps ссылаются на конкретную версию:

```text
security rule 153 evaluated P1
route R17 selected using P1
L2 frame built from P2
```

Это одна из главных explainability guarantees NetMap.

## Stage output не должен быть hidden mutable state

Каждый stage возвращает explicit semantic result.

Например:

```text
SecurityStageResult
NATStageResult
RouteDecisionResult
AdjacencyResult
```

Orchestrator записывает результат в trace branch.

Не должно быть:

```text
global current firewall decision somewhere in mutable context
```

без evidence.

## ProcessingTransition

Transition выбирается по outcome stage.

Пример:

```text
S10 ROUTE_DECISION
    FORWARD -> S20
    LOCAL   -> S60
    DISCARD -> T_DROP
    NO_ROUTE -> T_NO_ROUTE
    UNKNOWN -> T_UNKNOWN
```

Transition itself является частью normalized plan semantics.

## Terminal node

Plan может иметь explicit terminal:

```text
CONTINUE_TO_NEXT_HOP
NETWORK_DELIVERY
NOT_DELIVERED
UNKNOWN
```

Но конечный end-to-end verdict всё равно вычисляется orchestrator над trace branches.

## LOCAL_DELIVERY stage

Означает:

> packet достиг local network stack в текущем processing context.

Это **network-layer delivery**, а не доказательство работающего сервиса.

Stage имеет canonical empty payload:

```json
{}
```

и outcomes:

```text
DELIVERED
UNKNOWN
```

`LOCAL_DELIVERY` требует `traffic_class = LOCAL_INPUT`. В этом context результат
`DELIVERED` доказан независимо от того, представлен текущий packet как exact
`PacketState`, `NATPacketConstraint` или unknown packet value: uncertainty
конкретных полей packet не отменяет уже explicit control-flow handoff в local
stack. Packet value, routing state и ingress identity stage не мутирует.

При `TRANSIT` или `LOCAL_OUTPUT` stage возвращает `UNKNOWN` с
`STAGE_PRECONDITION_UNKNOWN`; traffic class не исправляется эвристически.

Canonical success edge имеет единственную совместимую terminal semantics:

```text
LOCAL_DELIVERY
    -- DELIVERED -->
TERMINATE { outcome = NETWORK_DELIVERY }
```

`DELIVERED` не может вести к Security, NAT, route decision или другому
non-terminal stage. Вся local network-layer processing располагается до
`LOCAL_DELIVERY`.

В текущем executable slice нет `delivery_target`: `DELIVERED` означает только,
что packet передан local network stack текущего processing context. Повторный
route lookup, InterfaceAddress identity lookup, adjacency, L2/L1 и service
health здесь не выполняются.

Explicit endpoint target остаётся будущим расширением resolver/query contract.

## Target semantics

Trace request может иметь:

```text
delivery_target?
```

### Без explicit target

Успех означает:

```text
packet дошёл до local stack, соответствующего текущему translated destination,
согласно known network semantics
```

Это удобно для query:

```text
пойдёт ли packet на public VIP 203.0.113.10:443?
```

DNAT на internal server не считается ошибкой.

### С explicit endpoint target

Например:

```text
target = server APP01 / interface eth0
```

Тогда local delivery к другому endpoint не считается выполнением target.

Это позволяет проверять:

```text
ведёт ли VIP именно к нужному backend?
```

## Port/service target

Пока network delivery завершается на local stack.

Даже если destination port известен:

```text
443
```

NetMap не утверждает, что process слушает этот port.

Позднее service/application model может расширить target predicate.

## Plan selection

На каждом новом processing point resolver должен выбрать applicable:

```text
PacketProcessingPlanAttachment
```

по:

```text
routing context
traffic class
ingress scope
```

Минимальные results:

```text
PLAN_SELECTED
NO_PLAN_CONFIRMED
UNKNOWN
CONFLICTING
```

Selection не является ordered/first-match policy. Все attachments requested set
оцениваются через three-valued ingress-scope applicability:

- несколько `TRUE`, указывающих один plan, схлопываются в `PLAN_SELECTED`;
- разные plans среди `TRUE` дают `CONFLICTING`;
- при `PARTIAL`/`UNKNOWN` coverage результат `UNKNOWN`, если definite conflict уже
  не доказан;
- `TRUE P` вместе с `UNKNOWN P` в complete set остаётся `PLAN_SELECTED P`;
- `TRUE P` вместе с `UNKNOWN Q` даёт `UNKNOWN`;
- complete set без `TRUE` и `UNKNOWN` даёт `NO_PLAN_CONFIRMED`.

Selector только выбирает plan. Он не запускает plan и не выполняет multi-hop
PacketFlow orchestration.

## NO_PLAN_CONFIRMED

Отсутствие special packet processing не должно выводиться просто из:

```text
в базе нет plan
```

Нужна completeness.

Если authoritative model говорит, что processing point использует generic simple behavior, adapter может attach explicit reusable plan:

```text
basic-router
simple-host
```

Так core не имеет hidden default.

## Generic basic-router plan

В качестве reusable normalized plan возможен:

```text
TRANSIT entry
    |
ROUTING_POLICY
    |
ROUTE_DECISION
    |
    +-- FORWARD -> ADJACENCY_L2 -> next point
    |
    +-- LOCAL -> LOCAL_DELIVERY
    |
    +-- DISCARD/NO_ROUTE -> negative
```

Это **явный plan object**, а не hardcoded fallback engine.

## Generic host plan

Например:

```text
LOCAL_OUTPUT
    |
ROUTING_POLICY
    |
ROUTE_DECISION
    |
ADJACENCY_L2

LOCAL_INPUT
    |
LOCAL_DELIVERY
```

Firewall/NAT stages добавляются только если known semantics их требует.

## Plan completeness

Processing plan сам требует completeness/version semantics.

Концептуально:

```text
PacketProcessingPlanSnapshot
    plan_id
    source
    observed_at?
    completeness
    platform_version?
    adapter_version?
```

Configured platform pipeline может быть почти статичной, но configuration-specific attachments меняют graph.

## Почему completeness критична

Если NetMap знает:

```text
route
-> security
-> L2
```

но пропустил неизвестный:

```text
DNAT
```

между ними, все downstream conclusions могут быть неверны.

Поэтому partial processing graph нельзя считать exact pipeline.

## Authoritative platform semantics

Plan может быть получен из:

```text
documented platform processing order
adapter knowledge for exact software version
manual normalized model
authoritative packet-tracer API
```

Provenance должна объяснять источник.

## Software version matters

Processing order может отличаться между versions/platform modes.

Поэтому adapter rule:

```text
FortiOS X.Y uses plan P
```

не должен бесшумно применяться к неизвестной версии.

Если platform semantics version-sensitive и версия неизвестна:

```text
UNKNOWN
reason = PROCESSING_PLAN_VERSION_UNKNOWN
```

лучше guessed pipeline.

## Query-scoped authoritative packet trace

Некоторые platforms предоставляют:

```text
packet-tracer
diagnose flow
policy simulation
```

Authoritative result может сообщить:

```text
matched security rule
selected route
NAT transform
drop reason
```

Такой result может использоваться как strong evidence для конкретного query даже если полный normalized plan не импортирован.

Но NetMap по возможности всё равно normalizes steps в общие stage/result types.

## Plan validation

Перед использованием complete plan должен проходить semantic validation.

Минимальные проверки:

1. entry point существует;
2. stage IDs unique;
3. transitions ссылаются на существующие nodes/terminals;
4. required outcomes обработаны;
5. graph не содержит accidental unreachable stages;
6. normalized plan не содержит unintended local cycles;
7. stage payload совместим с stage kind;
8. referenced policy attachments существуют или имеют valid external resolution;
9. terminal paths определены;
10. provenance/version applicability не противоречит target platform.

## Stage preconditions

Stage может иметь required inputs.

Примеры.

### SECURITY

Может требовать:

```text
ingress known
egress known
connection_state known
```

только если predicates соответствующей policy реально используют эти поля.

### NAT

Может требовать:

```text
egress known
```

для egress-scoped source NAT.

### ADJACENCY_L2

Требует:

```text
current FORWARD route decision
egress L3Binding
```

## Missing precondition

Если stage должен выполняться по plan, но required semantic input отсутствует:

```text
UNKNOWN
reason = STAGE_PRECONDITION_UNKNOWN
```

Orchestrator не переставляет stage автоматически.

## Egress-dependent policy

Пример:

```text
ROUTE_DECISION
    ->
SECURITY(zone ingress->egress)
```

Security stage получает selected egress.

Если adapter ошибочно поставил такую policy до route selection и egress predicate нельзя оценить:

```text
UNKNOWN
```

Это выявляет bad normalization вместо скрытого исправления plan core-ом.

## Route decision lifetime

Route decision остаётся действительным до:

- explicit new route stage;
- перехода на следующий processing point;
- terminal outcome.

Packet mutation сама по себе не аннулирует его автоматически.

Это отражает platform plan semantics.

## Re-route

Если platform реально делает reroute после DNAT:

```text
NAT
    ->
ROUTE_DECISION
```

просто присутствует новый stage.

Этот второй `ROUTE_DECISION` использует текущий `selected_routing_table_id`; он не запускает policy selection автоматически.

Если platform после NAT должна повторно выбрать table, plan обязан явно содержать:

```text
NAT
    ->
ROUTING_POLICY
    ->
ROUTE_DECISION
```

Если route lookup выполняется дважды:

```text
ROUTE_DECISION P0
NAT -> P1
ROUTE_DECISION P1
```

trace сохраняет обе decisions и обе basis packet versions.

## L2 handoff не переносит local decision state

После:

```text
ADJACENCY_L2
    ->
next NetworkInterface
```

новый processing point начинает с:

```text
packet = current packet
ingress = reached interface
traffic_class = TRANSIT or LOCAL_INPUT candidate
```

но:

```text
previous route decision
previous selected routing table
previous egress binding
previous local policy stage position
previous local-only mark
```

не переносятся.

Current wire-visible `PacketState` переносится. Если platform имеет explicit mechanism переноса local metadata, он моделируется отдельной semantics; local mark молча не наследуется.

## Определение TRANSIT vs LOCAL_INPUT

Receiving interface сам по себе не говорит, будет packet routed или locally delivered.

Initial processing entry обычно:

```text
TRANSIT/INGRESS
```

а local route decision уже переводит execution на branch `LOCAL_INPUT`.

Adapter plan может иметь более точную classification semantics.

Core не должен определять:

```text
если dst совпадает с interface address -> local
```

до route/pipeline semantics, если platform делает иначе.

## Security stage result

Overall security `PASS/BLOCKED/UNKNOWN` внутри одного stage не становится end-to-end verdict напрямую.

`BLOCKED` создаёт known-negative packet branch:

```text
termination = SECURITY_BLOCK
```

`PASS` продолжает plan.

## NAT stage result

NAT outcome никогда сам по себе не означает:

```text
DELIVERED
NOT_DELIVERED
```

Даже exact translation просто изменяет current packet.

## Route result

Route `FORWARD` не означает delivery.

Route `LOCAL` ещё может быть заблокирован local-input security.

Route `DISCARD` является known negative.

`NO_ROUTE` является known negative только при authoritative route resolver result.

## L2 result

`L2_UNREACHABLE` может сделать packet branch known-negative.

`L2 UNKNOWN` поднимает uncertainty.

Успешный L2 path только переносит execution на следующий processing point.

## End-to-end verdict

Для Packet Flow используется отдельный верхнеуровневый verdict:

```text
DELIVERED
NOT_DELIVERED
UNKNOWN
```

## DELIVERED

Существует подтверждённая branch, которая:

- следует applicable complete/authoritative processing plans;
- проходит required security stages;
- применяет required NAT transformations;
- имеет подтверждённые routing/lower-layer transitions;
- достигает network delivery target.

## NOT_DELIVERED

Все relevant packet possibilities исчерпывающе завершились known-negative outcomes.

Примеры:

```text
security DROP/REJECT
route DISCARD
confirmed NO_ROUTE
confirmed L2 unreachable
TTL expiration for concrete packet
explicit terminal drop
```

## UNKNOWN

Нельзя доказать ни delivery, ни exhaustive non-delivery.

Примеры:

```text
processing plan unknown
unknown platform order
partial security policy
partial NAT policy
unknown NAT allocation that affects later decision
unknown route selection
unknown ECMP exact choice
dynamic neighbor resolution required
unknown L2 branch
ambiguous next processing context
session state unknown
search limit
```

## Branch aggregation

Упрощённо:

```text
если есть confirmed delivered branch
и query semantics допускает эту branch:
    DELIVERED

иначе если все relevant possibilities
exhaustively known-negative:
    NOT_DELIVERED

иначе:
    UNKNOWN
```

Для exact packet path nondeterministic selection требует осторожности.

## Exact vs possible flow

Trace request может различать:

```text
POSSIBLE
EXACT
```

### POSSIBLE

Вопрос:

> существует ли хотя бы одна допустимая packet realization/path?

Полезен для structural analysis и constrained NAT/ECMP.

### EXACT

Вопрос:

> что произойдёт именно с этим конкретным packet в current state?

Требует exact selection там, где platform делает один выбор:

```text
ECMP
LAG hash
PAT allocation
session binding
```

Если selection неизвестен и possible outcomes различаются:

```text
UNKNOWN
```

## Нельзя смешивать POSSIBLE и EXACT

Пример ECMP:

```text
path A -> firewall permit
path B -> firewall drop
```

`POSSIBLE`:

```text
DELIVERED
```

если path A допустим.

`EXACT` без hash knowledge:

```text
UNKNOWN
```

потому что фактический packet может попасть на B.

## Constrained packet result

`TRANSFORMED_CONSTRAINED` создаёт отдельный `NATPacketConstraint`/symbolic packet result:

```text
source_ip ∈ POOL_A
source_port ∈ range
```

Это не exact `PacketState`. Constrained field нельзя подменять representative address/port, а `packet_base` не делает constrained translated field точным.

Flow engine может сохранять symbolic constraints.

Следующий Security predicate может иногда разрешиться без exact allocation.

Пример:

```text
SNAT pool = 203.0.113.0/28
security rule permits whole 203.0.113.0/28
```

Result может остаться определённым.

## Symbolic branching

Если downstream rule различает members pool:

```text
permit 203.0.113.5
drop other
```

а exact SNAT address unknown:

```text
UNKNOWN exact flow
```

или несколько possible branches для POSSIBLE query.

## Three-valued logic across layers

`UNKNOWN` не обязательно немедленно останавливает весь analysis.

Если все possible resolutions неизвестного stage приводят к одному final result, uncertainty может collapse.

Пример:

```text
unknown NAT source port
```

но downstream route/security вообще не зависят от source port.

Delivery всё ещё может быть доказана.

## Evidence graph

Trace result лучше считать не строковым log, а evidence DAG.

Каждый step:

```text
FlowTraceStep
    stage_id
    input_state_refs
    result
    output_state_refs
    evidence_refs
```

## Evidence refs

Могут включать:

```text
PacketProcessingPlan
ProcessingStage
SecurityPolicy/Rule
NATPolicy/Rule/Transform
RoutingTable/Route/NextHop
NeighborEntry
L2 trace
L1 path
operational state
snapshots/provenance
```

## Explainability invariant

Для каждого meaningful transition NetMap должен уметь ответить:

```text
почему этот stage здесь?
какой PacketState он видел?
какой rule/fact сработал?
что стало с packet?
почему выбрана следующая stage?
```

## Human-readable timeline

Из evidence graph UI может построить:

```text
P0 10.1.20.15:51234 -> 203.0.113.10:8443

FW01 / ingress
  security ACL-IN
    rule 10 PERMIT

  DNAT
    rule 20
    203.0.113.10:8443 -> 10.5.10.8:443

  route lookup using P1
    10.5.10.0/24 -> SERVERS

  zone security
    rule 153 PERMIT

  SNAT
    IDENTITY

  L2
    out port ...
    switch ...
    destination ...

APP01
  local input
    host firewall PASS

NETWORK DELIVERED
```

## Layer summaries

UI может дополнительно агрегировать:

```text
L1 OK
L2 OK
L3 OK
SECURITY PASS
NAT DNAT
DELIVERED
```

Но summary не заменяет detailed evidence.

## First failure view

Для диагностики полезна derived view:

```text
first known blocking/unknown point
```

Например:

```text
UNKNOWN at FW02 / NAT stage
reason:
    NAT rule order incomplete
known path:
    source -> ... -> FW02
```

Или:

```text
BLOCKED at FW01
rule 77 DROP
```

## Несколько failures

При branching может быть несколько blockers.

UI не должен скрывать альтернативы.

Например:

```text
ECMP A -> firewall DROP
ECMP B -> L2 UNKNOWN
```

Exact result:

```text
UNKNOWN
```

с обеими branches.

## Reverse traffic

Forward flow и reverse flow остаются отдельными directed traces.

Успешный:

```text
A -> B
```

не доказывает:

```text
B -> A
```

Особенно при:

```text
stateful firewall
NAT
asymmetric routing
```

## Session-level analysis

Позднее можно добавить composite query:

```text
NEW session from A to B
```

который:

1. trace forward NEW packet;
2. создаёт ephemeral session/NAT effects;
3. trace expected reverse ESTABLISHED packet;
4. возможно анализирует handshake sequence.

Но это **не входит** в базовый Packet Flow Trace.

## Existing session

Effective flow trace может использовать observed:

```text
SessionObservation
NATBindingObservation
```

как input.

Plan stages должны учитывать platform semantics existing-session fast path, если adapter её нормализовал.

## Fast path

Некоторые platforms для established session пропускают часть policy/routing processing.

Нельзя universal предполагать:

```text
каждый packet проходит full new-flow plan
```

Adapter может иметь отдельный plan entry/branch:

```text
existing session
    ->
fast path
```

Если session state влияет на plan selection и неизвестен:

```text
UNKNOWN
```

## Ephemeral simulation state

What-if trace может иметь execution-local:

```text
ephemeral_session_state
ephemeral_nat_bindings
```

Оно:

- не записывается в canonical DB;
- существует только внутри query;
- может использоваться дочерними reverse/generated flow traces.

## Generated packets

Security `REJECT`, TTL expiration и другие stages могут концептуально породить новый packet:

```text
ICMP error
TCP RST
```

Основной branch исходного packet завершается.

Generated response является **отдельным child flow**, если query явно просит его анализировать.

Это предотвращает смешивание двух направлений в одной branch.

## TTL / Hop Limit

Successful routed forwarding hop должен применять lifetime semantics.

Точное место decrement в vendor pipeline может стать explicit stage позднее, если policies реально match TTL.

Для первого plan:

- route decision не мутирует TTL;
- actual forwarding commit на `ADJACENCY_L2` считается routed hop;
- если known TTL/Hop Limit исчерпывается до передачи, branch завершается `TTL_EXPIRED`.

Если query не задал исходный TTL и он не нужен для иных semantics, NetMap его не выдумывает.

## MTU / fragmentation

MTU может позже повлиять на packet delivery:

```text
fragment
PMTUD
DF set
ICMP too big
```

Это отдельная future packet-processing semantics.

Первое ядро не делает вид, что моделирует MTU, если соответствующих facts нет.

## Local service availability

`LOCAL_DELIVERY` заканчивает network trace.

Проверка:

```text
порт слушается?
application отвечает?
TLS работает?
```

не входит в current model.

Иначе NetMap превратился бы из network reasoning engine в full application simulator.

## Processing point identity

PacketProcessingPlan attachment не обязан принадлежать physical `Firewall`.

Processing point может быть:

```text
router
host
VM
virtual firewall
cloud gateway
software namespace
```

Core использует:

```text
routing context
interfaces/bindings
plan attachment
```

а не `class == firewall`.

## Virtual appliances

Виртуальный firewall естественно работает:

```text
VM NetworkInterface
L2
L3Binding
RoutingContext
PacketProcessingPlan
Security/NAT policies
```

Физический host/hypervisor topology раскрывается отдельно через NetworkInterface realization/L1.

## Multi-context firewall

Один physical/logical firewall может иметь несколько:

```text
RoutingContext
```

с разными plans/policies.

Plan attachment к context/scope предотвращает global device-level assumptions.

## Plan versioning

Trace evidence должен включать:

```text
plan version/snapshot
policy snapshots
route snapshots
operational observations
```

Чтобы result можно было воспроизвести.

## Temporal alignment

Для:

```text
at_time = T
```

orchestrator пытается использовать согласованные historical views:

```text
plan/config
security
NAT
routes
neighbor
L2/FDB
operational state
```

Если timestamps существенно несовместимы и это влияет на conclusion:

```text
UNKNOWN
flag = TEMPORAL_MISMATCH
```

## Current trace

`now` всё равно не означает:

```text
использовать любые последние записи независимо от возраста
```

Каждый subresolver применяет собственную freshness policy.

## Read-only invariant

Packet Flow Trace не мутирует canonical state.

Он не:

```text
learns FDB
creates ARP cache
creates firewall session
allocates permanent PAT port
updates counters
```

как persistent effects.

What-if effects только ephemeral.

## Search graph

Execution может ветвиться из-за:

```text
UNKNOWN predicate
ECMP
LAG
symbolic NAT
multiple L2 paths
ambiguous plan/context
```

Trace engine должен иметь:

```text
cycle detection
state deduplication
branch merge
search limits
```

как уже определено для layer resolvers.

## Flow semantic state key

Cycle/dedup key должен учитывать все fields, которые могут изменить дальнейший outcome:

```text
processing context
plan/stage
current PacketState or symbolic constraint
route decision if active
connection/session state
relevant ephemeral NAT/session state
```

Нельзя merge states только потому, что они находятся на одном router.

## Forwarding loop

Packet может пройти:

```text
R1 -> R2 -> R3 -> R1
```

Если current semantic state повторяется и TTL не моделируется/не меняет semantics:

```text
LOOP_DETECTED
```

Если TTL known, loop может закончиться:

```text
TTL_EXPIRED
```

## Plan loop

Unexpected повтор того же local plan stage/state является:

```text
PROCESSING_LOOP
```

для normalized DAG-like plan.

Это обычно говорит об ошибке adapter normalization или explicit recirculation, которую надо моделировать отдельным context handoff.

## Search limits

Минимально:

```text
max hops
max stages
max branches
max symbolic states
max recursion depth
```

При limit:

```text
UNKNOWN
reason = SEARCH_LIMIT
```

Нельзя выдавать `NOT_DELIVERED`.

## Trace mode: configured

Configured flow trace использует:

```text
configured processing plan
configured security/NAT
configured routing intent
configured L2 topology
```

Operational sessions/FDB/state не должны незаметно подменять configured intent, кроме тех lower-layer facts, которые query explicitly допускает.

## Trace mode: effective

Effective flow trace использует:

```text
current plan/version
current security view
current NAT/session binding
installed route/FIB
current operational state
neighbor/FDB/L2 evidence
```

при соблюдении freshness/completeness.

## Mixed mode запрещён молча

Если часть trace использует:

```text
configured route
```

а другая:

```text
current firewall state
```

без explicit query policy, result может быть misleading.

Trace output должен показывать plane/evidence каждого stage.

Позднее query может разрешать controlled mixed-mode analysis.

## Processing plan provenance

Adapter должен сохранять, например:

```text
platform = FortiOS
version = ...
native hooks = ...
normalized by adapter version ...
```

или:

```text
manual plan
author = ...
```

Core не требует конкретного vendor name для execution, но provenance нужна инженеру.

## Adapter contract

Adapter считается корректным только если он:

1. не теряет значимый processing stage;
2. задаёт правильный control-flow order;
3. нормализует policy/NAT semantics;
4. сохраняет native provenance;
5. не объявляет completeness, которой реально нет;
6. учитывает version-specific pipeline semantics;
7. возвращает `UNKNOWN`, если normalization нельзя доказать.

## Тестирование adapter plan

Для каждого platform adapter полезны fixture cases:

```text
input packet/context
expected native result
expected normalized trace result
```

Минимально:

```text
permit
security drop
DNAT
SNAT
local delivery
no route
existing session
```

Это позволяет сравнивать NetMap с native `packet-tracer`/diagnose tooling.

## Почему инструкция потом станет проще

Будущая пользовательская/agent инструкция сможет описывать один общий механизм:

```text
1. нормализуй query в FlowExecutionState;
2. выбери PacketProcessingPlan;
3. выполняй stages по graph;
4. каждый stage вызывай через соответствующий resolver;
5. сохраняй PacketState lineage и evidence;
6. при L2 handoff переходи к plan следующего processing point;
7. не угадывай UNKNOWN;
8. заверши DELIVERED / NOT_DELIVERED / UNKNOWN.
```

Vendor-specific инструкции останутся в adapters, а не в центральном reasoning prompt.

## Пример plan: edge firewall

Концептуально:

```text
ENTRY TRANSIT
    |
S10 ingress-security
    |
    PASS
    v
S20 destination-NAT
    |
    v
S25 routing-policy
    |
    v
S30 route-decision in selected table
    |
    +-- LOCAL --> S70 local-input-security --> LOCAL_DELIVERY
    |
    +-- FORWARD --> S40 zone-security
                       |
                       PASS
                       v
                    S50 source-NAT
                       |
                       v
                    S60 adjacency-L2
                       |
                       v
                    NEXT_PROCESSING_POINT
```

Security block из S10/S40 ведёт к terminal `SECURITY_BLOCK`.

Route discard/no-route из S30 — к соответствующему terminal.

## Пример plan: simple router

```text
ENTRY TRANSIT
    |
ROUTING_POLICY
    |
ROUTE_DECISION
    |
    +-- LOCAL --> LOCAL_DELIVERY
    |
    +-- FORWARD --> ADJACENCY_L2
```

Это plan без firewall/NAT.

## Пример plan: host firewall

```text
LOCAL_OUTPUT
    |
outbound-security
    |
ROUTING_POLICY
    |
route-decision
    |
adjacency-L2

TRANSIT/arrival
    |
ROUTING_POLICY
    |
route-decision
    |
LOCAL
    v
inbound-security
    |
LOCAL_DELIVERY
```

Конкретная OS semantics может иметь другой plan.

## Пример: DNAT изменяет route

```text
P0:
dst = 203.0.113.10

S10 DNAT
    ->
P1:
dst = 10.5.10.8

S15 ROUTING_POLICY(P1)
    -> selected table T

S20 ROUTE_DECISION(P1)
    in table T
    ->
SERVERS
```

Trace ясно показывает, почему internal route выбран по translated address.

## Пример: route before NAT

Если platform semantics:

```text
S05 ROUTING_POLICY(P0) -> selected table T
S10 ROUTE_DECISION(P0, table T)
S20 DNAT -> P1
S30 ADJACENCY_L2
```

NetMap сохраняет:

```text
route basis = P0
neighbor/direct-destination resolution at S30 uses P1
```

если forwarding decision имеет `DIRECT_DESTINATION`.

Никакого hidden reroute.

## Пример: security видит translated destination

```text
P0 dst 203.0.113.10:8443
    |
DNAT
    v
P1 dst 10.5.10.8:443
    |
Security rule:
    dst 10.5.10.8 tcp/443
    PERMIT
```

Evidence:

```text
security evaluated P1
```

## Пример: security видит original destination

Другой plan:

```text
Security(P0)
    |
DNAT -> P1
```

Та же Security model работает без изменений.

## Пример exact dynamic PAT uncertainty

```text
SNAT:
src_ip = 203.0.113.5
src_port ∈ 40000..60000
```

Далее firewall permit:

```text
src_port 50000..51000
```

Exact packet flow:

```text
UNKNOWN
```

если allocator choice неизвестен.

Possible flow:

```text
DELIVERED
```

может быть доказан для части allocations, если query именно `POSSIBLE`.

## Пример symbolic NAT не мешает

SNAT source port неизвестен, но downstream:

```text
route depends only on destination
security permits any source port
```

Trace может сохранить symbolic source port и всё равно доказать:

```text
DELIVERED
```

## Пример incomplete processing plan

Known:

```text
route
security
L2
```

Но plan completeness:

```text
PARTIAL
```

Даже если known stages все successful:

```text
UNKNOWN
```

потому что неизвестный NAT/security stage мог изменить outcome.

## Пример native authoritative result

Platform packet simulator сообщает:

```text
ingress
DNAT rule 10
route X
security rule 20 allow
SNAT rule 30
egress
```

NetMap может создать query-scoped evidence chain и получить exact result, даже если canonical full plan ещё не импортирован.

## Result object

Концептуально:

```text
PacketFlowTraceResult
    verdict
    branches
    delivered_targets[]
    packet_lineage
    evidence_graph
    warnings/gaps[]
```

## Branch object

```text
PacketFlowBranch
    states[]
    steps[]
    termination
    target?
    uncertainty[]
```

## Termination reasons

Минимальные examples:

```text
TARGET_DELIVERED
LOCAL_NETWORK_DELIVERY
SECURITY_DROP
SECURITY_REJECT
ROUTE_DISCARD
NO_ROUTE
L2_UNREACHABLE
TTL_EXPIRED
PLAN_UNKNOWN
PLAN_CONFLICT
STAGE_UNKNOWN
NAT_UNKNOWN
ROUTE_UNKNOWN
L2_UNKNOWN
MISSING_PROCESSING_HANDOFF
PROCESSING_LOOP
FORWARDING_LOOP
SEARCH_LIMIT
```

Причина termination отделена от overall verdict.

## Layer verdicts сохраняются

End-to-end result не стирает subresults.

Например:

```text
L3 route: REACHABLE
Security: BLOCKED
PacketFlow: NOT_DELIVERED
```

или:

```text
Security: PASS
L3: UNKNOWN
PacketFlow: UNKNOWN
```

## Derived path presentation

Canonical evidence может быть очень подробной.

UI может создавать zoom levels:

```text
site-level:
A -> FW01 -> R2 -> B

L3-level:
VRF/route/next-hop

Security-level:
policy/rule

L2-level:
switch/binding/tag

L1-level:
port/cable/fiber
```

Все они являются projections одного trace evidence graph.

## Не хранить result как новую истину

Packet flow result может кэшироваться, но source of truth остаются:

```text
plans
policies
NAT rules
routes
operational facts
L2/L1 topology
```

При invalidation исходных facts trace cache должен перестать считаться current.

## Cache key

Если packet-flow result кэшируется, key должен учитывать как минимум:

```text
origin/context
packet descriptor or symbolic constraints
target
mode
EXACT/POSSIBLE
at_time/view
relevant plan/policy/routing versions
```

Просто:

```text
src IP + dst IP
```

недостаточно.

## Workspace boundary

Packet-flow, policy-routing и plan execution работают внутри уже выбранного workspace:

```text
request/job
    -> auth/access check
    -> workspace selection
    -> workspace-scoped Session/CanonicalRepository
    -> EvaluationView
    -> resolver/orchestrator
```

Plan/policy resolvers не знают user/owner и не используют process-global current workspace. `workspace_id` не становится полем routing-policy domain только ради isolation; canonical facts поступают через уже scoped repository.

## Инварианты

1. Packet Flow Trace является orchestrator, а не новым независимым forwarding layer.
2. Platform processing order задаётся explicit `PacketProcessingPlan`.
3. Нет одного universal security/NAT/routing order.
4. Processing plan является control-flow graph, а не обязательным плоским списком.
5. Security/NAT policy сохраняют свой внутренний ordered first-match semantics.
6. Plan stage является typed semantic operation.
7. Минимальные stage kinds: `PACKET_MARK`, `ROUTING_POLICY`, `ROUTE_DECISION`, `SECURITY`, `NAT`, `ADJACENCY_L2`, `LOCAL_DELIVERY`, `TERMINATE`.
8. Plan applicability задаётся explicit attachment/scope.
9. Traffic class минимум: `LOCAL_OUTPUT`, `TRANSIT`, `LOCAL_INPUT`.
10. Plan имеет explicit entry points.
11. Отсутствие plan без completeness не означает simple forwarding.
12. Generic router/host behavior должен быть explicit reusable plan, а не hidden fallback.
13. Security stage оценивает current PacketState.
14. `IDENTITY` сохраняет exact PacketState, `TRANSFORMED_EXACT` создаёт новый exact PacketState, а `TRANSFORMED_CONSTRAINED` создаёт отдельный constraint.
15. `PACKET_MARK` не мутирует PacketState и изменяет только explicit `LocalProcessingState`.
16. `ROUTING_POLICY` выбирает table, но не ищет route/next hop.
17. Route decision хранит `basis_packet_state` и `selected_routing_table_id`.
18. `ROUTE_DECISION` не выбирает table и не перезапускает `ROUTING_POLICY`.
19. NAT после route decision не вызывает hidden reroute.
20. Repeat route lookup выполняется только explicit routing stage; policy reselection требует explicit `ROUTING_POLICY` stage.
21. Route decision и adjacency/L2 являются разными reusable suboperations.
22. `DIRECT_DESTINATION` adjacency использует current packet destination в момент L2 handoff.
23. `GATEWAY` adjacency использует selected gateway.
24. Successful `ADJACENCY_L2` handoff переносит current packet value на следующий processing point и завершает текущий local plan через `CONTINUE_TO_NEXT_HOP`.
25. Previous route decision, selected table, egress state и local mark не переносятся на следующий hop.
26. Packet lineage обязана сохранять original/current/before/after transformations.
27. Каждый stage возвращает explicit result/evidence.
28. `NEXT_PROCESSING_POINT` создаёт `TRANSIT` context, а `TARGET_ATTACHMENT_REACHED` — `LOCAL_INPUT`; последний сам по себе не является network delivery.
29. `LOCAL_DELIVERY` подтверждает передачу в local network stack только для `LOCAL_INPUT`, не требует exact packet value и не мутирует packet/routing state.
30. `LOCAL_DELIVERY DELIVERED` явно ведёт только в `TERMINATE NETWORK_DELIVERY`.
31. `DELIVERED` означает network delivery, а не application success.
32. Explicit endpoint target может быть независим от original public/NAT destination.
33. End-to-end verdict: `DELIVERED`, `NOT_DELIVERED`, `UNKNOWN`.
34. `NOT_DELIVERED` требует exhaustive known-negative relevant branches.
35. `UNKNOWN` не превращается в negative из-за отсутствия данных.
36. `EXACT` и `POSSIBLE` являются разными query semantics.
37. Exact nondeterministic selection нельзя угадывать.
38. `NATPacketConstraint` не является fake exact PacketState и может продолжать analysis только если downstream stage поддерживает constraint reasoning.
39. Reverse flow анализируется отдельно.
40. Diagnostic flow trace не мутирует persistent FDB/neighbor/session/NAT state.
41. What-if state может быть только ephemeral.
42. Generated reject/ICMP packets являются отдельными child flows.
43. Processing plan имеет provenance/version/completeness.
44. Version-sensitive platform plan нельзя применять к неизвестной version без uncertainty.
45. Partial processing graph не доказывает exact end-to-end path.
46. Adapter обязан нормализовать vendor pipeline без скрытого пропуска значимых stages.
47. Trace evidence должно позволять восстановить, какой PacketState видел каждый rule/route stage.
48. Layer subresults сохраняются и не стираются overall verdict.
46. Trace result является derived data и не становится independent source of truth.
47. Recursive gateway lookup сохраняет selected table и не является новым packet-processing pass.
48. Local mark не является PacketState field или автоматически переносимой wire property.
49. Workspace selection выполняется выше repository/resolver boundary.

## Открытые вопросы

После этой ветки основная end-to-end semantics уже определена.

Отдельно остаются:

- exact shared `PacketPredicate` implementation;
- concrete DB schema для polymorphic stage payloads;
- platform adapter format;
- concrete persistence/resolver implementation согласованных routing-policy stages;
- exact TTL/fragment/MTU processing placement;
- tunnel/MPLS encapsulation stages;
- session fast-path model;
- ephemeral session what-if simulation;
- generated reverse/ICMP child flows;
- symbolic constraint engine;
- application/service-level delivery;
- cache/invalidation strategy;
- historical temporal alignment policy;
- adapter conformance test format.

Следующий архитектурный шаг уже не новый network layer. Имеет смысл перейти к [[02-graph|02. Граф сети]] и определить, как canonical facts компилируются в эффективные graph/projection structures для этих resolver'ов, после чего — к storage/API и инструкции работы системы.
