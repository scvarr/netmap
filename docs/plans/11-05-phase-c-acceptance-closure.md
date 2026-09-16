# 11.5 Закрытие замечаний Phase C и чистая повторная приёмка

## Назначение и обязательность

Этот документ — актуальный обязательный реестр всех замечаний, обнаруженных
при первой representative Phase C приёмке, и порядок их последующей ручной
проверки. В реестре остаются все замечания `C-UX-01` ... `C-UX-11`,
`C-COR-01`, `C-CAP-01` и `C-VIS-01`; замечание не считается необязательным
только потому, что его исправление относится к Phase D или более позднему
bounded milestone.

Проверки ниже выполняются через обычный пользовательский интерфейс. Нельзя
обходить сценарий прямыми записями в БД или API, а также принимать удаление и
повторное создание объекта вместо требуемого lifecycle-действия.

## Архитектурные границы и зависимости

- Canonical topology остаётся источником истины. `Blueprint`, `Port Block`,
  `SavedMap`, `MapComposite`, `MapCableRoute`, Regions и routing guides —
  authoring/presentation state в установленных для них границах; они не
  становятся доказательством topology.
- Идентичность `PhysicalObject`, endpoint, `Connection`, `ConnectionMember`,
  `Cable` и `Blueprint` не зависит от labels, координат, порядка или
  presentation. Existing immutable versions остаются immutable.
- `C-COR-01` сначала диагностируется и исправляется отдельно; его root cause
  нельзя заранее подменять объяснением про `C-UX-07` или маршруты.
- `C-CAP-01` — отдельный семантический пробел, а не расширение обычного
  1:1 patch-panel сценария. Новый canonical `Fanout/Splitter` entity не
  вводится.
- `C-UX-06` задаёт независимую геометрию размещения и поэтому проверяется до
  оценки аккуратного группового layout; `C-UX-07` отдельно проверяет групповое
  перемещение.
- `C-UX-11` должен явно определить реакцию сохранённых маршрутов на
  перемещение; его нельзя автоматически считать решённым созданием общего
  cable guide из `C-UX-10`.
- `C-UX-10` добавляет общую presentation-only кабельную направляющую. Она не
  является `PhysicalObject`, endpoint, `Connection`, `ConnectionMember`,
  `Cable` или canonical physical path.
- `C-VIS-01` проверяется и на обычных пересечениях, и поверх общего участка
  кабелей; выделение одного `Cable` не включает соседние кабели в evidence.
- `C-UX-02` и `C-UX-09` допустимо закрывать в одном пользовательском сценарии
  создания `PhysicalObject`: пользователь выбирает компактный
  `Blueprint`, а штатный manual non-Blueprint путь отсутствует.

Порядок не является новым roadmap: сначала отдельное расследование
`C-COR-01`, затем отдельный семантический контракт `C-CAP-01`, далее
UX/presentation corrections в порядке, удобном для конкретного bounded
milestone, с учётом зависимостей выше.

## Реестр замечаний и ручные проверки

### C-UX-01 — Иерархическая навигация Locations

**Исправить.** В `Инфраструктура -> Местоположения` показать дерево с
отступами, раскрытием и сворачиванием ветвей. В выборе родителя при создании
или изменении `Location` дать такую же tree-oriented навигацию. Произвольная
глубина иерархии и текущая семантика `Location.type` должны сохраниться.

**Граница `11-04`.** Меняется только понятность пользовательского просмотра и
выбора родителя; canonical hierarchy не меняется, фиксированная taxonomy для
`Location.type` не вводится.

**Ручная проверка.** Через UI создать заново `SYNTH-L1-LAB`, `FLOOR-3`,
`CAB-301`, `COMM-ROOM`, `FLOOR-8`, `SERVER-ROOM-808`, `RACK-811` и `RACK-833`,
каждый раз выбирая родителя в форме Location. Открыть список Locations,
раскрыть `SYNTH-L1-LAB`, затем `FLOOR-3` и `FLOOR-8`, свернуть ветви и снова
раскрыть их. Создать ещё один Location глубже существующей ветви, выбрать его
родителя в tree picker, сохранить, открыть и изменить его.

**Закрыто, если.** Все уровни видны как дерево, collapse/expand и выбор
родителя работают без плоского списка как единственного способа навигации,
а после обновления страницы родители и типы остаются прежними.

