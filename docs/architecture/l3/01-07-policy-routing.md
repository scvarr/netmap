# 01.7 Policy Routing

## Статус

Согласованный conceptual contract для выбора routing table и локального packet-mark processing.

Эта ветка фиксирует semantic boundaries перед реализацией `PacketProcessingPlan`. Она не задаёт SQL schema, migrations, API или конкретную vendor policy model.

Связанные заметки:

- [[architecture/l3/01-04-l3|01.4 L3 — routing model]];
- [[architecture/tracing/03-03-l3-trace|03.3 L3 Trace]];
- [[architecture/tracing/03-04-packet-flow-trace|03.4 Packet Flow Trace]];
- [[architecture/l3/01-05-security-policy|01.5 Security Policy]];
- [[architecture/l3/01-06-nat|01.6 NAT — packet transformation]];
- [[architecture/workspaces/07-workspaces|07. Workspace и canonical isolation]].

## Авторитетный порядок операций

Минимальная routing-processing цепочка:

```text
PACKET_MARK
    ->
ROUTING_POLICY
    ->
ROUTE_DECISION
```

Это три разные semantic operations:

- `PACKET_MARK` может изменить transient local-processing metadata;
- `ROUTING_POLICY` выбирает `RoutingTable`;
- `ROUTE_DECISION` выполняет lookup только внутри уже выбранной table.

Ни одна из этих операций не должна скрыто подменять другую.

## PacketState и local metadata

`PacketState` описывает текущую wire-visible packet identity:

```text
PacketState
    source_ip?
    destination_ip?
    ip_protocol?
    source_port?
    destination_port?
    icmp_type?
    icmp_code?
```

Local mark/fwmark не является полем `PacketState`.

Он не является:

- полем IP packet;
- Ethernet/frame property;
- автоматически переносимой характеристикой flow между processing nodes.

Если платформа передаёт значение через реально существующее protocol-visible поле, например DSCP, это значение моделируется соответствующим полем `PacketState`, а не магическим сохранением local mark.

## LocalProcessingState

Transient local metadata принадлежит отдельному runtime concept:

```text
LocalProcessingState
    local_mark?
```

Точный physical domain `local_mark` пока открыт. Без дополнительного platform contract он не фиксируется как integer, string или vendor-specific bit layout.

Семантика `LocalProcessingState`:

- существует только внутри конкретного local processing execution;
- не является canonical packet identity;
- не изменяется NAT;
- может читаться `ROUTING_POLICY`;
- может изменяться только explicit `PACKET_MARK`-like operation;
- не наследуется автоматически следующим router/firewall после L2 handoff.

`ConnectionState` остаётся отдельным runtime processing context. Он не становится ни `PacketState`, ни local mark.

## PACKET_MARK

`PACKET_MARK` — самостоятельная processing operation:

```text
input:
    current PacketState
    current LocalProcessingState
    local processing context

output:
    same PacketState
    new LocalProcessingState
```

Инварианты:

- `PACKET_MARK` не мутирует `PacketState`;
- `PACKET_MARK` не выбирает `RoutingTable`;
- `PACKET_MARK` не выполняет route lookup;
- `PACKET_MARK` не является NAT;
- result и evidence stage должны быть explicit;
- скрытый process-global fwmark запрещён.

Canonical storage mark rules/policies в этой ветке не фиксируется. Это отдельный implementation slice, но будущий `PacketProcessingPlan` обязан уметь явно разместить `PACKET_MARK` stage.

## RoutingPolicy

Минимальная conceptual model:

```text
RoutingPolicy
    id
    configured_completeness
    explicit default selection

RoutingPolicyRule
    id
    policy_id
    order_key
    predicate
    action
```

Первая core action:

```text
SELECT_TABLE(routing_table_id)
```

`RoutingPolicy` получает:

```text
PacketState
    +
LocalProcessingState
    +
local processing context
```

и возвращает выбранную table либо typed uncertainty/conflict.

