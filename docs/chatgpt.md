# CHATGPT.md

## Назначение и граница

Этот файл — внутренний workflow contract только для ChatGPT, который
координирует разработку NetMap.

`Codex`, `Luna`, `Terra` и `Sol` не должны читать `docs/chatgpt.md` как
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
заново, даже если они не изменились. Размер репозитория сам по себе не
является причиной выбирать наиболее сильную модель.

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

Обсуждение с пользователем преимущественно на русском. Английские термины
сохраняются для настоящих domain identifiers, названий моделей, команд,
статусов и технических контрактов. Operational prompts должны быть короткими,
конкретными и не превращаться в manual для coding agent.
