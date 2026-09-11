# 11.4 Phase C representative L1 testbed

## Назначение и граница

Этот документ — living acceptance-scenario document для Phase C из
[[plans/11-03-pre-l2-product-completion|11.3 Pre-L2 product completion]]. Phase C
testbed — прежде всего **SYNTHETIC L1 COVERAGE LAB**. Реальная сеть пользователя
даёт правдоподобный сюжет и naming, но fixture не предназначен для
реконструкции production.

Цель — минимальной связной synthetic network проверить хотя бы один
representative instance каждого существенно различающегося structural/modeling
archetype, который уже поддерживается или намеренно проверяется NetMap.
Покрываются capability axes, а не все возможные названия оборудования.
Пользовательские `class` и labels остаются открытыми; этот документ не вводит
закрытый enum device classes.

Стенд проверяет truthful L1 modeling, Blueprint/PortBlock authoring,
PhysicalObject/ConnectionPoint/Cable workflows, Locations и racks, SavedMap
presentation, Regions/routes, L1 trace и понятность UI без знания внутренних
entity IDs. Если схема или capability не может быть выражена честно, это Phase C
finding, а не повод подменять факт фиктивной topology.

## CONFIRMED REAL-WORLD SKELETON

Подтверждены следующие реальные сведения; они не устанавливают точные модели,
порты, fiber members или physical StackWise cabling:

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

OPEN real-world details: точные роли `o1`/`pp1`, hardware models оборудования в
811 и Cisco, exact endpoints оптических линий, серверные подключения,
StackWise ports/cabling, число волокон/member semantics и
media/connector/transceiver details. «1 к 24» нельзя называть splitter,
fan-out, 24-port panel или другим конкретным типом без подтверждения. Он может
позднее оказаться multi-member trunk/breakout или другой конструкцией.
Unknown real-world facts не являются canonical facts.

## SYNTHETIC REPRESENTATIVE FIXTURE

Ниже зафиксирован TEST FIXTURE, а не production inventory. Generic labels
выбраны для покрытия capability axes; vendor/model не выдумываются, кроме
известной роли Cisco core switch.

### Floor

- `PC1` — workstation; simple endpoint; Blueprint-backed простой объект с
  одним обычным network endpoint.
- `GENERIC1` — manually-created PhysicalObject без Blueprint, только для
  проверки non-Blueprint/advanced path.
- `O1` — wall/network outlet; маленький passive 1:1 объект с двумя
  ConnectionPoints и явной internal continuity.
- `PP-CU-24` — synthetic 24-port copper patch panel: FRONT + REAR, 24 front и
  24 rear ConnectionPoints, pair-by-index 1:1 internal continuity и dense
  PortBlock authoring.
- `SW-ACCESS` — access switch; отдельный Port Block для copper access ports и
  отдельный Port Block для optical/SFP uplinks, если это поддерживается
  текущим authoring contract. Protocol semantics не добавляются.

### Distribution cabinet 811

- `FPP-811` — ordinary synthetic optical patch/ODF representation, FRONT +
  REAR, dense optical 1:1 continuity; обычный optical passive case.
- `DIST-811` — active aggregation/distribution switch; copper/management и
  optical uplink groups только если это удобно существующим capabilities.

### Rack 833

- `FPP-833` — ещё один ordinary synthetic optical 1:1 patch/ODF boundary.
- `CORE-A`, `CORE-B` — два отдельных PhysicalObject, Cisco core switches,
  работающие как StackWise system. Canonical Stack entity и exact stack
  cables/ports не создаются.
- `SRV1` — server с двумя независимыми optical physical interfaces;
  `optical-1 -> CORE-A`, `optical-2 -> CORE-B`. По возможности management /
  ordinary port размещается на одном face, optical ports — на другом. L1 не
  выводит bonding/LACP/teaming.
- `RTR1` — synthetic edge router: LAN side к core, WAN side к external/provider
  handoff; текущий fixture проверяет только physical L1 foundation.
- `ISP/OFFMAP` — внешний/provider endpoint или off-map continuation.

