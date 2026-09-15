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

## Synthetic fixture versus production network boundary

Текущий `FLOOR-3` fixture — намеренно упрощённый synthetic best-practice
representative example, а не reconstruction production topology. В нём
`SW-301-ACCESS` сознательно выступает как pure-access representative switch,
чтобы покрыть current Phase C archetype.

В реальной сети этажные switches в общем случае могут иметь uplink/trunk
connections, а VLAN assignment выполняется по individual switch ports. Trunk /
access role и VLAN membership относятся к будущей L2 semantic coverage, а не к
текущим canonical L1 facts. В Phase C switch ports остаются `NETWORK_PORT`
endpoints, а physical connections/cables — ordinary physical connections;
fake canonical trunk entity и VLAN facts не добавляются.

Production-like additional floor branch можно будет добавить отдельно, когда
появятся подтверждённые physical facts: отдельный floor switch и его
physical uplink(s) к distribution side. Номер этажа, exact patch-panel count,
media, trunk ports и VLAN IDs сейчас не фиксируются. Точная physical path через
patch panels между real floor switch и rack 811 неизвестна и не подменяется
fake topology.

## SYNTHETIC REPRESENTATIVE FIXTURE

Ниже зафиксирован TEST FIXTURE, а не production inventory. Generic labels
выбраны для покрытия capability axes; vendor/model не выдумываются, кроме
известной роли Cisco core switch.

### Phase C Port Block naming convention

Port Block — reusable library-owned layout/template primitive. В этом fixture
его имя описывает reusable structure, а не topology role конкретного объекта:
предпочтительны role-neutral names вроде `PB-24-CP-1R`, `PB-48-NET-2R` и
`PB-2-NET-1R`. Если media/connector действительно известен в synthetic
fixture, допустимо физическое описание вроде RJ45/SFP в user-facing name, но
production facts не выдумываются. Это только Phase C authoring convention, а
не canonical contract или enum naming scheme.

### Spatial hierarchy and intended placement

Synthetic fixture использует следующую canonical Location hierarchy. Значения
`site`, `floor`, `room` и `rack` — только открытые пользовательские `Location.type`
для этого fixture; fixed Location taxonomy не вводится.

```text
SYNTH-L1-LAB [site]
├── FLOOR-3 [floor]
│   ├── CAB-301 [room]
│   └── COMM-ROOM [room]
└── FLOOR-8 [floor]
    └── SERVER-ROOM-808 [room]
        ├── RACK-811 [rack]
        └── RACK-833 [rack]
```

`CAB-301` — обычный кабинет/room на `FLOOR-3`; `COMM-ROOM` —
коммуникационная комната `FLOOR-3` с этажным access switch.
`SERVER-ROOM-808` — серверная на `FLOOR-8`. `RACK-811` —
коммуникационная стойка/шкаф внутри `SERVER-ROOM-808`; это не кабинет с
номером 811. `RACK-833` — стойка внутри `SERVER-ROOM-808` с core side и
`SRV1`.

Intended fixture placement:

- `CAB-301`: `PC1`, `O1`;
- `COMM-ROOM`: `PP-301-A`, `PP-301-B`, `SW-301-ACCESS`, `FPP-301`;
- `RACK-811`: `FPP-811`, `DIST-811`; `FANOUT-1x24` может находиться здесь
  только как отдельный deliberate stress probe, не как production equipment;
- `RACK-833`: `FPP-833`, `CORE-A`, `CORE-B`, `SRV1`, `RTR1`;
- `ISP/OFFMAP`: внешний/provider endpoint или off-map continuation, без
  искусственно назначенной local Location;
- `XCONN-4`: отдельная coverage branch, Location пока жёстко не фиксируется.

### FLOOR-3 / CAB-301

- `PC1` — workstation; simple endpoint; Blueprint-backed простой объект с
  одним обычным network endpoint.
- `O1` — wall/network outlet; маленький passive 1:1 объект с двумя
  ConnectionPoints и явной internal continuity.

### FLOOR-3 / COMM-ROOM

