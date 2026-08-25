# 07. Workspace и canonical isolation

## Статус

Согласованный application-level contract для нескольких независимых canonical моделей NetMap.

Эта ветка не добавляет новую L1/L2/L3/Security/NAT semantics. Она отвечает на вопрос:

> В какой независимой модели сети выполняются canonical writes, projections и traces?

## Мотивация

NetMap должен поддерживать несколько независимых вариантов описания сети:

```text
Workspace "Production"
    shared canonical model

Workspace "Личный вариант"
    private canonical model

Workspace "Эксперимент"
    private/shared canonical model
```

Это не несколько presentation maps одной topology. Каждый workspace содержит собственный canonical dataset.

## NetworkWorkspace

Application-level сущность:

```text
NetworkWorkspace
    id
    name
    owner?
    visibility/access policy
    lifecycle state
```

Точный storage/API schema определяется отдельным implementation milestone.

`NetworkWorkspace` не является network-domain entity и не участвует как node/edge в L1/L2/L3 graphs.

## Один workspace — одна canonical модель

**FIXED**

Все canonical и observed facts конкретного analysis operation принадлежат одному выбранному workspace.

Изменение facts в Workspace A не меняет Workspace B.

Shared workspace означает shared access к одной canonical модели, а не автоматическое объединение нескольких пользовательских моделей.

## Identity

**FIXED**

Canonical entity ID стабилен внутри workspace.

Полная application-level ссылка conceptually scoped:

```text
(workspace_id, entity_id)
```

Resolver внутри уже выбранного workspace может работать только с `entity_id` и не обязан протаскивать `workspace_id` через каждый domain primitive.

## Workspace выше network core

**FIXED**

Network core/resolvers не знают user/owner/visibility/permissions.

Application layer:

```text
request
    -> authentication / authorization
    -> workspace selection
    -> workspace-scoped Session/CanonicalRepository
    -> EvaluationView
    -> resolver
```

Workspace isolation выполняется до resolver semantics.

## Workspace не является EvaluationView

**FIXED**

`EvaluationView` создаётся внутри уже выбранного workspace.

Он выбирает CONFIGURED/EFFECTIVE, time/revision, observations, freshness, source resolution и completeness, но не выбирает между независимыми canonical models.

Один EvaluationView не смешивает facts нескольких workspace.

Сравнение двух workspace означает два независимых analysis operation с последующим application/presentation compare.

## Repository boundary

**FIXED**

Preferred conceptual boundary:

```text
WorkspaceRepositoryFactory
    workspace_id
        ->
Session / CanonicalRepository scoped to exactly one workspace
```

Resolver не должен самостоятельно реализовывать tenancy через `WHERE workspace_id = ...`.

Application code не должен передавать resolver'у repository, способный читать facts нескольких workspace как один graph.

## Storage strategy

**WORKING HYPOTHESIS**

Предпочтительный первый вариант:

```text
один PostgreSQL
    |
    +-- control/application namespace
    |       users
    |       workspaces
    |       permissions
    |
    +-- canonical schema workspace A
    +-- canonical schema workspace B
    +-- canonical schema workspace C
```

То есть PostgreSQL schema per workspace.

Это позволяет не добавлять `workspace_id` во все domain tables и оставить PK/FK/unique constraints локальными к workspace.

Exact mechanism (`search_path`, SQLAlchemy schema translation или иной безопасный вариант) фиксируется отдельным implementation milestone.

`workspace_id` во всех domain tables и database-per-workspace остаются допустимыми альтернативами, если implementation experiment покажет, что schema isolation неудобна.

## Request-scoped selection

**FIXED**

Нельзя использовать process-global mutable `current_workspace`.

Workspace selection scoped к конкретному request/job/transaction и должна быть safe при concurrency и connection pooling.

Schema/search-path implementation обязана исключить leakage выбранного workspace между pooled connections.

## Existing backend

**FIXED transitional rule**

До отдельного workspace milestone текущая single-schema canonical DB считается:

```text
implicit default workspace
```

Уже завершённые L1/L2/L3/Security/NAT milestones не требуется переделывать только из-за этого contract.

Но новый код не должен закреплять необратимые assumptions:

```text
canonical store всегда один глобальный
public.<table> является domain identity
resolver знает user/owner
```

## Provisioning и migrations

**FIXED requirement; mechanism OPEN**

После реализации workspace support система должна без ручного SQL уметь:

