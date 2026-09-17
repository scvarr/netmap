import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Breadcrumbs, PageHeader, PageShell } from "./PageChrome";

describe("PageChrome", () => {
  it("keeps title, description, notice and actions in the shared header structure", () => {
    render(
      <PageShell>
        <PageHeader
          eyebrow="Library"
          title="Title"
          description="Description"
          notice="Notice"
          actions={<button type="button">Create</button>}
        />
      </PageShell>,
    );
    const header = document.querySelector(".page-header")!;
    expect(header.querySelector(".page-header__text")).toContainElement(
      screen.getByRole("heading", { name: "Title" }),
    );
    expect(header.querySelector(".page-header__text")).toHaveTextContent(
      "Description",
    );
    expect(header.querySelector(".page-header__text")).toHaveTextContent(
      "Notice",
    );
    expect(header.querySelector(".page-header__actions")).toContainElement(
      screen.getByRole("button", { name: "Create" }),
    );
  });

  it("renders a useful parent link and a non-link current leaf without duplicate URLs", () => {
    render(
      <MemoryRouter>
        <Breadcrumbs
          label="Path"
          items={[
            { label: "Objects", to: "/infrastructure/objects" },
            { label: "Create object" },
          ]}
        />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/infrastructure/objects");
    expect(screen.getByText("Create object")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not mark an intermediate non-link section label as the current page", () => {
    render(<MemoryRouter><Breadcrumbs label="Path" items={[{ label: "Infrastructure" }, { label: "Objects", to: "/infrastructure/objects" }, { label: "Create object" }]} /></MemoryRouter>);
    expect(screen.getByText("Infrastructure")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Create object")).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
