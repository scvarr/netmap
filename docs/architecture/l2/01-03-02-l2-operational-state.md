# 01.3.2 L2 Operational State

## Статус

Согласованная минимальная модель состояния, необходимого для `effective` L2 trace.

Эта ветка намеренно **не моделирует LACP, STP, RSTP или MSTP как протоколы целиком**.

NetMap хранит/нормализует только те факты, которые влияют на возможность конкретного forwarding transition.

Связанные заметки:

- [[architecture/l1/01-02-network-interface|01.2 NetworkInterface]];
- [[architecture/l2/01-03-l2|01.3 L2 — forwarding model]];
- [[architecture/l2/01-03-01-l2-binding-encapsulation|01.3.1 L2Binding и Encapsulation]];
- [[architecture/tracing/03-02-l2-trace|03.2 L2 Trace]].

## Основной принцип

Для trace engine operational protocol state должен сводиться к вопросу:

> Допустим ли этот конкретный forwarding transition сейчас и в данном направлении?

Например engine не обязан понимать значения:

```text
LACP selected
LACP collecting
LACP distributing
STP root
STP alternate
STP discarding
MST instance 3
```

как фундаментальные классы topology.

Адаптер или protocol resolver нормализует их в небольшое число semantic facts.

Исходные protocol-specific значения могут сохраняться как provenance/debug data и использоваться UI.

## ForwardingEligibility

Общая семантика состояния:

```text
ForwardingEligibility

ELIGIBLE
INELIGIBLE
UNKNOWN
```

### ELIGIBLE

Известные данные подтверждают, что transition допустим в указанном направлении.

### INELIGIBLE

Известные данные подтверждают, что transition сейчас не должен использоваться для обычного user-data forwarding.

### UNKNOWN

Состояние явно не определено, конфликтует или не может быть надёжно выведено.

Кроме явного `UNKNOWN`, такой же результат resolution может получиться при отсутствии достаточных данных или stale observation.

`UNKNOWN` не эквивалентен `INELIGIBLE`.

## Направление

Eligibility задаётся направленно:

```text
INGRESS
EGRESS
```

Даже если большинство реальных состояний симметричны, backend не должен зашивать эту симметрию.

Например LACP различает:

```text
collecting   -> ingress eligibility
distributing -> egress eligibility
```

Поэтому удобное поле `both=true` может существовать на уровне API/import, но canonical semantics должна позволять представить направления независимо.

## Три области применения state

Минимально eligibility должна применяться к трём разным объектам/отношениям:

```text
NetworkInterface

NetworkInterfaceRealization edge

L2Binding
```

Они отвечают на разные вопросы и не должны заменять друг друга.

## NetworkInterface eligibility

State интерфейса отвечает:

> Способен ли сам `NetworkInterface` сейчас участвовать в ingress/egress forwarding?

Типичные источники:

```text
administratively disabled
operationally down
carrier down
upper LAG down
software interface disabled
```

Пример:

```text
NetworkInterface Eth1

configured ingress = ELIGIBLE
configured egress  = ELIGIBLE

operational ingress = INELIGIBLE
operational egress  = INELIGIBLE

reason/evidence: link down
```

Физический `Connection` при этом не удаляется.

```text
L1:
    cable exists

effective L2:
    interface unavailable
```

Это разные факты.

## Configured и operational plane

Нормализованная eligibility может происходить из двух семантических плоскостей:

```text
CONFIGURED
OPERATIONAL
```

### CONFIGURED

Долгоживущий факт конфигурации.

Примеры:

```text
administrative shutdown
binding configured disabled
LAG member configured not participating
```

### OPERATIONAL

Наблюдаемое текущее состояние.

Примеры:

```text
link down
LACP member not distributing
STP binding discarding
```

Operational fact должен иметь как минимум:

```text
source
observed_at
```

и участвует в freshness evaluation.

Конкретная схема хранения plane пока не фиксируется: это может быть одно общее представление eligibility facts или типизированные таблицы.

Семантика для trace engine должна быть одинаковой.

## NetworkInterfaceRealization eligibility

`NetworkInterfaceRealization` отвечает:

```text
upper interface -> lower interface
```

Например:

```text
Port-Channel10 -> Ethernet1
Port-Channel10 -> Ethernet2
```

Operational state должен применяться именно к **ребру realization**, а не только к lower interface.

Это важно:

```text
Ethernet1 operationally up
```

не означает:

```text
Ethernet1 currently participates in Port-Channel10
```

