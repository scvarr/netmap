# G1-VERIFY-01 — адресная инженерная верификация L1

- Дата проверки — 27 ноября 2026 года.
- Ветка `test/g1-verify-01`, проверенный SHA и база `0ad2907b448afc0291e153fe12abb5c79d6e07f3`.
- **IMPLEMENTED** — аудит выполнен. **G1 OPEN** — внешняя инспекция и решение о приёмке остаются за принимающей стороной.

Границы проверки взяты из [BACKLOG](../BACKLOG.md#g1--l1-connectivity-complete), [PROJECT_STATE](../PROJECT_STATE.md#статус-готовности-l1), [L1_CONNECTIVITY](../L1_CONNECTIVITY.md#обязательные-проверочные-сценарии), [OPEN_DECISIONS](../OPEN_DECISIONS.md) и [ARCHITECTURE](../ARCHITECTURE.md#транзакции-и-согласование-записей). Канонические записи и представление Saved Map проверялись по соответствующим контрактам.

## Docker preflight и остановка

Выполнены `docker compose ls --all` и `docker ps -a --filter label=com.docker.compose.project` с выводом меток. Предыдущие тестовые проекты `netmap-ccap-*`/`netmap-ccap*`, `netmap-l1-*`, `netmap-mod*` уже имели статус `exited`. Работающих временных стеков для остановки не было. Основной проект `netmap` работал в трёх контейнерах. Все серверные тесты использовали один проект `netmap-g1-verify-01` на `compose.test.yaml` с отдельной PostgreSQL в tmpfs, без опубликованных портов. `docker compose -p netmap-g1-verify-01 -f compose.test.yaml exec -T test-backend alembic current` показал `l1_optical_01a (head)`.

После прогона выполнен `docker compose -p netmap-g1-verify-01 -f compose.test.yaml stop`, повторены `docker compose ls --all` и проверка project labels. Оба контейнера проверки завершились с кодом 0 (`exited(2)`), одноразовый runner удалён флагом `--rm`. У `netmap` продолжили работать те же три контейнера (`92ad39488903`, `4aa91c9b4222`, `3ba952234204`). Действий над основным проектом, его данными, контейнерами, сетями и томами не было. Prune не применялся.

## Серверный прогон

```powershell
docker compose -p netmap-g1-verify-01 -f compose.test.yaml run --build --rm test-runner pytest -v `
  tests/test_exact_l1_group.py `
  tests/test_physical_compatibility_e2e.py `
  tests/test_cable_reconnect_e2e.py `
  tests/test_cable_lines_e2e.py `
  tests/test_port_types.py `
  tests/test_module_port_types.py `
  tests/test_object_reconciliation.py `
  tests/test_module_reconciliation.py `
  tests/test_passive_module_continuity.py `
  tests/test_optical_fiber_types.py `
  tests/test_optical_diagnostics.py::test_reconnect_and_transceiver_replacement_preview_are_advisory
```

Pytest 8.4.1, Python 3.13.7, PostgreSQL 17.6. Собрано 111 случаев, **108 PASS, 3 FAIL**, 31,02 с, код выхода 1.

| Файл в `tests/` | PASS | FAIL |
| --- | ---: | ---: |
| `test_exact_l1_group.py` | 14 | 0 |
| `test_physical_compatibility_e2e.py` | 16 | 0 |
| `test_cable_reconnect_e2e.py` | 15 | 0 |
| `test_cable_lines_e2e.py` | 0 | 1 |
| `test_port_types.py` | 14 | 0 |
| `test_module_port_types.py` | 7 | 2 |
| `test_object_reconciliation.py` | 4 | 0 |
| `test_module_reconciliation.py` | 15 | 0 |
| `test_passive_module_continuity.py` | 19 | 0 |
| `test_optical_fiber_types.py` | 3 | 0 |
| `test_optical_diagnostics.py` (только `test_reconnect_and_transceiver_replacement_preview_are_advisory`) | 1 | 0 |

### Матрица инженерных условий G1

| Условие | Выполненное свидетельство и граница |
| --- | --- |
| Медная связность | `test_copper_cable_reconnect_preserves_line_evidence_at_the_new_address` подтвердил RJ45 `REACHABLE`, после переноса старый адрес `UNKNOWN`, новый `REACHABLE`, UUID Cable/Connection/ConnectionMember в evidence сохранены. |
| Оптическая связность | `test_duplex_members_on_shared_interface` прошёл для прямой и обратной перестановок двух каналов на общем NetworkInterface. Перекрёстная ожидаемая пара отклонена, общей проводимости между members одного окончания нет. Типизированная установка SM/MM и физическая коммутация прошли в advisory-тесте. В `test_independent_fibers_keep_ids_and_history_after_reconnect_and_import` подтверждены две исходные отдельные канонические линии, оставшаяся часть теста заблокирована устаревшим ожиданием. |
| Активная граница и разрыв | `test_preserves_prefix_at_active_end_or_corrupt_continuity` подтвердил `UNKNOWN` с сохранённым доказанным префиксом на активной границе `OTHER_ENDING`. `test_break_then_disconnect_and_reconnect_refreshes_evidence` подтвердил `MISSING_INTERNAL_CONTINUITY`, `MISSING_EXTERNAL_CONNECTION`, восстановление пути и обновление evidence после удаления и нового создания Cable. |
| Rear-24, subset, permutation, резерв и reload | `test_rear_24_subset_permutation_and_resolved_evidence_after_reload` сверил повторные trace-ответы и разрешил точные refs ConnectionPoint, Connection, ConnectionMember и Cable в новой сессии БД. `test_rear_24_materializes_permuted_mappings_to_separate_front_points` подтвердил материализацию 3/24/12 на отдельные front points, две независимые внешние линии, COMPLETE для ожидаемых пар и subset, UNCONFIRMED для неверных пар и немаппированного member. Полнота оценивается по заданным парам. |
| ALLOW, DENY, UNKNOWN | `test_pair_compatibility`, `test_matrix_is_symmetric_and_preview_tracks_rules_not_names` и `test_multichannel_bulk_denial_dominates_unknown_and_allow` подтвердили три вердикта, симметрию, отказ при несовместимости и приоритет DENY для смешанного bulk с неизменным snapshot. |
| Защита структурных определений и модульные справочники | `test_connected_retained_endpoint_type_is_immutable` и `test_structural_edit_waits_for_concurrent_template_assignment` подтвердили защиту используемой структуры. `test_review_enforces_immutable_wiring_without_installations` проверил опубликованную разводку. `test_catalog_rename_archive_installation_and_workspace_roundtrip`, `test_archived_type_in_frozen_candidate_is_protected` и `test_pcie_card_definition_with_sfp_ports_publishes_and_roundtrips` подтвердили разделение вида и UUID, запрет неподходящих назначений, сохранение ссылок и roundtrip. |
| Занятый member | `test_member_reconnect_preserves_addresses_and_requires_exact_preview` проверил 409 `CABLE_RECONNECT_OCCUPIED` и сохранение прежней записи, а `test_member_wiring_preview_exact_pair_projection_and_disconnect` подтвердил независимую занятость каналов и сохранение внутренней continuity при отключении. |
| Конкурентные записи | `test_members_serialize_competing_writes_with_independent_remaining_capacity` подтвердил одного победителя на одном member и доступность соседнего. `test_reconnect_and_create_serialize_on_new_member`, `test_reconnect_conflicts_with_uncommitted_disconnect_without_losing_cable` и `test_concurrent_writers_blocked_after_preflight` проверили конкурирующее создание, reconnect, disconnect и вмешательство при reconcile. |
| Устаревшие preview | `test_bulk_is_atomic_and_requires_a_fresh_operation_confirmation`, `test_multichannel_bulk_confirmation_binds_addresses_order_subset_and_naming`, `test_reconnect_checks_the_matching_end_and_rechecks_changed_data_under_locks` и `test_simultaneous_reconnect_rejects_competitor_then_stale_preview` подтвердили повторную проверку состояния, адресов, порядка, состава и параметров операции, а также отказ конкуренту/устаревшему запросу. |
| Атомарность и состояние при отказе | `test_bulk_conflict_with_concurrent_single_create_leaves_other_pair_free` сохранил свободную пару при bulk-конфликте. `test_failed_transaction_rolls_back_endpoint_update`, `test_refusal_is_atomic`, `test_partial_success_rollback_mixed_archive` и `test_invalid_definition_is_atomic` покрыли откат изменения окончания, reconcile и определения пассивной разводки. |
| Identity при допустимом reconcile | `test_identity_additions_alias_and_idempotency_with_revision_skips`, `test_skipped_revisions_identity_add_remove_and_retry`, `test_layout_reconcile_and_workspace_preserve_canonical_continuity` и `test_optical_revision_updates_only_selected_connected_instances` подтвердили сохранение identity удерживаемых сущностей и связей, в том числе канонической разводки и подключённых линий, при допустимой смене ревизии. |
| Сохранность данных CAT-D-05 | Оба параметра `test_forward_migration_preserves_installation_and_seed` дошли до строки 294 после успешного `catd05_split_mount_types` и сравнения снимков, UUID, seed, ссылок и JSON, а также проверки сохранности после `mod02a_nested_installations`. Вариант с применённой первой ревизией проверил явную классификацию и сохранение UUID архивного пользовательского и переименованного seed-типа. Отдельные параметры проверок отката при конфликте имён и неизвестной классификации прошли. Итог обоих случаев с данными — FAIL на последующей границе `head`. |
| Advisory-диагностика reconnect | `test_reconnect_and_transceiver_replacement_preview_are_advisory` подтвердил механический ALLOW с фактами SM/SM/MM, отсутствие записи при preview и 204 на reconnect. При замене трансивера проверены CONFLICT вместе с ALLOW, 200 на запись и сохранение `fiber_type=SM` у прежнего Cable. |

### Классификация серверных отклонений

- `test_independent_fibers_keep_ids_and_history_after_reconnect_and_import` — устаревшее ожидание на строке 47. Точное равенство набора ключей Cable исключает `fiber_type`, которое экспортирует `app/workspace_portability.py:46` по [контракту L1-OPTICAL-01A](../L1_CONNECTIVITY.md#l1-optical-01a--характеристики-волокон). Проверки истории маркировок после reconnect и импорта в этом сценарии не достигнуты.
- `test_forward_migration_preserves_installation_and_seed[False]` и `[True]` — устаревшая конечная граница теста на строке 294. `upgrade()` ведёт на текущий head, а `alembic/versions/catd_simplify_01.py:30` останавливает апгрейд fixture с существующим Cable. Это соответствует [контракту запуска CAT-D-SIMPLIFY-01 на чистой БД](../L1_CONNECTIVITY.md#чистая-тестовая-бд-для-cat-d-simplify-01). Сравнения данных для CAT-D-05 уже пройдены. Последующие в этом тесте проверки TX-LIB downgrade/re-upgrade не выполнены.

## FN-058 — целевой прогон клиента

Из `frontend`, с установленными зависимостями проекта, Node 24.19.0, Vitest 4.1.10, jsdom 30.0.1 и React 19.2.8. Запущены восемь заданных случаев, остальные 19 из двух файлов отфильтрованы. **0 PASS, 8 FAIL**, код выхода 1.

```powershell
$pattern = @(
  'allows a continuation write retry after an add failure'
  'does not repeat a successful remove when its authoritative refresh fails'
  'does not repeat a successful continuation add when its authoritative refresh fails'
  'does not repeat a successful equipment delete when its authoritative refresh fails'
  'does not repeat a successful cable delete when its authoritative refresh fails'
  'applies size to every placement with the same Blueprint identity, not only the same immutable version'
  'reloads authoritative Saved Map after a bulk size write fails without repeating acknowledged writes'
  'is collapsed by default and expands into the bottom-docked panel'
) -join '|'
npm test -- src/pages/MapPage.mutationLifecycle.test.tsx `
  src/components/TraceCommandBar.test.tsx -t $pattern --reporter=verbose
```

В таблице `ML` означает `frontend/src/pages/MapPage.mutationLifecycle.test.tsx`, `TC` — `frontend/src/components/TraceCommandBar.test.tsx`.

| Тест | Результат и первопричина |
| --- | --- |
| `allows a continuation write retry after an add failure` (ML:24) | **FAIL**, 0 вызовов `addPlacement`. Устаревшая fixture `remoteBlueprintPresentation` (ML:11): в слоте есть `rendered_position`, отсутствует `panel_local_position`. `minimumBlueprintDisplayWidth` (`frontend/src/topology/blueprintDisplaySize.ts:51`) читает `panel_local_position.x` в preflight, до записи (`MapPage.tsx:1027,1346`). Общий alert QuickInspector появляется и при отказе геометрии. Тест повторил отказ preflight, retry после ошибки записи остался непроверенным. |
| `does not repeat a successful remove when its authoritative refresh fails` (ML:39) | **FAIL**, после клика «Повторить обновление» ожидается удалённый из текущего UI текст «Карта „A“ пока пуста». Устаревшее ожидание. Пустой состав даёт пустую физическую сцену (`MapPage.tsx:626`), UI первого запуска относится к отсутствию карт (`:1988`). До клика mock удаления placement вызван один раз. Итоговый счётчик не достигнут. |
| `does not repeat a successful continuation add when its authoritative refresh fails` (ML:40) | **FAIL**, отсутствует сообщение об успешной записи со сбоем обновления. Та же устаревшая геометрическая fixture, отказ происходит до `addPlacement` и до authoritative refresh. Отключение кнопки и отсутствие повтора после успешной записи остаются непроверенными. |
| `does not repeat a successful equipment delete when its authoritative refresh fails` (ML:41) | **FAIL**, устаревшее ожидание текста пустой карты после retry. До retry тест подтвердил один вызов канонического delete и сообщение о сбое чтения. Итоговый счётчик не достигнут. |
| `does not repeat a successful cable delete when its authoritative refresh fails` (ML:42) | **FAIL**, устаревшее ожидание текста пустой карты. До retry mock канонического delete вызван один раз. Итоговый счётчик не достигнут. Дополнительный дефект fixture: ответ retry очищает placements, хотя удаление Cable может оставить оборудование на карте. Такой ответ скрывает описанный ниже дефект обновления проекции при прежнем составе. |
| `applies size to every placement with the same Blueprint identity, not only the same immutable version` (ML:61) | **FAIL**, `spinbutton` «Ширина» отсутствует на этом шаге. Устаревший сценарий UI. Поле теперь в отдельном диалоге после команды размера, групповое действие находится в контекстном меню (`MapPage.tsx:1939,1964`, `MapContextMenu.tsx:32`). Выбор placements по Blueprint identity не достигнут. |
| `reloads authoritative Saved Map after a bulk size write fails without repeating acknowledged writes` (ML:82) | **FAIL**, тест ищет `button` «Применить к тому же шаблону». Текущий элемент — `menuitem` с многоточием (`MapContextMenu.tsx:32`). Устаревший селектор. Частичная запись, перечитывание и отсутствие повторной записи не достигнуты. |
| `is collapsed by default and expands into the bottom-docked panel` (TC:16) | **FAIL**, устаревшая русская aria-метка `L1 трассировка PhysicalObject`. После раскрытия DOM содержит `<section aria-label="Трассировка сети L1" class="trace-command trace-command--docked">` и кнопку «Свернуть» с `aria-expanded=true` (`TraceCommandBar.tsx:101`, `frontend/src/i18n.tsx`, ключ `trace.label`). Исходное свёрнутое состояние и переход к открытому наблюдались. Геометрия dock вне возможностей jsdom. |

### Повторные записи и подтверждённый дефект обновления

В трёх достигнутых сценариях remove/equipment delete/cable delete до нажатия retry мок записи вызван один раз. После клика тесты останавливаются на устаревшем тексте, поэтому динамического доказательства финального числа вызовов нет. По текущему коду `retryMapRefresh` (`MapPage.tsx:1379`) вызывает только `reloadMap`, который читает Saved Map (`:485`). Повторный вызов канонической записи этим обработчиком не обнаружен. В continuation add тесты не достигли записи. Bulk size относится к представлению. Его последовательный цикл записи и чтение при отказе (`:1236`) проверены чтением исходника. Отдельное повторное действие пользователя после частичной записи данным прогоном не доказано.

В `frontend/src/pages/MapPage.tsx` обнаружен независимый дефект согласования представления после успешного канонического удаления. В `deleteCable` (`:1604`) увеличение `canonicalDeleteRevision` происходит только после успешного первого `reloadMap`. При его отказе `retryMapRefresh` (`:1379`) перечитывает Saved Map и закрывает операцию без увеличения этой ревизии. Эффект получения проекции (`:619`) зависит от неё и ключей сцены и состава карты. При неизменных ключах после удаления Cable успешный retry не инициирует получение новой проекции. Это подтверждено трассировкой кода. Динамический сценарий с неизменным составом после сбоя в предоставленном тесте отсутствует. Риск относится к показу уже удалённой линии, а каноническое удаление остаётся подтверждённым. Отдельного нарушения серверного контракта G1 текущий прогон не обнаружил.

## Пробелы и границы corrective

- G1. Уточнить в существующем `test_cable_lines_e2e.py` контракт Workspace v17 с `fiber_type` и довести до выполнения проверки двух независимых линий, истории маркировки и импорта. В миграционном тесте ограничить путь с историческими Cable целевой ревизией CAT-D-05/MOD-02A, а актуальный head и TX-LIB lifecycle проверять в подходящем существующем сценарии. Защиту чистой БД и опубликованные ревизии сохранить.
- FN-058. Актуализировать fixtures и действия по реальному UI в существующих тестах. Проверять отдельно сбой записи и сбой чтения после успешной записи. Для add, remove, equipment delete и Cable delete проверять актуальный результат чтения и итоговый счётчик вызовов записи. Для Cable сохранить placements на retry и проверить уход удалённой линии из проекции. Исправление ограничить восстановлением проекции после подтверждённого delete без повтора DELETE. Для размеров проверить охват ревизий одной Blueprint identity, чтение после частичного сбоя и число записей в рамках одного действия.
- Внешняя инспекция CAT-D-SIMPLIFY-01/CAT-D-05 и окончательное решение по G1 остаются открытыми. Для будущих записей, затрагивающих владение и canonical scope, область чтения/записи, удерживаемые UUID и отказ при конфликте требуют согласования в рамках соответствующего контракта. Прогон подтверждает перечисленные сценарии, включая чистый head и исторический переход в проверенных точках.

## Ограничения и проверка изменений

Использованы существующие тесты и fixtures. Application code, тесты, миграции и тестовая инфраструктура не изменялись. Полные наборы, браузерная автоматизация, production build и повтор принятой ручной приёмки не выполнялись. Тесты проекции клиента использовали моки и jsdom. Rear-24 reload проверял повторные запросы и новую сессию БД. Рестарт приложения или PostgreSQL отдельно не проверялся.

Для диагностики обновлён локальный индекс GitNexus командой `node .gitnexus/run.cjs analyze`. `context` на проверенном SHA подтвердил `retryMapRefresh → reloadMap`. Полнота графа процессов ограничена бюджетом обхода, часть ссылок имеет непроверенное происхождение. Выводы сверены с реализацией `MapPage.tsx` и фактическими результатами Vitest. `detect_changes` для документационного diff не требуется.
