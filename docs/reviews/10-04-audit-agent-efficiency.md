# Audit: agent execution efficiency

Дата: 2026-08-31
Ветка: `audit-agent-efficiency`
Baseline: `HEAD = origin/main = f00bf087ebd67ac8279a5947bbad957d10f61801`

## Executive summary

Аудит нашёл три наиболее вероятных источника непропорциональной стоимости
будущих bounded changes и один менее frequent concentration hotspot:

1. `P1` — обязательная финальная full backend/frontend regression gate не
   имеет достаточно точного триггера и конфликтует по смыслу с более узким
   milestone guidance. Для небольшого изменения это создаёт test-selection и
   corrective-loop overhead, а не только runtime cost.
2. `P1` — frontend MapPage test family усиливает маленькие изменения через
   повторные page harnesses и моки.
3. `P1` — backend global test cleanup расширяет стоимость каждого E2E теста
   через autouse cleanup всех таблиц.

`P2` — `CanonicalRepository` остаётся важным architectural concentration
hotspot (около 2905 строк и 30 прямых upstream dependents), но `0/100` recent
touches и low/medium фактическая frequency не обосновывают отдельный cleanup
milestone сейчас.

Следующий bounded cleanup разумно ограничить уточнением validation gate,
локализацией backend test setup и одним аккуратным MapPage test-harness slice.
`CanonicalRepository` следует улучшать при естественном repository-touch
milestone либо после появления evidence повторяющейся стоимости; отдельный
repository refactor сейчас не рекомендуется.

## Method / evidence boundary

Проверено:

- branch/worktree state после `git fetch origin`; `git status --short --branch`,
  `git rev-list --left-right --count origin/main...HEAD`;
- обязательные `AGENTS.md`, `docs/00-implementation-constraints.md`,
  `docs/README.md`;
- inventory размеров application, test и docs files;
- targeted GitNexus `list_repos`, `context`, `query`, `impact` для MapPage,
  TopologyCanvas, `useI18n`, `CanonicalRepository` и packet-flow entrypoint;
- адресные `rg` по test setup, test families, legacy/historical expectations и
  validation commands;
- `git log -n 100 --name-only` как proxy частоты касаний.

Не запускались backend/frontend test suites, production builds, Docker tests и
широкие GitNexus graph operations. Поэтому test-runtime claims ниже — claims о
test selection, context и setup amplification; не измерения wall-clock.

GitNexus index существует, но на момент аудита сообщал `commitsBehind: 1` и
индексировал commit `04bcc85d...`. Все graph counts помечены этим ограничением;
где это важно, они сверены обычным текстовым поиском и историей. Индекс не
перестраивался, чтобы не превращать audit в broad repository operation.

## Ranked findings

### P1 — нестрогая full-regression gate на финальной границе milestone

**Симптом.** `AGENTS.md` требует full backend/frontend regression suites на
final milestone boundary, если только broad/uncertain impact не требует их
раньше. При этом `docs/00-implementation-constraints.md` говорит, что не
каждый milestone обязан иметь полный E2E suite. README также задаёт один
compose test-runner command, но не определяет более дешёвую область проверки.

**Evidence.** Frontend package script `test` — весь Vitest suite; inventory
содержит 81 frontend test file и 66 backend test files. В AGENTS правило
является project-wide instruction, а критерий `final milestone boundary` не
формализован.

**Механизм agent cost.** Agent должен сначала решать, является ли маленький
change milestone boundary, затем выбирать между targeted и full suites и
разбирать unrelated failures. Неопределённость провоцирует лишнее чтение
конфигурации, запуск широкого test work и corrective loops.

**Частота:** высокая — каждый implementation milestone потенциально попадает
в gate. **Выигрыш:** high при устранении ambiguity. **Риск:** low, если менять
только acceptance wording.

**Bounded corrective.** Отдельный documentation-only milestone: определить
объективный trigger full suite, сохранить targeted-first default и явно
разделить milestone acceptance от optional/full regression evidence. Не менять
код или тестовую архитектуру.

### P2 — `CanonicalRepository` как architectural concentration hotspot

**Симптом.** `app/repository.py` — 2905 строк и class span от строки 301 до
3082; в одном class сосредоточены persistence, validation и разные domain
records.

**Evidence.** Targeted GitNexus `context(CanonicalRepository)` показал 30
incoming imports из resolver/catalog/main модулей. `impact` upstream по class
показал `impactedCount: 30`, все на depth 1, `risk: CRITICAL` (индекс сообщил
`epistemic: exact`). В последних 100 commits файл не касался, то есть это
не самый частый текущий touch surface; finding основан на change amplification,
а не на размере. Обычный inventory подтверждает 120717 bytes / 2905 lines.