Один и тот же lower interface теоретически может иметь собственное состояние и отдельную eligibility как member конкретной реализации.

## Идентичность realization edge

Чтобы на realization edge можно было ссылаться из state/evidence, отношение должно иметь стабильную идентичность или эквивалентный стабильный composite key:

```text
(upper_interface_id, lower_interface_id)
```

Конкретная реализация БД пока не фиксируется.

## LAG/LACP normalization

Для LAG trace engine нужны две разные задачи:

```text
1. какие lower members сейчас допустимы?
2. какой member выберет конкретный frame?
```

Operational state этой ветки решает только первую.

Пример:

```text
Port-Channel10
├── Eth1  ingress ELIGIBLE / egress ELIGIBLE
├── Eth2  ingress ELIGIBLE / egress INELIGIBLE
└── Eth3  ingress INELIGIBLE / egress INELIGIBLE
```

Для LACP естественная нормализация:

```text
collecting=true
    -> realization ingress ELIGIBLE

collecting=false
    -> realization ingress INELIGIBLE

distributing=true
    -> realization egress ELIGIBLE

distributing=false
    -> realization egress INELIGIBLE
```

Но canonical model не обязана хранить поля `collecting` и `distributing`, если адаптер уже нормализовал результат.

Оригинальные LACP flags могут сохраняться как evidence.

## Static LAG

Static LAG использует ту же модель.

Не требуется отдельный алгоритм:

```text
LACP member state
```

против:

```text
static member state
```

Источник данных просто сообщает eligibility realization edge.

## Upper LAG state

State отдельных members не заменяет состояние upper interface.

Например:

```text
3 members ELIGIBLE
```

но устройство может считать сам LAG down из-за:

```text
min-links
configuration error
protocol state
local policy
```

Если upper interface известен как `INELIGIBLE`, весь переход через него блокируется независимо от отдельных member states.

Если upper state неизвестен, а точный effective trace зависит от него, неопределённость должна сохраняться.

## Member selection не является eligibility

Даже если:

```text
Eth1 ELIGIBLE
Eth2 ELIGIBLE
```

это не означает, что конкретный Ethernet frame пройдёт через оба.

Eligibility определяет candidate set.

Exact member selection может зависеть от:

```text
hash algorithm
source/destination MAC
IP fields
L4 fields
vendor implementation
runtime bucket state
```

Это отдельная будущая semantic policy.

### Reachability

Для structural reachability наличие хотя бы одного гарантированно допустимого member может продолжить branch.

### Frame trace

Если exact member невозможно определить, trace не выбирает случайный member.

В зависимости от query он:

- возвращает несколько possible branches;
- или помечает exact physical path как `UNKNOWN`.

## L2Binding eligibility

`L2Binding` уже задаёт пару:

```text
NetworkInterface <-> L2ForwardingContext
```

Поэтому он является естественной точкой для context-specific forwarding state.

State binding отвечает:

> Может ли user-data frame сейчас пересечь эту boundary между interface и конкретным L2 context?

Это позволяет одному физическому интерфейсу иметь разные состояния для разных L2 contexts.

## STP normalization

STP/RSTP/MSTP должны нормализоваться не в состояние физического порта вообще, а в eligibility соответствующих `L2Binding`.

Пример:

```text
Gi1/0/48
├── Context A / VLAN-like 100 -> ELIGIBLE
└── Context B / VLAN-like 200 -> INELIGIBLE
```

Такое различие возможно, например, когда contexts относятся к разным spanning-tree instances.

Модель не должна делать:

```text
Gi1/0/48 = STP blocked globally
```

если реальная область действия state уже.

## STP state и user-data forwarding

Для целей обычного user-data L2 trace protocol states нормализуются по их forwarding effect.

Типовой смысл:

```text
forwarding
    -> ingress ELIGIBLE
    -> egress ELIGIBLE

discarding/blocking
    -> ingress INELIGIBLE
    -> egress INELIGIBLE

learning/non-forwarding transitional state
    -> user-data forwarding INELIGIBLE
```

Точная protocol state machine остаётся ответственностью адаптера/protocol resolver.

NetMap не обязан симулировать convergence STP.

## MSTP

MSTP instance сам по себе не требуется trace engine.

Адаптер может:

1. получить MST instance membership;
2. определить, какие локальные `L2ForwardingContext`/`L2Binding` затронуты;
3. применить наблюдаемое port state к соответствующим bindings;
4. сохранить исходный MST instance/state как provenance.

В canonical forwarding graph остаётся нужный trace-факт:

