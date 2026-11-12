# Открытые продуктовые и архитектурные решения

[Состояние](PROJECT_STATE.md) · [Контракты](ARCHITECTURE.md) · [Работы](BACKLOG.md)

Перечисленные направления обсуждались; незаданные schema/API/UX здесь не выбираются.
Принятый target не равен реализации. Разработка идёт по Phase A–I.

## Решения Phase C от 11.11.2026

C-UX-04 — VERIFIED: все шесть ручных проверок пройдены пользователем;
полный scope проверки зафиксирован в [BACKLOG](BACKLOG.md).

C-UX-03 — NOT REQUIRED: произвольных названий панелей достаточно, отдельная
FRONT/REAR-семантика не нужна; это не реализованная функция. C-UX-05 — OPEN:
направляющие runtime map нужны относительно размещённых объектов; bounded UX
открыт, отдельно от auto-layout. C-UX-06 — OPEN: Width/Height пока не реализовывать,
повторно оценить после P-UX-21, не VERIFIED. C-UX-09 — OPEN: нужен раскрываемый
графический preview при выборе BaseTemplate по примеру preview библиотеки.
C-VIS-01 — OPEN: общий совпадающий подсвеченный участок допустим, но evidence
отдельных Cables не смешивается и пересечение не доказывает connectivity.
C-VIS-02 — OPEN: отдельное исправление отложено до повторной проверки после
изменения маркеров P-UX-21; автоматически не закрывается.

## Ближайшая очередь реализации — решение 11.11.2026

BT-DRAFT-01 → BT-COPY-01 → C-CAP-01 → продолжение representative L1 acceptance.
Это очередь реализации, не изменение последовательности gates Phase A–I.
L1 PRODUCT COMPLETE остаётся обязательным до продуктового L2/L3.

### BT-DRAFT-01 — локальное автосохранение BaseTemplate

**IMPLEMENTED / ACCEPTED / MERGED.** Один локальный черновик создания
и отдельный по template ID; localStorage, пауза 350 мс и flush при уходе.
Новый черновик предлагается продолжить; отказ требует подтверждения.
Существующий восстанавливается при совпадении server draft generation;
конфликт блокирует применение и не перезаписывает сервер.
Сохраняются параметры, панели, порты, геометрия, типы, имена, внутренние связи,
модульные места, активная панель, счётчики и порядок/параметры именования.
Выделение и временные состояния взаимодействия не сохраняются.
Очистка только после успешного server save той же версии; ошибки storage
и повреждение данных видимы. API, миграции и draft/candidate/publication без изменений.
Без синхронизации вкладок/устройств; локальные данные зависят от профиля браузера.

### BT-COPY-01 — копирование BaseTemplate

**IMPLEMENTED / external inspection pending.** «Создать копию» в библиотеке из опубликованной ревизии создаёт новый
независимый BaseTemplate. Копируются определения, панели, порты, PortType refs,
геометрия, внутренние связи и модульные места. Не копируются PhysicalObject,
canonical endpoints, подключения и зависимости исходных экземпляров.
Исходный шаблон не изменяется. Источник закреплён template/revision ID в URL;
загрузка с повторной попыткой, штатный create API только при явном сохранении.
Копия использует BT-DRAFT-01; существующий черновик требует выбора и подтверждения
удаления. Архивные PortType сохраняются с предупреждением и ручной заменой.
«Отмена» для создания, копии и редактирования очищает только локальное состояние
после подтверждения; ошибка storage оставляет редактор открытым. Backend lifecycle
не изменён. Адресные component/model tests и Docker build; ручная проверка pending.

## C-CAP-01 — обязательный semantic gap Phase D

C-CAP-01 (единый пункт, ссылка из Phase C) — OPEN, обязательный semantic gap Phase D.
Canonical ConnectionPoint/Connection/ConnectionMember foundation существует, но
BaseTemplate authoring, materialization и обычный Cable UI ограничены cardinality=1.
Обязательный сценарий стенда: один задний многоканальный вход патч-панели,
24 независимо адресуемых канала, 24 отдельных передних порта, exact internal
member mapping 1..24, один физический многоканальный Cable и точный L1 trace
отдельного канала после reload. Не создавать Fanout entity, фиктивные порты
или 24 искусственных Cable для подмены одного физического.
Точные DTO/API, редактирование member mappings, lifecycle/reconcile и UX — OPEN;
foundation не означает IMPLEMENTED.

