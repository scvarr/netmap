# Логические модульные места — HV-01-UX-02A

## Статус и границы

**UX-02B–D включены в main. HV-01 — PASSED (06.11.2026). Phase C остаётся открытой.**

Датированные статусы ниже относятся к контрольным точкам реализации.

Основание: main `34e9e392048c94fbcbb345d22907914d63bd8d35`.
Редактирование количества реализовано в UX-02D. Границы runtime описаны в UX-02B/UX-02C ниже.
Действующие IMPLEMENTED F1/F2a/F2b, D2 и E1/E2/E3 остаются описаны в
[09.6](../architecture/blueprints/09-06-hardware-template-module-contract.md).
Документ заменяет обязательность графического создания каждого ModuleBay в
целевой модели, с актуальными границами runtime, миграции и размещения в разделах UX-02B/UX-02C.
[Реестр Phase C](../plans/11-05-phase-c-acceptance-closure.md) не закрывается.

## Согласованная целевая семантика

В BaseTemplate пользователь задаёт панель, открытое значение совместимости и
количество модульных мест. Рисовать прямоугольник каждого места не обязательно.
Количество — способ создать индивидуальные места и показать ёмкость, а не
замена их стабильных opaque identifiers. Место вмещает не более одной установки.
Identity не зависит от имени, номера, порядка, координат и группировки в форме.
Новая canonical сущность не требуется: это развитие authoring/configuration
контракта мест ModuleBay, не физическая топология.

Совместимость остаётся открытой строкой: точное, чувствительное к регистру и
пробелам сопоставление без нормализации, enum и taxonomy. Одинаковые значения
не доказывают совместимость сетевого линка. Направление
[пользовательских справочников](user-reference-catalogs.md) этого не меняет;
семантика ссылок на изменяемые справочники остаётся отдельно OPEN.

PhysicalObject показывает свободную, занятую и общую ёмкость по каждой паре
«панель / совместимость» из фактически pinned конфигурации, а не latest template.
Пустое логическое место может не иметь видимого прямоугольника. Установленный
модуль имеет собственный body и порты из pinned ModuleTemplateRevision (F1).
Начальное размещение выполняется на выбранной панели с сохранением пропорций
в единицах панели и учётом ориентации. Initial fit без rectangle определён в UX-02C ниже.
Пользователь корректирует экземпляр через существующий F2b: перемещение,
пропорциональный resize, явные save/cancel/reset; порты следуют body.

Явно расположенные физические отсеки остаются допустимым специальным случаем
оборудования с фиксированными посадочными местами. Свободное место означает
отсутствие обязательного bay rectangle, а не отсутствие панели, identity или
ограничения ёмкости. Визуальное перемещение не меняет назначенное место.

## Обязательные инварианты реализации

- Увеличение количества добавляет новые ключи, сохраняя существующие. Уменьшение
  не перенумеровывает и не пересоздаёт оставшиеся места. Сначала удаляются
  наибольшие bay_key в лексикографическом порядке. Изменение числа не разрешает
  удалить занятую установку. Смена панели/совместимости проверяется как
  структурное изменение, а не безусловное редактирование агрегированного числа.
- Обновление base сохраняет ModuleInstallation.id, pinned module revision,
  orientation, endpoint mappings и canonical ConnectionPoint, NetworkInterface,
  Connection, ConnectionMember, Cable, metadata, aliases и dependencies.
  Не разрешается удалять или пересоздавать endpoints ради изменения мест.
  Canonical topology остаётся источником истины; layout не topology evidence.
- Опубликованные base/module revisions и frozen snapshots immutable. Публикация
  новой base revision не обновляет существующий объект сама по себе. Объект
  остаётся на своей pinned revision до безопасного применения. E1 review,
  E2 publication и E3 explicit reconcile сохраняют разделение обязанностей;
  публикация модуля не меняет установки. E3 сохраняет пользовательский layout.
- D2 сначала сохраняет валидные назначения, затем детерминированно назначает
  вытесненные установки свободным точно совместимым местам в лексикографическом
  порядке installation-ID / place-key. Имена, координаты и порядок в UI не
  определяют relocation. Новая модель не даёт права молча заменить этот порядок.