```text
binding X egress = INELIGIBLE
```

а не обязанность resolver знать MST configuration internals.

## Почему STP state не на Connection

STP не меняет физику:

```text
Connection
```

продолжает существовать.

И не обязательно меняет весь `NetworkInterface`.

Он ограничивает участие interface в определённом forwarding context.

Поэтому правильная область state:

```text
L2Binding
```

а не:

```text
Connection
```

и не обязательно:

```text
NetworkInterface globally
```

## Нормализованный eligibility fact

Концептуально trace engine может получать факт вида:

```text
ForwardingEligibilityFact
    subject
    direction
    plane
    eligibility
    source
    observed_at?
```

`subject` может ссылаться на:

```text
NetworkInterface
NetworkInterfaceRealization
L2Binding
```

Это **концептуальный интерфейс семантики**, а не зафиксированная схема одной polymorphic таблицы.

При реализации БД facts могут храниться в отдельных типизированных relations/tables.

## Вычисление effective eligibility

Для конкретного transition engine собирает все применимые ограничения.

Упрощённо:

```text
configured gates
        +
operational gates
        +
freshness / conflict resolution
        =
effective eligibility
```

### INELIGIBLE имеет блокирующий эффект

Если достоверный применимый факт говорит:

```text
INELIGIBLE
```

transition не используется в effective trace.

### UNKNOWN сохраняет неопределённость

Если необходимый state:

- неизвестен;
- отсутствует при неизвестной completeness;
- stale;
- конфликтует между источниками;

engine не заменяет его на `ELIGIBLE`.

Branch получает неопределённость.

### ELIGIBLE не отменяет другие gate

Например:

```text
interface = ELIGIBLE
realization member = ELIGIBLE
binding STP state = INELIGIBLE
```

итог:

```text
transition unavailable
```

Все применимые ограничения должны быть удовлетворены.

## Configured trace

В `configured` режиме operational facts не должны молча изменять topology.

Используются configuration-derived semantic rules и configured eligibility.

Пример:

```text
STP currently blocked
```

не удаляет путь из configured projection, если конфигурация сама допускает его.

Но:

```text
interface administratively disabled
```

является configured fact и может блокировать configured trace.

## Effective trace

В `effective` режиме:

```text
configured eligibility
+
актуальная operational eligibility
```

образуют фактический forwarding graph.

Если для требуемого operational gate нет достаточной информации, строгий effective trace должен деградировать в `UNKNOWN`, а не предполагать `up/forwarding`.

Политика `best effort` может быть добавлена позднее как отдельный query mode, но не должна менять строгую семантику `effective`.

## Направленная достижимость

Из-за раздельной ingress/egress eligibility:

```text
A -> B
```

и:

```text
B -> A
```

являются отдельными вопросами.

Например transient LACP state:

```text
collecting = true
distributing = false
```

может дать различную возможность движения в направлениях.

Backend не должен автоматически зеркалировать eligibility.

## L2ReachabilityDomain и асимметрия

Обычная стабильная Ethernet-сеть чаще формирует симметричные области.

Но canonical trace engine не должен использовать это как инвариант.

Если нужна агрегированная симметричная область, возможная политика:

```text
A и B принадлежат одному bidirectional domain
только если
reachable(A -> B) && reachable(B -> A)
```

То есть такая область соответствует взаимной достижимости / strongly connected component effective graph.

Конкретная UI-агрегация будет определена позднее.

## Conflict resolution

Несколько источников могут одновременно утверждать разные состояния.

Например:

```text
source A: ELIGIBLE at 10:00
source B: INELIGIBLE at 10:01
```

Canonical resolver не должен выбирать значение только потому, что одна запись прочитана последней.

Политика разрешения может учитывать:

```text
source authority
observed_at
data quality
adapter confidence
```

Точная модель precedence пока не фиксируется.

Если конфликт не разрешён, effective eligibility становится:

```text
UNKNOWN
```

с evidence на конфликтующие facts.

## Freshness

Operational fact должен иметь временную семантику.

Например:

```text
Eth1 link up
observed_at = T
```

не является вечной истиной.

Freshness policy может зависеть от:

```text
source
fact class
poll interval
query policy
```

Если state необходим для exact effective trace и считается stale, он не должен использоваться как бесспорно актуальный.

По умолчанию это ведёт к `UNKNOWN`.

## Completeness / coverage

Отсутствие operational fact не говорит:

```text
ELIGIBLE
```

или:

```text
INELIGIBLE
```

само по себе.

