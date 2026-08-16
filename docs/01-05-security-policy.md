# 01.5 Security Policy

## Статус

Согласованная базовая модель firewall/security policy.

Эта ветка определяет:

- `PacketState`, который видит security resolver;
- локальный `SecurityEvaluationContext`;
- scope/attachment policy;
- ordered security stages;
- ordered first-match rules;
- typed predicate tree;
- трёхзначную логику `TRUE / FALSE / UNKNOWN`;
- действия `PERMIT / DROP / REJECT`;
- explicit default action;
- configured/effective policy views;
- completeness и conflict handling;
- минимальную stateful/connection-state semantics;
- объяснимость rule match;
- строгую границу между security decision и NAT.

Эта ветка намеренно **не моделирует vendor firewall engines как отдельные классы**.

NAT как отдельная packet transformation model определён в [[01-06-nat|01.6 NAT — packet transformation]]. Полный end-to-end processing order определён концептуально в [[03-04-packet-flow-trace|03.4 Packet Flow Trace]].

Связанные заметки:

- [[01-04-l3|01.4 L3 — routing model]];
- [[03-03-l3-trace|03.3 L3 Trace]];
- [[03-02-l2-trace|03.2 L2 Trace]];
- [[01-03-02-l2-operational-state|01.3.2 L2 Operational State]].

## Основной принцип

Security resolver отвечает на вопрос:

> Что делает известная security policy с данным packet state в конкретной точке обработки?

Он не отвечает сам по себе:

```text
существует ли route?
```

или:

```text
куда физически пойдёт frame?
```

Эти вопросы уже решают L3/L2/L1 resolvers.

И наоборот:

```text
L3 path exists
```

не означает:

```text
packet permitted
```

Security является отдельным gate поверх packet path.

## Не vendor model

Canonical core не должен иметь фундаментальные subclasses:

```text
CiscoACL
FortiGatePolicy
PaloAltoRule
JuniperFilter
iptablesChain
nftablesChain
WindowsFirewallRule
```

Adapter преобразует vendor syntax/semantics в нормализованную policy model.

Исходные rule IDs, CLI, package names, zones, object names и protocol-specific details сохраняются как provenance/evidence.

## PacketState

Security policy оценивает **конкретное состояние packet на данной стадии processing**.

Концептуально:

```text
PacketState
    source_ip
    destination_ip
    ip_protocol
    source_port?
    destination_port?
    icmp_type?
    icmp_code?
```

Поля добавляются только если они реально участвуют в forwarding/security/NAT semantics.

Например позже могут понадобиться:

```text
DSCP
IPv6 flow label
fragment state
application identity
user identity
```

Но они не должны появляться в core заранее без сценария.

Local mark/fwmark принципиально не входит в `PacketState`. Это transient `LocalProcessingState`, определённый в [[01-07-policy-routing|01.7 Policy Routing]]. Если platform переносит значение через wire-visible поле вроде DSCP, моделируется именно соответствующее packet field.

## Почему PacketState отдельный объект

Packet identity может изменяться по мере processing.

Например будущий NAT может создать:

```text
PacketState before DNAT
PacketState after DNAT
PacketState after SNAT
```

Security rule должен оцениваться над **тем PacketState, который реально существует в его processing stage**.

Поэтому security policy не должна хранить скрытое предположение:

```text
rules always see original IP
```

или:

```text
rules always see translated IP
```

Порядок stages задаст будущий packet-flow orchestrator.

## PacketState immutable для одного step

Одна security evaluation не мутирует входной `PacketState`.

Результат policy:

```text
PERMIT
DROP
REJECT
```

не меняет:

```text
source_ip
destination_ip
ports
protocol
```

Packet transformations являются отдельными transitions.

Это важно для воспроизводимости и explainability.

## SecurityEvaluationContext

Кроме packet fields policy может зависеть от локального контекста прохождения.

Runtime context:

```text
SecurityEvaluationContext
    packet_state
    traffic_class
    routing_context_id?
    ingress_network_interface_id?
    egress_network_interface_id?
    ingress_l3_binding_id?
    egress_l3_binding_id?
    connection_state?
```

