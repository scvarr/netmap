# 09.6-A validation record

Implementation is complete on the milestone branch and awaits external inspection.
Draft/review/update/publication workflows and subsequent phases remain open.

## Checks

- Targeted backend: 50 passed (hardware configuration, base templates, workspace
  portability, L1 projection, object deletion, saved maps, connection points).
- Targeted frontend: 161 passed (hardware configuration, base editor, editor model).
- Frontend TypeScript/Vite production build passed in Docker.
- Fresh development and test databases successfully applied the single `0001`
  initialization revision. `alembic check` reported no schema differences.
- Workspace v4 export/reset/import preserves canonical IDs, configurations,
  module installations and their endpoint mappings.
- Browser verification created a base with MGMT and an OCP3 bay, a compatible
  two-port module, an object from that base, and a horizontal installation.
  The physical card displayed the occupied bay and all three canonical ports.

The requested full backend run on the fresh test database reported 854 passed
and 10 failed. Eight failures were affected fixture builders and were corrected;
the final targeted run verifies those contracts. One test depended solely on
removed historical Alembic revisions and was removed. The remaining failure is
unrelated cable-route test debt:
`test_cable_route_api_preserves_per_map_geometry_and_explicit_route_lifecycle`
expects waypoints without `anchor`, whereas the unchanged API includes
`anchor: null`. Cable-route behavior was not expanded into this milestone.
The full suite was not repeated after these targeted corrections.

GitNexus change inspection reports critical risk for the broad persisted-model
and migration-history cutover. Its process graph is supplemented by ordinary
source searches, targeted integration checks and the requested full backend run;
graph absence is not treated as proof of independence. External inspection is
required before acceptance.

The development database was actually dropped and recreated, rather than merely
stamped or upgraded over the old schema. Browser verification data remains in it
for inspection. This initialization history intentionally requires a clean
development database; it does not provide an old-schema migration path.

## Corrective UI review

The 09.6-A correction adds bay rectangles to the existing composition canvas,
single-bay selection, bounded drag and eight resize handles, plus synchronized
numeric geometry in the existing contextual rail. Bays are created on the active
panel; endpoints retain interactive priority; a panel with a bay cannot be deleted.
New module, installation and library controls reuse the existing NetMap styles.
Backend, API and database schema are unchanged by this correction.

- Relevant frontend checks: 185 passed across five files, including 13 new bay
  authoring tests; Docker frontend production build passed.
- Browser verification on the final build: add bay, drag, corner resize, numeric
  x correction, save base template successfully; module creation and installation
  forms also visually inspected.
- `git diff --check` passed. No backend suite was run for this UI correction.
- Corrective acceptance still requires external inspection; 09.6-B remains open.