- Проверяется панель **финального** D2 назначения относительно layout.panel_key.
  Переназначение на той же панели сохраняет layout, даже при изменении rectangle.
  Перенос на другую панель сейчас блокируется MODULE_LAYOUT_PANEL_CONFLICT;
  автоматический cross-panel перенос не реализован. Наличие совместимых мест
  на другой панели не доказывает безопасную применимость обновления. Нельзя
  молча выбирать другой порядок D2 ради обхода этого отказа.
- При недостаточной совместимой ёмкости сохраняется
  INSUFFICIENT_COMPATIBLE_CAPACITY: весь update объекта отклоняется, предыдущая
  base revision, установки и данные сохраняются. Публикация может состояться,
  проблемный объект остаётся requiring intervention. Проверка выполняется заново
  под актуальными блокировками; stale review не разрешает запись. Частичных
  потерь или частично применённой relocation быть не должно.
- F2b сохраняет ограничение текущей панели, expected-state conflict protection,
  локальный draft при ошибках и явное сохранение. Изменение ёмкости не сбрасывает
  пользовательский layout. Reset использует pinned initial fit, определённый UX-02C ниже.
- Явное удаление модуля остаётся отдельным действием с действующими dependency
  blockers. Успех освобождает место, сохраняя его ключ. Повторная установка —
  новая ModuleInstallation с новыми endpoints и pin текущей module revision;
  прежние installation ID, endpoints и связи не «воскрешаются». Сохранение
  layout удалённого экземпляра для повторной установки не утверждено.
- Существующие геометрические ModuleBay не могут молча терять координаты,
  даже пустые. Геометрия места и пользовательский layout установки — разные
  данные, сохранение одного не оправдывает потерю другого.

## Решения исходного docs milestone (core уточнён ниже)

| Решение | Требуемая граница |
| --- | --- |
| Хранение и UX количества | Выбрать развитие ModuleBay без нового canonical inventory; определить ключи добавлений/удалений, разбиение групп и конфликт параллельного редактирования. |
| Начальный layout без rectangle | Выбрать масштаб, anchor, порядок, overlap/collision и поведение при нехватке визуального пространства; сохранить пропорции, панель и положительную конечную геометрию. Визуальная теснота не равна нехватке логической ёмкости. |
| Reset и повторная установка | Определить воспроизводимый pinned initial placement для свободных мест и политику повторного использования presentation после удаления, без восстановления canonical identity. |
| Фиксированные места | Уточнить, означает ли fixed только initial anchor или дополнительное ограничение layout, как сочетается с F2b и relocation. До отдельного решения действующие ограничения не ослабляются. |
| Изменение панели | Любая будущая cross-panel стратегия требует отдельного контракта преобразования и сохранения layout; сейчас действует отказ F2a, не автоматический перенос. |
| Миграция и archives | Выбрать representation, forward migration и archive profile/version с явной валидацией; applied Alembic revisions не изменять. |

Рассмотренные в UX-02A альтернативы; UX-02B выбирает сохранение PLACED:

1. Сохранить их как явно фиксированные места с прежними ключами, панелями и
   rectangles; новые свободные места создавать без rectangle. Это сохраняет
   смысл старых посадочных мест, но требует явного различения режимов и правил
   их редактирования внутри одной целевой модели.
2. Превратить их в свободные места с прежними ключами и панелями, сохранив
   rectangle как presentation anchor/provenance. Нужно определить его использование
   для initial fit/reset и UI; нельзя выдавать сохранённый anchor за обязательный
   физический отсек или выбросить его после копирования layout установки.

В обоих вариантах immutable revisions и исторические snapshots остаются
читаемыми и неизменными. Нельзя сохранять obsolete authoring API через dual
runtime, legacy parser или fallback только ради development compatibility.
Допустимое сохранение данных и provenance не предрешает механизм перехода.

## Действующие workspace archives и риск совместимости

Сейчас workspace v5 использует module_geometry_version=1 и
module_layout_version=1; F1/F2a документируют bounded historical profiles и
детерминированное дополнение старой геометрии. HV-01-UX-02B расширяет profile, как описано в разделе core ниже. Будущая реализация обязана сохранить canonical
IDs, pinned revisions, индивидуальные ключи мест, installations, layout,
координаты прежних bays, пользовательские данные и frozen review provenance.
Нельзя переинтерпретировать текущий archive как набор безымянных счётчиков или
сделать неполный новый profile неотличимым от исторического.

Риски: потеря ключей при count-based редактировании, потеря пустых rectangles,
пересчёт пользовательского layout, неявный latest revision, обход panel conflict
и неоднозначный archive profile. Миграция и initial placement реализованы в
UX-02B/UX-02C. Для UX-02D требуется внешняя проверка итогового diff.