Не все поля обязаны быть известны на каждой стадии.

Например ingress ACL может оцениваться до выбора egress.

Zone-based forwarding policy обычно требует уже известные ingress и egress scopes.

## TrafficClass

Минимально различаются:

```text
TRANSIT
LOCAL_INPUT
LOCAL_OUTPUT
```

### TRANSIT

Packet маршрутизируется через local forwarding function.

### LOCAL_INPUT

Packet предназначен local stack/control plane/service текущего node/context.

### LOCAL_OUTPUT

Packet создан local stack и выходит наружу.

L2-only/bridged security может быть добавлена позднее как отдельная traffic class или расширение scope.

Она не требуется для первого L3 firewall use case.

## SecurityPolicy

Базовая policy:

```text
SecurityPolicy
    id
```

Человекочитаемые поля:

```text
alias.display
description
vendor_policy_id
```

могут быть metadata/provenance.

Forwarding semantics задаётся не именем policy, а ordered rules и explicit default action.

## SecurityPolicyAttachment

Policy сама по себе не говорит, где она применяется.

Применимость задаётся отдельным relation:

```text
SecurityPolicyAttachment
    id
    policy_id
    stage_order
    scope
```

`scope` является structured selector над `SecurityEvaluationContext`.

Конкретная физическая SQL-схема selector пока не фиксируется.

## SecurityScope

Минимально scope должен позволять ограничивать policy по:

```text
traffic_class
routing_context
ingress NetworkInterface / L3Binding
egress NetworkInterface / L3Binding
```

Каждое ограничение может быть:

```text
specific ID
normalized set of IDs
any
```

Policy attachment может использовать только часть полей.

Пример ingress ACL:

```text
traffic_class = TRANSIT
ingress_l3_binding = WAN
egress = any
```

Пример zone-like inter-segment policy:

```text
traffic_class = TRANSIT
ingress_l3_binding in USERS_BINDINGS
egress_l3_binding in SERVERS_BINDINGS
```

## Zone не является источником истины

Vendor zone:

```text
USERS
SERVERS
DMZ
```

полезна человеку и адаптеру.

Но canonical trace semantics не должна зависеть только от строки:

```text
from-zone = USERS
```

Адаптер нормализует membership зоны в structured set:

```text
USERS -> {L3Binding A, L3Binding B, ...}
```

и сохраняет исходное zone name/id как evidence.

Позднее `SecurityZone` может существовать как reusable grouping entity для UI/import, но core evaluation должен уметь работать по разрешённому membership, а не по имени.

## Несколько policy stages

На одном forwarding hop packet может последовательно проходить:

```text
ingress ACL
zone policy
global policy
egress ACL
```

Поэтому applicable policies образуют ordered stages.

`stage_order` определяет порядок security evaluations **относительно других security stages**.

Полный порядок относительно routing/NAT будет задан будущим packet-processing pipeline.

## PERMIT не означает глобальный allow

Это критический инвариант.

Если ingress ACL говорит:

```text
PERMIT
```

packet может быть позже заблокирован zone policy.

Поэтому canonical action:

```text
PERMIT
```

означает:

> текущий security stage разрешает продолжить processing.

Общий security result становится `PASS` только если все обязательные applicable stages успешно permit packet.

## SecurityRule

Внутри policy rules имеют строгий порядок:

```text
SecurityRule
    id
    policy_id
    order_key
    predicate
    action
```

`order_key` должен задавать total order внутри selected policy view.

Он не обязан быть contiguous integer:

```text
10
20
30
```

или vendor sequence number допустимы, если порядок однозначен.

## Rule identity

Rule identity не должна зависеть от:

```text
display name
line number in rendered config
text comment
```

Если vendor имеет стабильный UUID/rule ID, он может использоваться как provenance/external identity.

Canonical `SecurityRule.id` остаётся стабильным внутренним ID.

## First-match semantics

Нормализованная policy использует:

```text
first terminal matching rule wins
```

Adapter обязан преобразовать vendor-specific chain/jump/package semantics к эквивалентному effective ordered rule view насколько это возможно.

Это позволяет core resolver не интерпретировать:

