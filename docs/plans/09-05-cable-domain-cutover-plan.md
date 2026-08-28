# Cable.1 — Canonical Cable domain cutover

## Статус

**PLANNED.** Cable.0 зафиксировал target architecture; этот документ задаёт
границы следующего implementation milestone и не является его реализацией.

## Цель

Перевести canonical storage, domain services, API, projections, UI и tests на
модель `Cable 0..1 ↔ Connection`, удалив действующую Cable-as-PhysicalObject
схему. Canonical topology остаётся `Connection` между двумя
`ConnectionPoint`.

## In scope

- destructive pre-production cutover storage/domain model без dual read/write;
- Cable entity с ровно одной ссылкой на Connection и unique at-most-one Cable
  per Connection;
- atomic cable-backed create (`Connection + Cable`);
- atomic delete/disconnect cable-backed relation (`Cable + Connection`);
- direct Connection без Cable;
- удаление Cable-owned ConnectionPoint, internal Connection, Blueprint и
  Blueprint provenance semantics;
- обновление public DTO/API, catalog/details/projections, map wiring и
  authoritative reads под новые identity/reference rules;
- `MapCableRoute` по-прежнему presentation-only, keyed by canonical Cable
  identity, без topology authority;
- tests, fixtures и docs, которые проверяют новые invariants.

## Out of scope

- Cable product metadata: category, capacity class, medium, length, vendor и
  storage/API shape;
- Cable Bundle implementation;
- новая route geometry или изменение Saved Map visual design;
- поддержка, импорт или автоматическая конвертация старых development cable
  records;
- изменение applied Alembic revisions.

## Acceptance boundary

1. В active code/docs нет Cable как `PhysicalObject`, двух Cable-owned
   `ConnectionPoint`, internal Cable `Connection`, Cable Blueprint/provenance
   или special aggregate lifecycle.
2. Database/domain constraints делают orphan Cable, второй Cable на Connection и
   half-disconnected Cable невозможными.
3. Cable-backed create/delete проходят атомарно и не меняют lifecycle
   участвующих PhysicalObject/ConnectionPoint.
4. Direct Connection без Cable сохраняется допустимым.
5. MapCableRoute и будущий Cable Bundle не используются как доказательство
   canonical connectivity.
6. Targeted tests и Docker verification проходят; applied migrations не
   переписаны.

## Implementation notes

Сначала провести targeted impact analysis по canonical connection mutation,
physical-link/wiring APIs, cable catalog/details, map route persistence,
projection/resolver и Blueprint materialization. Затем выполнить один forward
migration либо документированный destructive reset, после чего удалить
obsolete code/tests/fixtures, а не добавлять compatibility layer. Перед
acceptance проверить `git diff`, `gitnexus detect_changes` и полный docs/code
поиск старых cable contract phrases.
