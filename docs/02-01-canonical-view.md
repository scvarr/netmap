# 02.1 Canonical facts и EvaluationView

## Статус

Согласованная модель coherent input view для resolver'ов NetMap.

`EvaluationView` не создаёт новую копию topology.

Он фиксирует:

> какие canonical и observed facts считаются допустимыми входными данными конкретного analysis query?

Это основа воспроизводимости, configured/effective/historical analysis и корректной работы с асинхронными источниками.

## Canonical facts

Canonical означает:

> факт хранится как самостоятельное domain/observation утверждение и может служить evidence для derivation.

Canonical не означает:

```text
вечный
ручной
абсолютно достоверный
```

Например:

```text
Connection
```

может быть ручным устойчивым фактом.

А:

```text
FDBEntry in snapshot T
```

— краткоживущим observed canonical fact.

Оба являются source records.

## Derived data не входит в canonical input автоматически

Например:

```text
L2ReachabilityDomain
cached packet trace
aggregated site edge
```

не используются как самостоятельные facts при новом trace, если только они явно не оформлены как validated cache/read model с dependency semantics.

Resolver должен быть способен rebuild result из исходных facts.

## EvaluationView

Концептуально:

```text
EvaluationView
    mode
    at_time?
    data_revision
    observation_selector
    freshness_policy
    source_resolution_policy
    completeness_policy
```

Физическая API schema будет определена позже.

## Mode

Минимально:

```text
CONFIGURED
EFFECTIVE
```

### CONFIGURED

Выбирает configuration/domain intent.

Operational observations не должны молча заменять configured facts.

### EFFECTIVE

Добавляет/предпочитает актуальные operational observations там, где они нужны semantics.

Например:

```text
interface state
FDB
installed route
neighbor
session/NAT binding
dynamic policy data
```

## Historical

Historical не обязательно является третьим `mode`.

Можно выразить:

```text
mode = EFFECTIVE
at_time = T
```

или:

```text
mode = CONFIGURED
at_time = T
```

Это позволяет задавать:

> что было настроено на T?

и:

> что фактически наблюдалось на T?

как разные вопросы.

## Data revision

Для persisted canonical/configured facts query желательно привязать к DB-consistent revision/snapshot.

Implementation может использовать:

```text
database transaction snapshot
monotonic revision
commit/version ID
```

Конкретный механизм не фиксируется.

Важно, чтобы один query не читал половину topology до update и половину после update без явной причины.

## Observation selector

Operational observations приходят независимо:

```text
switch poll every 30s
firewall poll every 60s
routing poll every 15s
manual update at arbitrary time
```

Невозможно всегда иметь один физически одновременный snapshot всей сети.

`EvaluationView` поэтому выбирает наиболее подходящие observations согласно query time и policy.

## at_time

```text
at_time = now
```

означает:

> выбрать observations, допустимые как current согласно freshness semantics.

Это не:

```text
просто взять последнюю запись любого возраста
```

Historical:

```text
at_time = T
```

выбирает observations относительно T.

## Freshness

Freshness зависит от класса fact/source.

Например:

```text
physical cable:
    weeks/months

FDB:
    seconds/minutes

interface status:
    seconds

configured firewall policy:
    until config revision changes
```

Поэтому единый глобальный TTL:

```text
all data valid 5 minutes
```

архитектурно слаб.

Freshness policy должна быть typed/source-aware.

## Stale fact

Stale observation не обязана полностью исчезать.

Resolver может использовать её как:

```text
historical hint
warning/evidence
```

Но strict effective conclusion, зависящий от current state, не должен считать stale fact бесспорно актуальным.

Типичный результат:

```text
UNKNOWN
flag = STALE_REQUIRED_FACT
```

## Source resolution

Несколько sources могут утверждать разные значения.

Например:

```text
manual: interface up
SNMP: interface down
vendor API: interface down
```

Нельзя использовать generic:

```text
latest row wins
```

для всех fact classes.

Source resolution policy может учитывать:

```text
authority
source type
observation time
confidence/quality
scope
```

Точная модель source precedence будет определена в `04. Источники данных`.

`EvaluationView` лишь фиксирует, какая policy была использована.

## Conflict

Если policy не может однозначно разрешить conflicting facts:

```text
selected semantic value = UNKNOWN/CONFLICTING
```

а не arbitrary source.

Trace evidence сохраняет конфликтующие records.

## Completeness

Completeness относится не только к individual fact.

Часто нужно знать полноту **набора**.

Примеры:

```text
all L2 bindings on interface X known
all routes relevant to table T known
full FDB snapshot for context C
all security rules before order N known
all processing-plan stages known
```

Поэтому completeness — scope-aware concept.

## Absence vs confirmed absence

Инвариант:

```text
record not found
```

сам по себе не означает:

```text
semantic fact does not exist
```

Если coverage/completeness unknown:

```text
absence -> UNKNOWN
```

Только relevant complete coverage позволяет:

```text
absence -> confirmed negative
```

## Query-scoped completeness

Полнота не обязана означать:

```text
мы импортировали всю таблицу
```

Authoritative lookup может доказать ровно один query.

Например:

```text
route get 10.20.30.40
```

может быть complete evidence для route selection этого destination.

Firewall packet simulator может быть complete для одного packet.

Это называется query-scoped authoritative evidence.

## Pinned evidence

После того как resolver выбрал конкретный observation/snapshot, trace step должен ссылаться на него.

