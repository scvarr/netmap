# Документация NetMap

Это навигационный индекс. Не нужно читать всю папку `docs/` перед каждой задачей: выберите минимальный набор документов по области работы.

## Читать всегда

- [[00-implementation-constraints|Ограничения реализации]] — обязательные project-wide правила.
- [[NetMap|NetMap]] — сводное дерево документации.
- [[chatgpt|CHATGPT]] — порядок работы ChatGPT с проектом.

## Architecture contracts

Текущие архитектурные контракты находятся в `architecture/`. Статус `IMPLEMENTED` не превращает контракт в history: реализованный контракт остаётся действующей документацией.

- [[architecture/01-domain-model|Предметная модель]]
- [[architecture/l1/01-01-l1|L1]] — физические connections и NetworkInterface
- [[architecture/l2/01-03-l2|L2]] — model, encapsulation, operational state, MAC/FDB
- [[architecture/l3/01-04-l3|L3]] — routing, security, NAT, policy routing
- [[architecture/graph/02-graph|Graph / resolver / projection / cache]]
- [[architecture/tracing/03-tracing|Tracing]]
- [[architecture/presentation/05-presentation|Presentation / UX]] и [[architecture/presentation/08-ui-implementation|UI implementation contract]]
- [[architecture/workspaces/07-workspaces|Workspaces]]
- [[architecture/blueprints/09-03-port-block-blueprint-architecture|Blueprint / Port Block]]

## Product direction

- [[product/09-02-post-l1-product-roadmap|Post-L1 product roadmap]]

## Active plans

- [[plans/09-01-l1-spatial-foundation-plan|L1 spatial foundation plan]]
- [[plans/stabilization/10-stabilization-overview|Stabilization overview]] и его [[plans/stabilization/10-02-stabilization-backlog|backlog]]

## Reviews and audits

- [[reviews/09-ui-ux-review|L1 UI/UX review]]
- [[reviews/10-01-audit-findings|Audit findings]]
- [[reviews/10-03-performance-baseline|Performance baseline]]

Выбирайте документы по задаче: например, для L2 trace достаточно соответствующих контрактов в `architecture/l2/` и `architecture/tracing/`, а для UI — `architecture/presentation/` плюс нужный plan или review.