```text
iptables jump
nftables verdict maps
FortiGate policy package internals
vendor chain return semantics
```

напрямую.

## Почему first-match допустим как canonical form

Большинство firewall/ACL semantics могут быть представлены как ordered decision program.

Если vendor engine имеет процедурные конструкции, adapter может:

1. прочитать native program;
2. применить known vendor semantics;
3. нормализовать semantic evaluation path;
4. сохранить native rule graph как provenance/debug data.

Если adapter не может доказать эквивалентный порядок/результат:

```text
policy evaluation = UNKNOWN
```

а не guessed first-match.

## SecurityPredicate

Rule predicate является typed boolean expression tree.

Минимальные combinators:

```text
ALL(children)   # AND
ANY(children)   # OR
NOT(child)
TRUE
FALSE
```

Leaf predicates являются structured semantic atoms.

## Минимальные packet predicates

Первое ядро должно уметь выразить:

```text
source IP in prefix set
destination IP in prefix set
IP protocol in set
source port in range/set
destination port in range/set
ICMP type/code
connection state in set
```

Также допустимы context predicates:

```text
routing context in set
ingress binding/interface in set
egress binding/interface in set
traffic class in set
```

## Address sets

Rule не должен хранить строку:

```text
"Office_Networks"
```

как единственную forwarding semantics.

Named vendor object/group нормализуется в semantic set:

```text
10.10.0.0/16
10.20.0.0/16
192.0.2.10/32
```

а исходное имя/structure сохраняется как provenance.

Canonical implementation может хранить reusable normalized address sets, если это уменьшает duplication.

Но имя set не определяет его содержимое.

## Service objects

Аналогично vendor:

```text
HTTPS
WEB-SERVICES
DB-PORTS
```

не являются фундаментальными rule actions/types.

Они нормализуются в predicates:

```text
protocol = TCP
destination_port = 443
```

или более сложный boolean expression.

Original service object сохраняется для UI/evidence.

## Protocol representation

IP protocol лучше хранить как нормализованное numeric/semantic value.

Например:

```text
TCP = 6
UDP = 17
ICMP = 1
ICMPv6 = 58
```

Human alias остаётся presentation.

Port predicate имеет смысл только для packet/protocol, где этот field существует.

## Three-valued predicate logic

Predicate evaluation возвращает:

```text
TRUE
FALSE
UNKNOWN
```

### TRUE

Известные packet/context facts подтверждают match.

### FALSE

Известные facts подтверждают, что match невозможен.

### UNKNOWN

Недостаточно данных для решения.

Например rule:

```text
dst TCP/443
```

а trace request знает:

```text
protocol = TCP
destination_port = unknown
```

Результат rule predicate:

```text
UNKNOWN
```

а не `FALSE`.

## Boolean algebra с UNKNOWN

Базовая безопасная логика:

```text
NOT UNKNOWN = UNKNOWN
```

Для `ALL`:

```text
если есть FALSE -> FALSE
иначе если есть UNKNOWN -> UNKNOWN
иначе TRUE
```

Для `ANY`:

```text
если есть TRUE -> TRUE
иначе если есть UNKNOWN -> UNKNOWN
иначе FALSE
```

Это позволяет анализировать partial packet descriptors без ложной определённости.

## Ordered evaluation

Policy resolver идёт по rules сверху вниз.

Для каждого rule:

```text
FALSE
    -> continue

TRUE
    -> apply action

UNKNOWN
    -> нельзя просто пропустить rule
```

UNKNOWN rule может shadow все последующие rules.

## Unknown match как branching

Безопасная semantic модель:

```text
rule predicate = UNKNOWN
```

создаёт две логические possibilities:

```text
branch A: rule matches -> action
branch B: rule does not match -> evaluate next rules
```

Если обе possibilities в итоге дают один и тот же forwarding result, resolver может collapse результат.

Если outcomes различаются:

```text
UNKNOWN
```

## Пример shadow uncertainty

Policy:

```text
10: dst-port 22  -> DROP
20: any          -> PERMIT
```

Query:

```text
protocol = TCP
destination_port = unknown
```

Rule 10:

```text
UNKNOWN
```

Rule 20:

```text
TRUE
```