### Дополнительный passive mapping archetype

`XCONN-4` — synthetic passive cross-connect/adapter с несколькими
ConnectionPoints, не production equipment claim. Маленький пример:

```text
side A: A1, A2
side B: B1, B2

intentional internal mapping:
A1 <-> B2
A2 <-> B1
```

Это отдельная проверка explicit arbitrary individual internal mappings, не
pair-by-index continuity.

### Обязательный FANOUT-1x24 stress object

`FANOUT-1x24` — deliberate Phase C promotion probe, а не ordinary 1:1 patch
panel и не production claim. Желаемая synthetic semantics:

```text
incoming side: IN-1
outgoing side: OUT-01 ... OUT-24
```

Тест проверяет, может ли NetMap truthfully представить physical medium, где один
incoming multi-member endpoint/trunk имеет отдельные members, продолжающиеся в
24 отдельных outgoing endpoint/member positions, с точным L1 evidence/trace.
Цель не в том, чтобы нарисовать 25 отдельных кружков.

Сначала нужно попытаться выразить `FANOUT-1x24` текущими user-facing
Blueprint/PortBlock capabilities. Если текущий authoring/materialization не
может честно выразить member/cardinality/fan-out semantics, acceptance всё
равно успешен с зафиксированным Phase C finding:
`missing domain/authoring capability`. Это кандидат на следующий bounded Phase D
milestone, а не claim о реализованной capability. Нельзя моделировать 24 fake
independent input ports ради обхода ограничения.

Этот probe связан с observation в 11-03 о возможном
`Blueprint endpoint cardinality + member-aware internal connectivity/fan-out`;
roadmap дальше этого не расширяется. `FPP-811` и `FPP-833` остаются обычными
1:1 cases.

## Suggested fixture topology

Схема synthetic fixture не утверждает соответствие production:

```text
PC1
 |
 O1
 |
PP-CU-24
 |
SW-ACCESS
 |
 | optical uplink
 |
FPP-811
 |
DIST-811
 |
 | inter-cabinet optical path
 |
+-------------------+
|                   |
FANOUT-1x24       FPP-833
|                   |
+------+------+     |
|             |     |
CORE-A     CORE-B   |
| StackWise  |      |
|            |      |
+-- SRV1-NIC1       |
     +-- SRV1-NIC2  |
                    |
                   RTR1
                    |
                ISP / OFFMAP
```

`XCONN-4` может быть отдельной небольшой веткой рядом с floor/distribution и не
обязан входить в основной forwarding narrative. `GENERIC1` может быть просто
размещён на карте и соединён одним обычным physical link.

## Coverage matrix

Один fixture object может покрывать несколько строк. Matrix перечисляет
capability axes, а не закрытый список device classes.

| # | Coverage axis | Fixture representative |
|---:|---|---|
| 1 | simple endpoint | PC1 |
| 2 | manual PhysicalObject без Blueprint | GENERIC1 |
| 3 | Blueprint-backed PhysicalObject | PC1 |
| 4 | маленький passive 1:1 объект | O1 |
| 5 | dense copper passive panel | PP-CU-24 |
| 6 | dense optical passive panel | FPP-811 / FPP-833 |
| 7 | active access switch | SW-ACCESS |
| 8 | active distribution switch | DIST-811 |
| 9 | core switch | CORE-A / CORE-B |
| 10 | два chassis как один будущий logical system | CORE-A + CORE-B / StackWise |
| 11 | router | RTR1 |
| 12 | dual-homed server | SRV1 |
| 13 | FRONT/REAR presentation | PP-CU-24, FPP-811, SRV1 |
| 14 | несколько Port Blocks в одном Blueprint | SW-ACCESS |
| 15 | ConnectionPoint-only endpoint group | O1 / PP-CU-24 |
| 16 | NETWORK_PORT endpoint group | PC1 / SW-ACCESS, если поддерживается |
| 17 | pair-by-index continuity | PP-CU-24, FPP-811 |
| 18 | arbitrary individual mapping | XCONN-4 |
| 19 | cross-face internal continuity | PP-CU-24, FPP-811, SRV1 |
| 20 | ordinary Cable-backed physical connection | fixture links |
| 21 | off-map/provider continuation | RTR1 -> ISP/OFFMAP |
| 22 | zero-waypoint MapCableRoute | любой выбранный cable на SavedMap |
| 23 | multi-waypoint MapCableRoute | другой cable на SavedMap |
| 24 | MapComposite use | representative placed objects |
| 25 | presentation variants | минимум два варианта SavedMap |
| 26 | deliberate member/cardinality/fan-out stress `1 -> 24` | FANOUT-1x24 |

