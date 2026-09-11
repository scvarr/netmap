# 11.4 Phase C representative L1 testbed

## Назначение и граница

Этот документ — living acceptance-scenario document для Phase C из
[[plans/11-03-pre-l2-product-completion|11.3 Pre-L2 product completion]]. Он
фиксирует границу между подтверждённым real-world skeleton и synthetic fixture,
который используется для постепенной проверки NetMap. Это не architecture spec
и не inventory source.

Цель стенда — проверить truthful L1 modeling, Blueprint/PortBlock authoring,
PhysicalObject/ConnectionPoint/Cable workflows, Locations и racks, SavedMap
presentation, Regions/routes, L1 trace и понятность UI без знания внутренних
entity IDs. Если реальная схема не может быть честно выражена текущей моделью,
это Phase C finding, а не повод подменять факт фиктивной topology.

## CONFIRMED REAL-WORLD SKELETON

Подтверждены следующие реальные сведения; они не устанавливают неизвестные
модели, порты или member mappings:

1. Есть упрощённая тестовая сборка этажа с рабочей цепочкой имён:
   `pc1 — o1 — pp1 — sw1`.
2. `sw1` — этажный коммутатор.
3. Стойка/шкаф 811 — коммуникационный/распределительный шкаф.
4. В 811 сходятся линии от этажей и линии в сторону серверной.
5. От 811 в другие шкафы приходят оптические линии на patch-panel/component,
   который пользователь описывает как «1 к 24».
6. Точная внутренняя физика и конструкция «1 к 24» пока неизвестна.
7. Стойка 833 содержит два Cisco, работающих в StackWise; эти Cisco являются
   ядром сети.
8. В 833 есть сервер с двумя оптическими интерфейсами.
9. Тестовый стенд используется не как точная копия production, а как
   representative synthetic model с разнообразными типами устройств.

Эти facts не подтверждают точные роли `o1`/`pp1`, аппаратные модели, ports,
fiber members или physical StackWise cabling.

### OPEN / UNKNOWN real-world details

Следующие сведения пока неизвестны и не должны становиться canonical facts без
подтверждения:

- точная роль и тип `o1`;
- точная роль и аппаратная модель `pp1`;
- точная аппаратная модель оборудования в 811;
- точное значение «1 к 24»: не называть это splitter, 24-port panel,
  fan-out или другим конкретным типом без подтверждения;
- vendor/model двух Cisco-коммутаторов;
- exact StackWise physical cabling и ports;
- exact endpoints оптических линий 811 → другие шкафы;
- куда подключены два optical interfaces сервера;
- количество волокон и member semantics;
- media, connector и transceiver details.

«1 к 24» может позднее оказаться multi-member trunk/breakout или другой
конструкцией. До подтверждения нельзя называть его splitter или fan-out. Если
truthful modeling потребует member-aware fiber authoring, которого не
поддерживает текущий UI, это Phase C finding, а не guessed workaround.

## Приблизительный real-world sketch

```text
Floor:
pc1 -- o1 -- pp1 -- sw1
                    |
                    | uplink / exact endpoint OPEN
                    |
Rack 811:           communication/distribution cabinet
                    | lines from floors and toward server room
                    | optical lines to other cabinets
                    |
Rack 833:           optical patch-panel/component
                                  ("1 к 24", exact construction OPEN)
                                  |
                         +--------+--------+
                         |                 |
                      Cisco A          Cisco B
                      StackWise         StackWise
                         |
                       Server
                 optical interface 1/2
```

Это приблизительная схема, а не inventory. Неизвестные соединения в Rack 833,
точные Cisco ports, StackWise cabling и серверные endpoints не считаются
установленными.

## SYNTHETIC REPRESENTATIVE FIXTURE

Ниже — предлагаемый test fixture для acceptance. Он не является production
inventory и не превращает synthetic labels или links в реальные facts.

### Synthetic objects

```text
Floor:
  PC1   — workstation
  O1    — wall/network outlet
  PP1   — passive floor patch panel
  SW1   — floor/access switch

Distribution cabinet 811:
  FPP-811  — synthetic optical patch/ODF representation
  DIST-811 — aggregation/distribution switch

Rack 833:
  FPP-833 — synthetic optical patch/ODF representation
  CORE-A  — Cisco core switch
  CORE-B  — Cisco core switch
  SRV1    — server with two optical physical interfaces
  RTR1    — edge router
```

`CORE-A` и `CORE-B` остаются отдельными PhysicalObjects для L1. Их известное
отношение в fixture — StackWise. Это не создаёт canonical Stack entity.

