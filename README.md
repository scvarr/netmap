# NetMap

NetMap is a canonical network-model and resolver project with a Docker-served
React UI. The canonical/resolver core deliberately goes well beyond the current
UI: L1/L2/L3, tracing, forwarding, routing, security, NAT, evidence and
projection contracts are modelled and tested in the backend, while the product
UI currently exposes a bounded set of topology, catalog, blueprint and Saved
Map workflows.

The repository is the source of truth. Architecture contracts in `docs/` may
describe broader intended semantics; this README distinguishes what is shipped
from what remains open.

## Current product surfaces

- **Saved Maps** at `/map` are the primary L1 presentation surface. A map is a
  presentation scope, never canonical topology: explicit non-cable
  `PhysicalObject` placements define membership.
- Each placement has independent presentation coordinates for
  `L1/PHYSICAL_OBJECT` (Physical) and `L2/DEVICE` (Logical). The two views are
  separate scenes; coordinates and viewport transforms are not shared.
- Physical Saved Maps render L1 projection geometry, blueprint-aware ports,
  collapsed simple cables between two placed endpoints, and one-hop off-map
  cable continuations. Neither a derived cable nor a remote continuation target
  becomes a placement automatically.
- A Saved Map also persists its own Physical/L1 `MapRegion` polygons and
  restricted presentation style through the public API. Region rendering and
  authoring controls are deliberately not part of the current UI.
- **Catalog** at `/infrastructure/objects` and object-detail/create pages is
  the bounded canonical management surface for physical objects, interfaces,
  connection points and supported physical/L2 operations.
- **Object Library** at `/library/object-blueprints` provides blueprint list,
  create, version-edit, delete and instantiate flows. Blueprint geometry is
  presentation metadata; it does not create L1 connectivity.
- The Map includes a bounded `trace <source> <destination> l1` command bar. It
  resolves interfaces through public details APIs and runs the existing
  interface-physical trace; it is not a generic L2/L3 trace workbench.

## Important invariants

- Canonical facts, resolver output and trace evidence are authoritative;
  React/React Flow state is presentation only.
- Saved Map membership and network view are orthogonal. `MapPlacement` means
  membership; `MapViewPosition` means per-view coordinates.
- A coordinate-only drag acknowledges locally and persists through the
  per-view position API. It does not reload the projection, rerun ELK, or reset
  the viewport. Failed writes reload the authoritative map position only.
- L1 cable collapse and off-map continuation reuse canonical projection facts
  and retain canonical refs/evidence. They are not parallel cable models.
- Logical dragging, per-scene persisted viewports, MapReference, Region editing,
  map wiring and multi-hop/off-map continuation are not implemented.

## Runtime

Docker Engine and Docker Compose are the required host dependencies.

```sh
docker compose up -d --build
docker compose ps
```

The application exposes the frontend at <http://localhost:5173/map> and the
backend health endpoint at <http://localhost:8000/health>. The backend applies
Alembic migrations before startup. Public APIs include Saved Map operations,
topology projection, canonical object/detail/write operations, blueprints and
trace endpoints; see `app/main.py` and the frontend data sources for the exact
implemented request/response contracts.

## Validation

Run backend tests only through the isolated test Compose stack; it uses its own
`netmap_test` database and must never target the runtime database.

```sh
docker compose -f compose.test.yaml up --build --force-recreate --abort-on-container-exit --exit-code-from test-runner test-runner
npm --prefix frontend test
npm --prefix frontend run build
```

Stop runtime containers while preserving data:

```sh
docker compose down
```

`docker compose down -v` deletes the local runtime database and is destructive.

## Documentation

- [`docs/NetMap.md`](docs/NetMap.md) — documentation index.
- [`docs/architecture/presentation/05-presentation.md`](docs/architecture/presentation/05-presentation.md) — presentation
  contracts, Saved Map scope and explicit open work.
- [`docs/architecture/presentation/08-ui-implementation.md`](docs/architecture/presentation/08-ui-implementation.md) — implemented
  frontend/API subset and its boundaries.
- [`docs/reviews/09-ui-ux-review.md`](docs/reviews/09-ui-ux-review.md) — working L1 product/UX
  review; its findings are implementation-pending, not runtime contracts.

The architecture notes intentionally contain designs that are not yet product
surfaces. Treat their status labels and the implementation-facing documents
above as the guide to current behaviour.
