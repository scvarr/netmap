# 01. Предметная модель

Родительская заметка для сущностей и отношений NetMap.

## Ветки

- [[01-01-l1|01.1 L1 — физическая модель]]
  - [[01-01-01-connections|01.1.1 Connection и cardinality]]
- [[01-02-network-interface|01.2 NetworkInterface — граница L1 и сетевых уровней]]
- [[01-03-l2|01.3 L2 — forwarding model]]
- [[01-04-l3|01.4 L3 — routing model]]
- [[01-05-security-policy|01.5 Security Policy]]
- [[01-06-nat|01.6 NAT — packet transformation]]
- [[01-07-policy-routing|01.7 Policy Routing]]

## Общий принцип

Предметная модель должна описывать минимальный набор устойчивых фактов. Такие понятия, как `switch`, `patch-panel`, `outlet`, `UTP Cat5e`, `OS2`, `single fiber` и аналогичные, не являются фундаментальными типами backend. При необходимости они задаются metadata.

Идентичность сущности задаётся стабильным ID. Человекочитаемое имя — alias/metadata и может изменяться без изменения топологии.

## Граница физики и сетевых уровней

`ConnectionPoint` и `NetworkInterface` являются разными сущностями. Первая описывает физическую точку соединения, вторая — логическую точку сетевой обработки. Их связывает явный `InterfacePhysicalBinding`.

Составные логические интерфейсы не требуют специальных классов: базовая зависимость задаётся через `NetworkInterfaceRealization`. Подробности: [[01-02-network-interface|01.2 NetworkInterface]].

## L2

L2 не моделируется как глобальный список VLAN. Базовыми фактами являются локальные `L2ForwardingContext`, привязки интерфейсов к ним и внешнее представление Ethernet frame на интерфейсе.

`VLAN ID` не является идентичностью L2-сети. Сквозной `L2ReachabilityDomain` является производным результатом анализа локальных forwarding context, L2 bindings, L1-топологии и текущего forwarding state.

Подробности: [[01-03-l2|01.3 L2 — forwarding model]].

## L3

L3 строится вокруг локального `RoutingContext`, а не глобального пространства IP-адресов. `VRF` является распространённой реализацией такого контекста, но не фундаментальным типом backend.

IP-адрес назначается через `L3Binding` конкретному `NetworkInterface` внутри routing context. Маршрутизация описывается `RoutingTable`, `Route` и явными next-hop relations.

Выбранный L3 next hop затем разрешается в link-layer destination и передаётся существующему L2 resolver. Таким образом route не содержит магическую ссылку на «следующее устройство».

Подробности: [[01-04-l3|01.4 L3 — routing model]].

Выбор routing table, transient local mark и границы `PACKET_MARK -> ROUTING_POLICY -> ROUTE_DECISION` определены отдельно в [[01-07-policy-routing|01.7 Policy Routing]].

## Security Policy

Security не встраивается в `Route` и не сводится к boolean `allowed` на L3 edge.

Canonical security model описывает ordered policy evaluation над явным `PacketState` и явным локальным processing context. Применимость policy задаётся структурированными attachments/scopes, а vendor-specific ACL/zone/firewall syntax нормализуется адаптерами.

`PERMIT` означает разрешение продолжить текущий security stage. `DROP`/`REJECT` останавливают packet. NAT остаётся отдельным packet transformation и не является security action.

Подробности: [[01-05-security-policy|01.5 Security Policy]].

## NAT

NAT моделируется как отдельная трансформация текущего `PacketState`, а не как `Route` и не как security action.

Canonical NAT model выбирает applicable ordered rule над явным packet/context state и возвращает новый packet state либо множество допустимых transformed states. SNAT, DNAT, PAT, port forwarding, identity NAT и twice NAT являются производными формами общих field transformations.

Полный порядок NAT относительно routing/security определяется будущим packet-processing pipeline.

Подробности: [[01-06-nat|01.6 NAT — packet transformation]].