`RoutingPolicy` не:

- ищет route;
- разрешает recursive next hop;
- выполняет L2 handoff;
- меняет `PacketState`;
- выполняет NAT;
- выполняет Security;
- изменяет local mark.

Direct-next-hop PBR action, redirect, egress override, VRF transfer и mark mutation не маскируются под `SELECT_TABLE`. Если vendor PBR выбирает next hop напрямую, это richer processing semantics отдельного будущего slice.

## RoutingPolicy predicate

Predicate conceptually может учитывать:

`PacketState`:

- source/destination IP;
- protocol;
- source/destination port.

Local context:

- current `RoutingContext`;
- ingress `NetworkInterface`/`L3Binding`;
- traffic class.

`LocalProcessingState`:

- local mark.

Packet predicates должны переиспользовать typed three-valued predicate semantics NetMap. Context и local-state predicates также должны быть typed.

Vendor zone/name/string не является forwarding truth. Конкретная JSON representation predicates до implementation milestone не фиксируется.

## Ordered three-valued semantics

`RoutingPolicyRule` имеет строгий total order по `order_key` и использует:

```text
TRUE
FALSE
UNKNOWN
```

Ordered first-match evaluation:

```text
FALSE
    -> continue

TRUE
    -> SELECT_TABLE(table)

UNKNOWN
    -> MATCH possibility
    -> NO_MATCH possibility
```

UNKNOWN rule нельзя молча пропустить.

Если все logical possibilities выбирают одну table, result может collapse в `TABLE_SELECTED`.

Если possibilities выбирают разные tables или часть possibilities не позволяет определить selection:

```text
TABLE_SELECTION_UNKNOWN
```

Если equally authoritative canonical facts дают несовместимые conclusions:

```text
CONFLICTING
```

Incomplete ordered `RoutingPolicy` обычно не доказывает selected table даже при known matching rule: неизвестный earlier rule мог его shadow. Применяются те же conservative completeness principles, что в Security и NAT.

## Explicit default selection

Complete policy имеет explicit default selection semantics.

Она может выбрать конкретную table либо явно сообщить отсутствие доказанной selection согласно будущей typed model.

Нельзя подменять default selection эвристикой:

- table name `main`;
- минимальный UUID/ID;
- display alias;
- insertion/DB-return order.

Explicit primary/default-table fact может быть основанием table selection. Это всё равно `ROUTING_POLICY`/table-selection semantics, а не hidden behavior `ROUTE_DECISION`.

## Validity selected table

`SELECT_TABLE` может выбрать только `RoutingTable`, которая:

- существует в canonical view;
- принадлежит текущему `RoutingContext`;
- совместима с address family текущего lookup.

Невалидная canonical reference является model error. Недостаточная completeness или неопределённый policy match дают typed uncertainty, а не произвольный fallback.

## ROUTING_POLICY result

Минимальные conceptual results:

```text
TABLE_SELECTED
TABLE_SELECTION_UNKNOWN
CONFLICTING
```

При `TABLE_SELECTED` artifact сохраняет:

- `RoutingPolicy`;
- matched rule или explicit default;
- `selected_routing_table_id`;
- basis `PacketState`;
- relevant `LocalProcessingState`;
- local context и evidence;
- logical MATCH/NO_MATCH branches, если они участвовали в collapse.

`TABLE_SELECTED` не утверждает, что route существует. Последующий `ROUTE_DECISION` может вернуть `NO_ROUTE`, `DISCARD`, `LOCAL`, `FORWARD`, `UNKNOWN` или `CONFLICTING` согласно L3 semantics.

## ROUTE_DECISION boundary

`ROUTE_DECISION` получает уже выбранную table:

```text
current PacketState
current RoutingContext
selected_routing_table_id
```

И выполняет:

```text
route lookup in selected RoutingTable
    ->
recursive next-hop resolution in same RoutingTable
```