- `PP-301-A` и `PP-301-B` — два synthetic 24-port copper passive patch
  panels. Оба используют один и тот же reusable 24-port Port Block и один
  и тот же Blueprint pattern; разные library templates без необходимости не
  создаются. Каждая панель имеет FRONT + REAR и pair-by-index internal
  continuity. Вместе они представляют обычную 48-drop floor distribution
  capacity к 48 access ports switch, но Phase C не требует создавать 48 wall
  outlets или 48 workstation objects: `O1` остаётся representative wall-drop
  path.
- `SW-301-ACCESS` — intentionally simplified pure-access representative
  switch с 48 ordinary network access ports и отдельными uplink ports. Для его
  reusable Port Blocks используются role-neutral structural names; topology
  role не встраивается в naming convention. Protocol semantics не добавляются.
- `FPP-301` — отдельный synthetic passive optical patch/ODF boundary для
  uplink(s) `SW-301-ACCESS` в сторону rack 811; exact fiber count и
  connector/media/transceiver details не утверждаются.

### FLOOR-8 / SERVER-ROOM-808 / RACK-811

- `FPP-811` — ordinary synthetic optical patch/ODF representation, FRONT +
  REAR, dense optical 1:1 continuity; обычный optical passive case.
- `DIST-811` — active aggregation/distribution switch; copper/management и
  optical uplink groups только если это удобно существующим capabilities.

`FANOUT-1x24`, если включён в fixture, остаётся отдельным deliberate stress
probe и не объявляется production equipment.

### FLOOR-8 / SERVER-ROOM-808 / RACK-833

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

### External/off-map continuation

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

Ниже приведена намеренно упрощённая synthetic best-practice схема; она не
утверждает соответствие production:

```text
MAIN SYNTHETIC L1 FIXTURE

FLOOR-3 / CAB-301
PC1 -> O1

FLOOR-3 / COMM-ROOM
O1 -> PP-301-A -> SW-301-ACCESS

ADDITIONAL FLOOR CAPACITY
PP-301-B -> другие access ports SW-301-ACCESS

FLOOR-8 / SERVER-ROOM-808 / RACK-811
SW-301-ACCESS -> FPP-301 -> inter-floor optical link -> FPP-811 -> DIST-811

RACK-833
DIST-811 -> rack-833 optical/core side
CORE-A / CORE-B
SRV1-NIC1 -> CORE-A
SRV1-NIC2 -> CORE-B
CORE-A -> RTR1 -> ISP/OFFMAP
CORE-A <-> StackWise relationship <-> CORE-B

SEPARATE COVERAGE BRANCHES (not required inline in the main path)

DIST-811 --> FPP-833      ordinary 1:1 passive optical case
DIST-811 --> FANOUT-1x24 deliberate 1 -> 24 stress case

SEPARATE PASSIVE MAPPING BRANCH

XCONN-4: A1 <-> B2, A2 <-> B1
```

Схема synthetic fixture не утверждает соответствие production. `FPP-833`
остаётся отдельным ordinary 1:1 passive coverage case, а `FANOUT-1x24` —
отдельным deliberate stress case; ни один из них не объявляется обязательным
inline production path.

Этот `FLOOR-3` path — representative synthetic best-practice path. Он не
утверждает, что production floor switch является pure access switch, что
production имеет ровно такие patch panels или что его physical path до rack
811 известен. Дополнительная production-like floor branch с L2 trunk/VLAN
semantics остаётся отдельным будущим acceptance scope; exact physical facts
для неё должны быть подтверждены до authoring.

`XCONN-4` может быть отдельной небольшой веткой рядом с floor/distribution и не
обязан входить в основной forwarding narrative; его Location не фиксируется.

## Coverage matrix

Один fixture object может покрывать несколько строк. Matrix перечисляет
capability axes, а не закрытый список device classes.

