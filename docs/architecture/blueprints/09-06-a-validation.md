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

## Corrective installed endpoint names

Module definition names remain local. One batched server resolver derives
`Panel / Bay / Endpoint` from mapping/installation/current bay/panel/definition.
Configuration endpoints expose explicit local and contextual names. Detached
physical/interface cards, L1 point lists and off-map continuations, physical
connection pickers, map port menus/wiring confirmation, peer details and catalog cable endpoints use the contextual
name. Spatial blueprint slots/markers continue using the local name. No persisted
columns, metadata aliases, canonical identities or naming templates were added.

- Targeted backend: 27 passed across hardware configuration, device details,
  L1 physical projection, catalog inventory and physical endpoint connections.
  Coverage includes two identical installations, four distinct CP/NI IDs, exact
  local aliases, unchanged built-ins, full contextual names, direct bindings,
  peer/cable/continuation names, repeated bay names on different panels and
  panel/bay read-state renaming without identity changes. Context uses one
  joined query; configuration loading has bounded batches per object.
- Targeted frontend: 30 passed: 24 across hardware configuration, physical details,
  endpoint picker and generic endpoint presentation, 5 selected map port-menu /
  wiring checks and 1 spatial local-name DeviceNode check. Unrelated cases in the
  latter files were not included in the final targeted runs.
- Running the entire DeviceNode test file also exposed an existing unrelated
  hidden-composite marker failure: it expects
  `blueprint-map-node__port--hidden-composite-connection`, while the unchanged
  component has no such class/behavior. That old contract is outside this
  correction; 36 checks passed and 1 failed in that broader diagnostic run.
- The broader map-menu/wiring diagnostic run had 42 passed and 4 failures in
  old size-operation and saved-map acknowledgement fixtures. All four reproduce
  with the original HEAD MapPage.tsx mounted into the same test runtime, so they
  are unrelated test debt, not regressions of this endpoint-name correction.
- Frontend TypeScript/Vite build passed in Docker. `git diff --check` passed.
- Browser verification created object `4fac80f0-9588-4538-af5a-8a36921d1e89`
  with two installations of one feth1/feth2 module in Back / PCIe1 and PCIe2.
  Card, direct interface labels and picker distinguish all four paths. On map
  LAB-0510 the four spatial markers retain local feth1/feth2 titles and accessible
  names. Verification fixture remains in the development database.
- Full backend/frontend suites were not run. No merge or later milestone work;
  external inspection is still required before accepting 09.6-A.
