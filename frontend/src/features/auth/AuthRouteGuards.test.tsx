import { fireEvent, render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
} from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../shared/api/HttpClient";
import {
  AuthContext,
  type AuthContextValue,
} from "./AuthContext";
import {
  AnonymousOnlyRoute,
  AuthenticatedRoute,
} from "./AuthRouteGuards";

describe("AuthRouteGuards", () => {
  it("should_preserveRequestedUrl_when_anonymousUserOpensProtectedRoute", async () => {
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ["/secret?mode=quick#round"],
    });

    renderRouter(router, contextValue("anonymous"));

    expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.state).toEqual({
      from: "/secret?mode=quick#round",
    });
  });

  it("should_renderProtectedContent_when_userIsAuthenticated", async () => {
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ["/secret"],
    });

    renderRouter(router, contextValue("authenticated"));

    expect(await screen.findByText("보호 화면")).toBeInTheDocument();
  });

  it("should_redirectToLobby_when_authenticatedUserOpensLogin", async () => {
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ["/login"],
    });

    renderRouter(router, contextValue("authenticated"));

    expect(await screen.findByText("로비 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/lobby");
  });

  it("should_restoreRequestedUrl_when_loginStateIsSafe", async () => {
    const router = createMemoryRouter(testRoutes, {
      initialEntries: [
        {
          pathname: "/login",
          state: { from: "/secret?mode=quick#round" },
        },
      ],
    });

    renderRouter(router, contextValue("authenticated"));

    expect(await screen.findByText("보호 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/secret");
    expect(router.state.location.search).toBe("?mode=quick");
    expect(router.state.location.hash).toBe("#round");
  });

  it("should_offerRetry_when_sessionRestoreFails", async () => {
    const restoreSession = vi.fn().mockResolvedValue(undefined);
    const value = {
      ...contextValue("error"),
      error: new ApiError({
        code: "NETWORK_ERROR",
        detail: "연결을 확인해 주세요.",
        status: 0,
        title: "연결 실패",
      }),
      restoreSession,
    };
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ["/secret"],
    });

    renderRouter(router, value);
    fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));

    expect(restoreSession).toHaveBeenCalledOnce();
  });

});

const testRoutes: RouteObject[] = [
  {
    Component: AnonymousOnlyRoute,
    children: [
      {
        element: <p>로그인 화면</p>,
        path: "/login",
      },
    ],
  },
  {
    Component: AuthenticatedRoute,
    children: [
      {
        element: <p>보호 화면</p>,
        path: "/secret",
      },
      {
        element: <p>로비 화면</p>,
        path: "/lobby",
      },
    ],
  },
];

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

function contextValue(
  status: AuthContextValue["status"],
): AuthContextValue {
  return {
    currentUser:
      status === "authenticated"
        ? {
            activeRoomCode: null,
            user: {
              id: "user-id",
              loginId: "trainer_red",
              nickname: "레드",
            },
          }
        : null,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    restoreSession: vi.fn(),
    setActiveRoomCode: vi.fn(),
    signup: vi.fn(),
    status,
  };
}
