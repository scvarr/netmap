# 09.2 Post-L1 product roadmap

## Статус и назначение

Это product/execution direction document после L1.S. Он фиксирует порядок
развития продукта и границы будущих систем, но не является детальным
implementation plan и не создаёт implementation milestones.

Текущий план [[plans/09-01-l1-spatial-foundation-plan|09.1 L1 spatial foundation]]
не пересматривается и продолжается независимо от этой заметки.

Связанные contracts:

- [[architecture/presentation/05-presentation|05. Представление и UX]];
- [[architecture/workspaces/07-workspaces|07. Workspace и canonical isolation]];
- [[architecture/graph/02-04-projections-aggregation|02.4 Projections и aggregation]];
- [[architecture/l2/01-03-l2|01.3 L2 — forwarding model]];
- [[architecture/l3/01-04-l3|01.4 L3 — routing model]].

## Стратегический порядок

**FIXED direction**

1. Завершить текущую серию L1.S spatial foundation.
2. Провести отдельный L1 Product UX / Usability Pass.
3. Сформировать полноценную многопользовательскую основу NetMap:
   authentication, ownership/isolation workspace, sharing/access control,
   comments/annotations, activity/audit.
4. Развивать portability и reusable content: workspace export/import,
   packages библиотек Blueprint, а при реальной потребности — map templates
   или cloning.
5. После зрелого L1 UX и multi-user foundation активно развивать semantic
   presentation L2 и L3.
6. После появления реальных L2/L3 UI use cases развивать observations,
   collectors/adapters, dynamic maps и monitoring/health overlays.

Порядок шагов после multi-user foundation может корректироваться по реальной
product need. Это не повод расширять core «на всякий случай»: L2/L3 backend
semantics уже существенно развиты. После зрелого L1 главным риском является
UX/product/application layer, а не изобретение ещё одного network core.
Backend и API расширяются для конкретного UI/use case.

## L1 Product UX / Usability Pass

**FIXED direction после L1.S**

Цель отдельного pass — сделать L1 NetMap самостоятельным удобным рабочим
инструментом, а не демонстрацией корректной архитектуры. Это будущий usability
review, не перечень уже утверждённых implementation milestones.

Проверяется непрерывный пользовательский workflow:

```text
Blueprint/template
    -> создать PhysicalObject
    -> разместить
    -> найти объект
    -> подключить конкретные порты
    -> проложить/исправить cable
    -> работать с passive internal continuity
    -> читать занятость портов
    -> использовать Saved Maps / detailed maps
    -> выполнить L1 trace
    -> понять результат без знания внутренних domain entities
```

Направления review:

- минимизация технических/internal полей в primary workflow;
- быстрый поиск Blueprint, object и map;
- удобное создание и размещение;
- читаемость больших patch panels и switches;
- ясный occupied/free port state;
- быстрые действия от выбранного порта;
- понятный cable editing;
- понятные destructive actions;
- navigation между общими и детальными Saved Maps;
- Quick Inspector как рабочая поверхность, а не debug panel;
- trace как пользовательская операция «куда уходит этот порт?» или «покажи
  физический путь».

## L1, L2 и L3 как presentation

**FIXED direction**

L1/L2/L3 — разные semantic projections, но не обязательно три отдельные
визуальные карты. Один spatial Saved Map может быть базовой сценой, над которой
UI показывает L1 physical path, L2 forwarding overlay, L3 routing overlay, а
позже security/NAT/operational overlays.

```text
L1: endpoint -> cable -> patch panel -> cable -> switch

L2 overlay: ingress interface
    -> VLAN/bridge/forwarding decision
    -> egress interface

L3 overlay: ingress
    -> routing decision
    -> next-hop/egress
```

Logical и aggregated layouts остаются допустимыми отдельными projections.
Отдельные L2/L3 Saved Map views этим не отменяются.

### L2 semantic aggregation

L2 — не просто L1 map с VLAN labels. Несколько canonical endpoints/interfaces
могут collapse в один presentation aggregate, когда они эквивалентны в текущей
L2 semantics. Например:

```text
24 endpoints -> SW1 Gi0/1-24 -> ACCESS VLAN 20

24 x PC / VLAN 20
        |
SW1 Gi0/1-24 ACCESS VLAN 20
```