| # | Coverage axis | Fixture representative |
|---:|---|---|
| 1 | simple endpoint | PC1 |
| 2 | Blueprint-backed PhysicalObject | PC1 |
| 3 | маленький passive 1:1 объект | O1 |
| 4 | dense copper passive panel | PP-301-A / PP-301-B |
| 5 | optical passive boundary/panel | FPP-301 / FPP-811 / FPP-833 |
| 6 | active access switch | SW-301-ACCESS |
| 7 | active distribution switch | DIST-811 |
| 8 | core switch | CORE-A / CORE-B |
| 9 | два chassis как один будущий logical system | CORE-A + CORE-B / StackWise |
| 10 | router | RTR1 |
| 11 | dual-homed server | SRV1 |
| 12 | FRONT/REAR presentation | PP-301-A, FPP-811, SRV1 |
| 13 | несколько Port Blocks в одном Blueprint | SW-301-ACCESS |
| 14 | ConnectionPoint port kind | O1 / PP-301-A |
| 15 | `NETWORK_PORT` port kind | PC1 / SW-301-ACCESS, если поддерживается |
| 16 | pair-by-index continuity | PP-301-A / PP-301-B, FPP-811 |
| 17 | arbitrary individual mapping | XCONN-4 |
| 18 | cross-face internal continuity | PP-301-A, FPP-811, SRV1 |
| 19 | ordinary Cable-backed physical connection | fixture links |
| 20 | off-map/provider continuation | RTR1 -> ISP/OFFMAP |
| 21 | zero-waypoint MapCableRoute | любой выбранный cable на SavedMap |
| 22 | multi-waypoint MapCableRoute | другой cable на SavedMap |
| 23 | MapComposite use | representative placed objects |
| 24 | presentation variants | минимум два варианта SavedMap |
| 25 | deliberate member/cardinality/fan-out stress `1 -> 24` | FANOUT-1x24 |

Rows 4, 5, 14–18 и 25 должны быть проверены без подмены одного mapping
archetype другим. Особенно `FANOUT-1x24` не заменяется ordinary 1:1 model.

Rows 1–24 — current-capability exercise set: они проверяют существующие или
bounded authoring/presentation paths и не являются заранее заявлением, что
каждая комбинация уже успешно поддерживается. Row 25 — отдельный deliberate
promotion probe; его ожидаемый результат может быть documented
`missing domain/authoring capability`.

## Presentation coverage

Phase C проверяет не только canonical objects, но и presentation:

- одна SavedMap с representative topology;
- Locations по возможности: `SYNTH-L1-LAB` -> `FLOOR-3` / `FLOOR-8` ->
  `CAB-301` / `COMM-ROOM` / `SERVER-ROOM-808` -> `RACK-811` / `RACK-833`;
- Regions для relevant floor, room и rack presentation, включая
  `COMM-ROOM`, `SERVER-ROOM-808`, `RACK-811` и `RACK-833`;
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
PC1 -> O1 -> PP-301-A -> SW-301-ACCESS access port
SW-301-ACCESS optical uplink -> FPP-301 -> inter-floor optical link ->
FPP-811 -> DIST-811
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

## Phase C observed findings

### C-UX-01 — Location hierarchy navigation

**Категория:** UX
**Статус:** OPEN / non-blocking Phase C finding

**Observed:**

- Canonical Location hierarchy существует, но основной UI «Местоположения» визуально показывает её как плоский список; родительские и дочерние отношения не считываются по структуре списка.
- Parent selector в форме создания/изменения Location также плоский и показывает hierarchy главным образом через concatenated full paths вроде `SYNTH-L1-LAB / FLOOR-1 / CAB-811`.
- Уже на synthetic hierarchy это снижает читаемость; при 10–15 уровнях и большом количестве siblings navigation станет существенно неудобной.

**Desired future correction:**

- Основной Locations browser должен визуально отображать дерево с явными отступами дочерних уровней.
- Ветви должны поддерживать collapse/expand.
- Parent picker должен предоставлять иерархическую навигацию с визуальными уровнями и collapse/expand либо эквивалентный tree-oriented interaction.
- Arbitrary hierarchy depth должна оставаться поддержанной.
- Correction не должна менять canonical Location semantics и не должна превращать `Location.type` в фиксированную taxonomy.

**Scope/status:**

- Сейчас НЕ реализовывать; Phase C не блокируется.
- Это concrete evidence для последующего bounded correction; finding не отмечать как IMPLEMENTED.
- Не проектировать сейчас конкретный React component/API/schema и не расширять finding в общий UI redesign.

### C-UX-02 — Manual non-Blueprint PhysicalObject authoring

**Категория:** UX
**Статус:** OPEN / non-blocking Phase C finding

**Observed:**

