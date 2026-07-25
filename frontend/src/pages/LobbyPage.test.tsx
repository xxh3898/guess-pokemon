import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
} from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";

import {
  AuthContext,
  type AuthContextValue,
} from "../features/auth/AuthContext";
import { ApiError } from "../shared/api/HttpClient";
import {
  createAuthContextValue,
  TEST_CURRENT_USER,
} from "../test/authTestUtils";
import { LobbyPage } from "./LobbyPage";

describe("LobbyPage", () => {
  it("should_showCurrentUserAndActiveRoom_when_sessionIsAuthenticated", async () => {
    renderLobby(
      createAuthContextValue({
        currentUser: {
          ...TEST_CURRENT_USER,
          activeRoomCode: "AB3K7M",
        },
        status: "authenticated",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "대전 준비",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "AB3K7M" }),
    ).toHaveClass("room-code");
    expect(screen.getByText("trainer_red")).toBeInTheDocument();
  });

  it("should_keepFutureRoomActionsDisabled_when_featureIsNotConnected", async () => {
    renderLobby(
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        status: "authenticated",
      }),
    );

    const pendingButtons = await screen.findAllByRole("button", {
      name: "다음 단계에서 연결",
    });
    expect(pendingButtons).toHaveLength(2);
    pendingButtons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it("should_openLogin_when_logoutSucceeds", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const router = renderLobby(
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        logout,
        status: "authenticated",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(logout).toHaveBeenCalledOnce();
  });

  it("should_keepLobbyAndShowError_when_logoutFails", async () => {
    const logout = vi.fn().mockRejectedValue(
      new ApiError({
        code: "INTERNAL_ERROR",
        detail: "잠시 뒤 다시 시도해 주세요.",
        status: 500,
        title: "서버 오류",
      }),
    );
    const router = renderLobby(
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        logout,
        status: "authenticated",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "잠시 뒤 다시 시도해 주세요.",
    );
    expect(router.state.location.pathname).toBe("/lobby");
  });
});

const lobbyRoutes: RouteObject[] = [
  {
    element: <p>처음 화면</p>,
    path: "/",
  },
  {
    element: <p>로그인 화면</p>,
    path: "/login",
  },
  {
    Component: LobbyPage,
    path: "/lobby",
  },
];

function renderLobby(
  value: AuthContextValue,
): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(lobbyRoutes, {
    initialEntries: ["/lobby"],
  });
  render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}