Нельзя вернуть:

```text
PERMIT
```

потому что packet может оказаться TCP/22.

Результат:

```text
UNKNOWN
```

с evidence на rule 10.

## Rule actions

Минимальные terminal actions:

```text
PERMIT
DROP
REJECT
```

### PERMIT

Текущий security stage пропускает packet к следующему stage.

### DROP

Packet блокируется без обязательного response semantics.

### REJECT

Packet блокируется и policy намерена сообщить об отказе.

Exact generated response:

```text
TCP RST
ICMP unreachable
ICMP administratively prohibited
```

может быть дополнительной structured/evidence semantics позднее.

Core security verdict для исходного packet всё равно:

```text
BLOCKED
```

## Non-forwarding side effects

Такие действия, как:

```text
LOG
COUNT
TAG
ALERT
```

не должны автоматически становиться terminal security action.

Если они не меняют packet forwarding, adapter может сохранить их как rule side effects/evidence.

Если local tag/mark позднее влияет на routing/security, он становится typed `LocalProcessingState` и изменяется explicit processing operation. Только protocol-visible значение может стать соответствующим `PacketState` field.

## NAT не SecurityRule action

Нельзя делать canonical action:

```text
ALLOW_AND_SNAT
DNAT_AND_ACCEPT
```

NAT изменяет packet identity.

Security отвечает:

```text
можно ли processing продолжаться?
```

NAT отвечает:

```text
каким становится PacketState?
```

Даже если vendor UI хранит их одной строкой, adapter должен разделить semantic effects.

Обе canonical записи могут ссылаться на один native vendor rule provenance.

## SecurityRule не выбирает route

Policy action:

```text
PERMIT
```

не содержит:

```text
next hop
egress router
routing table
```

Если security engine умеет policy-route/redirect, это отдельный packet-processing action и будет определено в routing-policy/packet-flow branch.

Security rule не превращается в Route.

## Explicit default action

Каждая complete normalized policy должна иметь explicit:

```text
default_action
```

минимально:

```text
PERMIT
DROP
REJECT
```

Нельзя полагаться на backend convention:

```text
firewall всегда implicit deny
```

или:

```text
ACL по умолчанию permit
```

Vendor adapter обязан нормализовать реальную default semantics.

## No match

Если все rules:

```text
FALSE
```

и policy view complete:

```text
apply explicit default_action
```

Если policy data incomplete или default неизвестен:

```text
UNKNOWN
```

## SecurityPolicySnapshot

Policy import/observation должен иметь version/snapshot semantics.

Концептуально:

```text
SecurityPolicySnapshot
    id
    source
    observed_at
    completeness
```

Snapshot определяет согласованный набор:

```text
policies
attachments
rule order
rules
default actions
normalized object contents
```

Physical storage может быть оптимизировано через versions/deltas.

Semantic trace должен уметь указать, какую policy view он использовал.

## Completeness

Минимально:

```text
COMPLETE
PARTIAL
UNKNOWN
```

### COMPLETE

Источник подтверждает, что relevant policy semantics достаточно полна для evaluation.

### PARTIAL

Известно, что rules/attachments/objects представлены не полностью.

### UNKNOWN

Полнота не подтверждена.

## Partial ordered policy особенно опасна

Для routing/FDB partial data уже опасна.

Для ordered firewall rules ещё опаснее.

Даже если NetMap нашёл matching rule:

```text
rule 100 PERMIT
```

в partial snapshot, он не знает, нет ли перед ним неизвестного:

```text
rule 50 DROP
```

Поэтому matching rule из partial ordered policy **обычно не доказывает final decision**.

Исключение возможно только если coverage явно гарантирует нужный prefix/order region или источник предоставляет authoritative query-scoped evaluation result.

## Query-scoped policy evaluation

Некоторые платформы могут иметь API/CLI вида:

```text
packet-tracer
policy lookup
test security-policy-match
```

Authoritative result для конкретного packet/context может быть самостоятельным evidence:

```text
matched rule X
decision PERMIT
```

даже если NetMap не импортировал весь policy set.

Модель источников данных должна позднее позволить отметить такую query-scoped completeness.

## Attachment completeness