### P-UX-21 — представление PhysicalObject на карте

**Статус: OPEN / PRODUCT DIRECTION AGREED. Реализация не начата.**

Согласованное продуктовое направление для runtime Map:

1. Большой внешний контур на пользовательском эскизе обозначает Location,
   а не корпус PhysicalObject.
2. Отдельная горизонтальная полоса заголовка сверху убирается. Корпус визуально
   разделяется на левую вертикальную область названия PhysicalObject,
   центральную область оборудования и правую область дополнительной информации.
3. Непосредственный Location может отображаться справа, если его подпись не
   пересекается с кабельными линиями. Если правая область занята, Location
   допускается показывать под названием объекта слева. Точные правила выбора
   расположения подписи и обработки пересечений остаются OPEN.
4. Существующий spatial contract
   одиночных Location chains и derived path labels сохраняется. Это presentation
   context; новая модель принадлежности объектов не вводится.
5. Расположение и координаты портов, принадлежность панелям и модулям сохраняются.
   Маркеры портов должны стать визуально компактнее, по примеру редакторов
   шаблонов; область взаимодействия с портом при этом не уменьшается.
6. Формы NETWORK_PORT/CONNECTION_POINT и цвета PortType сохраняют
   контракт PT-03.
7. Кабельные маршруты не перестраиваются ради декоративных подписей.
8. Canonical topology, endpoint identity, connections, trace evidence, SavedMap
   и Location hierarchy не меняют семантику.
9. P-UX-21 не входит в P-UX-03E. Это отдельная будущая реализация;
   C-VIS-02 не закрывается автоматически.

### P-UX-22 — Взаимодействие с объектами на физической карте

**Статус: PRODUCT DECISION PENDING / PRODUCT DISCUSSION. Продуктовый контракт ещё не утверждён полностью.**

Наблюдения и направления будущего UX-обсуждения:

- Текущий курсор перемещения слишком крупный.
- Действие левой кнопки мыши не всегда очевидно: перемещается карта или элемент
  под курсором.
- При наведении на интерактивный объект желательно подсвечивать его контур.
- При наведении на порт желательно подсвечивать конкретный порт и показывать
  специализированный компактный курсор.
- Визуальная реакция должна отражать реальную доступность действия.
- Необходимо рассмотреть режимы выбора, перемещения карты и редактирования.

Конкретные режимы и горячие клавиши не утверждены. Space+drag, средняя кнопка
мыши и отдельные инструменты остаются вариантами будущего UX-обсуждения.
P-UX-22 — отдельная будущая работа вне P-UX-03E.


### C-UX-16 — История изменений и инструменты редактора трасс

**PRODUCT DECISION PENDING / PRODUCT DIRECTION.** При редактировании трассы нет доступных
пользователю Undo/Redo, а удаление выбранной точки недостаточно заметно.
Удаление выбранного waypoint уже реализовано через QuickInspector; повторно
реализовывать его не требуется. Отдельной полноценной истории Undo/Redo нет.

**Целевое направление (реализация сейчас не выполняется).**

1. Undo отменяет последнее изменение геометрии в текущей сессии редактирования;
   Redo повторяет отменённое изменение.
2. История охватывает добавление, перемещение, числовое редактирование и удаление
   waypoints. Новое изменение после Undo сбрасывает доступную ветку Redo.
3. Удаление выбранного обычного waypoint доступно непосредственно в панели
   редактирования маршрута. Кнопки отражают доступность действия.
4. История изменяет только transient draft. Save выполняет существующую persisted
   запись; Cancel возвращает сохранённую геометрию.
5. Существующие ограничения Location boundary anchors сохраняются.
6. Canonical Cable, Connection, endpoints, trace evidence и SavedMap schema
   не меняются.
7. Горячие клавиши и окончательная композиция панели остаются OPEN для
   отдельного UX-контракта.

C-UX-16 не входит в C-UX-11 и не переоткрывает его. Завершённые milestones
11-08 не реализуют эту историю.

## C-UX-10 — Automatic Location Cable Channels

