# 00. Ограничения реализации

## Статус

Обязательные implementation constraints проекта NetMap.

Эта заметка не является предметной моделью сети. Она фиксирует правила, которым должна соответствовать практическая реализация.

Перед любой архитектурной или implementation-работой необходимо сначала
прочитать корневой [[../AGENTS|AGENTS.md]], а затем актуальную документацию
репозитория. `AGENTS.md` задаёт постоянный project-wide development contract;
подробная архитектурная семантика остаётся в текущих документах NetMap.

## Реализацию пишет Codex

Основной implementation agent проекта — Codex.

Архитектурная документация NetMap используется как контракт для implementation tasks.

Предпочтительный рабочий цикл:

```text
1. согласовать semantic/implementation slice;
2. зафиксировать его в docs;
3. выдать Codex ограниченный milestone;
4. Codex реализует код + тесты + container changes;
5. проверить результат на реальном repository state;
6. только затем переходить к следующему milestone.
```

Не следует выдавать Codex задачу:

```text
реализуй весь NetMap по документации
```

одним большим этапом.

## Роль этой документации

Документация должна быть достаточной, чтобы новый implementation session мог восстановить:

- canonical model;
- resolver semantics;
- правила `UNKNOWN`/completeness;
- границы модулей;
- текущий implementation milestone;
- обязательный способ запуска.

При переходе в новый чат/сессию история разговора не должна быть единственным источником этих решений.

## Docker-only runtime

Весь проект должен запускаться в Docker containers.

Целевой developer entry point:

```text
docker compose up
```

или эквивалентная явно документированная Compose-команда.

Host не должен требовать установленного:

```text
PostgreSQL
backend runtime/interpreter
Node.js
Redis
migration tooling
```

если эти компоненты нужны проекту.

Host requirements допускаются только для:

```text
Docker Engine / Docker Desktop
Docker Compose
Git
```

и обычных инструментов разработчика.

## Доступ Codex к Docker Engine

При implementation tasks Codex будет иметь доступ к Docker Engine.

Поэтому Codex должен:

- реально build'ить images;
- запускать containers;
- выполнять migrations;
- запускать automated tests внутри container environment;
- проверять health/startup;
- не ограничиваться генерацией Dockerfile/compose без запуска.

Если environment конкретной задачи временно не позволяет запустить engine, это должно быть явно указано как непроверенный аспект результата.

## Compose как локальная система запуска

Первая реализация ориентируется на Docker Compose.

Kubernetes не является requirement первого backend.

Compose должен описывать все обязательные runtime services.

Минимально ожидается:

```text
backend
database
```

Дополнительные services добавляются только при реальной необходимости.

Не следует заранее вводить:

```text
message broker
distributed cache
graph database
service mesh
multiple backend microservices
```

без доказанной потребности.

## PostgreSQL

Текущая архитектура предполагает PostgreSQL как основной кандидат canonical storage.

Если implementation milestone не выявил технического блокера, первый backend должен использовать PostgreSQL в отдельном container.

Persistent database data хранится в named volume.

Пример conceptual layout:

```text
services:
    db:
        PostgreSQL
        volume

    backend:
        NetMap application
        depends on db
```

Точная версия PostgreSQL фиксируется implementation milestone и должна быть pinned.

## Один backend сначала

Первый backend предпочтительно является modular monolith.

Внутри процесса могут существовать:

```text
CanonicalRepository
ViewResolver
StructureProvider
L1Resolver
L2Resolver
L3Resolver
SecurityResolver
NATResolver
PacketFlowResolver
```

Но это не означает отдельный container/service на каждый resolver.

Разделение на network services производится только при измеренной operational необходимости.

## Workspace boundary

NetMap должен поддерживать несколько независимых canonical network models через application-level `NetworkWorkspace`.

Workspace не является частью L1/L2/L3 resolver semantics.

Предпочтительная boundary:

```text
request/job
    -> auth/access check
    -> workspace-scoped Session/CanonicalRepository
    -> EvaluationView
    -> resolver
```

Не следует заранее добавлять `workspace_id` во все domain tables или передавать user/owner в resolver только ради workspace support.

До отдельного workspace milestone существующая single-schema database считается implicit default workspace.

Новые implementation decisions не должны необратимо предполагать, что canonical store всегда единственный глобальный namespace.

Подробности: [[architecture/workspaces/07-workspaces|07. Workspace и canonical isolation]].

## Reproducible build

Docker images должны собираться из repository source.

Зависимости должны быть зафиксированы lockfile/version constraints соответствующего ecosystem.

Недопустимо, чтобы working environment зависел от:

