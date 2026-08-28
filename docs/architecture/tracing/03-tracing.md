# 03. Трассировка

## Назначение

Эта ветка описывает поведение resolver/trace engine поверх canonical и observed facts NetMap.

Предметная модель отвечает на вопрос **какие факты существуют**, а трассировка — **как из этих фактов вычисляется путь, достижимость, причина остановки и степень определённости результата**.

## Ветки

- 03.1 L1 Trace — существует bounded public interface-physical trace boundary:

  ```text
  POST /v1/traces/interfaces/physical
      InterfacePhysicalTraceQuery
          from_interface_id
          to_interface_id
      -> InterfacePhysicalTraceArtifact
  ```

  Контракт принимает именно canonical `NetworkInterface` IDs. Результат имеет
  только verdict `REACHABLE` или `UNKNOWN`: `REACHABLE` доказывает физический
  L1 путь, а `UNKNOWN` означает, что он не доказан и не является `UNREACHABLE`.
  Public artifact может содержать factual `branches`, public L1 gap codes
  (`INTERFACE_PHYSICAL_BINDING_UNKNOWN`,
  `INTERFACE_PHYSICAL_REALIZATION_UNKNOWN`, `L1_TOPOLOGY_INCOMPLETE`) и warnings.
  Он не сохраняет достаточную partial frontier, чтобы UI мог делать выводы о
  блокировке на портах или необходимости перехода к L2.
- 03.1 L1 Trace также предоставляет object-level public boundary:

  ```text
  POST /v1/traces/physical-objects/l1
      PhysicalObjectL1TraceQuery
          from_physical_object_id
          to_physical_object_id
          from_connection_point_id?
          to_connection_point_id?
      -> PhysicalObjectL1TraceArtifact
  ```

  Он разворачивает каждый PhysicalObject в принадлежащие ему canonical
  ConnectionPoint/PointMember candidates и применяет те же L1 traversal facts.
  Все доказанные endpoint branches сохраняются отдельно; отсутствие доказанной
  branch возвращает `UNKNOWN`. Exact point обязан принадлежать указанному object.
  Physical cycle не скрывается: artifact возвращает отдельный `cycles` witness с
  canonical Connection/ConnectionMember evidence. NetworkInterface не требуется.
- [[architecture/tracing/03-02-l2-trace|03.2 L2 Trace]]
- [[architecture/tracing/03-03-l3-trace|03.3 L3 Trace]]
- [[architecture/tracing/03-04-packet-flow-trace|03.4 Packet Flow Trace]]

## Общие принципы

- Trace result является производным результатом и не становится независимым source of truth.
- Алгоритм не должен угадывать отсутствующие факты.
- `UNKNOWN` принципиально отличается от `UNREACHABLE`.
- Каждая существенная transition должна быть объяснима исходными facts/rules и их provenance.
- Визуальное схлопывание участков пути не меняет canonical trace result.
- Реализация поиска может оптимизироваться независимо от семантики трассировки.