Если в DB появляется новая запись во время trace:

```text
T2
```

уже пройденный step остаётся основан на:

```text
T1
```

Query не переписывает прошлое execution посередине анализа.

## On-demand external lookup

В будущем adapter может выполнять authoritative query во время trace.

Например:

```text
device route lookup
packet-tracer
```

Полученный result добавляется как query-scoped evidence branch.

Он должен иметь:

```text
source
observed_at
scope/completeness
```

и быть pinned к trace.

Он не обязан автоматически становиться persistent canonical fact, если ingestion policy этого не предусматривает.

## Temporal mismatch

Разные stages могут использовать observations:

```text
routing at 12:00:01
FDB at 12:00:12
firewall session at 12:00:07
```

Это нормально до определённой степени.

Но если time skew превышает допустимую semantics и может изменить conclusion:

```text
UNKNOWN
flag = TEMPORAL_MISMATCH
```

или warning согласно query policy.

## Strict view

Первый implementation лучше сделать conservative:

```text
unknown freshness
unknown completeness
unresolved conflict
```

не превращать автоматически в positive/negative.

Это даст больше `UNKNOWN`, но меньше ложных выводов.

Ослабленные best-effort modes можно добавить позже явно.

## Best-effort не должен быть default truth

Если позже появится:

```text
mode = BEST_EFFORT
```

result обязан показывать assumptions:

```text
assumed latest route still valid
assumed missing policy means no policy
```

и не смешиваться с strict authoritative verdict.

## EvaluationView fingerprint

Для caching полезен deterministic fingerprint выбранного input view.

Он может учитывать:

```text
DB revision
selected snapshot IDs
source-resolution policy version
freshness policy version
resolver/compiler version
```

Конкретный hashing mechanism не фиксируется.

## Fingerprint не обязан описывать всю БД

Можно строить scope-specific fingerprint для:

```text
L2 context
RoutingContext
processing point
query dependency set
```

Fine-grained оптимизация откладывается.

Первый backend может использовать coarse revision.

## Query reproducibility

Trace result должен позволять понять:

```text
mode
at_time
input revision/view
selected important snapshots
resolver version
```

Чтобы инженер мог позже объяснить, почему результат был именно таким.

## EvaluationView и transaction isolation

DB transaction consistency и network observation consistency — разные вещи.

Transaction snapshot гарантирует:

```text
consistent stored records
```

но не гарантирует, что внешние devices были опрошены одновременно.

Поэтому нужны оба слоя:

```text
database revision
+
observation time/provenance
```

## View lifetime

`EvaluationView` живёт в рамках analysis operation.

Он может переиспользоваться несколькими subresolvers одного `Packet Flow Trace`.

Это важно:

```text
L3
Security
NAT
L2
```

должны по возможности смотреть на согласованный selection policy/time context.

## Child resolver

Когда Packet Flow вызывает L2 resolver, он передаёт тот же high-level:

```text
EvaluationView
```

а не создаёт новый:

```text
now()
```

внутри L2.

Иначе lower layer может внезапно анализировать другой момент времени.

## Query-specific subview

Subresolver может сузить scope:

```text
EvaluationView
    ->
L2 subview for Context A
```

но не менять:

```text
mode
at_time
source policy
```

без явного evidence.

## Immutable semantic view

После создания конкретный resolved/pinned view conceptually immutable.

Если пользователь хочет:

```text
обновить данные и пересчитать
```

создаётся новый view/query.

## Инварианты

1. `EvaluationView` выбирает inputs, но не копирует topology.
2. Canonical facts могут быть configured или observed.
3. Derived reachability/cache не становится canonical evidence автоматически.
4. CONFIGURED и EFFECTIVE являются разными semantic modes.
5. Historical analysis задаётся query time/view.
6. Persisted facts должны читаться из consistent DB revision/snapshot.
7. External observations могут иметь разные timestamps.
8. Freshness typed/source-aware; единый universal TTL не предполагается.
9. Stale required observation не используется как бесспорно current.
10. Source conflict не разрешается generic last-write-wins.
11. Неразрешённый conflict сохраняется как uncertainty.
12. Completeness является scope-aware.
13. Отсутствие записи без completeness не доказывает semantic absence.
14. Query-scoped authoritative result может быть complete для конкретного вопроса без полного dataset.
15. Selected evidence pinning предотвращает silent mid-trace switching.
16. On-demand external result имеет provenance/time/scope.
17. Significant temporal mismatch должен быть видим result.
18. Conservative/strict semantics является безопасным default.
19. Best-effort assumptions, если появятся, должны быть explicit.
20. EvaluationView может иметь deterministic fingerprint для cache/reproducibility.
21. DB transaction consistency не заменяет observation temporal semantics.
22. Один Packet Flow передаёт общий EvaluationView дочерним resolvers.
23. Subview может сужать scope, но не молча менять semantic query time/mode.
24. Resolved view conceptually immutable в рамках query.

## Открытые вопросы

Следующие детали будут зафиксированы в других ветках:

- physical schema source/provenance records;
- formal completeness/coverage model;
- freshness policy representation;
- source authority/precedence;
- confidence/data-quality semantics;
- DB revision mechanism;
- on-demand adapter query persistence policy;
- scope-specific fingerprinting;
- historical reconstruction strategy.

Следующая ветка формализована в [[02-02-resolver-structures|02.2 Resolver structures]]: какие persistent indexes, view-scoped read models и query-scoped caches нужны каждому resolver.
