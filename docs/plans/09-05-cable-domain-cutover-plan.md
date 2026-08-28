# Cable.1 — Canonical Cable domain cutover

## Статус

**IMPLEMENTED — Cable.1.** Cable.0 зафиксировал target architecture; Cable.1
выполнил bounded canonical-domain cutover, описанный ниже.

## Цель

Перевести canonical storage, domain services и необходимые write/read API на
модель `Cable 0..1 ↔ Connection`, удалив действующую Cable-as-PhysicalObject
backend/domain/API схему. Canonical topology остаётся `Connection` между двумя
`ConnectionPoint`.

Это один coherent structural cutover, а не только замена storage. Все current
backend consumers, которые сейчас выводят Cable identity или endpoints из
Cable-`PhysicalObject` aggregate, переходят в этом milestone на canonical
Cable-backed `Connection`: catalog authoritative read, `PhysicalObject`
Details resolver, L1 projection semantics и `MapCableRoute` reference/storage
identity. Без этого они сохраняли бы старый runtime contract и потребовали бы
недопустимого legacy bridge.

## In scope

- destructive pre-production storage/domain cutover без dual read/write;
- Cable entity с ровно одной ссылкой на Connection и DB constraint
  `at-most-one Cable per Connection`;
- atomic cable-backed create (`Connection + Cable`);
- atomic delete/disconnect cable-backed relation (`Cable + Connection`);
- direct Connection без Cable;
- удаление старого Cable-as-PhysicalObject backend/domain/API path, включая
  Cable-owned ConnectionPoint, internal Connection, Blueprint и provenance;
- canonical write/read API, DTO и authoritative backend reads, необходимые
  новой модели;
- catalog authoritative read, Object Details backend resolver и L1 projection
  backend semantics, включая exact Cable refs и endpoints, derived directly
  from the Cable-backed `Connection`, not from a Cable aggregate;
- `MapCableRoute` storage/reference identity cutover from Cable
  `PhysicalObject` to canonical `Cable`, together with the necessary SavedMap
  DTO/API references and cascade lifecycle;
- backend tests, fixtures и миграционная/сбросная проверка новых invariants;
- только минимальные frontend/type/build/test adjustments, необходимые, чтобы
  existing bounded catalog, details, L1 map/projection and route behaviour
  continued to consume the new canonical Cable identity. Это не означает
  product/UI redesign.

## Out of scope

- Cable metadata storage/API shape, включая label/category/capacity class;
- redesign Object Details, новый Cable product UX или presentation polish;
- новая route geometry, visual redesign или изменение пользовательских
  interaction patterns поверх уже заменённой Cable identity;
- Cable metadata storage/API/editing beyond the identity required by this
  cutover;
- Cable.2: product UX cleanup/normalization поверх уже новой Cable model;
- Cable.3: Cable metadata foundation и дальнейшие presentation capabilities;
- Cable Bundle implementation; это отдельное последующее presentation work;
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
5. Catalog, Object Details, L1 projection и MapCableRoute не сохраняют
   Cable-`PhysicalObject` assumptions: they use canonical Cable refs and
   derive endpoints from its one Connection.
6. MapCableRoute и будущий Cable Bundle не используются как доказательство
   canonical connectivity.
7. Cable.1 не содержит полноценного product/UI redesign; follow-up boundaries
   Cable.2 и Cable.3 зафиксированы ниже.
8. Targeted backend tests и Docker verification проходят; applied migrations не
   переписаны.

## Follow-up boundaries

- **Cable.2 — product UX cleanup/normalization.** Нормализует Object Details,
  connect/disconnect and current L1 UX поверх уже materialized canonical Cable
  model. Он не переносит старую Cable identity и не возвращает legacy paths.
- **Cable.3 — Cable metadata foundation + further presentation capabilities.**
  Добавляет описательные Cable metadata прежде всего для
  label/category/capacity class и расширяет presentation capability только
  поверх canonical Cable refs. Cable не становится physical inventory;
  material characteristics и inventory lifecycle не входят в scope. Cable
  Bundle остаётся отдельным последующим presentation work.

## Implementation notes

Targeted impact analysis treats the following as one required Cable.1 cutover
surface: canonical connection mutation, physical-link/wiring APIs, cable
catalog/details reads, L1 projection semantics, MapCableRoute persistence and
references, and Blueprint materialization. HIGH/CRITICAL impact within this
surface is implementation work to complete, not a reason to retain a
compatibility layer. An impact outside this surface remains a blocker requiring
an explicit scope decision.

Implemented with forward revision `0035_canonical_cables`: it destructively
removes development Cable-as-PhysicalObject aggregates and route rows, adds
`cables(connection_id UNIQUE)` and recreates `MapCableRoute` against Cable.
The API creates one Connection plus Cable atomically, deletes either Cable plus
Connection atomically, and preserves direct Connections. Catalog, Object
Details, L1 projection/continuations and Saved Maps expose canonical Cable
refs. Regression coverage verifies the constraints, rollback, lifecycle, and
all four structural readers; obsolete aggregate fixtures were removed.