### C-UX-02 — Штатное создание PhysicalObject через Blueprint

**Исправить.** Убрать manual non-Blueprint создание из обычного UI создания
`PhysicalObject`. Уникальное оборудование должно создаваться через
одноразовый `Blueprint`; существующие/imported/API-created non-Blueprint
объекты остаются поддержанными, backend/API capability этим замечанием не
удаляется.

**Граница `11-04`.** Canonical `PhysicalObject` не зависит от provenance
`Blueprint`; это UX-ограничение normal create flow, не удаление модели и не
изменение manual `NetworkDevice` path.

**Ручная проверка.** Открыть `Инфраструктура -> Объекты -> Создать`, выбрать
строку нужного `Blueprint` в компактном picker, создать `PC1`, затем создать
`O1` из отдельного одноразового `Blueprint` и назначить им Locations. Открыть
`Объекты -> Создать` заново и проверить, что normal flow требует выбора
`Blueprint` и не предлагает manual non-Blueprint PhysicalObject. Разместить
оба созданных объекта на `SavedMap`, открыть их details и проверить, что
geometry и endpoints определяются выбранным Blueprint.

**Закрыто, если.** Обычный пользовательский сценарий создаёт
`PhysicalObject` только через выбранный `Blueprint`, а ранее поддержанный
non-Blueprint объект не ломается при просмотре, размещении и соединении.

### C-UX-03 — Понятные подписи физических сторон

**Исправить.** Уточнить пользовательские labels двух физических сторон и
явно пояснить, что это physical face, а не input/output или upstream/downstream.
Внутреннюю `FRONT`/`REAR` semantics сохранять, если отдельное review не
покажет архитектурную необходимость изменения.

**Граница `11-04`.** В `Blueprint` face не вводится направление topology;
`FRONT`/`REAR` остаются физическими сторонами, а не ролями соединения.

**Ручная проверка.** Создать через UI `PP-301` с двумя faces, открыть его
details и Blueprint view, перейти к размещению на `SavedMap`, открыть выбор
портов на обеих сторонах и создать обычные физические связи через FRONT и
REAR. Навести курсор/открыть подсказки и проверить подписи и пояснение. После
перезагрузки повторить открытие обеих сторон и trace одного соединения.

**Закрыто, если.** Пользователь однозначно понимает назначение обеих сторон,
может выбрать и соединить endpoint на каждой стороне, а labels не создают
впечатления направления topology и не меняют trace.

### C-UX-04 — Переименование существующего PhysicalObject

**Исправить.** Добавить явное действие изменения display name существующего
`PhysicalObject`; rename должен обновлять все обычные presentation surfaces
после authoritative refresh.

**Граница `11-04`.** Сохраняются identity объекта, его
`ConnectionPoint`/`NetworkInterface`, `Connection`, `Cable`, provenance,
Location и membership `SavedMap`; delete + recreate не является workaround.

**Ручная проверка.** Создать `PP-301`, назначить ему `COMM-ROOM`, разместить
на `SavedMap`, создать один `Cable` к `SW-301-ACCESS`, добавить его в
`MapComposite`, сохранить карту и открыть details объекта. Через явное
действие rename изменить имя на `PP-301-RENAMED`, сохранить и обновить
страницу. Открыть объект из списка, карту, composite, endpoint и Cable.

**Закрыто, если.** Имя меняется без удаления, все связи, endpoints,
placement, Location и membership остаются у того же объекта, а новое имя
видно во всех проверенных UI-поверхностях после refresh.

### C-UX-05 — Направляющие выравнивания и равных интервалов

**Исправить.** Во время drag на `SavedMap` показывать релевантные guides для
границ и центров видимых объектов, а также подсказку равного интервала при
размещении третьего объекта. Guides transient и не требуют grid или
automatic layout engine.

**Граница `11-04`.** Меняется только presentation authoring; `MapViewPosition`,
canonical topology, `Blueprint` и `Location` не меняются.

**Ручная проверка.** Создать и разместить рядом `PC1`, `PP-301` и
`SW-301-ACCESS` на одной `SavedMap`. Перемещать третий объект рядом с левыми,
правыми, верхними, нижними и центральными линиями первых двух; затем
переместить его в положение с тем же расстоянием, что между первыми двумя.
Зафиксировать положение, отпустить мышь и снова открыть карту; повторить
перемещение после reload.

