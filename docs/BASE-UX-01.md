# BASE-UX-01 — Panel Trim and Editor Zoom

Branch: `feat/base-ux-01-panel-trim-zoom`; base: `e5a4e6db7e1fe2d31087db102a9e1dfa1c4a6b28`.

Panel resize preserves composition-space port centres and placed-bay rectangles by recalculating panel-relative coordinates. All eight drag handles and numeric dimensions use `setPanelRectangle`. Numeric dimensions keep the top-left corner fixed. Panel move explicitly keeps the previous relative geometry. Slot keys, port types, links and bay keys are preserved. Logical module places have no rectangle to transform.

Resize is rejected atomically if an edge crosses a port marker footprint or any part of a placed bay. The editor displays a translated status message. Marker padding is seven fit-view pixels converted to composition units (including selected marker stroke); existing edge clipping is not worsened. Labels and invisible hit targets are not physical port footprints. No content is deleted or automatically repositioned.

Zoom steps are fit (1×), 2×, 4× and 8×. The entire SVG viewport grows within a bounded two-axis scroll area; controls, properties and context menus stay outside the scrolling SVG. Markers and annotations use the fit-view presentation scale. Pointer coordinates use the actual SVG screen rectangle, including its scrolled offset. Panel and bay gesture deltas also account for scrolling during a gesture. Fit resets scroll offsets. Zoom is React view state outside `BlueprintEditorState`; changing zoom alone emits no draft change and saves identical model data. Layout commands continue to use fit-view metrics.

Validation uses targeted frontend tests in Docker: model tests cover 48 ports in two rows, all eight trims, occupied-area rejection, identity, links and publication serialization; canvas tests cover 1×/2×/4×/8× selection, dragging and marquee with scroll offsets; editor tests cover numeric sizing and zoom-independent save/draft notifications. Existing local draft/recovery and publication page tests are included. No backend contract or canonical topology changed.

TypeScript/Vite build passes (existing large-chunk warning). All 202 targeted tests across six files pass in the sequential Docker run. One parallel run timed out in an existing publication revalidation test while the build was running; the sequential rerun passed all six files. GitNexus detect_changes ran against this worktree and reported HIGH risk in the known editor dependency cone; graph discovery was supplemented with direct caller inspection. Real-browser visual inspection and external FINAL branch-diff inspection remain acceptance steps; DOM tests do not establish native scrollbar, F5 or pointer hit-testing behaviour in a browser.


## Corrective — controls and viewport usability

The contextual tools now precede the canvas in a reserved 160px rail, including the empty-selection state, so selecting a port does not move the canvas during a drag. Existing port coordinates/properties, bay properties and multi-selection operations are retained. The tools have independent overflow for unusually large selections; they are outside the SVG scroll surface.

Removed the conflicting fixed height from the SVG viewport. The canvas wrapper owns the available height and its viewport fills it. The zoom stage owns percentage dimensions and a 24px fit-view gutter, scaled together with zoom. The actual SVG rectangle remains the pointer-mapping source. Fit includes the outer panel handles and port annotations without changing model coordinates. Desktop height rules now include LocalBaseTemplateEditor's fieldset wrapper. At widths up to 1100px the workspace uses natural single-column flow with a bounded canvas rather than clipping the old two-column layout.

Validation: the six-file targeted Docker set passed 202 tests; the updated editor file passed 65 tests, including three added 1×/4×/8× coordinate/control cases (205 distinct targeted tests total). Docker TypeScript/Vite production build and diff whitespace checks pass. Browser checks in Chrome covered 1366×900, 1366×768, 1000×800 and 700×900; local draft reload/resume, manual X/Y entry, selected-port properties, Fit handle gutters and native two-axis zoom overflow were observed. Canvas bounds were identical before and after selection. Zoom 4×/8× retained external tools. No model, trim, backend or publication contract changes.

Limitations: browser checks were focused manual smoke checks, not an exhaustive browser matrix for every gesture and bay configuration. Narrow screens retain normal page scrolling to reach the workspace; SVG pan/zoom scrolling remains local. External FINAL diff inspection is still required.