Rows 5, 6, 15–19 и 26 должны быть проверены без подмены одного mapping
archetype другим. Особенно `FANOUT-1x24` не заменяется ordinary 1:1 model.

Rows 1–25 — current-capability exercise set: они проверяют существующие или
bounded authoring/presentation paths и не являются заранее заявлением, что
каждая комбинация уже успешно поддерживается. Row 26 — отдельный deliberate
promotion probe; его ожидаемый результат может быть documented
`missing domain/authoring capability`.

## Presentation coverage

Phase C проверяет не только canonical objects, но и presentation:

- одна SavedMap с representative topology;
- Locations по возможности: building/site -> floor/server room -> cabinet/rack;
- Regions для floor, cabinet 811 и rack 833;
- хотя бы один zero-waypoint cable route;
- хотя бы один cable route с несколькими waypoints;
- хотя бы один MapComposite;
- хотя бы два presentation variants с различным placement/collapse/route state,
  но без изменения canonical topology.

SavedMap placement, routes, Regions, collapse state и variants не используются
как canonical truth.

## Critical L1 semantic boundary

Последовательность

```text
PC -> access switch -> distribution switch -> core -> server
```

не является одним passive L1 trace. Каждый active device завершает один
physical circuit и начинает другой. L1 acceptance проверяет отдельные physical
circuits, например:

```text
PC1 -> O1 -> PP-CU-24 -> SW-ACCESS access port
SW-ACCESS optical uplink -> distribution-side endpoint
DIST-811 uplink -> core-side endpoint
CORE -> SRV1 physical interface
CORE -> RTR1
RTR1 -> provider handoff
```

Нельзя добавлять internal continuity через active switches ради сквозного
PC-to-server trace. End-to-end forwarding across active switches относится к
более поздним L2/L3 semantics.

## Future semantic seeds

Эти seeds non-blocking и не запускают L2/L3 implementation:

- `CORE-A`/`CORE-B` -> future L2/L3 logical aggregation candidate;
- StackWise semantics -> не L1 identity;
- SRV1 dual links -> future bonding/LACP/teaming semantics;
- default route `0.0.0.0/0` via `RTR1` -> future L3 acceptance seed.

## Phase C execution procedure

Acceptance выполняется вокруг coverage matrix:

1. Для каждого archetype/capability создать fixture через обычный user-facing
   authoring flow.
2. Materialize `PhysicalObject`.
3. Проверить endpoints и internal continuity.
4. Создать physical connections и Cables.
5. Разместить объекты и связи на SavedMap.
6. Проверить relevant presentation: FRONT/REAR, Regions, routes, composite и
   variants.
7. Выполнить L1 trace там, где он семантически применим — по отдельным
   circuits, не через active-switch forwarding.
8. Зафиксировать finding, если operation невозможна, вводит ложную модель или
   требует знания внутренних UUID.

Для `FANOUT-1x24` finding о невозможности truthful member/cardinality/fan-out
моделирования является допустимым успешным результатом acceptance.

Finding categories:

- correctness;
- missing domain/authoring capability;
- UX;
- visual/style;
- performance/readiness;
- documentation/data uncertainty.

## Scope discipline

Не реализовывать fan-out сейчас, не проектировать новый canonical Stack, не
вводить L2/L3 semantics, не превращать testbed в полный hardware inventory и не
создавать exhaustive combinatorial matrix vendor/device variants. Цель — один
representative example на каждую существенно различающуюся structural
capability.