Отсутствие `SecurityPolicyAttachment` в базе не означает:

```text
security policy отсутствует
```

если NetMap не знает, что attachments данного processing point собраны полностью.

Поэтому applicability discovery тоже требует coverage.

Различаются:

```text
authoritatively no applicable policy
```

и:

```text
NetMap просто не получил policies
```

## No policy

Если attachment coverage complete и для processing point нет applicable security stages:

```text
SecurityResult = PASS
reason = NO_POLICY_APPLICABLE
```

Это не то же самое, что explicit permit rule, но packet может продолжать processing.

Если coverage unknown:

```text
SecurityResult = UNKNOWN
```

## Multiple applicable stages

Resolver:

1. находит applicable attachments;
2. сортирует их по известному `stage_order`;
3. передаёт текущий `PacketState` каждому stage согласно packet-flow processing plan;
4. оценивает policy.

Если stage:

```text
PERMIT
```

processing продолжается.

Если:

```text
DROP / REJECT
```

pipeline security result:

```text
BLOCKED
```

Если stage:

```text
UNKNOWN
```

и нет другого доказательства, которое делает outcome одинаковым для всех possibilities:

```text
UNKNOWN
```

## Stage order uncertainty

Если несколько applicable stages существуют, но их относительный порядок важен из-за packet transformations между ними, а order неизвестен:

```text
UNKNOWN
```

Security-only stages сами packet не мутируют, но NAT и explicit `PACKET_MARK`/`ROUTING_POLICY`/`ROUTE_DECISION` stages делают placement критичным.

Полный processing order будет принадлежать `Packet Flow Trace`.

## SecurityResult

Минимальный общий результат security evaluation:

```text
PASS
BLOCKED
UNKNOWN
```

### PASS

Все required applicable stages подтверждённо permit packet либо authoritative coverage подтверждает отсутствие policy.

### BLOCKED

Хотя бы один definitely applicable stage подтверждённо применяет:

```text
DROP
REJECT
```

к packet на его actual processing path.

### UNKNOWN

Нельзя доказать ни PASS, ни BLOCKED.

Например:

```text
missing rule data
unknown rule match
ambiguous attachment
unknown stage order
unknown connection state
stale dynamic object membership
conflicting policy snapshots
```

## BLOCKED не означает L3 unreachable

Security result:

```text
BLOCKED
```

может существовать при:

```text
L3 Reachability = REACHABLE
```

Это нормальная диагностическая ситуация:

```text
routing path exists
firewall intentionally denies packet
```

Future packet-flow result должен сохранять оба факта.

## ConnectionState

Stateful policy часто зависит от connection/session semantics.

Минимальный normalized state:

```text
ConnectionState

NEW
ESTABLISHED
RELATED
INVALID
UNKNOWN
```

Это semantic input для predicate, а не попытка симулировать конкретный vendor conntrack implementation.

Vendor-specific states могут нормализоваться в эти значения либо остаться richer evidence, если однозначная нормализация невозможна.

## ConnectionState не угадывается

Если query:

```text
TCP src -> dst:443
```

не говорит, является ли packet новым или частью existing session, backend не должен автоматически считать:

```text
NEW
```

если security decision зависит от state.

UI/API может предлагать явный convenience mode:

```text
new connection
```

который устанавливает:

```text
ConnectionState = NEW
```

## SessionObservation

Для effective trace current firewall может предоставить session/conntrack observation.

Концептуально:

```text
SessionObservation
    flow identity
    normalized connection_state
    source
    observed_at
```

Точная session model откладывается.

Security resolverу важен normalized state и evidence.

## Return traffic

Reverse traffic является отдельным направленным packet flow.

Нельзя заключить:

```text
forward flow PERMIT
=>
reverse flow PERMIT
```

без stateful semantics.

Для stateful firewall future orchestrator может анализировать:

```text
forward NEW
```

и затем:

```text
reverse ESTABLISHED
```

если simulation/session semantics позволяет доказать создание session.

Базовая security policy этого side effect сама не создаёт.

## Read-only trace

Security trace не должен мутировать session table.

Проверка:

```text
would this NEW flow be permitted?
```

