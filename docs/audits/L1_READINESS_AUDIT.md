# L1-AUDIT-01 — независимый аудит эксплуатационной готовности

## Executive summary

**Фактическая готовность соответствует уровню ограниченного однопользовательского пилота для обычной L1-коммутации 1:1. Продуктивная готовность по действующему контракту не подтверждена.** На чистом стенде через UI удалось воспроизвести повседневный цикл от шаблона до трассировки, включая патч-панель, установку NIC, несколько кабелей, две компоновки и восстановление workspace. Trace различил явную пассивную связь, отсутствие внутреннего соответствия и отсутствие транзита через активное оборудование. Идентификаторы и результаты трассировки совпали после повторного открытия и восстановления.

Главный подтверждённый дефект — [GitHub #2](https://github.com/scvarr/netmap/issues/2). При полном сворачивании родителя в uniform grid оборудование из скрытой ветви осталось на карте, а UI сообщил о четырёх подключениях без маршрута. В проверенной ручной компоновке скрытие сработало. Второй практический риск — обычное подключение после конфликта показывает устаревшие свободные окончания и предлагает бесполезный повтор. Сервер сохранил единственное успешное подключение.

По текущим gates для L1 по-прежнему обязательны truthful multichannel, representative acceptance, workspace productization и стабилизация. Они ограничивают итоговую готовность независимо от успешного 1:1 сценария. Зафиксированные ниже оценки severity и обязательности предложены для external review. Статусы Phase A–I взяты из [BACKLOG](../BACKLOG.md), а официальная приёмка находится вне этого аудита.

## Срез, стенд и метод

- Проверено 19.11.2026. Исходный checkout `audit/l1-readiness-01` был чистым. HEAD, локальный `main`, `origin/main` и ответ `git ls-remote origin refs/heads/main` совпадали на `7c75401430bf70f44111bab8cb4f79fd0434f544`. На старте удалённой audit-ветки не было.
- Источники состояния и критериев — [AGENTS.md](../../AGENTS.md), [PROJECT_STATE](../PROJECT_STATE.md), [BACKLOG](../BACKLOG.md), [ARCHITECTURE](../ARCHITECTURE.md), [OPEN_DECISIONS](../OPEN_DECISIONS.md), [L1_CONNECTIVITY](../L1_CONNECTIVITY.md) и [L1_REFERENCE_NETWORK](../L1_REFERENCE_NETWORK.md). Существующая ручная приёмка кабельных milestones относится к указанным в PROJECT_STATE сценариям.
- Docker Engine 28.4.0, Compose v2.39.4-desktop.1. Проект `netmap-l1-readiness-01` собран из checkout через `compose.yaml` и временный override. Frontend доступен на `127.0.0.1:5191`, backend внутри compose-сети, PostgreSQL 17.6 на отдельном томе `netmap-l1-readiness-01_l1_audit_pg`, database `audit`. Alembic применён при старте, сервисы healthy. Пользовательский проект `netmap` и его том исключены из всех процедур.
- Playwright 1.58.2, Chromium 145.0.7632.6, русский интерфейс, 1440×1000 и выборочная проверка редактора на 1024×768. Вторая вкладка использована для конфликта. Записи synthetic inventory выполнялись через штатные формы и команды UI. JSON скачивался штатным экспортом, trace и mutation responses фиксировались как ответы на операции браузера. Отрицательный файл импорта получен из экспорта изменением только `format_version`.
- В stand test database `netmap_test` выполнены четыре адресных backend-файла, **32 passed**, включая 11 сценариев trace. Первый запуск HTTP trace-тестов дал 11 ложных падений, так как их default URL указывал на приложение с database `audit`, а фикстуры писали в `netmap_test`. Повтор с отдельным Uvicorn на loopback:8011 и общей `netmap_test` прошёл. См. [ограничители тестовой БД](../../tests/conftest.py) и [HTTP test setup](../../tests/test_physical_object_l1_trace_e2e.py).
- Адресный Vitest прогон `automaticLocationLayout.test.ts`, `TopologyCanvas.test.tsx`, `MapPage.contextMenu.test.tsx`, `CableReconnectDialog.test.tsx` дал **60 passed, 3 failed**. Все три падения в [MapPage.contextMenu.test.tsx](../../frontend/src/pages/MapPage.contextMenu.test.tsx) ожидают вызов mock записи ширины в сценариях copy, resize и same-template apply. В runtime подтверждена запись допустимой ширины via resize и обнаружено отдельное молчаливое ограничение минимума (L1A-07). Связь всех трёх падений с одной причиной пока **SUSPECTED**. Это существующий сигнал покрытия на чистом HEAD. Copy и same-template apply отдельно в браузере не подтверждены. Полные suites не запускались.
- Ограничения выборки — один Chromium, один инженерный сценарий, 48 портов на крупнейшем устройстве, без нагрузочного baseline, assistive technology, upgrade существующей пользовательской базы и полного набора reference network. Доказательства для всего домена выводить из этой выборки нельзя.

**Статусы.** CURRENT описывает поведение среза. IMPLEMENTED подтверждается реализацией доступного контракта. VERIFIED в документации означает состоявшуюся приёмку, PASS в таблице означает независимую проверку только указанного сценария. OPEN означает незавершённую реализацию или проверку, TARGET — согласованное направление будущего поведения, PRODUCT DECISION PENDING — требуется продуктовое решение. BLOCKED указывает на конкретную зависимость. CODE-OBSERVED фиксирует вывод из кода без подтверждения сценария в браузере.

## Синтетическая сеть и доказательства

`Audit HQ → Audit F02 → Audit MDF → Audit Rack` содержит PP-02. SW-02 размещён в соседней ветви `Audit Desk` того же этажа. SRV-01 с установленным двухпортовым Audit NIC находится в отдельном корне `Audit Peer`. SW-SPARE использован для инвентаря и reparent Location. Через UI созданы Audit Copper, три BaseTemplate, ModuleTemplate, две панели Front/Rear на PP-02 и модульное место SRV-01.

Основной путь проходит по цепи `SRV-01 NIC/1 — C-back — PP-02 Rear/2-1 ↔ Front/1-1 — C-front — SW-02 1-1`. Пара Rear/2-2 и Front/1-2 имела отдельный внешний Cable с каждой стороны и не имела внутренней связи. Для проверки active boundary временно подключён отдельный порт SW-02 к встроенному порту SRV-01. Карта Audit Network содержит три объекта, основной ручной вариант и Audit Grid. Audit Overlay служила второй картой для проверки shared identity и удаления SavedMap.

[Журнал браузера](l1-readiness-evidence/browser-results.json) содержит trace-артефакты, связывание внешних hops с Cable, выбранные ответы ошибок, результаты roundtrip и excerpts UI. [Скриншот trace](l1-readiness-evidence/03-trace.png) показывает пользовательский verdict. Номера в таблице далее используются для связи выводов с конкретными сценариями.

## Матрица покрытия

| ID | Сценарий | Результат | Наблюдение и граница |
| --- | --- | --- | --- |
| T01 | Чистый Docker boot, миграции, открытие Chromium | PASS | Изолированный PostgreSQL, браузер загрузил приложение. |
| T02 | PortType и его назначение | PASS | Audit Copper с HEX применён к активным и пассивным endpoints. Полный archive lifecycle вне выборки. |
| T03 | C-UX-01, дерево, глубина, reparent и reload | PASS | Четыре уровня исходно. Audit Spare перенесён под Audit Rack, выбор сохранился после reload. |
| T04 | P-UX-19, серия Location и конфликт | PASS | 01…03 созданы через preview. Пересечение 02…04 показало два существующих имени и блокировало создание, 04 отсутствовал после reload. Лист 03 удалён с подтверждением. |
| T05 | BaseTemplate, active/passive и панельное соответствие | PASS | 48 сетевых портов, две панели, четыре пассивных точки и одно явное соответствие. |
| T06 | ModuleTemplate, активные endpoints и установка | PASS | Два порта NIC появились в физической таблице и trace picker. Отдельно см. T25 для детального visual recheck. |
| T07 | C-UX-02/09, создание с nested Location и preview шаблона | PASS | Создание и поиск Rack работают. Picker показывает тип и счётчики, графический preview доступен в библиотеке. C-UX-09 остаётся OPEN (G03). |
| T08 | C-UX-12, массовое именование по расположению | PASS | В шаблоне из 48 портов применена маска GE-## в spatial order, GE-01 и GE-48 найдены после reload сохранённого draft. |
| T09 | C-UX-13, полезная площадь редактора и доступ к таблице | FAIL | Полотно отрисовывает 48 портов. Диалог операций перекрыт навигацией даже на 1440×1000. На 1024×768 основной редактор прокручивается вертикально без page-wide horizontal overflow. L1A-02. |
| T10 | C-UX-14, impact inspector | PASS | 48 строк изменений, сводка двух экземпляров и два потенциально безопасных обновления на снимке. Масштаб большой инсталляционной базы не проверен. |
| T11 | Обычный connect, панельный список физических подключений | PASS | Четыре named Cable, Front/Rear, отдельно external и internal. Панель переключается, подключённые endpoints отображаются. |
| T12 | Конфликт ordinary connect и восстановление | FAIL | Сервер сохранил победивший Cable, вторая вкладка получила 422, осталась на занятых окончаниях. Reload восстанавливает состояние. L1A-03. |
| T13 | Bulk create/delete с карты, preview, cancel и confirm | PASS | Отменён preview создания, затем создана и удалена одна выбранная пара. Mutation statuses 201 и 204. Массовое создание десятков Cable в Chromium вне выборки, таблица проверена на 48 source ports. |
| T14 | Cable rename и single-end reconnect | PASS | Rename C-front сохранил trace. Reconnect C-race-winner с 1-4 на 1-10 показал before/after, сохранил Cable, Connection, ConnectionMember IDs и фиксированный конец. Occupied endpoints отключены в естественно сортированном picker. |
| T15 | Reconnect и bulk write atomicity при race/rollback | PASS | Адресные тесты на PostgreSQL, включая конкурентный reconnect, rollback, stale preview и отклонение всей bulk create пачки. HTTP/browser race этого reconnect не проверялся. |
| T16 | Действия с подключённым модулем | FAIL | Удаление защищено 409, обе связи сохранены. Пользователь видит сырой английский текст ошибки. L1A-06. |
| T17 | L1 trace положительной цепи и два отрицательных контроля | PASS | REACHABLE с тремя hops. UNKNOWN для отсутствующего passive mapping и пути через активный SW-02. См. JSON. |
| T18 | SavedMap, варианты, reopen и неизменность trace | PASS | Созданы placements и копия варианта. После переключения ручного режима и uniform grid их состояния различались. Результат trace совпал с baseline после reload и смены варианта. |
| T19 | Полный collapse и expand в ручной компоновке | PASS | При пустом списке скрылись PP-02, SW-02 и дочерние рамки. Внешние участки остались видимыми со стороны SRV-01. Повторное раскрытие восстановило объекты. |
| T20 | Issue #2, полный collapse в uniform grid | FAIL | Дочерние рамки исчезли, устройства остались, предупреждение о четырёх подключениях. Повтор подтверждён после reload с сохранённым пустым списком. При непустом выборе ветвь F02 осталась видна. L1A-01. |
| T21 | Issue #1, меню object/port/Cable/background и инспектор | FAIL | Качественная проверка discoverability подтверждает перегрузку object menu, список команд зависит от цели. L1A-05. |
| T22 | Zoom и Fit View в физическом режиме | FAIL | Края рамок и управление родителем остались за viewport, ручной Zoom Out вернул их. L1A-04. |
| T23 | Изменение ширины объекта и повторное открытие | FAIL | Допустимые 620 записываются. Ввод 480 проходит и молча сохраняется как 533.333… для dense template. L1A-07. |
| T24 | Workspace v8 export/reset/import и ошибочный импорт | PASS | Отказ импорта в непустую БД, отмена reset сохраняет данные, недопустимая версия в пустой БД оставляет её пустой. После правильного импорта совпали все четыре раздела и trace. |
| T25 | P-UX-07/08/10/11 и F2b visual recheck | NOT TESTED | Есть выборочные наблюдения о RU, переходах, preview библиотеки, геометрии NIC и одном install row. Матрица keyboard/focus, loading/error states, pinned preview, плотная F2b composition и высокая installation table отдельно не пройдены. |
| T26 | P-UX-13/14/15, переходы трёх вкладок и reload | PASS | Overview → Physical → Interfaces → reload → Physical и возврат в Overview сохранили SRV-01. После загрузки видны интерфейсы, C-back, pinned preview и Audit Peer в соответствующих вкладках. |
| T27 | BT-COPY-01, публикация новой ревизии, reconcile | PASS | Копия повторила опубликованную ревизию, локальный draft восстановлен и отменён с подтверждением, сохранённая копия получила новый ID. Ревизия 2 не меняла два экземпляра до явного update. После обновления trace по GE-01 совпал с исходным по 1-1. Сложные конфликты версий вне выборки. |
| T28 | Внешний multichannel, FANOUT-1x24 и точный member UI trace | BLOCKED | C-CAP-01-02/03/04 OPEN. G01. |
| T29 | CableType, переносимые определения, независимые карты reference network | BLOCKED | Нужные возможности TARGET/OPEN, сквозной reference network недоступен. G01 и D01. |
| T30 | Auth, persisted workspace, ACL, sharing и activity | BLOCKED | Phase F не реализована как пользовательский цикл. G02. |
| T31 | PERF-002/003/004/005, PERF-007, FE-003, CORR-001 | NOT TESTED | Нет актуальных замеров на representative scale, проверки всех scene keys/ELK fallback и глубокой легальной пассивной цепи. |
| T32 | Дополнительная матрица collapse | NOT TESTED | Не проверены sequence layout и полный набор комбинаций partial collapse для скрытых/показываемых дочерних объектов. |
| T33 | Две карты с одним canonical объектом, cancel и delete карты | PASS | Два разных placements с одним PhysicalObject ID. После удаления Audit Overlay canonical export совпал. |

Итого **33 сценария — 20 PASS, 7 FAIL, 3 BLOCKED, 3 NOT TESTED**. PASS для части RECHECK PENDING ограничен этой выборкой и не меняет исходный статус. Падения адресных frontend-тестов описаны отдельно от браузерных findings.

## Подтверждённые findings

Шкала severity использует четыре уровня. S0 — потеря или повреждение данных либо недоступность продукта, S1 — существенная ошибка основного workflow, S2 — заметный сбой с обходом, S3 — локальная UX или эксплуатационная проблема. Обязательность для L1 независима от severity. **Всего 7 findings: S0 0, S1 1, S2 3, S3 3.**

### L1A-01 · Полный collapse в uniform grid оставляет дочернее оборудование

**S1 · BLOCKER CANDIDATE · дефект карты · CONFIRMED.** [GitHub #2](https://github.com/scvarr/netmap/issues/2).

1. На физической Audit Network разместить PP-02 в Rack и SW-02 в Desk внутри ветви HQ, кабели вывести к SRV-01 под другим корнем.
2. В Audit Grid выбрать «Равномерная таблица». Оставить список видимых прямых элементов HQ пустым. Свернуть HQ.
3. Ожидается компактный HQ, скрытые descendants и внешние маршруты до границы HQ. Фактически дочерние рамки исчезают, PP-02 и SW-02 остаются с портами, PP-02 выступает у соседней ветви, в UI «Подключений без маршрута: 4».

Доказательства включают [пустой выбор](l1-readiness-evidence/05-collapse-empty-settings.png), [grid до](l1-readiness-evidence/08-grid-expanded.png) и [после](l1-readiness-evidence/09-grid-collapsed.png). [Ручной до](l1-readiness-evidence/06-expanded.png) и [после](l1-readiness-evidence/07-collapsed.png) служат сравнением. В [uniformGridPresentation.ts](../../frontend/src/topology/uniformGridPresentation.ts#L71) `hidden` включает Location без grid frame. [deriveLocationPresentation](../../frontend/src/topology/locationFrames.ts#L61) фильтрует эти Location перед построением subtree/proxy, хотя placement всё ещё ссылается на исчезнувший frame, и оставляет fallback rectangle объекта. Это объясняет наблюдаемую утечку. Изменения canonical данных при collapse не обнаружены.

Инженер видит ложное расположение и теряет маршрут внешнего кабеля. Сохранить ancestor resolution для скрытых placements во всех стадиях presentation и использовать один результат при видимости и построении внешней границы. Для проверки исправления нужен Chromium regression с пустым набором, вложенностью, внешним Cable и сменой варианта. Устройства, порты и внутренние участки исчезают, внешние заканчиваются на допустимой точке, expand восстанавливает сцену, canonical IDs и trace совпадают.

### L1A-02 · Сайдбар перехватывает управление диалогом портов

**S2 · BLOCKER CANDIDATE · дефект редактора · CONFIRMED.**

1. В BaseTemplate с одной или двумя панелями добавить порты. Оставить левую панель развёрнутой на 1440×1000.
2. Открыть «Порты и внутренние связи», щёлкнуть checkbox в колонке A.
3. Ожидается выбор порта. Playwright видит доступный checkbox, но hit-test даёт «Основная навигация». Выбор удаётся после сворачивания панели.

Перекрытие видно на [скриншоте диалога с сайдбаром](l1-readiness-evidence/02-dialog-sidebar.png). Hit-test сохранён в `template.sidebarHit` [журнала](l1-readiness-evidence/browser-results.json). Первый проход авторинга passive mapping может остановиться без объяснения. Следует согласовать modal stacking, inert background и начальный focus с общим page chrome. Исправление проверяется при открытой навигации и на 1024×768/1440×1000 checkbox, выбор, прокрутка и confirm работают мышью и клавиатурой. Закрытие возвращает focus инициатору.

### L1A-03 · Ordinary connect после конфликта предлагает устаревший retry

**S2 · BLOCKER CANDIDATE · дефект восстановления после конфликта · CONFIRMED.**

1. В двух вкладках открыть SRV-01 / «Физика», начать подключение встроенного 1-1 к свободному SW-02 1-4.
2. Подтвердить из первой вкладки под именем C-race-winner, затем из второй под именем C-race-loser.
3. Ожидается конкретная причина, актуальное состояние и возможность выбрать новую свободную пару. Фактически POST отклоняется 422, вторая форма пишет «Не удалось создать физическое подключение», продолжает показывать «Свободен» и 1-4. Кнопка «Повторить» снова даёт 422. После reload виден C-race-winner, второго Cable нет.

Результат записан в `conflicts.ordinaryCableRace` и виден на скриншоте. [Журнал](l1-readiness-evidence/browser-results.json) · [устаревшая форма](l1-readiness-evidence/12-stale-cable-form.png). Инженер теряет время или продолжает работу по неверной занятости, серверная целостность в этом опыте сохранена. Следует различать retry транспортной ошибки и конфликт canonical occupancy, перечитывать оба окончания после конфликта. Исправление проходит проверку, если при работе из двух вкладок создаётся одна запись, а вторая форма сообщает причину и исключает занятую пару без ручного reload.

### L1A-04 · Fit View не охватывает вложенные Location в ручной карте

**S2 · NON-BLOCKER · дефект навигации карты · CONFIRMED.**

1. Открыть Audit Network в основном ручном варианте с четырьмя вложенными Location и размещёнными объектами.
2. Нажать нижнюю кнопку Fit View.
3. Ожидается охват видимой сцены с управляющими элементами Location. Верх Audit HQ остаётся за окном, кнопка «Свернуть Audit HQ» имеет y ≈ −204 px. Два шага Zoom Out возвращают управление.

Кадр и код подтверждают проблему. [Fit View](l1-readiness-evidence/04-fit-view.png) · [fitBounds и Controls](../../frontend/src/components/TopologyCanvas.tsx#L369). Команды родителя трудно обнаружить после открытия сложной карты. Следует использовать одинаковые bounds для первичного fit и явной кнопки, учесть Location frames и свободное место рядом с панелями. Исправление проверено, когда один Fit View делает видимыми заголовки и действия всех крайних подтверждённых frames, с тестом на viewport.

### L1A-05 · Частые кабельные действия затеряны в меню объекта

**S3 · NON-BLOCKER · UX · CONFIRMED.** [GitHub #1](https://github.com/scvarr/netmap/issues/1).

1. По очереди открыть контекстные меню SW-02, свободного порта, маршрута Cable и пустой области. Затем открыть «Быстрый инспектор» объекта обычным щелчком.
2. Для повседневной коммутации ожидается понятный вход по задаче и явное различие между изменением вида и изменением данных. Меню SW-02 содержит девять действий. «Массовое подключение» и «Массовое удаление кабелей» стоят в конце после размера, фиксации, снятия с карты и удаления объекта из NetMap. Быстрый инспектор предлагает переход в карточку и технические сведения. Порт и фон имеют по одной основной команде, Cable — три.

Команды видны на [скриншоте меню SW-02](l1-readiness-evidence/10-object-menu.png), excerpts `map` в [журнале](l1-readiness-evidence/browser-results.json), [MapContextMenu](../../frontend/src/components/MapContextMenu.tsx). Инженер дольше ищет ежедневную операцию. Соседство с удалением объекта увеличивает цену ошибки. Падения пользователя или ошибочная запись не наблюдались. Предлагается bounded UX contract по группировке команд и доступу из инспектора/инструмента. Исправление проверяется по тому, как инженер находит массовую перекоммутацию и отличает «убрать с карты» от удаления inventory в task-based проверке, существующие команды доступны.

### L1A-06 · Причина запрета демонтажа NIC показана сырым текстом

**S3 · NON-BLOCKER · обратная связь · CONFIRMED.**

1. На SRV-01 удалить установленный Audit NIC, когда подключены C-back и C-unused-rear. Принять native confirm.
2. Ожидается русский отказ с объяснением, какие окончания или кабели мешают. Сервер вернул 409, UI показал `Error: ModuleInstallation cannot be removed because its endpoints are in use` и «Повторить».

Наблюдение подтверждают [отказ](l1-readiness-evidence/11-module-uninstall-conflict.png), `conflicts.moduleRemoval` в [журнале](l1-readiness-evidence/browser-results.json). Защита данных работает, но оператору приходится сопоставлять детали с таблицей. Предлагается локализованное сообщение доменного конфликта и ссылка на используемые порты. После исправления сообщение в RU идентифицирует препятствия, состояние модуля и Cable остаётся прежним.

### L1A-07 · Диалог ширины молча ограничивает значение

**S3 · NON-BLOCKER · UX размера · CONFIRMED.**

1. На ручном варианте открыть «Изменить размер…» у SW-02 с 48 портами. Ввести 480 вместо 533.333… и применить.
2. Ожидается понятный минимальный размер до подтверждения или явное сообщение о корректировке. Диалог закрылся, PUT 200 сохранил 533.333…, после reload снова показано это же число. Контроль 620 сохранён как 620.

Результат записан в `map.resize` в [журнале](l1-readiness-evidence/browser-results.json), [persistBlueprintDisplayWidths](../../frontend/src/pages/MapPage.tsx#L1164), [ограничение по расстоянию между портами](../../frontend/src/topology/blueprintDisplaySize.ts#L51). Оператор не понимает, выполнилось ли действие. Следует сохранить геометрический предел и показать его в диалоге. После исправления ввод 480 даёт видимую причину или точное итоговое значение, допустимое 620 сохраняется и читается после reload.

## UX/UI и работа инженера

- **Путь через инвентарь.** Выбор Location через дерево и поиск пригоден для вложенных объектов. Шаблоны в библиотеке визуально раскрываются, но picker при создании объекта требует возвращаться в библиотеку для визуальной проверки. Для нескольких похожих панелей различие по счётчикам слабо. [Preview и editor на 48 портах](l1-readiness-evidence/01-template-48.png).
- **Топология и карта.** Объект, placement и кабель представлены разными действиями. Добавление со страницы объекта заканчивается вторым подтверждением на карте. Поиск карты ищет размещённое оборудование, а trace picker предлагал также SW-SPARE, отсутствующий на карте. Для эксплуатации важна видимая подсказка о scope поиска и trace, особенно при переходе от нескольких views к будущим независимым maps. Это наблюдение и продуктовый вопрос, `DECISION REQUIRED`, без отдельного дефекта корректности.
- **Порты и адресация глазами оператора.** Физическая таблица разделяет внутреннюю связь и внешний Cable. На одинаковых номерах названия панели и модульного места полезны. Карточка, каталог Cable, reconnect и trace используют разный сокращённый контекст. Например, trace показывает `Панель 1/1`, карточка — `Панель 1 / Место 1 / 1` для того же модульного порта. Выбор остался однозначным в этой сети. Повторяющиеся имена в нескольких установках отдельно не проверены.
- **Консистентность.** Каталог/Location/настройки используют знакомые заголовки, таблицы и состояния загрузки. Редакторы и карта имеют рабочие, но разные паттерны для подтверждения, zoom и панелей. Смешение браузерного confirm, app modal и inline popover особенно заметно при удалении модуля, удалении карты и wiring соответственно. Существующая лексика в основном понятна. «Разрешён» в каталоге Cable, `Fit View` и английский доменный отказ требуют контекста или перевода. При наличии внутренних и внешних связей полезно сохранить имеющееся разграничение.
- **Плотность и доступность.** Exact labels, названия контролов, search и natural order помогают обойти плотное полотно. В Change Inspector 48 изменений и сводка двух объектов были доступны, длинный список идёт в порядке ключей, поэтому сравнение GE-01…GE-48 визуально затруднено. На узком окне у редактора 1644 px содержимого по вертикали при 768 px высоты. Проверка доступности остаётся выборочной. [Инспектор](l1-readiness-evidence/14-template-inspector.png) · [узкий редактор](l1-readiness-evidence/15-template-narrow.png).

## Canonical L1 и архитектурные риски

| Инвариант | Оценка на срезе |
| --- | --- |
| Источник connectivity и геометрия | Trace строится по canonical adjacency, `Connection` и `ConnectionMember`, а collapse, variant и width меняют presentation. Результат тот же после смены варианта. Видимое отсутствие маршрута в L1A-01 относится к карте. [Resolver](../../app/physical_object_l1_resolver.py#L24) · [canonical refs](../../app/physical_object_l1_resolver.py#L140). |
| Stable identity | Пользовательские rename, reconnect и reopen сохранили проверенные IDs. В reconnect изменился `point_b_id`, member indices и id сохранились. Две SavedMap использовали один объект с разными placements. Удаление одной карты сохранило canonical rows. См. JSON. |
| Exact addressing/evidence | Positive trace имеет четыре point/member states, три hop и точные Connection/ConnectionMember refs. Первый и последний Connection сопоставляются с Cable по `Cable.connection_id` из экспорта. Direct Cable refs отсутствуют в этом object-trace payload. UI показывает verdict и подсветку, интегрированный человекочитаемый список hops с ID не был обнаружен в проверенной trace панели. Для полного member acceptance это отдельный критерий C-CAP-01-04. [Артефакт](l1-readiness-evidence/browser-results.json). |
| Partial damage | 409 при демонтаже, 422 в гонке connect и проверка серии сохранили текущее состояние. Названные backend-тесты подтверждают atomic bulk create, rollback reconnect и ограничения адресации. Более широкие crash/recovery, массовый stale delete через Chromium и частичное восстановление данных вне выборки. |
| Явная passive continuity, отсутствие active transit | Ручная связь Rear/2-1↔Front/1-1 необходима для успешного пути. Два внешних Cable ко второй паре не создают continuity. Отдельно получен UNKNOWN для пути, который потребовал бы перехода с одного сетевого порта SW-02 на другой. |
| Portability | Совпали строки `canonical`, `authoring`, `presentation`, `settings` при сравнении ключей и содержимого, включая вложенный порядок. Снимок содержал 4 объекта, 103 points, 99 интерфейсов, 6 Connections/6 members, 5 Cable, 3 placements и 2 variants. [Восстановление](l1-readiness-evidence/13-workspace-import.png). |

**Multichannel сегодня.** CURRENT write, bulk и reconnect требуют cardinality 1 и mapping 1→1. В core есть capacity, exact member address и независимые internal/external правила. C-CAP-01-01 IMPLEMENTED для BaseTemplate definitions и materialization: capacity пассивного входа, внутренние subset/permutation и stable keys. Обычный графический редактор блокирует редактирование и копирование multichannel definitions. ModuleTemplate internal pass-through и внешний multichannel lifecycle остаются OPEN. Object-level trace может перечислять участвующие members и ветви по ConnectionPoint. Это недостаточно для пользовательского выбора произвольного member, внешнего авторинга, изменения mapping и подтверждения roundtrip. [Ограничения write](../../app/physical_connections.py#L188) · [Reconnect](../../app/physical_connections.py#L351) · [L1-CONNECTIVITY](../L1_CONNECTIVITY.md#c-cap-01-01--definitions-и-materialization).

| ID / статус | Будущая область и последствия | Severity / обязательность |
| --- | --- | --- |
| R01 · CODE-OBSERVED / TARGET | **PortType cardinality > 1 для NETWORK_PORT.** Есть ограничения в DTO, check constraint и проверке portable definition. Одна interface identity может потребовать binding/realization нескольких members, при этом verdict отдельного fiber следует отличать от readiness всей duplex-линии. Потребуются одинаковые инварианты на materialization, reconcile, import, occupancy и evidence. Структурная правка справочника не должна менять capacity существующего point. [Schema](../../app/schemas.py#L879) · [models](../../app/models.py#L503) · [portability](../../app/workspace_portability.py#L424). | S1 потенциальный · DECISION REQUIRED |
| R02 · TARGET / PRODUCT DECISION PENDING | **ConnectorType и совместимость.** ConnectorType как элемент модели требует решения. CURRENT PortType задаёт имя/цвет, сравнение capacity само по себе не доказывает физическую совместимость. Нужно определить границы механической стыковки, среды и правила unknown vs incompatible, в том числе повторную серверную валидацию после preview. Риск симметричен: ложный запрет полезной модели или принятие соединения, которое нельзя смонтировать. [OPEN_DECISIONS](../OPEN_DECISIONS.md#porttype-и-физическая-совместимость). | S1 потенциальный · DECISION REQUIRED |
| R03 · TARGET / PRODUCT DECISION PENDING | **CableType.** Номинальная ёмкость сборки, подключённый subset, подключаемый интерфейс и внешняя геометрия различны. Нужны правила исторических Cable, перестановки, partial use, 2↔1+1 и границы одной Cable identity. Выбор влияет на occupancy locks, preview от двух устройств, delete/reconnect, evidence и portability. До согласования пересмотра L1-O5 действует принятый критерий одной Cable identity для trunk. [CableType](../L1_REFERENCE_NETWORK.md#cabletype) · [OPEN_DECISIONS](../OPEN_DECISIONS.md#cabletype-и-member-aware-модель). | S1 потенциальный · DECISION REQUIRED |
| R04 · CODE-OBSERVED / PRODUCT DECISION PENDING | **MODULE_PORT, сменные трансиверы.** Установка NIC доступна. Отдельный runtime contract с таким kind и обслуживанием сменного трансивера не выявлен. Инженеру важно различить постоянное логическое окончание шасси, заменяемый физический компонент и текущую реализацию интерфейса. Владение кабелем, совместимость, доступность при извлечении и следы в истории нужны до любых автоматических изменений. [ModuleInstallation](../../app/models.py#L670) · [NetworkInterfaceRealization](../../app/models.py#L717). | S1 потенциальный · DECISION REQUIRED |
| R05 · CODE-OBSERVED / PRODUCT DECISION PENDING | **NetworkInterface identity при замене.** Same-template reconcile может сохранять идентификаторы у удержанных endpoints. Добавление нового endpoint создаёт interface, поэтому uninstall/install нельзя считать заменой с сохранением identity. Контракт должен определить операцию в том же месте, условия сохранения binding и ссылки зависимых слоёв при другом модуле, отказ при неоднозначности и границы аудита. [Module reconcile](../../app/module_reconciliation.py#L75). | S1 потенциальный · DECISION REQUIRED |
| R06 · CURRENT и TARGET | **Структурирование справочников.** PortType уже каталог. Классы оборудования и Location.type строковые. «Шаблоны имён кабелей» находятся в инфраструктуре. Для пользовательских классификаций определить жизненный цикл ссылок и структурных полей, политику совпадения существующих значений, влияние на filters/экспорт и scope в workspace. Производитель/модель и перенос меню полезны для инвентаря, их минимальная обязательность не установлена. [Справочники](../OPEN_DECISIONS.md#справочники-и-техническая-совместимость). | S2 потенциальный · DECISION REQUIRED |

## Product readiness и Phase C–I

| Phase / состояние источника | Независимая оценка | Недостающий критерий |
| --- | --- | --- |
| C · OPEN | Ручной 1:1 путь состоялся, но найдены дефекты в collapse, авторинге и обработке конфликтов. Некоторые RECHECK проверены частично. | Закрыть согласованные corrective findings, пройти повторно сохранённый и чистый representative workflow. |
| D · OPEN | C-CAP-01-01 foundation доступен в core. Обычный 1:1 и внутренний mapping одной пары подтверждены. | G01, согласование CAT-D и повторная полноценная инженерная приёмка truthful multichannel. |
| E · OPEN | Повторяющиеся элементы page chrome и typed i18n существуют. Паттерны управления фокусом, confirm, errors, selector/inspector расходятся. | После C/D принять общие archetypes, паттерны справочников и план bounded adoption. |
| F · BLOCKED | Набор данных v8 принадлежит текущему implicit workspace, а две карты могут представлять один canonical объект. | G02, persisted isolation/auth/access/sharing/activity. |
| G · BLOCKED | Есть выборочные десктопные UX проверки, L1A-02/04/05 и расхождения терминов. | После E/F проверить связанные страницы, keyboard/focus, русскую терминологию и понятность задач. |
| H · OPEN | Текущий стенд воспроизводим, 48-портовый workflow функционален. Это малая выборка. | Снять актуальные budgets/baseline, закрыть обязательные PERF-002/003/004/005 и согласованные дополнительные blockers. |
| I · BLOCKED | Phase A/B остаются в прежнем статусе. Полная приёмка эксплуатации зависит от C–H. | G04, чистый финальный прогон с workspace, правами, topology, trace, accountability и scale. |

| ID | Пробел | Оценка |
| --- | --- | --- |
| G01 | **OPEN, обязательная capability.** Один внешний multichannel Cable, exact subset/permutation, безопасный lifecycle и trace после reload. UI не позволяет собрать truthful FANOUT-1x24. | S1 · L1 BLOCKER по Phase D |
| G02 | **OPEN, обязательная capability.** Persisted workspace с auth, ACL, sharing и attribution. Доступный export/reset/import не создаёт перечисленные границы. | S1 · L1 BLOCKER по Phase F |
| G03 | **OPEN, выбор обязательности.** Раскрываемое графическое preview в picker создания, shared routes, расширенная интеракция карты, часть визуальных findings. Не стоит объединять их в одну corrective задачу. | S3 для picker · DECISION REQUIRED по Phase C |
| G04 | **OPEN, обязательный gate.** Representative performance и финальная приёмка. Сценарии, потеря данных или latency на реальном масштабе этим аудитом не установлены. | S1 за риск эксплуатации · L1 BLOCKER по H/I |
| G05 | **CODE-OBSERVED, engineering improvement.** FE-002: создание карты требует проверки pending guard и сохранения ровно одной записи при повторной отправке. Runtime double-submit в аудите не воспроизводился. | S3 предварительно · NON-BLOCKER |

## Приоритеты и последовательность bounded milestones

1. **Collapse uniform grid, Issue #2.** Взять изолированный патч presentation с browser regression для показанной иерархии. В критерий включить сохранённое состояние, full/partial collapse, восстановление и внешние границы. Он предшествует достоверной приёмке физической карты.
2. **Диалог внутренних связей и конфликт ordinary connect.** Два независимых исправления. Первое открывает надёжный вход в authoring passive continuity, второе — восстановление состояния при актуальной занятости. Повторить исходные браузерные шаги и exact trace.
3. **Уточнение Phase D.** Согласовать C-CAP-01-02/03/04 и L1-O5 вместе с минимальным CAT-D. Затем по отдельности проверить canonical external write/lifecycle, UI mapping и trace с truthful FANOUT и portability. Текущую 1:1 цепь сохранить как контроль.
4. **Вернуться к representative Phase C/D acceptance.** Перепроверить оставшиеся visual/recheck сценарии, определить обязательность L1A-01/02/03 и G03. Запустить чистый UI run после corrective и семантических работ. Меню, Fit View, размер, сообщения и падения mock-тестов удобно вести отдельными bounded задачами по принятой обязательности.
5. **Shared UX foundation → productization → adoption.** Для E согласовать общие primitives. Для F разложить isolation, auth/access и attribution на проверяемые задачи. Для G актуализировать пользовательские flows и доступность.
6. **Stabilization и финальная приёмка.** Опираясь на актуальные сравнительные measurements, завершить H и I в принятой последовательности. План throughput и размера выборки согласовать до замеров. Новые продуктовые L2/L3 flows идут после L1 gate.

## Вопросы для продуктового согласования

1. Какие ошибки карты и authoring обязательны к закрытию для C? Достаточен ли временный ручной вариант при дефекте uniform grid, и какую стоимость ошибки в conflict UX считаем приемлемой?
2. Как соотносятся одна Cable identity физической сборки, независимые fiber paths, 2↔1+1 и partial mapping? Какую операцию инженер должен выполнить для изменения или отключения выбранного member?
3. Какие структурные признаки PortType/ConnectorType/CableType входят в минимум CAT-D, как распознаётся unknown compatibility и какие изменения использованного типа допустимы?
4. Что считается тем же NetworkInterface при замене NIC или transceiver и какой UI обязан показать перепривязку зависимых Cable, bindings и evidence?
5. Когда независимые SavedMap становятся самостоятельной topology boundary для reference portability, а какие карты остаются совместными представлениями внутри workspace?
6. Что должен видеть инженер в evidence panel для trace: список канонических hops и Cable, member, панель и контекст модуля либо переход к источнику этих сведений? Какая форма нужна при branch/cycle?
7. Какой минимум справочников требуется до L1, какие представления и права нужны для их совместного использования? Как измеряются keyboards/accessibility, нагрузка и допустимый объём production dataset?

## Итог

Обычные операции L1 на проверенной сети пригодны для ограниченного пилота с активными устройствами, пассивной патч-панелью и кабелями 1:1. Требуют корректировки отображение скрытой ветви, доступ к настройке внутренних связей и обработка занятого порта в конкурентной работе. Обязательные multichannel, workspace и финальные эксплуатационные gates остаются открыты. Этот отчёт фиксирует результаты конкретной выборки и передаётся на external review.