Такой aggregate не создаёт canonical group, не сливает identity
`PhysicalObject`, хранит supporting canonical/evidence refs и должен быть
explainable/expandable. Passive patch panel на L2 может свернуться до compact
physical-path context.

Ключевое различие scaling: L1 масштабируется прежде всего spatial hierarchy и
detailed Saved Maps, L2 — прежде всего semantic aggregation/collapse. Exact L2
grouping heuristics остаются OPEN до реального L2 UI milestone.

## Physical Media, Link Capability и Transport Diagnostics

**FUTURE product direction; не меняет стратегический порядок и не создаёт
implementation milestone**

Когда появится соответствующий L1/L2/L3 UX use case, NetMap может развивать
диагностику physical media, wired/wireless transport и capacity. Точная позиция
этой capability остаётся product-driven после уже зафиксированных направлений
roadmap.

### Четыре разных класса facts

Нельзя смешивать в одном «speed кабеля» четыре разные области:

1. Relatively stable configured/inventory facts установленного component/medium:
   cable copper/fiber/DAC/other, category/profile, construction, length,
   connector/media context; media/capability characteristics passive components,
   patch panels, couplers и transceivers.
2. Capability: что component или `NetworkInterface` поддерживает — link rates,
   PHY modes, transceiver capabilities, media/frequency/channel combinations,
   passive rating.
3. Configured link state: auto-negotiation, forced/configured rate, duplex и
   mode.
4. Operational/observed link state: negotiated rate/duplex, current PHY mode,
   link state, source, `observed_at` и freshness.

Capability не доказывает configured или negotiated state, а operational
observation не является immutable property кабеля/порта. Structured capability
profiles должны быть reusable definitions/references для cable authoring,
Blueprint/library content, validation, capability analysis и presentation. Они
не являются закрытым enum: конкретный profile schema, storage и API остаются
OPEN. Blueprint/library identity и identity конкретного `PhysicalObject` также
остаются разными; visual cable authoring позже может предлагать reusable profile
и optional length вместо raw metadata.

### Wired capability и capacity path

Effective capability нельзя свести к `ConnectionPoint.speed`: физическая точка
описывает место подключения, а `NetworkInterface` — сетевую реализацию через
него. Будущий resolver может учитывать `NetworkInterface`, transceiver,
`ConnectionPoint`, cable, passive path components, remote endpoint, medium/profile,
length, PHY, lanes, configured mode и remote capability. Не фиксируются ни
универсальное правило вроде `Cat6 = 10 Gbps`, ни standards engine.

Поверх доказанного path NetMap может показывать известную capacity-цепочку и
bottleneck, например `10G -> 10G -> 10G -> 1G -> WAN`. Это означает «на этом
участке известно link-rate/capability ограничение 1 Gbps», а не «реальная
throughput равна 1 Gbps»: throughput дополнительно зависит от utilization,
congestion, shaping/policing, forwarding/firewall performance, характеристик
пакетов, provider limits и других факторов.

Полезный diagnostic case — mismatch: обе стороны и physical path способны на
10G, а observation сообщает 1G. UI может сопоставить `capable/expected: 10G` с
`observed: 1G` и показать область проверки (cable/termination, transceiver,
forced mode, remote endpoint, PHY/errors), но не утверждает причину без evidence.

### Wireless transport

Приоритетная wireless ветка — устойчивые transport links: WiMAX, point-to-point
и point-to-multipoint radio, microwave/radio bridge и другой backhaul. User
Wi-Fi associations могут появиться позднее, но не являются главным driver.

Wireless transport не должен изображаться фиктивным wired `Cable`/`Connection`.
Он требует отдельной structured technology semantics поверх shared
`PhysicalObject` / `NetworkInterface` foundation; final entity `WirelessLink` и
DB schema сейчас не фиксируются. Его configured facts могут включать band/
frequency, channel, channel width, remote endpoint/sector, configured mode/
capacity и другие stable parameters. Operational observations отдельно несут
RSSI/signal strength, SNR/CINR, modulation, negotiated/operational PHY rate,
availability, errors/quality, source, `observed_at` и freshness. Universal radio
metric schema не предполагается.

Wireless segment участвует в том же capacity analysis, что и wired. Например
`1G -> Radio Ethernet 100M -> WiMAX operational 40M -> Base Station 1G -> 10G`
может честно указать текущий bottleneck 40M как изменяемое observation, а не
вечное свойство physical topology.