## HV-01-UX-02B — Logical Module Places Core

**IMPLEMENTED / EXTERNAL REVIEW PENDING. Phase C — PAUSED. HV-01 — NOT PASSED.**

ModuleBay is one individual record with stable opaque bay_key, display_name,
panel_key and exact open compatibility. kind=LOGICAL has no rectangle (NULL
coordinates); kind=PLACED requires a full valid rectangle. Both have capacity=1.
Alembic 0008 is forward-only: existing rows become PLACED without changing keys,
rectangles (including empty bays), installations, endpoints or saved layout.
Historical immutable definitions remain unchanged and readable as PLACED with a
complete rectangle. Newly serialized definitions include kind explicitly.

Workspace v5 exports module_places_version=1 alongside module_geometry_version=1
and module_layout_version=1. The new profile requires kind on every ModuleBay row.
Historical archives without the places marker accept geometric rows only and add
PLACED at the import boundary, preserving frozen definitions and canonical IDs.

UX-02C enables compatible installations in free LOGICAL places, including D2
final assignment, existing F2b interaction and workspace v5 import. Exact
compatibility, capacity=1, locking, expected-state 409, canonical materialization,
MODULE_LAYOUT_PANEL_CONFLICT and INSUFFICIENT_COMPATIBLE_CAPACITY remain in force.
Frontend enables installation without drawing an empty LOGICAL rectangle.
This core supersedes the earlier representation/migration OPEN entries only;
external inspection and HV-01 acceptance remain outstanding.


## HV-01-UX-02C — Logical Module Installation

**IMPLEMENTED / EXTERNAL REVIEW PENDING.
Phase C — PAUSED. HV-01 — NOT PASSED.**

Initial layout uses all LOGICAL places of the pinned base revision on the owning
panel, sorted lexicographically by bay_key. For N places and panel W × H,
columns = min(N, max(1, ceil(sqrt(N × W/H)))); rows = ceil(N/columns).
Places occupy row-major equal normalized cells. The pinned module body is
centered and proportionally fitted in its cell in panel units; VERTICAL rotates
the complete image clockwise before fitting. Dimensions are finite and positive,
and the result stays inside the panel. PLACED retains its existing bay fit.

Cells are transient calculation regions, never persisted ModuleBay rectangles.
They constrain only initial placement. F2b move/resize/save/cancel/reopen retain
existing panel bounds and expected-state protection. Reset recomputes from pinned
base/module revisions, bay_key, panel dimensions and orientation, independent of
neighbor layouts. Adding/removing installations never moves existing ones.
Visual overlap does not reduce logical capacity; no packing/collision solver.

D2 retains valid assignments first and deterministic exact-compatible relocation;
same-panel relocation preserves layout and installation/endpoint identities.
Cross-panel final assignments still fail atomically. E3 preserves layout and
canonical identities. Uninstall retains dependency blockers; reinstall creates
new installation and endpoints, even when initial layout is identical.

Workspace remains v5 with module_places_version=1 and existing geometry/layout
markers. Only the obsolete LOGICAL installation import prohibition is removed.
Saved layout, bay_key, pinned revisions, installation IDs, endpoint mappings,
canonical IDs, connections, metadata and frozen review provenance round-trip
unchanged. No snapshots or applied Alembic revisions are rewritten.

## HV-01-UX-02D — Logical Places Count Authoring

**IMPLEMENTED / EXTERNAL REVIEW PENDING. Phase C — PAUSED. HV-01 — NOT PASSED.**

В редакторе BaseTemplate откройте «Модульные места», выберите панель,
введите совместимость и положительное целое количество, затем нажмите
«Создать группу». Для существующей группы доступны «Применить количество»
и «Удалить группу». Максимум — 1024 места на группу при создании и изменении.
Регистр и пробелы различают группы даже на одной панели.

При увеличении создаются только недостающие места с новыми opaque bay_key и
именами. При уменьшении сначала удаляются наибольшие bay_key в
лексикографическом порядке. Ноль удаляет группу. Сохранившиеся места
сохраняют все поля. Отсеки PLACED редактируются на полотне отдельно.

Сохраните черновик, проверьте изменения и опубликуйте ревизию. После уменьшения
проверьте, можно ли отдельно применить ревизию к объектам. При отказе D2
объект остаётся на прежней pinned revision.