**Механизм agent cost.** Любая правка, попавшая в public repository boundary,
требует понять множество прямых consumers и связанные модели/валидацию. Agent
может быть вынужден читать большой class даже для bounded storage change;
critical graph signal повышает обязательный scope reasoning и validation.

**Частота:** low по истории касаний, с medium/high overhead при каждом таком
изменении. **Выигрыш:** medium/high только для repository-touch milestones.
**Риск:** high — это canonical persistence boundary.

**Bounded corrective.** Улучшать только при естественном repository-touch
milestone либо после evidence повторяющейся стоимости: выбрать один cohesive
slice с сохранением canonical identity и transaction contracts и сравнить
change cone до/после. Отдельный repository refactor сейчас не рекомендуется;
не дробить файл механически и не вводить compatibility layer.

### P1 — MapPage test harness amplification

**Симптом.** Frontend MapPage behaviour распределён по 9 test files; шесть
файлов имеют собственный `renderPage` и повторяют datasource/mocking setup.
Backend setup рассматривается отдельно ниже.

**Evidence.** MapPage family: 9 files, суммарно 90 `it`/test cases по
inventory; `MapPage.savedMaps.test.tsx` — 241 строка, 42 теста и 328 `vi.fn`,
`MapPage.mutationLifecycle.test.tsx` — 22 теста и 152 `vi.fn`; отдельные
`renderPage` обнаружены в wiring, textAnnotations, regionEdit, contextMenu,
mutationLifecycle и savedMaps. `TopologyCanvas` при этом имеет только два
direct test files и входы MapPage + эти tests — это показывает, что широкая
MapPage family, а не canvas size, является amplification surface.

**Механизм agent cost.** Для локальной UI правки agent читает несколько
вариантов почти одинакового page harness и синхронизирует mocks, поэтому
изменение одного MapPage invariant расширяет context и test-selection work по
нескольким файлам. Большой объём test code здесь является следствием
повторного setup и широкого scope, а не количества тестов как такового.

**Частота:** high для MapPage (27 touches за последние 100 commits; savedMaps
test — 16). **Выигрыш:** medium/high. **Риск:** medium для harness extraction.

**Bounded corrective.** Один shared MapPage test harness только для
неизменяемой render/data-source части, без удаления behavioural cases и без
broad test rewrite. Перед изменением сравнить targeted failure behaviour.

### P1 — backend autouse database cleanup amplification

**Симптом.** Backend `tests/conftest.py` содержит autouse `clean_database`,
который перед каждым тестом последовательно удаляет 49 model tables с ручным
dependency order.

**Evidence.** Autouse fixture вызывается всеми тестами, а cleanup вручную
перечисляет 49 таблиц. Это означает, что добавление модели/relationship может
требовать изменения общего setup, а любой targeted E2E test наследует весь
cleanup contract.

**Механизм agent cost.** Для backend изменения agent должен учитывать общий
destructive fixture и порядок удаления; targeted E2E test получает setup scope,
не связанный с его конкретным invariant. Это расширяет context и потенциальный
corrective work, даже если сам behavioural change локален.

**Частота:** medium для backend model changes. **Выигрыш:** medium. **Риск:**
high для изменения isolation/cleanup semantics.

**Bounded corrective.** Отдельно проверить fixture scope и сделать cleanup
contract локальнее либо явно generated, сохранив database isolation. Не
объединять с MapPage harness cleanup и не делать broad test rewrite.

### P2 — i18n surface часто затрагивается, но evidence corrective urgency ниже

`frontend/src/i18n.tsx` — 87593 bytes, всего 111 строк из-за плотных
однострочных dictionaries; `useI18n` имеет 30 incoming components и 12
GitNexus processes, а файл касался 23 раза за 100 commits. Это создаёт
context/readability и locale-parity overhead при добавлении key. Однако
fan-out — ожидаемая семантика общего typed i18n hook, а не доказанный
test/change amplification с широкими corrective loops. При естественном
касании можно выделить locale data в focused modules с одним typed contract,
но отдельный cleanup пока не входит в top 3.

### NO ACTION — большие packet-processing E2E families без доказанного duplicate invariant

Packet-processing backend family состоит из 7 files, 127 test functions и
3723 строк. Отдельные L2/L3/NAT/security/routing families также велики. Но
адресный просмотр показал различные сценарии terminal outcomes, completeness,
attachments, NAT/security и branch semantics; сам размер и E2E suffix не доказывают
дублирование одного invariant. Без test execution/coverage mapping нельзя
обосновать удаление, перемещение или замену этих тестов.

### NO ACTION — `MapPage.tsx` и `TopologyCanvas.tsx` как просто большие файлы