```text
create empty workspace
    -> current canonical schema revision

upgrade existing workspace
    -> current canonical schema revision
```

Точный migration/provisioning lifecycle определяется отдельным milestone.

## Fork

**FIXED product capability**

Пользователь может создать независимый workspace из существующего workspace/snapshot:

```text
fork Workspace A at revision R
    -> Workspace B
```

После fork изменения A не распространяются в B и наоборот.

Первый implementation предпочитает **полную canonical copy**, а не copy-on-write/delta overlay.

## Fork identity

**WORKING HYPOTHESIS**

При full-copy fork полезно сохранять local canonical IDs исходных entities.

Тогда:

```text
(workspace A, object X)
(workspace B, object X)
```

являются двумя независимыми версиями fork-lineage object.

Cross-workspace identity всё равно включает `workspace_id`.

## Merge

**FIXED для первого implementation**

Fork не превращает NetMap в Git.

Пока не требуются automatic merge, three-way merge, rebase, conflict resolution или live inheritance from base workspace.

## Traces, evidence и cache

**FIXED**

Trace/evidence относится к одному workspace.

Persisted/shareable artifact должен позволять восстановить:

```text
workspace_id
evaluation view / revision
resolver version
```

Trace из одного workspace нельзя silently dereference/overlay поверх другого.

Любой cross-query cache, projection cache или persisted derived artifact workspace-scoped.

## Ingestion

**FIXED**

Adapter/background job, создающий canonical/observed facts, имеет explicit target workspace до начала write.

## Access model

**FIXED product direction; exact ACL OPEN**

Authentication отвечает на вопрос:

> кто пользователь?

Authorization отвечает на вопрос:

> что ему разрешено в данном workspace?

Exact auth provider остаётся OPEN. Допустимые будущие направления — local
accounts для standalone deployment и OIDC для нормальной multi-user/corporate
установки; конкретный provider сейчас не фиксируется.

Минимальная пользовательская ролевая модель может быть такой:

```text
OWNER
EDITOR
COMMENTER
VIEWER
```

Это удобные presets над permissions, а не network-domain semantics. Conceptual
permissions:

```text
workspace.read
workspace.comment
workspace.edit
workspace.manage_access
workspace.delete
```

Ожидаемая семантика:

- `OWNER`: полный контроль над workspace и sharing/access management;
- `EDITOR`: read, изменение canonical/presentation state и comments, без
  обязательного права управлять доступом;
- `COMMENTER`: read и comments/annotations без topology/presentation edit;
- `VIEWER`: только read.

Точные ACL schema, role inheritance и groups остаются OPEN.

### Visibility и membership

**FIXED direction**

Общая visibility и пользовательская ACL/membership — разные concerns.
Conceptual visibility может включать:

```text
PRIVATE
SHARED
PUBLIC_READ
```

Точные enum и API не фиксируются. Visibility отвечает за то, кто workspace в
принципе может видеть; membership/ACL — за полномочия конкретного user/group.

### Comments и annotations

**FIXED future collaboration capability**

Пользователь с `workspace.read` и `workspace.comment` может оставлять
замечания, не меняя canonical topology. Annotation/comment не является
canonical network fact; у неё есть author, timestamp, workspace scope,
target/context и lifecycle `OPEN`/`RESOLVED` или эквивалент. Позже допустимы
replies/threading.

Будущая annotation может относиться к `PhysicalObject`, `ConnectionPoint`,
cable/`Connection`, `SavedMap`, `Region`, `MapReference` и другим
canonical/presentation targets по реальной потребности. Polymorphic DB schema
сейчас не фиксируется.

UX direction: badge/open-comments indication на карте, список открытых
замечаний и возможность owner/editor увидеть и resolve замечание.

### Activity и audit

**FIXED product requirement после multi-user writes**

Система должна уметь ответить: кто, что, когда изменил и в каком workspace.
Нужна append-only activity/audit capability, особенно для canonical topology
mutations, destructive actions, access-control changes и workspace lifecycle
operations. Это не означает проектирование event sourcing.

Связанное post-L1 направление описано в
[[09-02-post-l1-product-roadmap|09.2 Post-L1 product roadmap]].

## Workspace portability

**FIXED direction; format details OPEN**

Workspace export/import — не database dump и не сериализация текущих ORM
tables, а отдельный versioned public exchange model. Conceptual manifest:

