import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
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
import { SignupPage } from "./SignupPage";

vi.mock("../pokemon/FeaturedPokemonArtwork", () => ({
  FeaturedPokemonArtwork: () => (
    <span data-testid="featured-pokemon-artwork" />
  ),
}));

describe("SignupPage", () => {
  it("should_createAccountAndOpenLogin_when_formIsValid", async () => {
    const signup = vi.fn().mockResolvedValue(TEST_CURRENT_USER.user);
    const router = renderSignup(createAuthContextValue({ signup }));

    fillSignupForm();
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    await waitFor(() => {
      expect(signup).toHaveBeenCalledWith({
        loginId: "trainer_red",
        nickname: "레드",
        password: "valid-password-123",
      });
    });
    expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.state).toEqual({
      loginId: "trainer_red",
      signupComplete: true,
    });
  });

  it("should_showValidationErrors_when_formValuesAreInvalid", () => {
    const signup = vi.fn();
    renderSignup(createAuthContextValue({ signup }));

    fireEvent.change(screen.getByLabelText("아이디"), {
      target: { value: "red-trainer" },
    });
    fireEvent.change(screen.getByLabelText("닉네임"), {
      target: { value: "<레드>" },
    });
    fireEvent.change(screen.getByLabelText("비밀번호"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("비밀번호 확인"), {
      target: { value: "different" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    expect(
      screen.getByText("아이디에 사용할 수 없는 문자가 있어요."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("닉네임에 사용할 수 없는 문자가 포함되어 있어요."),
    ).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });

  it("should_keepFriendlyPlaceholders_when_renderingSignupForm", () => {
    renderSignup(createAuthContextValue());

    expect(screen.getByPlaceholderText("예: chiho")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("비밀번호를 입력해 주세요"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("비밀번호를 한 번 더 입력해 주세요"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("예: 포켓몬박사"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/UTF-8|byte|밑줄/i),
    ).not.toBeInTheDocument();
  });

  it("should_attachErrorToLoginId_when_idAlreadyExists", async () => {
    const signup = vi.fn().mockRejectedValue(
      new ApiError({
        code: "LOGIN_ID_ALREADY_EXISTS",
        detail: "이미 사용 중인 로그인 ID입니다.",
        status: 409,
        title: "회원가입 실패",
      }),
    );
    renderSignup(createAuthContextValue({ signup }));

    fillSignupForm();
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    expect(
      await screen.findByText("이미 사용 중인 로그인 ID입니다."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("아이디")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("should_showServerAlert_when_signupIsRateLimited", async () => {
    const signup = vi.fn().mockRejectedValue(
      new ApiError({
        code: "SIGNUP_RATE_LIMITED",
        detail:
          "회원가입 요청이 너무 많습니다. " +
          "잠시 뒤 다시 시도해 주세요.",
        retryAfterSeconds: 600,
        status: 429,
        title: "회원가입 요청 제한",
      }),
    );
    renderSignup(createAuthContextValue({ signup }));

    fillSignupForm();
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "회원가입 요청이 너무 많습니다.",
    );
  });
});

const signupRoutes: RouteObject[] = [
  {
    Component: SignupPage,
    path: "/signup",
  },
  {
    element: <p>로그인 화면</p>,
    path: "/login",
  },
];

function renderSignup(
  value: AuthContextValue,
): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(signupRoutes, {
    initialEntries: ["/signup"],
  });
  render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

function fillSignupForm(): void {
  fireEvent.change(screen.getByLabelText("아이디"), {
    target: { value: "  Trainer_RED  " },
  });
  fireEvent.change(screen.getByLabelText("닉네임"), {
    target: { value: " 레드 " },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "valid-password-123" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), {
    target: { value: "valid-password-123" },
  });
}