**Закрыто, если.** При drag guides появляются только для совпадающих
геометрий/интервалов, исчезают после drop, помогают разместить третий объект,
а сохранённые координаты остаются presentation state без изменения topology.

### C-UX-06 — Независимые ширина и высота размещения

**Исправить.** Для каждого Blueprint-backed placement добавить независимое
изменение Width и Height через canvas и Inspector, используя один
authoritative presentation contract; aspect-ratio lock может быть только
дополнительным удобством.

**Граница `11-04`.** Меняется геометрия конкретного placement на `SavedMap`,
не intrinsic body geometry `Object Blueprint`, canonical object, identities,
topology, continuity или provenance. Порты и attachment geometry должны
следовать rendered body в пределах карты.

**Ручная проверка.** Создать `PP-301`, `SW-301-ACCESS` и `FPP-811`, разместить
их на `SavedMap`, выбрать `PP-301` и изменить только Width через Inspector,
затем только Height. Повторить независимое изменение за handles по X и Y,
создать Cable к объекту и проверить attachment. Переключить SavedMap variant,
вернуться к исходной карте и открыть Blueprint editor для сравнения intrinsic
геометрии.

**Закрыто, если.** Width и Height изменяются независимо и одинаково
отражаются через Inspector и canvas, порты/кабельные attachment остаются
корректными, а Blueprint и canonical topology не изменяются.

### C-UX-07 — Перемещение раскрытого composite как группы

**Исправить.** Добавить явный drag affordance у раскрытого `MapComposite`,
который переводит всех его members на один delta и сохраняет относительную
геометрию и membership.

**Граница `11-04`.** Это presentation-only group translation; composite не
становится canonical parent/container, а `PhysicalObject`, Location,
topology, Cable и Blueprint semantics не меняются. Поведение сохранённых
waypoints проверяется отдельно в `C-UX-11`.

**Ручная проверка.** Создать и разместить `FPP-833`, `CORE-A`, `CORE-B`,
`SRV1`, создать `MapComposite` с этими объектами, раскрыть его и сохранить
`SavedMap`. Перетащить composite за header/frame, не за member, затем открыть
каждый member и сравнить delta координат и относительные расстояния. Свернуть,
раскрыть и обновить страницу; проверить membership и topology.

**Закрыто, если.** Один drag перемещает всех видимых members на одинаковый
delta, внутренний layout и membership сохраняются, а canonical данные и
связи не меняются.

### C-COR-01 — Взаимодействие с members раскрытых composites

**Исправить.** Устранить перехват hit-testing/focus/selection так, чтобы все
видимые members всех одновременно раскрытых `MapComposite` независимо
выбирались обычным способом в течение длительной editing session и после
reload. Сначала выполнить targeted diagnosis; не утверждать root cause до
воспроизводимого подтверждения.

**Граница `11-04`.** Frame/background composite не маскирует members; только
явно interactive header/toggle получает composite-specific interaction.
`C-UX-07` и cable routing не считаются причиной автоматически.

**Ручная проверка.** Создать и разместить два composite: `811` с `FPP-811` и
`DIST-811`, `COMM-3` с `PP-301` и `SW-301-ACCESS`; раскрыть оба. По очереди
кликнуть каждый member, открыть его context menu, выбрать port и начать
редактирование Cable route. Переместить presentation objects, создать и
отредактировать несколько routes, переключить selection между composites.
Сделать полный reload страницы и повторить все клики, включая контрольный
объект вне composite.

**Закрыто, если.** Каждый visible member обоих composites и контрольный объект
выбирается, его port/context-menu interaction доступно до и после reload, а
выбор одного composite не блокирует другой; проверка воспроизводится после
длительной сессии.

### C-UX-08 — Редактирование membership MapComposite

**Исправить.** Дать UI для добавления и удаления уже размещённых на той же
`SavedMap` `PhysicalObject` из существующего `MapComposite` без удаления и
пересоздания самого composite.

**Граница `11-04`.** Сохраняются identity/name composite, objects, Location,
Blueprint, topology, variants и существующие presentation state; member,
исключённый из membership, остаётся на карте. Existing overlap/nesting
restrictions не обходятся.

