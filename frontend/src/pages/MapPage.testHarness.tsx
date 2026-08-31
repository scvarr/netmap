import { render } from "@testing-library/react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
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
