# PORT-UX-01 — Compact ports

Implementation on the milestone branch; external inspection and visual acceptance remain required.

- Runtime Blueprint markers: 6 flow units including a 0.5-unit border; square NETWORK_PORT and circular CONNECTION_POINT. Foreground SVG uses a 5.5-unit path plus a centred 0.5-unit stroke, matching the HTML border box. Runtime PortType supplies the fill in both layers.
- Hit squares are 8 units. Minimum centre separation is 10 units on at least one axis, leaving a 2-unit gap between adjacent hit squares. Highlight rings extend at most 1 unit from the marker. No editor controls are copied.
- Minimum width is the maximum of 32, each panel's 12-unit minimum height converted to composition width, and 10 * composition width / max(abs(dx), abs(dy)) for every pair of pinned panel-local port centres. There is no 240-unit cap. Coincident centres or a minimum above the supported 960-unit width produce an explicit geometry error.
- Read-time dimensions, nameplate, rendered footprint, Location packing inputs and cable endpoints use the effective minimum. Existing SavedMap display_width is not rewritten on load. Resize and explicit size writes use the same policy. Zoom does not participate in geometry or persistence.
- Panel borders paint inward without displacing port centres. Body hover outlines the card without moving it; port hover/focus highlights that port and shows its local name. Port-only cable cursor; click, keyboard and context actions remain on the original port element. Hover does not invoke callbacks or writes.
- Nameplate, canonical topology, published revisions, route waypoints, boundary anchors and automatic layout algorithm are unchanged. No Front/Rear, new equipment format or C-UX-10 Channels implementation is claimed.

Validation is targeted frontend testing and TypeScript/Vite build in Docker. Actual PP1/SW1 visual acceptance, zoom and variant interaction in a browser remain pending external inspection. Synthetic 48-port two-row circle/square fixtures verify the minimum, small saved widths and no mutation; existing cable interaction, PortType, trace, bulk wiring, SavedMap and Location tests cover affected behaviour.

Baseline debt: the ApiSavedMapDataSource acknowledgement case in MapPage.wiring.test.tsx fails to load its map on the base commit as well. The obsolete panel-less FloatingTopologyEdge fixtures and nameplate-less layout expectations encountered in the target cone were corrected to the current presentation contract.

Results: 164 targeted tests pass across the selected ten files (including the final component rerun after fixture correction). TypeScript/Vite build and git diff --check pass. Vite reports its existing large-chunk warning. GitNexus detect_changes completed for this worktree, reporting high risk across the known size/cable dependency cone. No backend contract changed; no backend suite was run.