**Ручная проверка.** Создать и разместить `CORE-A`, `CORE-B`, `SRV1` и `RTR1`
на одной `SavedMap`, создать composite `833` из первых трёх и сохранить карту.
Открыть edit membership, добавить `RTR1`, сохранить, проверить frame и список
members, затем удалить `RTR1` тем же UI и убедиться, что он остался на карте.
Обновить страницу и проверить name/identity composite, collapsed/expanded
state и variant.

**Закрыто, если.** Add/remove выполняются без recreate, composite сохраняет
свою identity/name и presentation state, а objects и topology не удаляются и
не меняются.

### C-UX-09 — Компактный Blueprint picker

**Исправить.** В основном picker при создании `PhysicalObject` заменить
крупные карточки плотным list/table-oriented представлением с компактным
derived preview, именем, версией, классом, количеством endpoints/ports,
internal continuity/link count и явным выбором.

**Граница `11-04`.** Не вводятся отдельная canonical thumbnail entity,
ручные image assets, vendor artwork или общий redesign catalog/library;
canonical `Blueprint` и `PhysicalObject` semantics не меняются.

**Ручная проверка.** Открыть `Инфраструктура -> Объекты -> Создать`, найти
строки для Blueprint простого endpoint, passive panel и switch. Сравнить их
в одном viewport, проверить preview и metadata, выбрать `PC1` и затем
`PP-301`, создать объекты и открыть их details. Выполнить этот сценарий вместе
с проверкой `C-UX-02`, не создавая manual non-Blueprint object.

**Закрыто, если.** Библиотеку можно сравнить в плотном списке, preview
отличает основные geometry patterns, metadata читается без открытия каждой
карточки, а выбор создаёт корректный Blueprint-backed object.

### C-CAP-01 — Cardinality, members и многоканальное внешнее подключение

**Исправить.** В reusable authoring дать возможность задать для одного
ConnectionPoint `cardinality > 1` и distinct `ConnectionMember`, выразить
member-aware internal connectivity и корректно materialize distinct member
identities с exact L1 evidence/trace через конкретный member. Дополнительно
обязателен пользовательский сценарий внешнего подключения многоканального
`ConnectionPoint`: один многоканальный входной Cable/Connection с несколькими
`ConnectionMember` должен быть подключаем через UI к соответствующим внешним
endpoint/member positions.

**Подтверждённая граница по текущему `main`.** Обычное создание физического
соединения сейчас ограничено `cardinality=1` и `member_index=1`. Поэтому
подтверждение `FANOUT-1x24` не может состоять из 24 фиктивных кабелей, 24
фиктивных входных ports, одного endpoint с прямыми связями без member identity
или presentation-only имитации. Нужен один многоканальный входной
`Cable`/`Connection` с несколькими `ConnectionMember`, созданный через UI.

**Граница `11-04`.** Это capability gap authoring/materialization, не
утверждение отсутствия всей canonical L1 модели. Physical endpoint не равен
individual physical member; новый canonical `Fanout/Splitter` entity не
вводится. Exact schema, DTO/API, migration и internal implementation не
фиксируются этим реестром.

**Ручная проверка.** В пустой части заново созданного fixture через UI создать
reusable `Blueprint`/`Port Block` для `FANOUT-1x24` с одним incoming
ConnectionPoint и 24 outgoing positions. В authoring задать cardinality/member
count входного endpoint, создать distinct `ConnectionMember`, задать mapping
member N -> соответствующий output member/endpoint и materialize один
`PhysicalObject`. В details проверить member identities и internal links.
Затем через UI создать один внешний многоканальный входной `Cable`/`Connection`
на incoming `ConnectionPoint` и присоединить его members к внешнему
endpoint/member positions (а не создавать 24 отдельных входных ports или
кабелей). Выбрать отдельный member, выполнить его L1 trace, открыть evidence
и проверить, что выделен нужный member/path, а остальные members не стали его
evidence. Reload и повторное открытие объекта должны сохранить результат.

**Закрыто, если.** Весь сценарий — reusable authoring, cardinality > 1,
distinct members, member-aware mapping, materialization, один
многоканальный внешний Cable/Connection и member-specific trace — выполняется
через UI без фиктивной topology; identity и evidence каждого member точны.
До появления этой capability текущий результат остаётся подтверждённым
открытым замечанием, а не частично закрытым результатом.

### C-UX-10 — Общая кабельная направляющая и гребёнчатый маршрут

