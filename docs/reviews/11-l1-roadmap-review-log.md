# L1 Roadmap Review Log

Временный последовательный журнал текущего docs-only review перед
пересборкой roadmap NetMap до L2.

Окончательный порядок implementation items по milestone здесь не фиксируется.

## RVR-001 — Exact-evidence подсветка L1 trace branch

- Краткое описание: при L1 trace, если между одной парой `PhysicalObject`
  существуют несколько отдельных `Cable`, выбранная trace branch может
  визуально подсвечивать лишние parallel Cable.
- Тип: bug / correctness regression.
- Severity: HIGH.
- Влияние на L1 completion: прямое нарушение корректности trace presentation;
  L1 completion блокируется до устранения.
- Blocker до L2: да.
- Behavior-preserving: да.
- Benchmark: нет.
- Зависимости: нет.
- Подтвержденная фактическая причина: Cable presentation может опираться на
  общий supporting projection edge, а trace highlighting использует этот общий
  edge как достаточное условие. Поэтому exact branch через один Cable
  расширяется на соседние Cable между той же парой объектов.
- Согласованное решение: визуальная подсветка выбранной L1 trace branch
  следует exact canonical evidence. Общий projection/presentation edge между
  `PhysicalObject` недостаточен для доказательства конкретного Cable. Для
  Cable-backed связи подсвечивается только exact Cable / `ConnectionMember`,
  доказанный выбранной branch; parallel Cable не подсвечиваются только из-за
  общего projection edge. То же правило exact evidence применяется к direct
  `ConnectionMember` и internal passive continuity. Presentation collapse
  никогда не расширяет canonical trace result.
- Acceptance: при нескольких Cable между одной парой `PhysicalObject`, если
  selected trace branch использует один Cable, highlighted остаются только
  exact evidenced Cable/`ConnectionMember`; остальные parallel Cable не
  highlighted.
- Статус: RECORDED.

## RVR-002 — Broken Cable catalog link

- Краткое описание: во вкладке «Кабели» имя Cable отображается как clickable
  link; клик ведет в PhysicalObject Details и завершается ошибкой
  `PhysicalObject does not exist`.
- Тип: bug / regression после Cable-as-PhysicalObject cutover; UX/correctness
  navigation.
- Severity: MEDIUM.
- Влияние на L1 completion: Cable catalog содержит неверную навигацию и
  вводит в заблуждение о domain identity; L1 completion блокируется.
- Blocker до L2: да.
- Behavior-preserving: да.
- Зависимости: нет.
- Подтвержденная фактическая причина: для Cable используется
  `item.cable_ref.entity_id`, имя оборачивается в `Link to={objectLink(id)}`,
  `objectLink()` ведет на `/infrastructure/objects/:id`, а этот route
  обслуживается `InfrastructureObjectDetailPage`. По действующему domain
  contract Cable не является `PhysicalObject`.
- Согласованное решение: Cable никогда не маршрутизируется через PhysicalObject
  Details. Пока отдельной Cable Details surface нет, Cable label в catalog —
  обычный текст без ссылки. Ссылки на PhysicalObject на концах Cable остаются.
  Отдельная Cable Details page сейчас не создается; при возможном появлении
  она должна иметь собственный Cable-specific route/lifecycle.
- Acceptance: в Cable row click-target на самом Cable label отсутствует;
  endpoint PhysicalObject links остаются рабочими; Cable identity не
  передается в `/infrastructure/objects/:id`.
- Статус: RECORDED.

## RVR-003 — User-editable Cable label

- Краткое описание: Cable отображается техническим именем вроде
  `Cable 3b710bd8`, и пользователь не может задать или изменить нормальное
  имя.
- Тип: UX gap / existing planned Cable.3 capability.
- Severity: MEDIUM.
- Влияние на L1 completion: обязательная usability-часть Cable.3 не завершена;
  L1 completion блокируется как часть Cable.3 product usability.
- Blocker до L2: да.
- Behavior-preserving: да.
- Benchmark: нет.
- Зависимости: Cable.3 metadata foundation.
- Подтвержденный контекст: действующий Cable.3 contract уже планирует optional
  `label`; catalog DTO допускает `label_source = TECHNICAL_FALLBACK`.
- Согласованное решение: Cable получает optional mutable user-facing label.
  Отсутствие label допустимо; тогда UI использует deterministic technical
  fallback, например существующий `Cable <short-id>`, который не становится
  canonical user label автоматически. Пользователь может задать, изменить и
  очистить label. Это не меняет Cable identity, linked Connection, endpoints,
  `MapCableRoute` references, trace semantics или topology. Write boundary
  должна быть Cable-specific и не переиспользовать PhysicalObject rename API.
  Основной Cable catalog предоставляет понятное rename/edit action. До
  отдельно согласованной Cable Details surface label остается plain text.
- Acceptance: (1) Cable без user label показывает technical fallback; (2)
  rename после authoritative refresh показывает user label; (3) clear label
  возвращает technical fallback; (4) Cable UUID, Connection, endpoints и
  routes не меняются; (5) PhysicalObject write boundary не используется.
- Статус: RECORDED.
