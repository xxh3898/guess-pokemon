import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
  type InitialEntry,
  type RouteObject,
} from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../shared/api/HttpClient";
import {
  createAuthContextValue,
  TEST_CURRENT_USER,
} from "../../test/authTestUtils";
import {
  AuthContext,
  type AuthContextValue,
} from "./AuthContext";
import { LoginPage } from "./LoginPage";

vi.mock("../pokemon/FeaturedPokemonArtwork", () => ({
  FeaturedPokemonArtwork: () => (
    <span data-testid="featured-pokemon-artwork" />
  ),
}));

describe("LoginPage", () => {
  it("should_loginWithNormalizedId_when_formIsValid", async () => {
    const login = vi.fn().mockResolvedValue(TEST_CURRENT_USER);
    const router = renderLogin(["/login"], createAuthContextValue({ login }));

    fillLoginForm("  Trainer_RED  ", "valid-password-123");
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        loginId: "trainer_red",
        password: "valid-password-123",
      });
    });
    expect(await screen.findByText("로비 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/lobby");
  });

  it("should_restoreRequestedPathAndReplaceLogin_when_loginSucceeds", async () => {
    const login = vi.fn().mockResolvedValue(TEST_CURRENT_USER);
    const entries: InitialEntry[] = [
      "/",
      {
        pathname: "/login",
        state: { from: "/secret?mode=quick" },
      },
    ];
    const router = renderLogin(
      entries,
      createAuthContextValue({ login }),
      1,
    );

    fillLoginForm("trainer_red", "valid-password-123");
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByText("보호 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/secret");
    expect(router.state.location.search).toBe("?mode=quick");

    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByText("처음 화면")).toBeInTheDocument();
  });

  it("should_showFieldErrors_when_requiredValuesAreMissing", () => {
    const login = vi.fn();
    renderLogin(["/login"], createAuthContextValue({ login }));

    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    expect(screen.getByText("아이디를 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("비밀번호를 입력해 주세요.")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("should_showFriendlyPlaceholders_when_formIsEmpty", () => {
    renderLogin(["/login"], createAuthContextValue());

    expect(
      screen.getByTestId("featured-pokemon-artwork"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("아이디를 입력해 주세요"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("비밀번호를 입력해 주세요"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/UTF-8|byte|밑줄/i),
    ).not.toBeInTheDocument();
  });

  it("should_showSafeServerDetail_when_credentialsAreInvalid", async () => {
    const login = vi.fn().mockRejectedValue(
      new ApiError({
        code: "INVALID_CREDENTIALS",
        detail: "로그인 ID 또는 비밀번호가 올바르지 않습니다.",
        status: 401,
        title: "로그인 실패",
      }),
    );
    renderLogin(["/login"], createAuthContextValue({ login }));

    fillLoginForm("trainer_red", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("로그인 ID 또는 비밀번호가 올바르지 않습니다.");
  });

  it("should_prefillLoginId_when_signupHasCompleted", async () => {
    renderLogin(
      [
        {
          pathname: "/login",
          state: {
            loginId: "trainer_red",
            signupComplete: true,
          },
        },
      ],
      createAuthContextValue(),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "회원가입을 마쳤습니다.",
    );
    expect(screen.getByLabelText("아이디")).toHaveValue("trainer_red");
  });
});

const loginRoutes: RouteObject[] = [
  {
    element: <p>처음 화면</p>,
    path: "/",
  },
  {
    Component: LoginPage,
    path: "/login",
  },
  {
    element: <p>로비 화면</p>,
    path: "/lobby",
  },
  {
    element: <p>보호 화면</p>,
    path: "/secret",
  },
];

function renderLogin(
  initialEntries: InitialEntry[],
  value: AuthContextValue,
  initialIndex?: number,
): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(loginRoutes, {
    initialEntries,
    initialIndex,
  });
  render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

function fillLoginForm(loginId: string, password: string): void {
  fireEvent.change(screen.getByLabelText("아이디"), {
    target: { value: loginId },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: password },
  });
}