**Исправить.** Добавить presentation-only cable guide/corridor, к которому
можно привязать несколько отдельных `Cable`, с предсказуемыми ingress/egress
участками и читаемым общим corridor. Для объединённого участка явно показать
количество кабелей; individual leads остаются различимыми.

**Граница `11-04`.** `Cable` остаются отдельными canonical сущностями,
guide не становится endpoint или physical object, Location и exact physical
path не выводятся из его геометрии, trace сохраняет exact evidence.

**Ручная проверка.** Создать `PP-301`, `SW-301-ACCESS` и несколько обычных
физических `Cable` между соседними портами, разместить их на одной
`SavedMap`. Создать в UI общий guide/corridor, назначить на него эти кабели и
переместить guide рядом с группой. Сохранить карту, проверить отдельные leads,
общий участок и отображаемое количество, затем изменить положение endpoints и
сохранить. Выполнить trace одного Cable на dense участке.

**Закрыто, если.** Guide создаётся и редактируется как presentation primitive,
несколько Cable получают читаемый общий участок с количеством, endpoints и
canonical identities не меняются, а trace одного Cable выделяет только его
evidence.

### C-UX-11 — Реакция сохранённого маршрута на перемещение

**Исправить.** Определить и реализовать однозначную lifecycle-семантику
сохранённого `MapCableRoute` при перемещении endpoint, object или group:
маршрут не должен становиться практически непригодным; выбранная стратегия
должна быть предсказуемой и сохраняться после refresh.

**Граница `11-04`.** `MapCableRoute` остаётся presentation state `SavedMap`;
canonical `Cable`, `Connection`, endpoints и L1 trace не меняются. Finding
отдельен от автоматической routing guide из `C-UX-10`.

**Ручная проверка.** Создать два объекта и `Cable` между ними на `SavedMap`,
создать route с несколькими waypoints и сохранить. Переместить один endpoint,
затем member object и раскрытый group; осмотреть сохранённый route, открыть
его edit, при необходимости сохранить допустимое обновление через UI,
перезагрузить страницу и повторить перемещения. Проверить, что endpoint leads,
intermediate waypoints и сегменты следуют за установленной контрактом
семантикой, а trace остаётся тем же Cable.

**Закрыто, если.** Для одиночного объекта и group перемещение даёт заранее
определённый читаемый результат, route не оставляет неуправляемых вытянутых
segments без предусмотренного пользовательского действия, результат не
теряется после reload, а topology/evidence не изменяются.

### C-VIS-01 — Видимость trace поверх обычных кабелей

**Исправить.** Active L1 trace должен визуально оставаться поверх ordinary
Cable presentation, включая совпадающие/пересекающиеся сегменты и общий
участок guide/corridor. Конкретный способ layering не фиксируется.

**Граница `11-04`.** Presentation layering не меняет canonical evidence;
пересечение geometry не включает ordinary Cable в trace и не смешивает это
замечание с selection или route lifecycle.

**Ручная проверка.** Создать dense группу соседних Cable между patch panel и
switch, несколько route waypoints и общий guide по сценарию `C-UX-10`.
Наложить или пересечь geometry двух кабелей, открыть trace одного Cable,
переместить карту и переключить selection. Повторить на route без guide и
после reload, затем открыть exact evidence и отдельно проверить соседний
ordinary Cable.

**Закрыто, если.** Весь highlighted Cable и его route/evidence видимы поверх
ordinary и общего участка, соседние кабели не ошибочно подсвечены, а
семантический trace result и identity не меняются.

## Итоговая чистая повторная Phase C приёмка

После закрытия всего реестра повторная приёмка начинается с пустой тестовой
БД. Старый Phase C стенд не переиспользуется. Через UI заново создаются
`Locations`, `Port Blocks`, `Object Blueprints`, `PhysicalObjects`, `Cables`,
`SavedMaps`, `MapComposites`, routes, Regions и остальные данные fixture;
прямые записи в БД/API для обхода пользовательского сценария запрещены.

Затем заново собирается representative fixture из `11-04`, включая обычные
1:1 passive cases, `XCONN-4`, presentation variants, routes, composite и
отдельный `FANOUT-1x24` probe с одним многоканальным входным
`Cable`/`Connection` и несколькими `ConnectionMember`. Выполняются все
ручные проверки этого документа, включая проверки зависимостей и повторный
reload. Только после положительного результата каждого пункта допускается
финальный статус повторной Phase C приёмки.
