import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";

import {
  AuthContext,
  type AuthContextValue,
} from "../../features/auth/AuthContext";
import {
  createAuthContextValue,
  TEST_CURRENT_USER,
} from "../../test/authTestUtils";
import { ApiError } from "../api/HttpClient";
import { AuthenticatedSiteHeader } from "./AuthenticatedSiteHeader";

describe("AuthenticatedSiteHeader", () => {
  it("should_showActiveNavigation_when_userIsAuthenticated", async () => {
    renderHeader(authenticatedContext(), "/history", "history");

    expect(
      await screen.findByRole("link", { name: "경기 기록" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("레드")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "로비" }),
    ).toHaveAttribute("href", "/lobby");
  });

  it("should_openAndCloseMobileMenu_when_keyboardIsUsed", async () => {
    renderHeader(authenticatedContext(), "/lobby", "lobby");

    const menuButton = await screen.findByRole("button", {
      name: "메뉴 열기",
    });
    fireEvent.click(menuButton);

    expect(
      screen.getByRole("navigation", { name: "모바일 메뉴" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "메뉴 닫기" }),
    ).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("navigation", { name: "모바일 메뉴" }),
    ).not.toBeInTheDocument();
  });

  it("should_closeMobileMenu_when_currentRouteIsSelected", async () => {
    renderHeader(authenticatedContext(), "/history", "history");
    fireEvent.click(
      await screen.findByRole("button", { name: "메뉴 열기" }),
    );

    fireEvent.click(
      within(
        screen.getByRole("navigation", {
          name: "모바일 메뉴",
        }),
      ).getByRole("link", { name: "경기 기록" }),
    );

    expect(
      screen.queryByRole("navigation", { name: "모바일 메뉴" }),
    ).not.toBeInTheDocument();
  });

  it("should_openLogin_when_logoutSucceeds", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const router = renderHeader(
      authenticatedContext({ logout }),
      "/lobby",
      "lobby",
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "로그아웃" }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(logout).toHaveBeenCalledOnce();
  });

  it("should_showServerDetail_when_logoutFails", async () => {
    const logout = vi.fn().mockRejectedValue(
      new ApiError({
        code: "INTERNAL_ERROR",
        detail: "잠시 뒤 다시 시도해 주세요.",
        status: 500,
        title: "서버 오류",
      }),
    );
    renderHeader(
      authenticatedContext({ logout }),
      "/lobby",
      "lobby",
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "로그아웃" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "잠시 뒤 다시 시도해 주세요.",
    );
  });
});

function authenticatedContext(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return createAuthContextValue({
    currentUser: TEST_CURRENT_USER,
    status: "authenticated",
    ...overrides,
  });
}

function renderHeader(
  value: AuthContextValue,
  initialEntry: string,
  activePage: "history" | "lobby",
): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(
    [
      {
        element: (
          <AuthenticatedSiteHeader activePage={activePage} />
        ),
        path: "*",
      },
    ],
    { initialEntries: [initialEntry] },
  );
  render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}
