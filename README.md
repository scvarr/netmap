# NetMap

M1.1 implements configured L1 traversal across canonical `ConnectionMember`
mappings, including multi-hop paths and cycle protection.

## Runtime

The only host prerequisites are Docker Engine and Docker Compose. The Compose
application contains PostgreSQL and one FastAPI backend container.

```sh
docker compose build
docker compose up -d
docker compose ps
```

The backend applies Alembic migrations before starting and exposes:

```text
GET  http://localhost:8000/health
POST http://localhost:8000/v1/traces/l1
```

Example query body:

```json
{
  "from": {"point_id": "00000000-0000-0000-0000-000000000001", "member_index": 1},
  "to": {"point_id": "00000000-0000-0000-0000-000000000002", "member_index": 1}
}
```

## Migrations and tests

All commands run inside the backend container:

```sh
docker compose exec backend alembic upgrade head
docker compose exec backend pytest
docker compose exec backend alembic downgrade base
docker compose exec backend alembic upgrade head
```

Stop the application while keeping database data:

```sh
docker compose down
```

Reset the local development database (destructive):

```sh
docker compose down -v
docker compose up -d --build
```

An out-of-range point member uses the explicit API contract HTTP 422 with
`error.code = VALIDATION_ERROR`; it is never represented as network `UNKNOWN`.

Because this slice has no global topology completeness model, exhausting all
known canonical L1 facts without reaching the target returns `UNKNOWN` with a
typed `L1_TOPOLOGY_INCOMPLETE` gap, never `UNREACHABLE`. Corrupt canonical facts
remain an HTTP `MODEL_ERROR`.