`MapPage.tsx` — 2026 строк и часто менялся (27/100 commits), но GitNexus
upstream impact для `MapPage` показал только 2 affected symbols и `risk: LOW`;
входы — App и page tests, а UI responsibilities видны как explicit child
components. `TopologyCanvas.tsx` — 688 строк, но его incoming surface — MapPage
и два test files. Это не evidence, что дробление файлов снизит agent cost.

### NO ACTION — `app/main.py`, `app/schemas.py`, `app/models.py` по одному лишь размеру

Размеры заметны (`main.py` 1216, `schemas.py` 1888, `models.py` 954 lines), а
main/schema touch frequency равна 9/100 и models 7/100. Но targeted evidence
не показало для них одновременно частого touch и широкого unresolved cone;
`evaluate_packet_flow` в GitNexus имеет узкую функцию entrypoint с 10
процессами, а schemas file target не разрешился как symbol path. Это не повод
вводить speculative extraction.

### NO ACTION — документация как broad mandatory loading

Самые большие docs: packet-flow trace 1970 строк, security policy 1260,
L3 trace 1162, presentation 1035/891. Но `docs/README.md` прямо говорит не
читать всю `docs/` перед каждой задачей и даёт area-specific index; constraints
также направляет к минимальному набору. Evidence broad loading отсутствует.
Следовательно, navigation contract уже выполняет нужную функцию; создавать
второй index/source of truth или дробить документы только по размеру не нужно.

## Heatmap

| Surface | Context cost | Change fan-out | Test fan-out | Frequency of touch | Priority |
|---|---|---:|---:|---:|---|
| `AGENTS.md` full-regression gate | medium | project-wide gate | 147 test files at full gate | every milestone | P1 |
| `app/repository.py` / `CanonicalRepository` | high | 30 direct upstream | broad, not fully enumerated | 0/100 recent commits | P2 |
| MapPage test family | high for MapPage work | 6 repeated page harnesses | 90 tests / 9 files | MapPage 27/100 | P1 |
| `tests/conftest.py` autouse cleanup | medium | all DB tests | every test invokes 49-table cleanup | model changes recurring | P1 |
| `frontend/src/i18n.tsx` | medium | 30 `useI18n` callers | locale/integration tests | 23/100 | P2 |
| `frontend/src/pages/MapPage.tsx` | high file read, low graph cone | 2 upstream symbols | 9 related files | 27/100 | NO ACTION |
| `frontend/src/components/TopologyCanvas.tsx` | medium | 1 page + 2 tests | 2 direct test files | 19/100 | NO ACTION |
| packet-processing E2E family | high suite surface | domain-specific | 127 tests / 7 files | not established | NO ACTION |
| architecture/tracing docs | high when selected | document-local | n/a | not established | NO ACTION |

## Ranked bounded corrective milestones

1. **P1 — clarify the validation gate.** Documentation-only acceptance rule with
   explicit final-boundary trigger, targeted-first default and failure
   classification. Highest leverage and lowest architectural risk.
2. **P1 — consolidate one MapPage harness slice.** Share only stable render and
   datasource construction across the six files; preserve each test family and
   verify the resulting change cone. Do not touch `MapPage.tsx`.
3. **P1 — localize shared backend test setup.** First measure which backend
   tests truly require the full database reset and isolate only that contract;
   no suite deletion and no schema change.
4. **P2 — repository concentration follow-up.** Address one cohesive
   `CanonicalRepository` slice only when a natural repository-touch milestone or
   repeated-cost evidence justifies it; do not start a standalone repository
   refactor and do not bundle it with test cleanup.

## What not to do

- Не дробить `MapPage.tsx`, `repository.py`, `main.py`, `schemas.py` или
  `models.py` по line count.
- Не удалять E2E tests и не заменять их unit tests без доказательства, что
  invariant уже покрыт дешевле и с отдельной ценностью.
- Не превращать fixture/harness cleanup в новую test architecture или общую
  abstraction framework.
- Не добавлять compatibility shims, dual formats, deprecated aliases или
  migration layers ради уменьшения текущего agent context.
- Не убирать GitNexus: targeted `context`/`impact` дал полезный сигнал для
  `CanonicalRepository` и подтвердил `NO ACTION` для MapPage; улучшать нужно
  routing/limits и handling stale index, а не отказываться от graph.
- Не создавать второй documentation index. Достаточно уточнить существующий
  navigation contract, если появится конкретный loading failure.
- Не запускать full suites/build как часть этого audit-only milestone и не
  считать их отсутствие дефектом отчёта.

## Acceptance record

Изменён только этот audit document. Application code, tests и instructions не
изменялись. Для документа применялась только `git diff --check`; test suites и
production builds намеренно не запускались согласно scope milestone.
