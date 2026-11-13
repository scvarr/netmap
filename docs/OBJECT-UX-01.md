# OBJECT-UX-01 — Three-Zone PhysicalObject Frame

PhysicalObject with a published BaseTemplate composition uses one square-corner horizontal frame:
identity (72 flow px), composition, cable management reserve (minimum 20 flow px).
The empty right zone is presentation only: no ports, links, or canonical entities are synthesized.
The identity is bounded and ellipsized, with a full hover title; Location is optional and no U or name-derived Location type is required.

`display_width` continues to mean composition width. Minimum footprint adds 92 px; derived automatic frame allocation may extend the cable zone;
height is the composition aspect ratio with no top nameplate. Existing saved widths are read unchanged.
PORT-UX-01 density minima still apply. Resize converts the frame width back to composition width.
Panels, port shapes, colors and published revisions are unchanged. Internal L1 stays composition-local;
rendered ports, cable endpoints and foreground markers share the same left-zone offset.
Client layout/collision and server SavedMap footprints include both side zones and the density minimum.
Reading geometry does not write Cable waypoints or alter MapCableRoute.

Object cable comb and common harness are agreed **OPEN** follow-up work, including object-relative
waypoints and later Location boundary integration. This milestone creates only a reserved area.
C-UX-10 is not declared implemented by this change. Canonical topology and Member mappings are unchanged.

Validation: targeted frontend geometry, interaction, L1, layout and runtime-color tests;
server dense footprint, SavedMap, variants and Location geometry tests; Docker TypeScript/Vite build.
Browser inspection of live PP1/SW1 and a real pointer resize remains a manual acceptance check.

Results: backend targeted set 27 passed. Frontend expanded targeted set 170 passed, 1 failed:
MapPage.wiring acknowledgement/malformed-response fixture cannot load the map.
The same failure reproduces using unmodified base 76d9855 sources (12 passed, 1 failed),
so it is classified as existing unrelated test debt and left outside this milestone.

Additional automatic Location layout checks: 12 passed; horizontal resize control and DeviceNode checks: 16 passed again after the final control change. TypeScript/Vite build and diff whitespace check passed. GitNexus staged inspection covered all 15 files (critical expected shared geometry change cone).


## Corrective — unified frame and flexible cable zone

The visible outer border is painted above the three surfaces without shifting panel coordinates;
identity typography is 9 px and the identity column stays 72 px.
Composition width is explicit in runtime node data (`compositionDisplayWidth`), independent of
React Flow frame width. Endpoint/foreground and L1 geometry use that composition width.
Additional frame width belongs entirely to the cable reserve; its minimum remains 20 px.
Manual resize changes composition width by the requested width delta.

Automatic layout allocates the final Location inner width to its sole visible Blueprint-backed
object after sibling Location widths are equalized. Multiple direct objects do not stretch.
The resulting frame width is variant-derived only: no storage model, migration, saved display_width
or route write is introduced. Manual layout retains the minimum cable zone.

Corrective validation: targeted geometry/layout/interaction tests, SavedMap and variant backend
checks, TypeScript/Vite and diff whitespace checks. Browser verification was attempted against the
existing Opera NetMap window, but Computer Use stopped because it could not confidently determine
the browser URL. Live visual PP1/SW1 acceptance remains unverified.

Corrective results: 154/154 frontend targeted checks plus 50/50 canvas/continuation/DeviceNode
checks (DeviceNode checks repeated), 25/25 backend geometry/SavedMap/variant checks.
TypeScript/Vite build and git diff --check passed. No backend implementation changed in the corrective.