`ROUTE_DECISION` никогда:

- не выбирает table скрыто;
- не ищет `main`/primary/min-ID fallback;
- не запускает `ROUTING_POLICY`;
- не мутирует `PacketState` или `LocalProcessingState`.

Если selected table отсутствует, packet-flow layer получает:

```text
TABLE_SELECTION_UNKNOWN
```

до запуска `ROUTE_DECISION`.

## Recursive next-hop resolution

Gateway recursion является внутренней работой одного `ROUTE_DECISION`:

```text
lookup destination D in table T
    -> gateway G
lookup G in SAME table T
    -> ...
```

На всей recursion chain:

- `routing_table_id = T` сохраняется;
- `original_destination = D` сохраняется;
- меняется только `lookup_address`;
- purpose меняется на `NEXT_HOP_RESOLUTION`;
- `ROUTING_POLICY` повторно не вызывается.

Recursive lookup не является новым packet-processing pass и не запускает:

- `PACKET_MARK`;
- `ROUTING_POLICY`;
- Security;
- NAT;
- entry point `PacketProcessingPlan`.

Gateway address не становится новым `PacketState.destination_ip`.

## Explicit reroute и policy reselection

Packet mutation сама по себе не запускает routing заново.

Plan:

```text
ROUTING_POLICY
-> ROUTE_DECISION
-> NAT
-> ROUTE_DECISION
```

означает: второй `ROUTE_DECISION` использует текущий `selected_routing_table_id`, если plan явно его не изменил.

Если platform после NAT повторяет policy selection, plan обязан сказать это явно:

```text
NAT
-> ROUTING_POLICY
-> ROUTE_DECISION
```

Таким образом reroute, table reuse и policy reselection являются explicit plan semantics.

## Handoff к следующему processing point

После успешного L2/wire handoff:

- текущий wire-visible `PacketState` переносится;
- создаётся новый local execution context;
- previous route decision очищается;
- `selected_routing_table_id` очищается;
- local-only mark не наследуется.

Если платформа действительно переносит local metadata отдельным mechanism, этот mechanism должен быть смоделирован явно. Process-global или неявное наследование запрещено.

## Workspace boundary

Policy routing не меняет workspace contract:

```text
request/job
    -> auth/access check
    -> workspace selection
    -> workspace-scoped Session/CanonicalRepository
    -> EvaluationView
    -> resolver
```

`RoutingPolicy` conceptually не содержит `workspace_id`. Resolver не знает user/owner и работает только с canonical facts, видимыми через уже scoped repository/session. Process-global current workspace запрещён.

## Инварианты

1. `PACKET_MARK`, `ROUTING_POLICY` и `ROUTE_DECISION` — разные operations.
2. Local mark не является `PacketState` или frame field.
3. `PACKET_MARK` меняет только `LocalProcessingState`.
4. `ROUTING_POLICY` выбирает table и не ищет route.
5. `ROUTE_DECISION` получает selected table и не выбирает её.
6. Recursive gateway resolution сохраняет selected table и original destination.
7. Recursion не перезапускает policy/packet processing.
8. NAT меняет packet state; PACKET_MARK — нет.
9. NAT не вызывает automatic reroute или policy reselection.
10. Ordered UNKNOWN predicate ветвится, а не пропускается.
11. Incomplete policy не даёт ложной selected table.
12. Table name/ID/alias/order не являются selection heuristic.
13. Local mark не переносится автоматически на следующий processing node.
14. Workspace выбирается выше resolver/repository boundary.

## Открытые вопросы

Отдельными milestones остаются:

- SQL schema `RoutingPolicy`/`RoutingPolicyRule`;
- exact predicate JSON schema;
- local mark physical value domain;
- PACKET_MARK rule storage;
- policy attachment/coverage model;
- direct-next-hop PBR и redirect;
- VRF transfer/leaking;
- effective/observed policy routing;
- concrete `PacketProcessingPlan` persistence and execution.
