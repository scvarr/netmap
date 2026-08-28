# NetMap

Корневое дерево проектирования. Документация ведётся как связный набор заметок в Obsidian-совместимом формате.

- [[00-implementation-constraints|00. Ограничения реализации]]
- [[architecture/01-domain-model|01. Предметная модель]]
  - [[architecture/l1/01-01-l1|01.1 L1 — физическая модель]]
    - [[architecture/l1/01-01-01-connections|01.1.1 Connection и cardinality]]
  - [[architecture/l1/01-02-network-interface|01.2 NetworkInterface — граница L1 и сетевых уровней]]
  - [[architecture/l2/01-03-l2|01.3 L2 — forwarding model]]
    - [[architecture/l2/01-03-01-l2-binding-encapsulation|01.3.1 L2Binding и Encapsulation]]
    - [[architecture/l2/01-03-02-l2-operational-state|01.3.2 L2 Operational State]]
    - [[architecture/l2/01-03-03-mac-fdb|01.3.3 MAC и FDB]]
  - [[architecture/l3/01-04-l3|01.4 L3 — routing model]]
  - [[architecture/l3/01-05-security-policy|01.5 Security Policy]]
  - [[architecture/l3/01-06-nat|01.6 NAT — packet transformation]]
  - [[architecture/l3/01-07-policy-routing|01.7 Policy Routing]]
- [[architecture/graph/02-graph|02. Граф сети]]
  - [[architecture/graph/02-01-canonical-view|02.1 Canonical facts и EvaluationView]]
  - [[architecture/graph/02-02-resolver-structures|02.2 Resolver structures]]
  - [[architecture/graph/02-03-derived-graphs|02.3 Derived graphs и evidence]]
  - [[architecture/graph/02-04-projections-aggregation|02.4 Projections и aggregation]]
  - [[architecture/graph/02-05-cache-invalidation|02.5 Cache и invalidation]]
- [[architecture/tracing/03-tracing|03. Трассировка]]
  - [[architecture/tracing/03-02-l2-trace|03.2 L2 Trace]]
  - [[architecture/tracing/03-03-l3-trace|03.3 L3 Trace]]
  - [[architecture/tracing/03-04-packet-flow-trace|03.4 Packet Flow Trace]]
- [[architecture/presentation/05-presentation|05. Представление]]
- [[architecture/workspaces/07-workspaces|07. Workspace и canonical isolation]]
- [[architecture/presentation/08-ui-implementation|08. UI implementation contract]]
- [[reviews/09-ui-ux-review|09. Рабочий L1 UI/UX review]]
- [[plans/09-01-l1-spatial-foundation-plan|09.1 План завершения L1 spatial foundation]]
- [[product/09-02-post-l1-product-roadmap|09.2 Post-L1 product roadmap]]
- [[architecture/blueprints/09-03-port-block-blueprint-architecture|09.3 Port Block Blueprint composition and multi-face physical presentation]]
- [[plans/stabilization/10-stabilization-overview|10. Stabilization — аудиты и backlog]]
  - [[reviews/10-01-audit-findings|10.1 Реестр находок аудитов]]
  - [[plans/stabilization/10-02-stabilization-backlog|10.2 Stabilization backlog]]
  - [[reviews/10-03-performance-baseline|10.3 Performance baseline и бюджеты]]

## Базовые принципы

- Backend хранит факты о сети, а L1/L2/L3/Security являются проекциями и вычисляемыми представлениями этих фактов.
- Визуальное представление не является частью предметной модели.
- Реализованный UI — bounded subset поверх существенно более широкого
  canonical/resolver core. L1 physical presentation сейчас работает прежде
  всего через Saved Maps; карта остаётся presentation scope, а не canonical
  topology или хранилищем connectivity.
- Человекочитаемые имена, типы, роли, производители и технологические классификации не определяют идентичность сущностей и хранятся как metadata/aliases.
- Модель не зашивает фиксированные типы зданий, помещений, оборудования, кабелей или сред передачи.
