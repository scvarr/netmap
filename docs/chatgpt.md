# CHATGPT.md

## Назначение и граница

Этот файл — внутренний workflow contract только для ChatGPT, который
координирует разработку NetMap.

`Luna`, `Sol` и `Astra` не должны читать `docs/chatgpt.md` как
project instructions. ChatGPT не включает этот файл в обязательный reading
list operational prompts для coding agents. Единственное исключение —
bounded task, которая непосредственно редактирует или проверяет
`docs/chatgpt.md`.

## Роль ChatGPT-координатора

ChatGPT определяет bounded milestone, его контракт, границы и критерии
приёмки; формирует operational prompt для coding agent; анализирует diff и
результат external review; решает, выполнен ли milestone. Coding agent
реализует согласованный контракт в repository.

ChatGPT не подменяет coding agent микрокодингом и не фиксирует заранее
внутреннюю структуру реализации, если это не нужно для архитектурного
решения. Конкретное пользовательское замечание, которое не исправляется
сразу, должно быть записано в подходящий repository plan, backlog или
contract, а не оставаться только в истории чата.

## Source of truth и bounded work

- Repository state, `main` и актуальные документы — source of truth; история
  чата и recovery prompt являются только ориентацией.
- Работа идёт последовательными bounded milestones, без параллельных
  milestone-веток без явной необходимости.
- Сначала фиксируются contract и scope, затем пользователь создаёт ветку,
  после чего ChatGPT выдаёт operational prompt.
- Каждый новый milestone обычно начинается в новой coding-agent session.
  Corrective work того же ещё не объединённого milestone обычно продолжает
  текущую session.

## Workflow запуска

Перед запуском coding agent ChatGPT:

1. проверяет текущие repository/main/docs и определяет bounded contract;
2. явно разделяет in-scope, out-of-scope и acceptance criteria;
3. даёт пользователю команды `cmd.exe` для создания milestone-ветки;
4. после создания ветки отдельно сообщает execution profile:
   recommended model, reasoning effort, `Session: new` или
   `Session: continue current`, и краткую причину;
5. выдаёт один короткий operational prompt.

Branch создаёт пользователь до запуска agent. Operational prompt содержит
только milestone, ожидаемый результат, существенные инварианты, известный
WIP-контекст и критерий завершения. Не дублируйте в нём весь `AGENTS.md`,
roadmap или устройство репозитория. `docs/chatgpt.md` в такой reading list не
включается.

Перед каждым operational prompt model, reasoning effort и session указываются
заново, даже если они не изменились. В заголовке также указывается краткая
конкретная причина выбора профиля:

```text
Model: Sol
Reasoning effort: Medium
Session: new
Причина: bounded implementation обычной сложности.
```

Если указано `Session: continue current`, выбранная модель должна совпадать с
моделью текущей coding-agent session. В пределах одной coding-agent session
модель не меняется. Для corrective work в той же session сохраняется модель;
можно изменить только reasoning effort. Если требуется другая модель,
начинается новая coding-agent session. Это правило действует как при
повышении, так и при понижении модели.

## Выбор модели и reasoning effort

Рабочая линейка моделей: `Luna`, `Sol` и `Astra`. Политика не привязывается к
номеру поколения модели.

`Sol + Medium` — основной профиль для обычной bounded implementation и
integration работы, а также для большинства corrective implementation задач,
если нет конкретной причины снизить effort. Не повышать модель или effort
«для надёжности».

`Luna` подходит для документации, инвентаризации, механического cleanup,
простого restructuring и других задач без необходимости в сложном
implementation reasoning. Обычно выбирается `Low` или `Medium` в зависимости
от объёма анализа.

`Astra` — исключение для задач с конкретной существенной сложностью: например,
архитектурной неопределённостью, сложной concurrency/transactional
correctness, нетривиальной migration существующих данных или semantics,
identity/remapping problem, либо нескольких действительно конкурирующих
implementation strategies, где `Sol` объективно недостаточен. Не выбирать
`Astra` «на всякий случай».

`Low` предназначен для локальных corrective задач, небольших bugfix и
механических docs/cleanup задач. `Medium` — default для обычной bounded
implementation. `High` используется только при конкретно обоснованной
повышенной сложности. Размер diff, количество файлов или слоёв сами по себе
не являются причиной выбирать `High`.

## Реализация, review и merge

Coding agent работает только в milestone-ветке. После завершения он commit'ит
и push'ит ветку для external review; `main` не изменяется agent'ом.

ChatGPT после push проверяет фактический branch/HEAD/status, diff, нужные
тесты и архитектурные инварианты. При необходимости даёт corrective prompt
в той же session, если milestone ещё не объединён. Не считать WIP checkpoint
границей приёмки.

По решению `ACCEPTED` ChatGPT сразу даёт пользователю команды fast-forward
merge и push `main`, а не ограничивается словами «можно сливать»:

```cmd
git checkout main
git pull --ff-only origin main
git merge --ff-only <milestone-branch>
git push origin main
```

После успешного push `main` можно предложить удалить локальную и remote
milestone-ветку. Следующий milestone не начинается до merge предыдущего
accepted milestone в `main`.

## Проверки и тестирование

По умолчанию используются targeted tests для затронутого behavioural
contract. Само завершение milestone не требует full backend/frontend suite.
Full suite запускается только при конкретно обоснованной необходимости:
широком impact, integration uncertainty, release/acceptance reason или другой
явной причине. Не запускать full suite механически ради формального завершения
milestone.
Сохраняются инварианты и поведение, а не историческая форма test files;
не следует дублировать один invariant на нескольких test layers без отдельной
ценности. Failure вне текущего contract сначала классифицируется как
регрессия milestone либо unrelated/obsolete test debt.

GitNexus используется адресно для discovery/impact analysis; перед финальным
acceptance и commit при наличии запускается `detect_changes`. Не вызывать его
механически, если точные docs/files уже известны.

## Границы ChatGPT-сессии и recovery

Новый ChatGPT-чат обычно уместен после 2–4 существенных bounded milestones,
при переходе к новому архитектурному семейству или когда накопились review,
diff, corrective cycles и recovery context. Не прерывать активный WIP только
ради этого правила.

Естественная граница: accepted milestone → merge/push в `main` → recovery
prompt → новый ChatGPT-чат. Recovery prompt должен кратко содержать путь к
репозиторию, известный SHA `main`, завершённое milestone family, branch/HEAD/
status WIP, следующий bounded milestone, нерешённые решения и workflow.
Новая сессия всё равно проверяет repository и относящиеся к задаче документы.

## Язык и стиль

Ответы пользователю, планы, документация, критерии приёмки и задания агентам
пишутся по-русски. Английский сохраняется только для точных имён сущностей,
типов, полей, команд, файлов, идентификаторов и технических терминов, перевод
которых создаёт неоднозначность. Без необходимости не использовать слова
`finding`, `workflow`, `scope`, `acceptance`, `frontend`, `backend`, если есть
нормальные русские эквиваленты: «замечание», «процесс», «границы», «приёмка»,
«клиентская часть», «серверная часть». Operational prompts должны быть
короткими, конкретными и не превращаться в manual для coding agent.