- Manual PhysicalObject flow создаёт canonical object без Blueprint.
- На Saved Map такой object попадает в generic/fallback presentation path;
  его visual footprint заметно отличается и крупнее, чем у
  structured Blueprint-backed `PC1`, без той же полноценной Blueprint
  geometry/presentation semantics.
- Наличие двух user-facing creation paths — structured Blueprint-backed и
  упрощённого manual PhysicalObject — увеличивает вариативность UX и
  acceptance surface без доказанной product necessity.

**Agreed product direction / desired correction:**

- Primary user-facing PhysicalObject creation должен быть Blueprint-backed.
- Manual PhysicalObject creation следует убрать из normal create-object UI.
- Уникальное equipment допустимо описывать одноразовым Blueprint.
- Canonical PhysicalObject model остаётся независимой от Blueprint provenance;
  existing/imported/API-created non-Blueprint objects остаются supported.
- Backend/API capability не удалять в рамках этого finding.
- Manual NetworkDevice path в этот finding не входит.

**Scope/status:**

- Сейчас НЕ реализовывать; Phase C не блокируется.
- Не превращать finding в implementation contract конкретных React
  components/routes/API deletion и не расширять его в общий redesign Create
  Object screen.

### C-UX-03 — Physical face terminology clarity

**Категория:** UX
**Статус:** OPEN / non-blocking Phase C finding

**Observed:**

- User-facing terminology `FRONT`/`REAR` может восприниматься как направление
  прохождения линии или как роль endpoint в topology.
- Runtime отображает две faces как две stacked surfaces, что усиливает
  возможность прочитать их как «верхняя/нижняя» или «вход/выход».
- Для passive объектов вроде wall outlet / patch panel физический смысл может
  быть `room-facing / cable-side` либо `front / rear`, но эти термины не должны
  задавать topology direction.
- Для других объектов буквальное `FRONT`/`REAR` может быть менее естественным;
  текущая терминология требует отдельной UX проверки.

**Desired future correction / question:**

- Сохранить canonical/internal `FRONT`/`REAR` semantics как physical face,
  если дальнейший review не выявит архитектурной причины менять модель.
- Отдельно определить наиболее понятные user-facing labels; рассмотреть
  варианты «Лицевая / тыльная сторона», «Сторона A / Сторона B» либо другой
  нейтральный wording, не принимая один вариант в рамках этого finding.
- UI должен явно исключать трактовку face как input/output или
  upstream/downstream.
- Не вводить topology direction semantics в Blueprint face.

**Scope/status:**

- Сейчас НЕ реализовывать; Phase C не блокируется.
- Это finding о terminology/UX clarity, а не предложение изменить canonical
  topology или `FRONT`/`REAR` enum/internal architecture.

### C-UX-04 — Existing PhysicalObject rename workflow

**Категория:** UX / authoring lifecycle
**Статус:** OPEN / non-blocking Phase C finding

**Observed:**

- Имя PhysicalObject задаётся при создании.
- В доступном UI существующего объекта не обнаружено явного действия для
  переименования.
- Это проявилось на реальном acceptance workflow: уже корректно созданному
  semantic/topology object потребовалось уточнить user-facing name.
- Delete + recreate не является приемлемым штатным rename workflow, особенно
  после появления connections, SavedMap placement, Location assignment и
  другой связанной state.

**Desired future correction:**

- Пользователь должен иметь явную возможность изменить display name
  существующего PhysicalObject.
- Rename должен сохранять canonical object identity и не пересоздавать
  PhysicalObject, его ConnectionPoints, NetworkInterfaces, Connections,
  Cables, Blueprint provenance, Location assignment или SavedMap membership.
- Topology и presentation references должны продолжать ссылаться на тот же
  canonical object.
- После успешного rename UI должен показывать новое имя во всех обычных
  presentation surfaces после authoritative refresh.

**Scope/status:**

- Сейчас НЕ реализовывать; Phase C не блокируется.
- Текущий `PP-301` можно оставить под существующим именем; delete/recreate не
  требуется и не принимается как штатный workaround.
- Backend/API rename capability этой docs-задачей не утверждается; отдельный
  implementation milestone должен определить, является ли gap frontend-only
  или требует bounded backend contract change.
