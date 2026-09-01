# Application Change History

## Статус

**OPEN / PLANNED.** Это cross-cutting product/architecture contract для
будущей generic history capability. Полная система сейчас не реализуется.

## Семантическая модель

Application Change History — один логический append-only mutation journal
приложения. Он является источником для глобального журнала активности,
истории конкретной сущности и будущего accountability/audit UX.

История конкретной сущности — projection/filter общего журнала по stable
entity reference, а не отдельная history table для каждого типа объекта.
Будущие consumers могут включать PhysicalObject, Cable, Blueprint, Port Block
или версию группы портов, Location, SavedMap и другие mutable application
entities; закрытый enum поддерживаемых типов здесь не фиксируется.

```text
Application Change History
          |
          +--> global activity feed
          |
          +--> filter by entity -> entity history
          |
          +--> filter by workspace/actor/time/action in future
```

## Граница canonical truth

Текущие canonical/domain tables остаются source of truth текущего состояния.
Change history не является canonical topology/domain state, не используется
для восстановления состояния replay-ом и не подменяет repository/domain
reads. Event sourcing не требуется.

```text
canonical current state
        +
append-only change history

но НЕ

event log -> replay -> current state
```

История должна оставаться полезной после удаления сущности. Поэтому будущая
event record логически сохраняет stable historical entity reference/id и,
где необходимо, human-readable snapshot/context на момент события. Soft
delete не является обязательным условием.

## Минимальный смысл события

Без фиксации конкретной таблицы или API будущая запись должна выражать:

- уникальную identity события;
- время;
- subject/entity reference;
- operation/change kind;
- достаточное структурированное описание изменения;
- actor — после появления application identity;
- workspace context — после завершения `NetworkWorkspace`;
- возможность сгруппировать несколько mutations одной пользовательской
  операцией, если это потребуется implementation contract.

## Generic и domain-specific history

Generic Application Change History не заменяет persisted domain-specific
history, если она участвует в correctness или business rules.

`CableLabelHistory` — уже реализованный bounded domain precedent. Он нужен для
authoritative правила: исторически использовавшееся Cable label можно
использовать повторно только после explicit confirmation. Поэтому он
существует раньше generic activity log, участвует в domain write decision и
не должен впоследствии вычисляться из audit log. Он может сосуществовать с
generic event о rename/release/reuse.

Общий принцип: bounded domain history MAY быть введена раньше generic
audit/history, когда этого требует correctness. Это не является разрешением
создавать специальные history tables без необходимости.

## OPEN для bounded implementation contract

- exact persisted schema;
- event/action taxonomy;
- before/after vs structured delta/snapshot representation;
- transaction/correlation representation;
- actor identity integration;
- workspace scoping/indexing;
- retention/archive policy;
- query API;
- UI surfaces/filtering;
- permissions на просмотр history.

## Non-goals

Этот contract не проектирует и не реализует event sourcing, undo/redo,
restore historical state, soft delete, version control, snapshots всего
workspace, diff/merge, comments, notifications, security SIEM export,
analytics pipeline, generic database triggers или application code.