```text
format = netmap-workspace
format_version = N
```

Self-contained workspace export в перспективе переносит необходимое состояние:
workspace metadata, canonical topology, EntityMetadata/aliases, Saved Maps,
MapPlacements, per-view positions/locks, cable route geometry, regions,
MapReferences, необходимые Blueprint definitions/versions и другие
presentation objects, если они являются частью workspace.

Exact archive format остаётся OPEN. Пользовательский файл `.netmap` позже
может быть container/archive, но ZIP/JSON/storage layout сейчас не фиксируются.
Observed/runtime telemetry не обязана входить в обычный workspace export.

Совпадение UUID не даёт права overwrite существующий workspace. Первый
безопасный product direction — import self-contained package как новый
isolated workspace; restore/merge semantics проектируются отдельно, automatic
merge не требуется.

## Blueprint library packages

**FIXED direction; не часть workspace export**

Отдельный versioned exchange contract conceptually имеет формат:

```text
netmap-blueprint-library
```

Package может содержать Blueprint definitions, immutable versions,
presentation geometry, endpoint groups/slots, internal link authoring rules и
metadata. Он не содержит instances `PhysicalObject` конкретной сети. Один
package может включать несколько связанных Blueprint.

Use cases: generic patch-panel library, generic servers, vendor/device-family
libraries и перенос пользовательских Blueprint между установками. Exact package
storage format и versioning mechanics остаются OPEN, кроме требования
versioned exchange contract.

Возможен будущий третий механизм — Map template / clone для повторного
использования presentation structure. Он не смешивается ни с Blueprint library,
ни с workspace snapshot.

## Workspace и Map

**FIXED**

`NetworkWorkspace` отвечает:

> Какая canonical модель сети является source of truth?

Saved map/projection отвечает:

> Как показать выбранную canonical модель?

В одном workspace может быть несколько maps/projections.

Обычная map не смешивает facts разных workspace как одну topology.

## Modular monolith

**FIXED**

Workspace management остаётся application module существующего modular monolith.

Отдельный workspace/tenant/project microservice заранее не требуется.

## OPEN

До отдельного implementation milestone не фиксируются:

- exact SQLAlchemy workspace scoping;
- PostgreSQL schema naming;
- control tables physical schema;
- exact auth provider;
- group/role inheritance;
- archive/soft-delete;
- cross-workspace compare UI;
- merge/rebase;
- optimized copy-on-write;
- database-per-workspace.

## Инварианты

1. NetMap поддерживает несколько независимых canonical network models.
2. Каждая canonical model принадлежит одному `NetworkWorkspace`.
3. Workspace является application boundary, а не L1/L2/L3 entity.
4. Resolver работает с одним workspace-scoped repository/session.
5. User/owner/permissions не входят в network resolver semantics.
6. `EvaluationView` работает внутри уже выбранного workspace.
7. Application-level identity scoped парой `(workspace_id, entity_id)`.
8. Facts разных workspace не смешиваются одним resolver query.
9. Workspace selection request/job scoped и pool/concurrency safe.
10. Single-schema backend до workspace milestone является implicit default workspace.
11. Первый fork — independent full copy, не copy-on-write overlay.
12. Изменения source/fork после fork не синхронизируются автоматически.
13. Merge не требуется для первого implementation.
14. Persisted traces/derived artifacts сохраняют workspace scope.
15. Cross-query cache namespace/key включает workspace.
16. Ingestion write имеет explicit target workspace.
17. Private/shared и VIEW/EDIT — минимальные application capabilities.
18. Workspace и presentation map/projection — разные сущности.
19. PostgreSQL schema per workspace — preferred first storage hypothesis, а не обязательный implementation mechanism.
20. Workspace management остаётся частью modular monolith.
21. Authentication и authorization разделены: права оцениваются в контексте выбранного workspace.
22. Роли являются presets над application permissions, а не network-domain semantics.
23. Visibility определяет принципиальную видимость workspace, membership/ACL — права конкретного user/group.
24. Comments/annotations не изменяют canonical topology и имеют workspace scope.
25. Multi-user writes оставляют append-only activity/audit след.
26. Workspace export/import использует отдельный versioned public exchange model, а не ORM/database dump.
27. Обычный import создаёт новый isolated workspace; совпавший UUID не разрешает overwrite.
28. Blueprint library package является отдельным versioned exchange contract и не содержит instances конкретной сети.
