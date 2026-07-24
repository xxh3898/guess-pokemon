import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { routes } from "./routes";

describe("application routes", () => {
  it("should_renderLandingPage_when_openingRootRoute", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/"],
    });

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Guess Pokémon",
      }),
    ).toBeInTheDocument();
  });

  it("should_renderNotFoundPage_when_openingUnknownRoute", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/unknown"],
    });

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "페이지를 찾을 수 없어요",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "처음으로 돌아가기",
      }),
    ).toHaveAttribute("href", "/");
  });
});