не создаёт canonical:

```text
ESTABLISHED session
```

Так же как L2 frame trace не мутирует FDB learning.

What-if session simulation должна использовать отдельное ephemeral state.

## Dynamic address groups

Firewall rules могут ссылаться на dynamic groups:

```text
FQDN objects
cloud tags
directory groups
threat feeds
dynamic address groups
```

Если membership влияет на decision, оно является structured observed fact с provenance/freshness.

Если membership неизвестен:

```text
predicate = UNKNOWN
```

Нельзя считать unknown group пустой.

## DNS/FQDN objects

Rule:

```text
destination = example.internal
```

не должен сравнивать packet IP со строкой hostname.

Adapter/resolver должен иметь временной resolved set:

```text
FQDNObjectSnapshot
    hostname
    IP set
    observed_at
    completeness
```

если такая функция реально добавляется.

До этого policy, зависящая от unresolved FQDN membership, даёт uncertainty.

## Time-based rules

Rule schedule может влиять на match.

Если модель поддерживает time predicate, evaluation использует:

```text
query at_time
```

а не wall clock скрыто внутри resolver.

Historical trace должен быть воспроизводим.

Time-based predicates не добавляются в первое ядро, пока не появится реальный use case.

## Application/User identity

Next-generation firewalls могут принимать решения по:

```text
application
user
device identity
TLS/SNI
URL category
```

Эти поля не являются частью минимальной L3 security model.

Predicate system должен быть расширяемым, чтобы позже добавить typed atoms.

Если policy decision зависит от неизвестного application/user field:

```text
UNKNOWN
```

лучше, чем попытка считать правило IP/port-only.

## Configured security

Configured view отвечает:

> какое policy intent можно вывести из известной конфигурации?

Она использует:

```text
configured rules
configured objects/groups
configured attachments
configured defaults
```

Operational session state не должен незаметно менять configured result.

Для stateless question этого часто достаточно.

## Effective security

Effective view может дополнительно учитывать:

```text
current session state
dynamic group membership
rule enable/disable runtime
cluster/firewall active state
current application identity
current time-dependent state
```

Но core не обязан пересчитывать vendor firewall runtime engine, если adapter предоставляет authoritative effective evaluation.

## Disabled rules

Disabled native rule не должна случайно участвовать в normalized effective ordered policy.

Adapter может:

- исключить её из effective view;
- сохранить как configured-but-disabled structured fact;
- сохранить native evidence.

Как именно отображать disabled rules — presentation/history concern.

## Conflict resolution

Если два equally authoritative policy snapshots дают разные decisions:

```text
source A: rule X PERMIT
source B: rule Y DROP
```

и precedence/freshness не разрешают конфликт:

```text
SecurityResult = UNKNOWN
flag = CONFLICTING_DATA
```

Нельзя использовать «последняя прочитанная строка победила» как domain semantics.

## Freshness

Configured policy обычно меняется медленнее FDB, но dynamic security state может быть быстро меняющимся.

Freshness особенно важна для:

```text
sessions
dynamic groups
FQDN membership
active cluster node
temporary rules
```

Policy view должна ссылаться на observation time/source.

Stale dynamic fact не используется как бесспорно current.

## Rule evidence

Каждый final decision должен объяснять:

```text
which policy
which attachment/stage
which rule
which predicate atoms matched
which default action if no rule matched
which source/snapshot
```

Пример:

```text
FW01
stage: zone policy USERS -> SERVERS
policy: P17
rule: 153
match:
    src 10.1.20.15 in USERS_NET
    dst 10.5.10.8 in APP_NET
    protocol TCP
    dst-port 443
action: PERMIT
```

## Default evidence

Если decision получен default action:

```text
matched rule = none
default = DROP
```

trace должен показать это явно.

Нельзя придумывать synthetic rule `implicit deny` без связи с policy semantics.

UI может отображать:

```text
default DROP
```

как отдельную причину.

## Policy stage evidence

Если packet проходит несколько stages:

```text
ingress ACL        PERMIT rule 10
zone policy        PERMIT rule 153
egress ACL         PERMIT default
```

trace сохраняет весь список.

Пользователь должен видеть не только последний allow.