### Synthetic physical links

Следующие links — fixture choices, а не claims about production:

```text
PC1
  -> O1
  -> PP1
  -> SW1

SW1 optical uplink
  -> distribution path in/through 811
  -> DIST-811

DIST-811
  -> synthetic optical patching between 811 and 833
  -> core side in rack 833

SRV1 optical interface 1
  -> CORE-A

SRV1 optical interface 2
  -> CORE-B

CORE-A
  -> RTR1

RTR1
  -> external ISP/provider handoff or off-map continuation
```

Exact mapping through `FPP-811`/`FPP-833` may be refined during fixture
construction. The external ISP/provider handoff is outside the local-map
boundary.

### Passive device semantics

For this synthetic fixture it is acceptable to model `PP1`, `FPP-811` and
`FPP-833` as ordinary 1:1 passive patch panels with explicit paired
ConnectionPoints and internal continuity. This is deliberately not an
assertion that the real «1 к 24» component is 1:1. The real component remains
UNKNOWN.

### StackWise boundary

`CORE-A` and `CORE-B` remain separate PhysicalObjects for L1. The known fact is
only that they operate in StackWise. Do not invent a canonical Stack entity,
exact stack ports, or the number/topology of StackWise cables. Physical stack
links may be added later only when known, or when explicitly created as
synthetic fixture data and clearly marked synthetic.

### Server dual-homing

The synthetic fixture explicitly chooses:

```text
SRV1 optical-1 -> CORE-A
SRV1 optical-2 -> CORE-B
```

Это synthetic representative topology, не подтверждённый production fact. На
L1 два server interfaces остаются независимыми physical endpoints; bonding,
LACP или teaming не выводятся из dual-homing.

### Router / Internet boundary

`RTR1` — synthetic edge router. В текущем L1 Phase C fixture моделируются
только его physical LAN/WAN endpoints и physical links. Provider/Internet
может быть представлен external/off-map handoff.

Отдельный FUTURE SEMANTIC SEED для более позднего L3 acceptance:

```text
core has default route 0.0.0.0/0 via RTR1
```

Это не Phase C/L1 acceptance criterion. Он не расширяет текущий roadmap и не
запускает L3 implementation.

## Critical L1 semantic boundary

Последовательность

```text
PC -> access switch -> distribution switch -> core -> server
```

не является одним passive L1 trace. Каждый active switch terminates one
physical link and begins another. Поэтому L1 acceptance проверяет отдельные
physical circuits, например:

```text
PC1 -> O1 -> PP1 -> SW1 access port
SW1 uplink -> distribution-side endpoint
DIST-811 uplink -> core-side endpoint
CORE -> SRV1 physical interface
CORE -> RTR1
RTR1 -> provider handoff
```

Нельзя вводить internal L1 continuity через active switches только ради
end-to-end PC-to-server trace. End-to-end forwarding across active switches
относится к более поздним L2/L3 semantics.

## Acceptance use в Phase C

1. Создать и проверить Locations и racks, включая этаж и стойки 811/833.
2. Создать необходимые Blueprints/Port Blocks только по реально известным
   данным; synthetic fixture values явно отличать от real-world facts.
3. Materialize physical objects и ConnectionPoints для выбранного fixture.
4. Построить отдельные подтверждённые или явно synthetic physical Connections
   и Cable workflows.
5. Разместить их на SavedMap.
6. Настроить presentation, routes и Regions, не используя presentation state
   как canonical topology truth.
7. Выполнить L1 trace на отдельных подтверждённых/synthetic circuits и
   проверить evidence/result.
8. Зафиксировать каждый gap и отделить data uncertainty от отсутствующей
   domain/authoring capability.

Fixture exercises:

- simple endpoint;
- passive outlet;
- multi-port passive patch panel;
- active access switch;
- distribution switch;
- optical patching;
- two-chassis core;
- dual-homed server;
- router;
- off-map/provider boundary;
- SavedMap placement/routes/Regions;
- truthful separation between passive L1 continuity and active forwarding.

Каждый gap классифицируется как correctness, missing domain/authoring
capability, UX, visual/style, performance/readiness или
documentation/data uncertainty.

Пользовательский сценарий должен выполняться через видимые имена и обычные UI
workflows; знание UUID или других внутренних entity IDs не является acceptance
prerequisite.

Этот testbed не проектирует StackWise domain model, не добавляет optical/fiber
feature в roadmap заранее, не обещает multi-fiber support, не превращает real
«1 к 24» в splitter/fan-out и не расширяет текущий scope до L2/L3.