- Не расширять finding на общий metadata editor или arbitrary property
  editing.

### C-UX-05 — Map alignment and equal-spacing guides

**Категория:** UX / SavedMap authoring
**Статус:** OPEN / non-blocking Phase C finding

**Observed:**

- Точное визуальное выравнивание нескольких объектов на Saved Map сейчас
  выполняется вручную.
- При drag нет направляющих относительно геометрии соседних visible object
  footprints, и пользователь не получает явного указания, что границы или
  центры объектов совпали.
- При размещении третьего и последующих объектов нет подсказки, что расстояние
  между объектами совпадает с уже существующим интервалом.
- На topology map с patch panels, switches и rack equipment это быстро
  ухудшает аккуратность схемы.

**Desired future behavior:**

- Во время перемещения PhysicalObject на Saved Map предоставлять transient
  smart/alignment guides относительно других visible object footprints для
  left edge, right edge, horizontal center, top edge, bottom edge и vertical
  center.
- Предоставлять equal-spacing guidance: если два существующих объекта задают
  визуальный интервал и пользователь размещает третий объект в подходящей
  последовательности, UI должен показывать совпадение нового gap с уже
  существующим gap. Аналогичная семантика допустима по горизонтали.
- Guides появляются только когда relevant во время drag и исчезают после
  завершения interaction. Лёгкое snapping к найденному target может быть
  рассмотрено отдельным implementation contract.

**Scope/status:**

- Сейчас НЕ реализовывать; Phase C не блокируется.
- Finding не требует выбора конкретного pixel snap threshold, не проектирует
  конкретную React Flow implementation и не вводит новые canonical entities.
- Не менять `MapViewPosition` semantics: persisted position после drop остаётся
  обычным presentation state.
- Это не automatic layout engine, не обязательное grid snapping и не
  multi-selection / bulk distribute capability.
- Canonical topology, Blueprint и Location не затрагиваются.

### C-UX-06 — Independent SavedMap object width and height

**Категория:** UX / presentation capability
**Статус:** OPEN / non-blocking Phase C finding

**Observed:**

- Canvas resize Blueprint-backed object сохраняет Blueprint aspect ratio:
  drag за resize handle масштабирует object одновременно по X и Y.
- Inspector предоставляет только Width; runtime height выводится из intrinsic
  Blueprint body aspect ratio.
- Независимого per-placement X/Y sizing для конкретного Saved Map нет.
- На acceptance layout это ограничивает композицию patch panels, switches,
  optical panels и других объектов, которым иногда нужна независимая ширина и
  высота.

**Desired product capability:**

- Для Blueprint-backed PhysicalObject placement пользователь должен иметь
  возможность независимо задавать presentation width и height на конкретной
  Saved Map.
- Resize handles должны позволять изменять X и Y независимо, а Inspector —
  предоставлять явные Width и Height.
- Изменение через canvas и Inspector должно использовать один и тот же
  authoritative presentation contract.
- Aspect-ratio-locked resize может остаться доступной convenience
  operation/modifier, но не должен быть единственным способом sizing.

**Critical architecture boundary:**

- Это не изменение intrinsic Object Blueprint body geometry и не свободная
  деформация Blueprint template; речь только о Saved Map presentation instance.
- Это не изменение canonical PhysicalObject. ConnectionPoint identity,
  NetworkInterface identity, topology и Blueprint provenance не меняются.
- Изменение размеров должно только трансформировать rendered body/ports,
  internal continuity и external cable attachment geometry в пределах
  конкретного Saved Map placement. Размер остаётся map-local presentation
  state.

**Scope/status:**

- Сейчас НЕ реализовывать; Phase C не блокируется.
- Текущий contract является width-only; correction не объявляется
  frontend-only. Будущий bounded milestone должен отдельно согласовать
  изменение presentation contract, например необходимость второго persisted
  presentation dimension, до начала implementation.
- Не фиксировать сейчас имя нового DTO/database field, migration strategy,
  exact min/max dimensions, resize handle implementation или backward
  compatibility mechanics.
- Historical NULL/default sizing semantics в этот finding не входят.

### C-UX-07 — Move expanded composite as a group

**Категория:** UX / SavedMap presentation
**Статус:** OPEN / non-blocking Phase C finding

