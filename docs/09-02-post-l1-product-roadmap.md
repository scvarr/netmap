# 09.2 Post-L1 product roadmap

## Статус и назначение

Это product/execution direction document после L1.S. Он фиксирует порядок
развития продукта и границы будущих систем, но не является детальным
implementation plan и не создаёт implementation milestones.

Текущий план [[09-01-l1-spatial-foundation-plan|09.1 L1 spatial foundation]]
не пересматривается и продолжается независимо от этой заметки.

Связанные contracts:

- [[05-presentation|05. Представление и UX]];
- [[07-workspaces|07. Workspace и canonical isolation]];
- [[02-04-projections-aggregation|02.4 Projections и aggregation]];
- [[01-03-l2|01.3 L2 — forwarding model]];
- [[01-04-l3|01.4 L3 — routing model]].

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