## Reject-generated traffic

`REJECT` может вызвать новый reverse packet.

Например:

```text
TCP RST
ICMP unreachable
```

Базовая security evaluation фиксирует:

```text
original packet BLOCKED by REJECT
```

но не запускает generated packet автоматически.

Future Packet Flow Trace может опционально создавать отдельную дочернюю flow branch.

## L3 processing context

Transit security обычно вызывается после того, как L3 resolver уже знает:

```text
ingress L3Binding
selected egress L3Binding
RoutingContext
```

Но некоторые stages работают до route lookup.

Поэтому security model не фиксирует единственный момент вызова.

Packet Flow Trace будет явно вставлять policy evaluations в processing pipeline.

## Policy match после NAT

Если vendor pipeline:

```text
DNAT
then security policy
```

security получает translated destination.

Если:

```text
security
then SNAT
```

security получает pre-SNAT source.

Это ещё одна причина, почему policy оценивает explicit current `PacketState`, а NAT не встроен в SecurityRule.

## Coupled vendor rule

Native config может выглядеть концептуально:

```text
from USERS to WAN
permit
source NAT interface-address
```

Adapter создаёт semantic facts:

```text
SecurityRule:
    predicate ...
    action PERMIT

NAT rule/effect:
    transform source ...
```

с общей provenance ссылкой на native rule.

Так core сохраняет корректную decomposition, не теряя связь с реальным config.

## Policy ownership

SecurityPolicy может принадлежать:

```text
physical firewall
virtual firewall
host firewall
router ACL subsystem
cloud security function
```

Но ownership не определяет applicability.

Applicability задаёт `SecurityPolicyAttachment`.

Конкретная generic logical owner entity будет определена только если она потребуется нескольким слоям модели.

## Не нужен фундаментальный Firewall class

Для trace важны:

```text
где policy применяется
какие rules
какой packet state
какой decision
```

Тип объекта:

```text
firewall
router
Linux host
cloud gateway
```

может быть classification metadata.

Core не обязан проверять:

```text
if class == firewall then evaluate policy
```

## Пример: ingress ACL + zone policy

Processing point знает:

```text
ingress = WAN
egress = SERVERS
packet = TCP 198.51.100.10 -> 10.5.10.8:443
```

Applicable stages:

```text
stage 10: WAN ingress ACL
stage 20: WAN -> SERVERS policy
```

Stage 10:

```text
rule 100 PERMIT tcp/443
```

Stage 20:

```text
rule 153 PERMIT APP_HTTPS
```

Result:

```text
SecurityResult = PASS
```

Evidence содержит обе rules.

## Пример: поздний block

```text
stage 10 ingress ACL -> PERMIT
stage 20 zone policy -> DROP rule 77
```

Overall:

```text
BLOCKED
```

Причина:

```text
policy stage 20
rule 77
action DROP
```

`PERMIT` stage 10 не делает flow глобально allowed.

## Пример: unknown port

Policy:

```text
10: tcp dst 22 -> DROP
20: any        -> PERMIT
```

Packet:

```text
protocol = TCP
dst_port = unknown
```

Result:

```text
UNKNOWN
```

а не `PASS`.

## Пример: incomplete policy

Imported rules:

```text
100: HTTPS -> PERMIT
200: any   -> DROP
```

но snapshot:

```text
PARTIAL
```

Query matches rule 100.

Нельзя доказать:

```text
PERMIT
```

потому что неизвестный earlier rule мог бы shadow 100.

Result:

```text
UNKNOWN
```

если нет stronger query-scoped evidence.

## Пример: authoritative no policy

Coverage говорит:

```text
all security attachments for transit path X known
```

Applicable attachments:

```text
none
```

Result:

```text
PASS
reason = NO_POLICY_APPLICABLE
```

## Пример: unknown attachment coverage

В базе нет firewall rules, но source coverage неизвестна.

Result:

```text
UNKNOWN
```

а не:

```text
PASS
```

Это защищает от самого опасного класса ложных «всё разрешено».

## Минимальное концептуальное ядро