Нужна информация о coverage источника.

Примеры:

```text
получены состояния всех физических интерфейсов SW1

получены состояния всех members Port-Channel10

получены STP states для всех bindings Context A
```

Модель coverage остаётся отдельной будущей documentation/implementation задачей.

До этого фиксируется правило:

> negative или positive effective conclusion нельзя строить на молчаливом предположении о состоянии, которое источник не подтвердил.

## Protocol provenance

Хотя protocol-specific fields не являются частью минимального forwarding ядра, они полезны для объяснения.

Пример trace evidence:

```text
SW1/Gi48 -> Context A
INELIGIBLE

normalized from:
    protocol = MSTP
    instance = 3
    role = alternate
    state = discarding
    observed_at = ...
```

Или:

```text
Po10 -> Eth2 egress ELIGIBLE

normalized from:
    protocol = LACP
    selected = true
    synchronized = true
    distributing = true
```

Таким образом UI может показывать сетевому инженеру знакомую причину, не заставляя core trace engine знать внутренности каждого протокола.

## Порядок проверки gate

Порядок вычисления может оптимизироваться, но семантически transition зависит от всех применимых gate.

Пример egress через LAG:

```text
Context A
    |
    | binding eligibility
    v
Port-Channel10
    |
    | interface eligibility
    v
NetworkInterfaceRealization
    |
    | member eligibility
    v
Eth2
    |
    | interface eligibility
    v
L1
```

Если любой обязательный gate достоверно `INELIGIBLE`, branch останавливается.

Если gate необходим и `UNKNOWN`, подтверждённая reachability по этой branch отсутствует.

## Branch evidence

При остановке из-за state trace должен указывать:

```text
termination = FORWARDING_BLOCKED
```

и evidence, например:

```text
subject = L2Binding B17
direction = egress
eligibility = INELIGIBLE
source = switch adapter
reason = STP discarding
```

Operational state не должен превращаться в необъяснимый boolean внутри алгоритма.

## Что модель намеренно не решает

Эта ветка не определяет:

- LACP negotiation state machine;
- STP election/root selection;
- STP convergence simulation;
- vendor-specific CLI semantics;
- LAG hash algorithm;
- ECMP;
- multicast forwarding;
- firewall/security policy.

Эти механизмы либо нормализуются адаптером до eligibility facts, либо получают отдельную semantic branch, если они действительно влияют на требуемый trace.

## Инварианты

1. Operational protocols не являются фундаментальными topology classes.
2. Trace engine использует нормализованную `ForwardingEligibility`.
3. Eligibility имеет значения `ELIGIBLE`, `INELIGIBLE`, `UNKNOWN`.
4. Eligibility направленная: ingress и egress независимы.
5. State самого `NetworkInterface`, realization edge и `L2Binding` являются разными областями.
6. Physical link state не удаляет L1 `Connection`.
7. LAG member state принадлежит realization edge, а не только lower interface.
8. Lower interface `up` не означает, что member участвует в конкретном LAG.
9. LAG eligibility определяет candidate members, но не exact member selection.
10. STP-like state нормализуется на `L2Binding`.
11. STP state не должен без необходимости блокировать весь interface глобально.
12. Configured и operational eligibility являются разными planes.
13. Strict effective trace не предполагает `ELIGIBLE` при отсутствии required operational state.
14. Достоверный `INELIGIBLE` блокирует соответствующий transition.
15. `UNKNOWN` не превращается автоматически ни в allow, ни в deny.
16. Все применимые gate должны быть совместимы с transition.
17. Operational fact имеет provenance и temporal semantics.
18. Stale required state не должен бесшумно использоваться как current.
19. Неразрешённый conflict приводит к `UNKNOWN`.
20. L2 reachability является направленной.
21. Симметричная L2-область должна выводиться из взаимной достижимости, если такая проекция нужна.
22. Protocol-specific evidence может храниться для объяснимости без проникновения protocol state machine в core resolver.

## Открытые вопросы

Следующие вопросы остаются отдельными ветками:

- точная модель coverage/completeness;
- freshness policy;
- source precedence/conflict resolution;
- exact LAG member-selection policy для frame trace;
- нужны ли дополнительные eligibility subjects для overlay/virtual switching;
- нужна ли отдельная model административного state или достаточно configured eligibility facts;
- exact STP/LACP provenance schemas для конкретных adapters.

Следующим логичным шагом является определить MAC/FDB model, потому что после operational eligibility это последний крупный недостающий компонент для meaningful `L2 Frame Trace`.
