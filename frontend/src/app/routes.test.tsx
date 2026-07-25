import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import {
  AuthContext,
  type AuthContextValue,
} from "../features/auth/AuthContext";
import {
  createAuthContextValue,
  TEST_CURRENT_USER,
} from "../test/authTestUtils";
import { routes } from "./routes";

describe("application routes", () => {
  it("should_renderLandingPage_when_openingRootRoute", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/"],
    });

    renderRouter(router, createAuthContextValue());

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "질문으로 찾아내는 포켓몬",
      }),
    ).toBeInTheDocument();
  });

  it("should_renderNotFoundPage_when_openingUnknownRoute", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/unknown"],
    });

    renderRouter(router, createAuthContextValue());

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "페이지를 찾을 수 없어요",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "처음 화면으로",
      }),
    ).toHaveAttribute("href", "/");
  });

  it("should_redirectToLogin_when_anonymousUserOpensLobbyDirectly", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/lobby"],
    });

    renderRouter(router, createAuthContextValue());

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "로그인",
      }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.state).toEqual({ from: "/lobby" });
  });

  it("should_redirectToLobby_when_authenticatedUserOpensSignup", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/signup"],
    });

    renderRouter(
      router,
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        status: "authenticated",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "대전 준비",
      }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/lobby");
  });

  it("should_linkToLobby_when_authenticatedUserOpensLandingPage", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/"],
    });

    renderRouter(
      router,
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        status: "authenticated",
      }),
    );

    expect(
      await screen.findByRole("link", { name: "대전 로비로" }),
    ).toHaveAttribute("href", "/lobby");
  });
});

function renderRouter(
  router: ReturnType<typeof createMemoryRouter>,
  value: AuthContextValue,
): void {
  render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
}
