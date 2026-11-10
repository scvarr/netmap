# NetMap

NetMap — модель физической сети с canonical topology, L1 trace и картами
представления. Backend содержит также L2/L3 resolver core; полноценные L2/L3
пользовательские workflows ещё не готовы. Phase C открыта, L1 PRODUCT COMPLETE
не достигнут.

Доступны библиотеки BaseTemplate/ModuleTemplate, ревизии и безопасное обновление
оборудования и установленных модулей, PortType справочник, дерево Locations,
SavedMap с вариантами компоновки, collapse/group move, кабельные маршруты,
массовое соединение портов и L1 trace с exact evidence. Настройки данных дают
export/reset/import текущего implicit workspace в Workspace JSON v7.

## Запуск

Нужны Docker Engine и Docker Compose. Миграции выполняются перед запуском backend.

```sh
docker compose up -d --build
docker compose ps
```

[Приложение](http://localhost:5173/map) · [Backend health](http://localhost:8000/health)

Остановка с сохранением данных:

```sh
docker compose down
```

`docker compose down -v` удаляет runtime database volume.

## Разработка

Runtime только Docker; зависимости pinned. Backend tests используют отдельную
тестовую БД, никогда runtime database. Запускать проверки по затронутому контракту;
полные suites нужны по конкретному основанию, не для изменений документации.

```sh
docker compose -f compose.test.yaml up --build --force-recreate --abort-on-container-exit --exit-code-from test-runner test-runner
npm --prefix frontend test
npm --prefix frontend run build
git diff --check
```

Реализованные API и DTO: `app/main.py`, `app/models.py`, `app/schemas.py`;
пользовательские маршруты: `frontend/src/App.tsx`.

## Документация

- [Текущее состояние и ограничения](docs/PROJECT_STATE.md)
- [Действующие архитектурные контракты](docs/ARCHITECTURE.md)
- [Незавершённая работа и Phase A–I](docs/BACKLOG.md)
- [Открытые решения](docs/OPEN_DECISIONS.md)
- [Правила разработки](AGENTS.md)

`docs/chatgpt.md` — отдельный внутренний контракт координатора, не инструкция
coding agent и не часть продуктового комплекта.
