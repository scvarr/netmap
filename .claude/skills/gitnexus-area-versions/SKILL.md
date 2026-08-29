---
name: gitnexus-area-versions
description: "Skill for the Versions area of netmap. 10 symbols across 1 files."
---

# Versions

10 symbols | 1 files | Cohesion: 70%

## When to Use

- Working with code in `alembic/`
- Understanding how upgrade work
- Modifying versions-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `alembic/versions/0029_repair_blueprint_composition_schema.py` | _has_check_constraint, _has_foreign_key, _has_primary_key, _has_unique_constraint, _inspector (+5) |

## Entry Points

Start here when exploring this area:

- **`upgrade`** (Function) — `alembic/versions/0029_repair_blueprint_composition_schema.py:123`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `upgrade` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 123 |
| `_has_check_constraint` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 56 |
| `_has_foreign_key` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 32 |
| `_has_primary_key` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 27 |
| `_has_unique_constraint` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 49 |
| `_inspector` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 19 |
| `_repair_port_block_instances` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 63 |
| `_has_column` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 23 |
| `_repair_endpoint_slots` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 101 |
| `_repair_face` | Function | `alembic/versions/0029_repair_blueprint_composition_schema.py` | 112 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Upgrade → _inspector` | cross_community | 4 |

## How to Explore

1. `context({name: "upgrade"})` — see callers and callees
2. `query({search_query: "versions"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
