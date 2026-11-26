import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { vi } from "vitest";
import type { PhysicalObjectL1TraceArtifact } from "../topology/physicalObjectL1TraceTypes";
import { MemoryRouter } from "react-router-dom";

export function createMapPageHarness<Page extends ComponentType<any>>(Page: Page) {
  const renderPage = (
    props: ComponentProps<Page>,
    initialEntry: string,
    afterPage?: ReactNode,
  ) => render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Page {...props} />
      {afterPage}
    </MemoryRouter>,
  );

  return renderPage;
}


export function objectTraceFixture(source: string, target: string) {
  const artifact: PhysicalObjectL1TraceArtifact = {
    schema_version: 1, verdict: "REACHABLE",
    query: { from_physical_object_id: source, to_physical_object_id: target },
    source_candidates: [], target_candidates: [], nodes: [], edges: [], evidence_refs: [], cycles: [], gaps: [], warnings: [],
    branches: [{
      branch_id: "path", edge_ids: [], evidence_refs: [{ entity_type: "PhysicalObject", entity_id: source }],
      source: { point_id: "source", member_index: 1 }, target: { point_id: "target", member_index: 1 },
    }],
  };
  const trace = vi.fn().mockResolvedValue(artifact);
  const inventory = {
    schema_version: "1.0" as const,
    equipment: [source, target].map(id => ({
      physical_object_ref: { ref_type: "CANONICAL_FACT", entity_type: "PhysicalObject", entity_id: id },
      label: id, map_memberships: [],
    })),
    cables: [], gaps: [], warnings: [],
  };
  return {
    artifact, trace, inventory,
    traceDataSource: { tracePhysicalObjectsL1: trace },
    catalogInventoryDataSource: { loadCatalogInventory: vi.fn().mockResolvedValue(inventory) },
    async submit() {
      fireEvent.click(screen.getByRole("button", { name: "Трассировка" }));
      const panel = within(screen.getByRole("region", { name: "Трассировка сети L1" }));
      const from = panel.getByLabelText("Откуда");
      await within(from).findByRole("option", { name: source });
      fireEvent.change(from, { target: { value: source } });
      fireEvent.change(panel.getByLabelText("Куда"), { target: { value: target } });
      fireEvent.click(panel.getByRole("button", { name: "Трассировать" }));
    },
  };
}
