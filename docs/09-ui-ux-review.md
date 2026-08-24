# 09. Рабочий UI/UX review — Object Library и Blueprint Template Editor

## Статус и границы

**WORKING UX REVIEW / IMPLEMENTATION PENDING.** Эта заметка сохраняет результаты
первого ручного пользовательского прохода по Object Library и созданию,
редактированию и versioning blueprint templates. Она не меняет canonical domain
model, resolver semantics, API, persistence или текущий runtime. Наблюдения ниже
разделяют реализованный subset, UX-проблемы, согласованное направление и открытые
product/domain вопросы; они не являются готовым implementation plan.

Canonical и presentation boundaries остаются в [[01-domain-model|domain model]],
[[05-presentation|presentation contract]] и
[[08-ui-implementation|UI implementation contract]]. Следующий ручной review
должен продолжить пользовательский lifecycle, а не автоматически породить
milestones:

```text
instantiate PhysicalObject from blueprint
    -> object catalog/detail
    -> physical ports/connections
    -> Saved Map placement/presentation
```

## Подтверждённый работающий foundation

Ручной проход подтвердил полезность уже materialized blueprint model и editor
как authoring surface.

- Endpoint groups — удачная authoring abstraction: ими быстро описываются простой
  PC, outlet, telephone, 24/48/52-port switch, patch panel, SAN switch и storage
  с несколькими группами портов.
- Массовое создание endpoint slots заметно лучше масштабируется, чем ручное
  создание каждого порта.
- Patch panel — особенно быстрый сценарий: несколько groups вместе с generator
  pair-by-index позволяют массово создать пары front/rear.
- Blueprint versions immutable: edit создаёт новую version, а уже
  materialized objects предыдущей version не уничтожаются и не меняются неявно.
- Live schematic preview полезен как концепция и уже помогает authoring.
- SAN switch описывается текущими protocol-neutral `NETWORK_PORT` slots. На
  границе L1/`NetworkInterface` editor не требует Ethernet-specific port type.

Последнее наблюдение согласуется с FC compatibility boundary в
[[01-01-l1|L1]], [[01-02-network-interface|NetworkInterface]],
[[01-03-l2|Ethernet L2 boundary]] и [[05-presentation|presentation]]. Оно не
создаёт FC primitive, FC resolver или FC UI.

## Entry flow: template-first, но не новый canonical invariant

### Наблюдаемая проблема

В полностью пустой системе пользователь попадает на пустую Saved Map и видит
«Добавить объект». UI не объясняет нормальный путь:

```text
создать blueprint/template
    -> создать canonical object from blueprint
    -> добавить object на Saved Map
```

### Согласованное направление

Primary user workflow должен быть template-first. Empty states для отсутствующих
templates, objects и map placements должны быть разными и state-aware; на пустой
системе интерфейс должен вести к созданию или выбору шаблона, а не ограничиваться
«Добавить объект».

### Открытый product question

Это не означает запретить `PhysicalObject` без blueprint. Manual/advanced
creation path остаётся отдельным product decision; template-first — направление
основного UI path, не canonical invariant.

## Терминология и authoring controls

### Язык интерфейса

Template Editor сейчас смешивает русский и английский (`Live schematic preview`,
`Fill color`, `Body kind`, `Endpoint groups`, `Internal link generator`,
`Pair groups by index`). Это UX-проблема. Целевое направление —
терминологически целостный русскоязычный интерфейс.

### Маркировка и stable identity

`Key prefix` и `Display prefix` неясны без знания внутренней blueprint model.
Stable slot identity может быть важна для backend/version migration, но primary
authoring UI не должен заставлять пользователя мыслить внутренними keys без
необходимости. Предпочтительная форма пользовательского представления:

```text
Маркировка портов
Префикс: A
Начать с: 1
Количество: 24
```

Stable/internal key следует генерировать или скрывать, где это возможно. Если
изменение identity может быть destructive, будущий UI должен явно показывать
его последствия.

### Создание groups

Сейчас первая endpoint group появляется автоматически, а ниже есть «Добавить
группу»; неясно, создаёт ли кнопка текущую или ещё одну group. Предпочтительное
направление: изначально пустая секция «Группы портов» и явное добавление первой
group. Точная microcopy пока не зафиксирована.