```text
SecurityPolicyAttachment
        |
        v
SecurityPolicy
        |
        +-- SecurityRule[]
        |       |
        |       +-- SecurityPredicate
        |       +-- PERMIT / DROP / REJECT
        |
        +-- explicit default action
```

Runtime:

```text
PacketState
    +
SecurityEvaluationContext
    |
select applicable attachments
    |
ordered policy stages
    |
ordered rule evaluation
    |
PASS / BLOCKED / UNKNOWN
```

## Canonical / observed / derived

### Canonical/configured facts

Могут включать:

```text
SecurityPolicy
SecurityPolicyAttachment
SecurityRule
SecurityPredicate
default action
normalized address/service sets
```

### Operational observations

Могут включать:

```text
current session/connection state
dynamic group membership
current policy snapshot
cluster active state
query-scoped policy match
```

### Derived results

```text
predicate result
matched rule
stage decision
overall SecurityResult
```

Derived result не становится independent source of truth.

## Инварианты

1. Security policy является отдельным layer gate и не является `Route`.
2. L3 reachability не означает security permit.
3. Canonical core не зависит от vendor firewall class/syntax.
4. Policy оценивает explicit current `PacketState`.
5. Security evaluation сама не мутирует `PacketState`.
6. NAT является отдельным packet transformation.
7. `SecurityEvaluationContext` явно содержит доступный ingress/egress/routing scope.
8. `TRANSIT`, `LOCAL_INPUT`, `LOCAL_OUTPUT` являются минимальными traffic classes.
9. Policy applicability задаётся `SecurityPolicyAttachment`, а не именем firewall object.
10. Zone name не является источником истины; zone membership нормализуется в structured scope.
11. На одном hop может быть несколько ordered security stages.
12. `PERMIT` означает permit текущего stage, а не глобальный allow.
13. Security rules имеют deterministic total order в complete normalized policy.
14. Canonical policy использует first terminal match semantics.
15. Если vendor semantics нельзя надёжно нормализовать, resolver возвращает uncertainty.
16. Rule predicate является typed structured expression, а не свободной строкой.
17. Predicate evaluation использует `TRUE / FALSE / UNKNOWN`.
18. Missing required packet field даёт `UNKNOWN`, а не `FALSE`.
19. UNKNOWN earlier rule нельзя молча пропускать.
20. Rule actions минимум: `PERMIT`, `DROP`, `REJECT`.
21. Logging/counters не являются terminal forwarding action.
22. Security rule не выбирает route.
23. Complete policy имеет explicit default action.
24. Default action нельзя применять при insufficient rule completeness.
25. Partial ordered rule set обычно не доказывает final decision даже при найденном match.
26. Attachment discovery тоже имеет completeness semantics.
27. Authoritative no-policy и missing-policy-data являются разными состояниями.
28. Общий security result минимум: `PASS`, `BLOCKED`, `UNKNOWN`.
29. `BLOCKED` может существовать одновременно с L3 `REACHABLE`.
30. Connection/session state не угадывается, если он влияет на rule match.
31. Forward и reverse flow являются отдельными направленными запросами.
32. Trace не создаёт persistent session state как side effect.
33. Dynamic groups/identities имеют provenance/freshness.
34. Security decision должен иметь evidence до policy/rule/default action.
35. Vendor combined security+NAT rule раскладывается на отдельные semantic effects.
36. Policy ownership не определяет applicability.
37. Фундаментальный `Firewall` subclass не требуется core resolver.

## Открытые вопросы

Следующие ветки намеренно откладываются:

- platform-specific order DNAT/security/SNAT;
- policy-based routing/redirect actions;
- exact session/conntrack model;
- ephemeral what-if session simulation;
- generated reject/ICMP response flows;
- dynamic address/FQDN object schemas;
- application/user identity predicates;
- time schedules;
- L2/bridged firewall policy;
- proxy/service-chain security functions;
- HA/cluster ownership of policy state;
- historical policy diff/version UX;
- source precedence and cross-source conflict resolution.

Следующий логичный шаг — определить NAT как отдельную packet transformation model, а затем собрать `03.4 Packet Flow Trace`, который композиционно вызывает routing, security, NAT, neighbor и L2 resolvers в правильном порядке.
