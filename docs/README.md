# Документация NetMap

Это навигационный индекс. Не нужно читать всю папку `docs/` перед каждой задачей: выберите минимальный набор документов по области работы.

## Точки входа

- Для навигации по документации используйте этот `docs/README.md`.
- [[00-implementation-constraints|00. Ограничения реализации]] — обязательный project-wide implementation contract.
- [[chatgpt|docs/chatgpt.md]] — только workflow ChatGPT; Codex не читает его как свою инструкцию.
- [[NetMap|docs/NetMap.md]] — полное архитектурное дерево/reference. Читайте его при необходимости, а не перед каждой bounded-задачей.

## Architecture contracts

Текущие архитектурные контракты находятся в `architecture/`. Статус `IMPLEMENTED` не превращает контракт в history: реализованный контракт остаётся действующей документацией.

- [[architecture/01-domain-model|Предметная модель]]
- [[architecture/l1/01-01-l1|L1]] — физические connections и NetworkInterface
- [[architecture/l1/01-01-02-cable|Cable domain decision]] — Cable.0 target model
- [[architecture/l2/01-03-l2|L2]] — model, encapsulation, operational state, MAC/FDB
- [[architecture/l3/01-04-l3|L3]] — routing, security, NAT, policy routing
- [[architecture/graph/02-graph|Graph / resolver / projection / cache]]
- [[architecture/tracing/03-tracing|Tracing]]
- [[architecture/presentation/05-presentation|Presentation / UX]] и [[architecture/presentation/08-ui-implementation|UI implementation contract]]
- [[architecture/presentation/09-spatial-location-mapreference-contract|Spatial contract: Location, Region, SavedMap и MapReference]]
- [[architecture/workspaces/07-workspaces|Workspaces]]
- [[architecture/blueprints/09-03-port-block-blueprint-architecture|Blueprint / Port Block]]
- [[architecture/10-application-change-history|Application Change History]]

## Product direction

- [[product/09-02-post-l1-product-roadmap|Post-L1 product roadmap]]

## Current completion roadmap

- [[plans/11-03-pre-l2-product-completion|11.3 Pre-L2 product completion]] —
  canonical sequential execution roadmap до `L1 PRODUCT COMPLETE` и начала
  semantic L2.

## Active plans

- [[plans/09-01-l1-spatial-foundation-plan|L1 spatial foundation plan]]
- [[plans/09-04-l1-product-ux-completion|L1 Product UX completion]]
- [[plans/09-05-cable-domain-cutover-plan|Cable.1 canonical cutover plan]]
- [[plans/stabilization/10-stabilization-overview|Stabilization overview]] и его [[plans/stabilization/10-02-stabilization-backlog|backlog]]

## Reviews and audits

- [[reviews/09-ui-ux-review|L1 UI/UX review]]
- [[reviews/10-01-audit-findings|Audit findings]]
- [[reviews/10-03-performance-baseline|Performance baseline]]

Выбирайте документы по задаче: например, для L2 trace достаточно соответствующих контрактов в `architecture/l2/` и `architecture/tracing/`, а для UI — `architecture/presentation/` плюс нужный plan или review.
