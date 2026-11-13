# OBJECT-UX-01 — Three-Zone PhysicalObject Frame

PhysicalObject with a published BaseTemplate composition uses one square-corner horizontal frame:
identity (72 flow px), composition, cable management reserve (20 flow px).
The empty right zone is presentation only: no ports, links, or canonical entities are synthesized.
The identity is bounded and ellipsized, with a full hover title; Location is optional and no U or name-derived Location type is required.

`display_width` continues to mean composition width. Full footprint adds 92 px;
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
