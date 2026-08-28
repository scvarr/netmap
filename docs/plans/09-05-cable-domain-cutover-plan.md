# Cable.1 — Canonical Cable domain cutover

## Статус

**PLANNED.** Cable.0 зафиксировал target architecture; этот документ задаёт
границы следующего implementation milestone и не является его реализацией.

## Цель

Перевести canonical storage, domain services и необходимые write/read API на
модель `Cable 0..1 ↔ Connection`, удалив действующую Cable-as-PhysicalObject
backend/domain/API схему. Canonical topology остаётся `Connection` между двумя
`ConnectionPoint`; projection, map и полноценный UI cutover вынесены в
Cable.2/Cable.3.

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
- backend tests, fixtures и миграционная/сбросная проверка новых invariants;
- только минимальные frontend/type/build adjustments, необходимые для
  собираемости repository.

## Out of scope

- Cable metadata storage/API shape, включая label/category/capacity class;
- полноценный projection/UI/map redesign;
- Cable.2: projections + Object Details/connect/disconnect/current L1 UX
  cutover;
- Cable.3: MapCableRoute/presentation cutover + Cable metadata foundation;
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
5. Cable.1 не содержит полноценного projection/UI/map redesign; follow-up
   boundaries Cable.2 и Cable.3 зафиксированы ниже.
6. MapCableRoute и будущий Cable Bundle не используются как доказательство
   canonical connectivity.
7. Targeted backend tests и Docker verification проходят; applied migrations не
   переписаны.

## Follow-up boundaries

- **Cable.2 — projections + Object Details/connect/disconnect/current L1 UX
  cutover.** Переводит projection DTO, Object Details и текущие L1 workflows на
  canonical Cable-backed Connection model.
- **Cable.3 — MapCableRoute/presentation cutover + Cable metadata foundation.**
  Переводит route/presentation contracts и закладывает описательные Cable
  metadata прежде всего для label/category/capacity class. Cable не становится
  physical inventory; material characteristics и inventory lifecycle не входят
  в scope. Cable Bundle остаётся отдельным последующим presentation work.

## Implementation notes

Сначала провести targeted impact analysis по canonical connection mutation,
physical-link/wiring APIs, cable catalog/details, map route persistence,
projection/resolver и Blueprint materialization. Затем выполнить один forward
migration либо документированный destructive reset, после чего удалить
obsolete code/tests/fixtures, а не добавлять compatibility layer. Перед
acceptance проверить `git diff`, `gitnexus detect_changes` и полный docs/code
поиск старых cable contract phrases.