### Transport trace и QinQ visibility

Для сложной transport сети future product surface может объединить в одном trace
physical medium/path, L2 encapsulation state, доказанные transformations,
capacity и unknown sections. Conceptual hop table:

```text
Hop | Physical transport | Encapsulation before/after | Transformation | Capacity | Evidence/state
```

QinQ уже выражается существующими `EncapsulationStack`, `dot1q`, `dot1ad`,
stacked labels, ingress match, egress emit, translation и derived push/pop
semantics. Новая canonical QinQ/transport trace engine semantics не нужна.
Adapters позднее нормализуют vendor configuration в этот contract, не выводя
семантику из vendor-specific names. Known -> `UNKNOWN TRANSFORMATION` -> known
остаётся честным результатом; несовместимые stack expectations дают
`UNKNOWN`/conflict, а не выдуманный path.

## Observations, collectors и operational presentation

**FIXED direction; не текущий implementation plan**

Conceptual pipeline:

```text
external source/device
    -> collector/adapter
    -> raw observation
    -> normalization
    -> identity resolution/reconciliation
    -> presentation / comparison with canonical model
```

Универсальным должен быть normalized observation contract, а не один
универсальный parser всех устройств. Возможные adapters/sources включают SNMP,
SSH/CLI, REST/API, NETCONF, RouterOS API, LLDP/CDP, Nmap, Zabbix и другие
monitoring/discovery sources; этот перечень не является обязательным.

Сильный invariant: observation означает «источник сообщил X» и не становится
автоматически canonical topology fact. Conceptual trust progression:

```text
Observation -> Resolved observation -> Canonical fact
```

Переход контролируется product/application rules. Например, LLDP может
подтвердить canonical L1-связь `SW1/Gi48` — `SW2/Gi47`; если же canonical L1
утверждает другое, UI показывает drift/conflict, а не молча переписывает
topology.

Для этого направления adapters могут нормализовать wired interface speed,
configured/negotiated rate, duplex, errors и transceiver data; wireless signal,
modulation, operational capacity и availability; transport/L2 QinQ/service
configuration, VLAN rewrite, LLDP/adjacency и operational state. Эти facts
сохраняют source и temporal evidence и не переписывают canonical model без
явного reconciliation decision.

### Временное измерение

Observed data следует моделировать как временные observations, а не только как
mutable current field. Conceptually важны source, `observed_at`,
freshness/validity, value и evidence. Это открывает current state,
historical snapshot, состояние до/после аварии и timeline изменения
operational state. Time-series database сейчас не проектируется.

### Operational overlays

Monitoring source, например Zabbix, может предоставлять normalized health
state: `OK`, `INFO`, `WARNING`, `HIGH`, `DISASTER`, `UNKNOWN/STALE`. Это не
final API enum. Presentation может свернуть его в normal/green,
warning/yellow, problem/red и unknown/stale/gray.

Health — operational observation, не canonical topology semantics. Возможные
map modes: topology, topology + health, problems only. Quick Inspector в
перспективе показывает source, `observed_at`, severity, problem refs/details.

### Dynamic Maps

Обычная Saved Map имеет membership, явно заданный пользователем. У Dynamic Map
membership/projection может вычисляться из query или observations, например
«VLAN 20», «LLDP topology ядра», «все устройства с active problems».

```text
Collectors
    -> Observation store
    -> Dynamic Maps / overlays / Object Detail / analysis
```

Collector не привязан к запуску конкретной карты. При обновлении dynamic
membership желательно сохранять presentation state стабильно идентифицированных
элементов, когда это возможно. Exact query language, persistence и scheduling
остаются OPEN.

### Secrets и data sources

Credentials для SNMP/API/SSH/Zabbix и других collectors — application secrets.
Workspace `VIEW` permission не даёт права видеть credentials, а обычный
workspace export не должен переносить secrets открытым текстом. Exact secrets
storage и datasource permissions остаются OPEN.

## Границы решений

Эта roadmap фиксирует product direction, но намеренно не определяет DB tables,
REST endpoints, DTO fields, auth provider, ACL schema, archive format,
Dynamic Map query language, observation storage или универсальный aggregation
engine. Эти решения появляются только вместе с конкретным UI/use case.