C-UX-10-01 foundation реализован в milestone-ветке, ожидает внешней инспекции:
самостоятельные прямоугольные frames всех canonical Locations на каждой карте
со spatial вложением по canonical parent, единым переносом контейнера с
оборудованием/routes и ростом предков; назначение Location согласует существующие
placements всех карт/variants (corrective),
variant geometry и одна обязательная map-scoped виртуальная точка, Save/Cancel,
перемещение/resize и копирование variant. Геометрия не меняет topology/hierarchy.
C-UX-10 остаётся OPEN: Channels, составные Cable routes, comb и новый collapse
не реализованы.


**OPEN: DECIDED TARGET, не IMPLEMENTED.** C-UX-10-CONTRACT — только
продуктовый контракт; реализация требует отдельного bounded milestone и не
пересматривает C-UX-11. Phase A–I и C-CAP-01 сохраняют статусы.

### CURRENT и владение

CURRENT: MapCableRoute хранит индивидуальные waypoints; boundary anchors
привязаны к самостоятельным Location frames (C-UX-10-01 foundation).
Shared channels и автоматическое создание каналов отсутствуют. Пустые Location
имеют frame и одну обязательную виртуальную точку.

TARGET согласован с [независимыми картами](L1_REFERENCE_NETWORK.md#независимые-карты):
Location и виртуальная инфраструктура принадлежат одной карте и не разделяются
между независимыми картами. MapPresentationVariant — компоновка этой карты.
Геометрия относится к presentation variant; переключение вариантов и изменение
геометрии не меняют identity точки или canonical topology. Точная persistence
schema, DTO и API этим контрактом не выбираются.

### Обязательная граничная точка

Каждый Location имеет ровно одну обязательную виртуальную граничную точку,
автоматически создаваемую вместе с Location, в том числе пустым. Дополнительные
точки не поддерживаются; ручное удаление обязательной точки запрещено.
Положение настраивается в компоновке карты; identity не зависит от координат,
названия, порядка или переключения компоновок. Точка не является canonical
ConnectionPoint и не создаёт физических endpoints.

### Общий виртуальный Channel

Channel соединяет обязательные точки двух разных Location. Для одной
неупорядоченной пары Location в карте допустим не более чем один прямой Channel.
Он имеет общую редактируемую геометрию и используется любым количеством Cables.
Поиск обходного пути через третьи Location не требуется. Геометрические изгибы
не создают промежуточных Location connections. Channel не является Cable,
Connection или CableBundle; его наличие не доказывает физическую связность
и не влияет на exact L1 trace.

### Соединение портов и preview

При соединении портов определяются непосредственные Location их объектов.
При одинаковом Location используется прямая индивидуальная трасса без Channel.
При разных Location используется существующий Channel этой пары; если его нет,
предлагается автоматическое создание с обязательными точками обоих Location.
Полный маршрут показывается до подтверждения. Persistent изменения создаются
только после подтверждения согласованной операции; отмена или ошибка не оставляет
частично созданной инфраструктуры. Повторное подключение переиспользует Channel
без дубликатов.

Пример: первый Cable U19 → U24 создаёт Channel U19–U24; следующий использует
его. Cable U18 → U24 создаёт Channel U18–U24, используя существующую точку U24.

### Составное отображение Cable

Физический Cable остаётся одной canonical сущностью с реальными окончаниями.
Отображаемый путь: индивидуальный подвод от начального порта к точке его Location,
динамическая общая часть по Channel, индивидуальный подвод от точки второго
Location к конечному порту. Общая геометрия не копируется в маршруты Cables.

Клик по индивидуальному подводу выбирает Cable; клик по общей части — Channel.
Редактирование Cable меняет только его индивидуальные подводы в концевых
Location. Редактирование Channel меняет общую геометрию для всех использующих
его Cables. Выделение Cable подсвечивает только его путь, не пути остальных
кабелей; общий участок не смешивает их trace evidence. Выделение Channel может
показывать список и количество использующих его Cables.

### Lifecycle и перемещение оборудования

Используемый Channel удалять нельзя. После удаления последнего Cable пустой
Channel сохраняется, визуально отличается от используемого и может быть вручную
удалён пользователем. Изменение геометрии Channel не меняет canonical
Cable/Connection/ConnectionMember.

При перемещении оборудования в другой Location физические окончания Cable
сохраняются. Индивидуальный подвод перепривязывается к обязательной точке нового
Location; общая часть вычисляется для новой пары Location, отсутствующий Channel
предлагается автоматически. Если оба конца теперь в одном Location, применяется
индивидуальная трасса без Channel. Прежний Channel остаётся и может стать пустым.
Ошибка не оставляет частично изменённую инфраструктуру или потерянный маршрут.

### Collapse / expand

Сворачивание скрывает внутренние участки по структурной принадлежности, а не
по координатам: waypoint внутреннего участка скрывается даже за рамкой Location.
Внешние части отображаются до граничной точки свёрнутого Location. Необходимая
boundary при пересечении subtree не скрывается unary simplification; между двумя
детьми обязательного перехода через точку родителя нет.

Nested collapse соблюдает иерархию: внешний явно свёрнутый контейнер приоритетен,
внутренние Channels скрываются. Внешние Channels потомков при collapse общего
родителя получают производное отображение до границы родителя без раскрытия
детей. Эта проекция не создаёт новых persisted Channels и не меняет исходную пару
Location. Expand полностью восстанавливает исходную геометрию рекурсивно,
без перезаписи Cable или Channel.

### Пустые Location

TARGET: пустой Location имеет видимую область для размещения обязательной точки
и создания Channels до добавления оборудования. Геометрия пустого контейнера —
presentation state, не canonical физические размеры помещения. Это отличие
от прежнего derived frame; frame/point foundation реализован в C-UX-10-01,
создание Channels остаётся OPEN.

### OPEN implementation decisions

Открыты точная persistence schema, DTO/API, детали атомарности согласованных
операций, конфликтов и конкурентного создания уникальной пары; UX подтверждения
и восстановления после ошибок, включая перемещение оборудования. Также OPEN:
отсутствующий непосредственный Location, удаление/изменение иерархии Location,
копирование вариантов и начальное размещение точек, алгоритм индивидуальных
подводов/comb и производной collapse-проекции. Эти детали не отменяют принятые
инварианты lifecycle, уникальности, identity и отсутствия частичных изменений.
Waypoint snapping не реализует Channel; исправления renderer, косметика и общий
CSS refactor не входят в documentation-only milestone.

## Справочники и техническая совместимость

PT-01/02/03 завершены. Согласовано: reusable user-defined values, выбор из
«Справочников», current name/color независимо от immutable template revision.
Открыты дополнительные типы оборудования/кабелей, классификации, технические
характеристики PortType (technology/speed/connector), compatibility catalog,
создание типов прямо из форм, immutable fields и правила блокировки изменений
используемых типов, безопасное deletion/archive/update. Не подменять cardinality
или member mapping классификацией; не вводить закрытую hardware taxonomy.
Phase D определяет минимальные L1 classifications, E — UX, F — workspace/access.

## Endpoint-relative route sections

Обсуждались waypoints относительно ConnectionPoint: непрерывный prefix/suffix
одного endpoint, между системами координат elastic segment; допускается несколько
relative points. Это presentation, не новая connectivity. Persistence/API/schema
и UX открыты; не часть P-UX-03E и не принятый implementation milestone.

## Spatial и оборудование

Ordered child layout (rack units/chassis/shelves), physical occupancy нескольких
мест, selector-based collapse, reusable Location series templates, arbitrary
nonphysical grouping — открытые отдельные capabilities. Current Location assignment
остаётся single immediate Location, не many-to-many; geometry не доказывает occupancy.
MapReference — будущая composition/navigation независимых SavedMaps с drill-down
и canonical-derived crossings, не Location/containment или простой hyperlink-object.
Scene schema/persistence, interaction и milestone placement не выбраны.
Nested modules, CPU/RAM/disks/PSU inventory и mechanical compatibility не реализованы;
scope/need открыты. Dense runtime map LOD остаётся отдельным измеряемым решением;
PT-03 уже решает базовые shape/color, не требует повторного проектирования.

## Workspace, multi-user и история

Согласовано: NetworkWorkspace — application isolation boundary над network core;
SavedMap — presentation внутри dataset, EvaluationView — coherent read, не workspace.
Persisted isolation/auth/access/sharing/activity нужны до L2 (Phase F), exact
bounded decomposition открыта. Auth provider, roles/groups/ACL inheritance,
SQLAlchemy scope и storage/schema strategy, provisioning/archive/soft-delete,
sharing permissions/public links, query/UI и release gate не выбраны.
Fork/merge/compare/rebase, copy-on-write, database-per-workspace, packages,
comments/annotations, map cloning/templates и общая portability не становятся MUST
автоматически. Текущий v7 export/reset/import не закрывает эту family.

Generic activity: append-only mutation journal, global feed и per-entity projection,
не event sourcing и не source of truth topology. Actor/workspace attribution после
соответствующих foundations; CableLabelHistory уже отдельное domain exception.
Открыты event taxonomy, persisted schema, before/after vs delta/snapshot,
transaction/correlation, actor integration, indexing, retention, query/filter/UI
и права чтения. Exact version/update alias rules нельзя переносить со старого
Blueprint API на новый template lifecycle без проверки текущего контракта.

## Media/capability, diagnostics и operational data

Согласовано различать stable media/configured component facts, capability,
configured link state и observed/negotiated state. Nominal Cable capacity не
равна interface capability, negotiated speed или throughput. Reusable profiles
открыты по schema/storage/API; не фиксировать универсальное Cat6=10G правило.
Path diagnostics могут учитывать transceiver/passive components/remote endpoint,
lanes/PHY/medium, не только ConnectionPoint.speed. Wireless/transport modelling,
capacity chain/bottleneck и standards scope требуют product use case; порядок
после обязательных gates уточняется отдельно.

Observations/collectors отделены от canonical truth: source/time/freshness/evidence,
явное reconciliation при conflict/drift. Historical/timeline support, scheduling,
observation storage, Dynamic Map query language/membership persistence и сохранение
layout остаются открытыми. Collector не запускается только ради одной карты.
Health overlays и problem-only modes — направления, не окончательные enums/API.
Secrets SNMP/API/SSH/monitoring — application secrets; VIEW не даёт credentials,
обычный workspace export не переносит их открытым текстом. Secrets storage и
permissions источников не выбраны.

## Дополнительные границы решений

- Степень/валидация физических points по типам, реальные пути Cable через
  промежуточные Locations, история переподключений и temporal states остаются
  открытыми; presentation channels не являются физическим inventory.
- Массовый multichannel member mapping и степень FANOUT authoring зависят от
  C-CAP-01. Canonical foundation есть; exact template/API решение не выбрано.
- Поиск всего оборудования и свободного порта для создания связи независимо от
  текущей карты — future product direction; map click остаётся быстрым способом.
- Application compression: сначала размеры текущего v7 и ZIP/GZIP, затем решение
  о собственном формате; старый v5 размер не основание архитектуры.
- RoutingPolicy/PACKET_MARK storage/predicate domains, direct-next-hop PBR,
  redirect, VRF leaking и effective observations требуют отдельного product scope;
  наличие backend resolvers не означает весь предполагаемый UI/persistence.
- API-002 missing-resource semantics, performance budgets и LOD выбираются на
  текущих измерениях и контрактах, не ради старой формы тестов.

Контракт [L1-CONTRACT-02](L1_CONNECTIVITY.md) закрепляет L1-O1–L1-O10 как DECIDED.
C-CAP-01 остаётся OPEN Phase D, L1 PRODUCT COMPLETE обязателен до L2/L3.
Решения не объявляют текущий core полным multichannel продуктом.

## Принятые решения L1-O1–L1-O10 — DECIDED

Продуктовый контракт L1-CONTRACT-02 от 11.11.2026. Это target, а не
подтверждение соответствия текущих API, materialization, reconcile или trace.
Доказательная инвентаризация выше сохраняет отдельные статусы реализации.

- **L1-O1:** L1 охватывает сетевые кабельные соединения меди и оптики.
  Для меди канал — независимо подключаемая сетевая линия, для оптики — волокно.
  Проводники RJ45 отдельно не моделируются. Количество каналов задаётся данными.
- **L1-O2:** единый механизм соответствий для внутренних связей и внешних кабелей:
  автоматическое прямое, обратное или заданное упорядочивание, обязательный preview,
  ручная корректировка, частичные mappings, проверка занятости и атомарное сохранение.
- **L1-O3:** member имеет не более одного внешнего и одного внутреннего соединения.
  Разные members одного ConnectionPoint независимы. Конфликт не удаляет старую
  связь автоматически. Исключения настоящих разветвителей вне базовой модели.
- **L1-O4:** PON splitter остаётся в предметной области, но требует отдельного этапа.
  Обычные ConnectionMember не имитируют деление. Оптический бюджет вне C-CAP-01.
- **L1-O5:** физический кабель имеет одну Cable identity, включая несколько окончаний
  с разным числом каналов. Многоконцевые сборки требуют расширения текущей
  двухточечной модели; фиктивные Cable недопустимы.
- **L1-O6:** BaseTemplate определяет физическую конструкцию и внутреннюю разводку.
  Физическая переделка требует нового BaseTemplate и нового PhysicalObject;
  индивидуальная переделка внутренней конструкции экземпляра не поддерживается.
  Исправления описаний, имён и геометрии представления этим не ограничиваются.
- **L1-O7:** изменение физической конструкции модуля требует нового ModuleTemplate.
  Internal continuity модулей — отдельная задача реализации, не готовая возможность.
- **L1-O8:** активное оборудование завершает L1 trace; автоматического transit между
  портами нет. Пассивное продолжение требует явных внутренних связей.
  L2 forwarding и active conversion не подменяют L1.
- **L1-O9:** изменение физической конструкции создаёт новую identity оборудования;
  внешняя перекоммутация сохраняет identity. Старые подключения автоматически
  не переносятся. Исправления ошибочных данных — отдельный случай; частичная
  потеря canonical dependencies недопустима.
- **L1-O10:** отдельный канал возвращает точный подтверждённый canonical evidence путь.
  Группа независимо оценивает members; полнота считается относительно явно заданных
  ожидаемых соответствий. Резервные каналы автоматически не ошибка.
  REACHABLE не означает измеренную исправность физической линии.

Нет фиксированной hardware taxonomy и специальных схем 1x24/1x48.
PortType не определяет connectivity; presentation state не canonical topology.
C-CAP-01 остаётся OPEN Phase D; L1 PRODUCT COMPLETE обязателен до L2/L3.

## Технические вопросы реализации — OPEN

DTO/API, schema/storage и миграции, stable member addressing/provenance,
internal/external role validation и concurrency occupancy, atomic lifecycle,
безопасный reconcile и исправление ошибочных данных, ModuleTemplate continuity,
UX preview/editing и контракт группового результата/ожидаемых mappings открыты.
Выбор выполняется в соответствующем implementation contract по
[последовательности C-CAP-01](BACKLOG.md), не в этой консолидации.

## Управление состояниями сети — PRODUCT DIRECTION AGREED / OPEN

1. Утверждённая текущая топология сети.
2. Создание независимой рабочей копии.
3. Редактирование и утверждение целевой топологии.
4. Выполнение физических изменений.
5. Утверждение новой текущей топологии.
6. Сохранение предыдущих состояний в истории.

Это отдельное будущее направление, не IMPLEMENTED и не MapPresentationVariant.
Текущий SavedMap не обеспечивает независимое версионирование canonical topology.
Хранение, сравнение, утверждение, переключение и разрешение конфликтов — OPEN;
техническое решение и milestone placement не выбраны.


## C-CAP-01-01 — definitions и materialization

Реализованы cardinality и exact internal member mappings BaseTemplate,
атомарная materialization и запрет публикации изменения физической конструкции.
Контракт хранения и границы: [ARCHITECTURE](ARCHITECTURE.md#c-cap-01-01--definitions-и-materialization).
Графический multichannel edit/copy блокируется без потери данных; API доступен.
C-CAP-01 остаётся **OPEN Phase D**; C-CAP-01-02/03/04 не реализованы.

## L1-REFERENCE-01 — DECIDED TARGET / implementation OPEN

[Полный контракт](L1_REFERENCE_NETWORK.md): независимые карты, CableType,
переносимые определения и demo initialization приняты, но не реализованы.
Уточнение прежнего workspace direction: CURRENT SavedMap — presentation над общей
topology; TARGET карта владеет независимой сетью внутри application isolation
NetworkWorkspace. MapReference не даёт межкартовых canonical соединений.
Открыты DB schema/FK transition/API map isolation, JSON/versioning и UX импорта,
сопоставление конфликтующих типов, controlled transition исторических Cable,
защита используемой конструкции CableType и безопасная initialization/conflict policy.
Отдельный bounded map isolation milestone предшествует включению demo.
MPO→LC breakout, PON splitter, SAS shelves и duplex fiber/interface realization
остаются OPEN. C-CAP-01 OPEN Phase D; 02/03/04 не закрыты; gates A–I неизменны.