**Observed:**

- Expanded MapComposite визуально представляет группу объектов рамкой, но
  пользователь не может взять такой expanded composite и переместить весь блок
  как одну группу.
- Existing member objects приходится перемещать отдельно.
- Для representation вроде rack / communication room это делает composite
  существенно менее удобным как authoring primitive.

Это не correctness bug: текущий B.3 contract реализует MapComposite
grouping/collapse/presentation, а Phase C выявил дополнительную product need
для group translation.

**Desired future behavior:**

- У expanded composite должен быть явный drag affordance, предпочтительно на
  header/frame, не конфликтующий с взаимодействием с member objects.
- Drag expanded composite должен перемещать все его member PhysicalObject
  placements на текущей SavedMap/variant на одинаковый delta.
- Relative layout членов внутри группы должен сохраняться, membership при этом
  не меняется.
- Canonical PhysicalObject, Location, topology, Cable и Blueprint semantics не
  меняются; операция остаётся presentation-only.

**Scope/status:**

- Сейчас НЕ реализовывать; Phase C не блокируется.
- Не фиксировать сейчас persistence/atomicity strategy для нескольких member
  position writes, rollback/error lifecycle, поведение explicit MapCableRoute
  waypoints при group move, exact collision policy или конкретную React Flow
  implementation.
- Не моделировать composite как canonical parent/container и не смешивать
  finding с `C-COR-01`.

### C-COR-01 — Expanded composite blocks member interaction

**Категория:** correctness / interaction
**Статус:** OPEN Phase C finding

**Observed:**

- При двух одновременно существующих expanded composites доступность ordinary
  member interaction зависит от состояния и не привязана к конкретному
  composite.
- В одном наблюдаемом состоянии members внутри `811` выбирались ordinary
  click, а members внутри ранее созданного `COMM-3` — нет.
- После полного reload страницы ситуация изменилась: members внутри `COMM-3`
  начали нормально выбираться, а members внутри `811` перестали.
- PhysicalObject, которые вообще не состоят в MapComposite, продолжают
  нормально выбираться независимо от этого состояния.
- Все объекты при этом остаются визуально видимыми.
- Таким образом, при нескольких одновременно expanded MapComposite обычное
  interaction с visible members может работать только в одном composite, а
  после full reload конкретный composite с доступными members может измениться.
- Есть наблюдаемое впечатление, что выбор member внутри доступного composite
  может влиять на interaction/focus между composites, но это пока только
  гипотеза и не установленный root cause.

**Expected invariant:**

- Expanded MapComposite является presentation frame/grouping aid и не должен
  маскировать ordinary hit-testing visible PhysicalObject members.
- Все visible PhysicalObject members всех одновременно expanded composites
  должны оставаться independently selectable тем же способом, что и вне
  composite.
- Selection одного member не должна лишать members другого expanded composite
  возможности ordinary click/selection; reload не должен менять availability
  member interaction.
- Port interaction, object click, context menu и прочие normal member
  interactions не должны перехватываться рамкой/background composite.
- Только явно interactive areas самого composite, например header/toggle,
  могут получать composite-specific interaction.

**Minimal reproduction scenario:**

1. Иметь два expanded MapComposite одновременно; каждый содержит минимум один
   visible PhysicalObject member.
2. Проверить ordinary click member первого composite.
3. Проверить ordinary click member второго composite.
4. Выполнить full page reload.
5. Повторить оба click и сравнить availability member interaction до и после
   reload.
6. Проверить control object вне composites.

**Scope/status:**

- Сейчас НЕ исправлять; Phase C object creation может продолжаться.
- Не утверждать root cause. Z-index, pointer-events, React Flow node ordering,
  stale state и hit area остаются возможными направлениями будущей диагностики,
  но не являются установленным объяснением в этом finding.
- Не расширять finding в redesign MapComposite и не смешивать его с
  `C-UX-07`.

## Scope discipline

Не реализовывать fan-out сейчас, не проектировать новый canonical Stack, не
вводить L2/L3 semantics, не превращать testbed в полный hardware inventory и не
создавать exhaustive combinatorial matrix vendor/device variants. Цель — один
representative example на каждую существенно различающуюся structural
capability.