```text
случайно установленного host package
ручного изменения container после запуска
неописанного local file outside repo
```

кроме explicit secrets/config mounts.

## Configuration

Runtime configuration передаётся через:

```text
environment variables
.env for local development
explicit config files mounted or copied into image
```

Repository должен содержать безопасный template:

```text
.env.example
```

если используются environment variables.

Secrets не commit'ятся.

## Database migrations

Schema changes выполняются migration mechanism.

Нельзя рассчитывать на:

```text
ручной SQL в shell
```

как штатный способ развёртывания.

Fresh environment должен уметь перейти:

```text
empty database
    ->
current schema
```

повторяемым способом.

## Health checks

Long-running services должны иметь machine-readable health/readiness check там, где это практически полезно.

Compose startup не должен зависеть только от:

```text
sleep 10
```

для ожидания database/backend.

## Automated tests

Implementation milestone считается завершённым только если соответствующая semantics покрыта automated tests.

Тесты должны запускаться в containerized environment.

Желательные уровни:

```text
unit:
    pure resolver/state-machine semantics

integration:
    PostgreSQL repository + migrations + resolver

end-to-end:
    API query -> evidence result
```

Не каждый milestone обязан сразу иметь полный E2E suite, но критические semantic invariants не должны оставаться только комментариями.

## Fixtures

Для resolver tests нужны небольшие deterministic network fixtures.

Предпочтительно не использовать огромный production-like dump как единственный test dataset.

Примеры fixture slices:

```text
L1 cable/pass-through
L2 access/trunk
STP blocked alternate path
LAG member state
route recursion
partial routing table -> UNKNOWN
security first-match
DNAT -> route
packet delivered
packet blocked
```

## No host-specific paths

Runtime/build не должен зависеть от Windows paths вроде:

```text
E:\...
```

внутри application semantics.

Repository может находиться на Windows host, но container paths должны быть portable.

## Network access adapters

Будущим adapters может требоваться доступ из container к management networks/devices.

Способ доступа является deployment concern:

```text
normal Docker bridge/routing
explicit published ports
host networking where platform permits and it действительно требуется
VPN/routed host connectivity
```

Core architecture не должна требовать host networking по умолчанию.

## External credentials

Device/API credentials:

- не входят в canonical network model;
- не commit'ятся в repository;
- передаются через secrets/environment/config integration.

Trace evidence не должно случайно сериализовать secret values.

## API-first backend

Первый backend должен иметь machine-readable API boundary.

UI не должен быть единственным способом использовать resolver.

Это позволит:

- тестировать semantics без UI;
- подключить frontend позже;
- использовать NetMap из automation/agent workflows.

Точный protocol/API framework выбирается implementation milestone.

## UI не блокирует backend

Первый implementation milestone может вообще не иметь полноценного frontend.

Приоритет:

```text
canonical storage
migrations
resolver
evidence output
API
tests
Docker startup
```

UI строится поверх стабильного API/result model.

## Observability

Backend должен писать structured enough logs, чтобы отличать:

```text
MODEL_ERROR
internal error
network UNKNOWN
normal negative verdict
```

Не требуется сразу полноценный distributed tracing/metrics stack.

## Development commands

К моменту первого working milestone repository должен документировать минимально:

```text
build
start
stop
test
migrate
reset local dev database
```

Предпочтительно через:

```text
docker compose ...
```

и/или небольшой portable task wrapper.

## Не проектировать deployment раньше времени

Пока не требуются:

```text
HA PostgreSQL
horizontal backend scaling
Kubernetes
distributed workers
production ingress
multi-region
```

Архитектура не должна мешать им в будущем, но первый implementation не оплачивает их сложность.

## Инварианты

1. Основную реализацию пишет Codex по ограниченным milestones.
2. Архитектурные docs являются implementation contract.
3. Весь runtime NetMap containerized.
4. Docker Compose — первый штатный способ локального запуска.
5. Codex при наличии Docker Engine реально build/run/test containers.
6. Host не требует project runtimes/databases вне Docker.
7. PostgreSQL — базовый storage candidate первого backend.
8. Первый backend — modular monolith, если нет доказанной причины для microservices.
9. Runtime dependencies pinned/reproducible.
10. Schema развивается migrations.
11. Fresh environment поднимается без ручной настройки БД.
12. Tests выполняются в container environment.
13. UI не блокирует implementation backend semantics.
14. Backend имеет machine-readable API.
15. Windows host paths не проникают в portable runtime assumptions.
16. Credentials/secrets не хранятся в repository/canonical model.
17. Trace/evidence output не раскрывает secrets.
18. Production/distributed infrastructure не проектируется до реальной необходимости.