### Цвет и schematic geometry

Hex-only ввод цвета неудобен. Primary UI должен предлагать visual color picker
или palette; hex допустим как optional/advanced exact value.

Текущие Width/Height воспринимаются как абсолютный map-size (например,
`480 x 40`), хотя blueprint должен описывать local/normalized schematic geometry:
форму, aspect ratio и расположение endpoint groups. Фактический display size на
Map — задача renderer/presentation. Это target concept, не решение о storage
schema.

## Endpoint-group arrangement и preview

### Group placement

Текущих сторон `TOP`, `BOTTOM`, `LEFT`, `RIGHT` недостаточно. Например, storage
может иметь Controller A с FC ports справа сверху и MGMT слева сверху, а
Controller B — FC ports справа снизу и MGMT слева снизу. Направление — `side`
плюс relative position/offset along side либо эквивалентная normalized
presentation geometry, без enum explosion (`LEFT_TOP`, `LEFT_CENTER`, ...).
Точная persistence model не фиксируется.

### Различимость groups

Несколько switch groups на одной стороне (например 24 access ports и 2 uplinks)
сейчас визуально сливаются в непрерывную последовательность endpoints. Будущий UX
должен делать clusters различимыми: gap, labels, highlighting, selectable
clusters и/или relative placement/span — это варианты, не финальный visual
design.

Live preview в перспективе должен стать инструментом schematic arrangement, а
не только passive preview: selection/highlighting group и, возможно, её
перемещение вдоль стороны. Это direction, а не требование реализовать drag
сейчас.

## Internal links

Pair-by-index generator полезен, особенно для patch panel, но терминология
должна до выполнения явно объяснять, что создаётся:

```text
groupA[1] <-> groupB[1]
groupA[2] <-> groupB[2]
...
```

Future authoring capability должна позволить просмотреть generated internal
links, исправить отдельную связь, создать нестандартное соответствие и увидеть
ошибочное mapping. Для этого достаточно в том числе table/manual editing;
graphical drag-and-drop не является обязательным решением. Нельзя выдавать
текущий generator за покрытие всех internal-link scenarios.

## Blueprint version lifecycle: future controlled upgrade

Текущий lifecycle технически безопасен:

```text
Blueprint v1 -> existing objects
edit blueprint -> immutable Blueprint v2
existing objects remain on v1
```

Но пользователю не видно, что появилась новая version, какие objects остались
на старой и как их перевести. Нужна future product capability controlled object
upgrade: увидеть instances старой version, выполнить dry-run compatibility
analysis, увидеть changes и blockers, затем явно применить upgrade к выбранным
или всем compatible objects.

Пример blocker: если v2 удаляет `Gi1/0/48`, но `SW07/Gi1/0/48` имеет external
connection, instance нельзя silently upgrade. После устранения blocker analysis
и apply должны быть повторяемыми.

Ключевой будущий invariant: upgrade blueprint version не означает
delete/recreate `PhysicalObject`. Canonical identity объекта и, насколько это
возможно, identity совпадающих generated slots сохраняются. Existing topology,
connections, placements, references, future L2/L3 facts и history не должны
теряться только из-за upgrade.

Для будущего compatibility planner полезна product-level классификация, а не
окончательная algorithm specification:

- обычно presentation-safe: color, schematic geometry, group position,
  display labels;
- обычно structurally additive: add slot, add group;
- potentially destructive / требует compatibility analysis: remove slot,
  remove group, change slot identity, modify internal connectivity.

## Открытый domain вопрос: telephone passthrough

IP phone с uplink network port и downstream PC network port может иметь
embedded bridge/switch forwarding behavior. Это не обязательно passive L1
internal continuity. Будущая L2 modeling должна рассмотреть этот случай как
отдельный domain question и не моделировать telephone passthrough passive cable
только ради удобства UI.

## Что эта заметка не утверждает

Это первый manual UX review только для Object Library и Blueprint creation,
editing и versioning. Он не является завершённым UI redesign plan, не меняет
canonical facts и не вводит roadmap. Implementation milestones допустимо
формировать лишь после более полного user-level прохода по L1 UI.
