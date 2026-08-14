# NetMap

Корневое дерево проектирования. Документация ведётся как связный набор заметок в Obsidian-совместимом формате.

- [[01-domain-model|01. Предметная модель]]
  - [[01-01-l1|01.1 L1 — физическая модель]]
    - [[01-01-01-connections|01.1.1 Connection и cardinality]]
  - [[01-02-network-interface|01.2 NetworkInterface — граница L1 и сетевых уровней]]
  - [[01-03-l2|01.3 L2 — forwarding model]]
    - [[01-03-01-l2-binding-encapsulation|01.3.1 L2Binding и Encapsulation]]
    - [[01-03-02-l2-operational-state|01.3.2 L2 Operational State]]
    - [[01-03-03-mac-fdb|01.3.3 MAC и FDB]]
  - [[01-04-l3|01.4 L3 — routing model]]
  - [[01-05-security-policy|01.5 Security Policy]]
  - [[01-06-nat|01.6 NAT — packet transformation]]
- [[02-graph|02. Граф сети]]
  - [[02-01-canonical-view|02.1 Canonical facts и EvaluationView]]
  - [[02-02-resolver-structures|02.2 Resolver structures]]
  - [[02-03-derived-graphs|02.3 Derived graphs и evidence]]
  - [[02-04-projections-aggregation|02.4 Projections и aggregation]]
  - [[02-05-cache-invalidation|02.5 Cache и invalidation]]
- [[03-tracing|03. Трассировка]]
  - [[03-02-l2-trace|03.2 L2 Trace]]
  - [[03-03-l3-trace|03.3 L3 Trace]]
  - [[03-04-packet-flow-trace|03.4 Packet Flow Trace]]
- [[04-data-sources|04. Источники данных]]
- [[05-presentation|05. Представление]]
- [[06-history|06. Хранение и история]]

## Базовые принципы

- Backend хранит факты о сети, а L1/L2/L3/Security являются проекциями и вычисляемыми представлениями этих фактов.
- Визуальное представление не является частью предметной модели.
- Человекочитаемые имена, типы, роли, производители и технологические классификации не определяют идентичность сущностей и хранятся как metadata/aliases.
- Модель не зашивает фиксированные типы зданий, помещений, оборудования, кабелей или сред передачи.
