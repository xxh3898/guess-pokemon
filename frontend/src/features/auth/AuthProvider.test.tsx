import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../shared/api/HttpClient";
import { useAuth } from "./AuthContext";
import { AuthProvider } from "./AuthProvider";
import type { AuthGateway, CurrentUser } from "./authApi";

const CURRENT_USER: CurrentUser = {
  activeRoomCode: null,
  user: {
    id: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
    loginId: "trainer_red",
    nickname: "레드",
  },
};

describe("AuthProvider", () => {
  it("should_restoreAuthenticatedUser_when_sessionIsValid", async () => {
    const gateway = createGateway({
      currentUser: vi.fn().mockResolvedValue(CURRENT_USER),
    });

    renderHarness(gateway);

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "authenticated",
    );
    expect(screen.getByTestId("nickname")).toHaveTextContent("레드");
  });

  it("should_restoreAnonymousState_when_sessionIsMissing", async () => {
    const gateway = createGateway({
      currentUser: vi.fn().mockRejectedValue(authenticationRequired()),
    });

    renderHarness(gateway);

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "anonymous",
    );
  });

  it("should_retrySessionRestore_when_initialRequestFails", async () => {
    const currentUser = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(CURRENT_USER);
    const gateway = createGateway({ currentUser });

    renderHarness(gateway);

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "error",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "authenticated",
    );
    expect(currentUser).toHaveBeenCalledTimes(2);
  });

  it("should_refreshCurrentUser_when_loginSucceeds", async () => {
    const currentUser = vi
      .fn()
      .mockRejectedValueOnce(authenticationRequired())
      .mockResolvedValueOnce({
        ...CURRENT_USER,
        activeRoomCode: "AB3K7M",
      });
    const login = vi.fn().mockResolvedValue(CURRENT_USER.user);
    const gateway = createGateway({ currentUser, login });

    renderHarness(gateway);
    await screen.findByText("anonymous");
    fireEvent.click(screen.getByRole("button", { name: "테스트 로그인" }));

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "authenticated",
    );
    expect(screen.getByTestId("room-code")).toHaveTextContent("AB3K7M");
    expect(login).toHaveBeenCalledOnce();
  });

  it("should_clearUser_when_sessionExpirationIsReported", async () => {
    const expirationListener: { current?: () => void } = {};
    const gateway = createGateway({
      currentUser: vi.fn().mockResolvedValue(CURRENT_USER),
      subscribeSessionExpired: vi.fn((listener: () => void) => {
        expirationListener.current = listener;
        return vi.fn();
      }),
    });

    renderHarness(gateway);
    await screen.findByText("authenticated");
    act(() => {
      expirationListener.current?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "anonymous",
      );
    });
    expect(gateway.clearSessionSecurity).toHaveBeenCalledOnce();
  });

  it("should_clearUserAndSecurityState_when_logoutSucceeds", async () => {
    const gateway = createGateway({
      currentUser: vi.fn().mockResolvedValue(CURRENT_USER),
    });

    renderHarness(gateway);
    await screen.findByText("authenticated");
    fireEvent.click(screen.getByRole("button", { name: "테스트 로그아웃" }));

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "anonymous",
    );
    expect(gateway.logout).toHaveBeenCalledOnce();
    expect(gateway.clearSessionSecurity).toHaveBeenCalledOnce();
  });

  it("should_updateActiveRoomLocally_when_roomMembershipChanges", async () => {
    const gateway = createGateway({
      currentUser: vi.fn().mockResolvedValue(CURRENT_USER),
    });

    renderHarness(gateway);
    await screen.findByText("authenticated");
    fireEvent.click(
      screen.getByRole("button", { name: "활성 방 설정" }),
    );

    expect(screen.getByTestId("room-code")).toHaveTextContent(
      "AB3K7M",
    );
    expect(gateway.currentUser).toHaveBeenCalledOnce();
  });
});

function renderHarness(gateway: AuthGateway): void {
  render(
    <AuthProvider gateway={gateway}>
      <Harness />
    </AuthProvider>,
  );
}

function Harness() {
  const auth = useAuth();
  return (
    <div>
      <p data-testid="auth-status">{auth.status}</p>
      <p data-testid="nickname">{auth.currentUser?.user.nickname ?? ""}</p>
      <p data-testid="room-code">
        {auth.currentUser?.activeRoomCode ?? ""}
      </p>
      <button
        onClick={() => {
          void auth.login({
            loginId: "trainer_red",
            password: "password",
          });
        }}
        type="button"
      >
        테스트 로그인
      </button>
      <button
        onClick={() => {
          void auth.logout();
        }}
        type="button"
      >
        테스트 로그아웃
      </button>
      <button
        onClick={() => {
          void auth.restoreSession();
        }}
        type="button"
      >
        다시 확인
      </button>
      <button
        onClick={() => {
          auth.setActiveRoomCode("AB3K7M");
        }}
        type="button"
      >
        활성 방 설정
      </button>
    </div>
  );
}

function createGateway(
  overrides: Partial<AuthGateway> = {},
): AuthGateway {
  const defaults: AuthGateway = {
    clearSessionSecurity: vi.fn(),
    currentUser: vi.fn().mockResolvedValue(CURRENT_USER),
    login: vi.fn().mockResolvedValue(CURRENT_USER.user),
    logout: vi.fn().mockResolvedValue(undefined),
    signup: vi.fn().mockResolvedValue(CURRENT_USER.user),
    subscribeSessionExpired: vi.fn(() => vi.fn()),
  };
  return { ...defaults, ...overrides };
}

function authenticationRequired(): ApiError {
  return new ApiError({
    code: "AUTHENTICATION_REQUIRED",
    detail: "로그인이 필요합니다.",
    status: 401,
    title: "로그인 필요",
  });
}

function networkError(): ApiError {
  return new ApiError({
    code: "NETWORK_ERROR",
    detail: "네트워크 상태를 확인해 주세요.",
    status: 0,
    title: "연결 실패",
  });
}
