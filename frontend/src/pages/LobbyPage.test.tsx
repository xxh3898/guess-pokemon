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

import {
  AuthContext,
  type AuthContextValue,
} from "../features/auth/AuthContext";
import type { RoomGateway } from "../features/room/roomApi";
import type { WaitingRoomSnapshot } from "../features/room/roomTypes";
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
    expect(
      screen.getByRole("link", { name: "이어서 하기" }),
    ).toHaveAttribute("href", "/rooms/AB3K7M");
    expect(screen.getByText("trainer_red")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "경기 기록" }),
    ).toHaveAttribute("href", "/history");
  });

  it("should_openWaitingRoom_when_roomCreationSucceeds", async () => {
    const setActiveRoomCode = vi.fn();
    const gateway = createRoomGateway();
    const router = renderLobby(
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "방 만들기" }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/rooms/AB3K7M");
    });
    expect(gateway.create).toHaveBeenCalledOnce();
    expect(setActiveRoomCode).toHaveBeenCalledWith("AB3K7M");
  });

  it("should_normalizeAndJoinRoom_when_codeIsValid", async () => {
    const setActiveRoomCode = vi.fn();
    const gateway = createRoomGateway({
      join: vi.fn().mockResolvedValue(GUEST_SNAPSHOT),
    });
    const router = renderLobby(
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway,
    );

    fireEvent.change(await screen.findByLabelText("방 코드"), {
      target: { value: "ab3k7m" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "입력한 방 코드로 입장하기",
      }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/rooms/AB3K7M");
    });
    expect(gateway.join).toHaveBeenCalledWith("AB3K7M");
    expect(setActiveRoomCode).toHaveBeenCalledWith("AB3K7M");
  });

  it("should_showFriendlyValidation_when_roomCodeIsInvalid", async () => {
    const gateway = createRoomGateway();
    renderLobby(
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        status: "authenticated",
      }),
      gateway,
    );

    fireEvent.change(await screen.findByLabelText("방 코드"), {
      target: { value: "AB12" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "입력한 방 코드로 입장하기",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "친구에게 받은 방 코드 6자리를 입력해 주세요.",
    );
    expect(gateway.join).not.toHaveBeenCalled();
  });

  it("should_showServerDetail_when_roomJoinFails", async () => {
    const gateway = createRoomGateway({
      join: vi.fn().mockRejectedValue(
        new ApiError({
          code: "ROOM_NOT_FOUND",
          detail: "방을 찾을 수 없습니다.",
          status: 404,
          title: "방 없음",
        }),
      ),
    });
    renderLobby(
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        status: "authenticated",
      }),
      gateway,
    );

    fireEvent.change(await screen.findByLabelText("방 코드"), {
      target: { value: "AB3K7M" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "입력한 방 코드로 입장하기",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "방을 찾을 수 없습니다.",
    );
  });

  it("should_disableRoomActions_when_activeRoomExists", async () => {
    renderLobby(
      createAuthContextValue({
        currentUser: {
          ...TEST_CURRENT_USER,
          activeRoomCode: "AB3K7M",
        },
        status: "authenticated",
      }),
      createRoomGateway(),
    );

    expect(
      await screen.findByRole("button", { name: "방 만들기" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "입력한 방 코드로 입장하기",
      }),
    ).toBeDisabled();
  });

  it("should_openWaitingRoom_when_joinableRoomIsSelected", async () => {
    const setActiveRoomCode = vi.fn();
    const gateway = createRoomGateway({
      join: vi.fn().mockResolvedValue({
        ...GUEST_SNAPSHOT,
        roomCode: "ABCD23",
      }),
      list: vi.fn().mockResolvedValue({
        rooms: [
          {
            hostNickname: "블루",
            roomCode: "ABCD23",
          },
        ],
      }),
    });
    const router = renderLobby(
      createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "블루님의 방 ABCD23 입장하기",
      }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/rooms/ABCD23");
    });
    expect(gateway.join).toHaveBeenCalledWith(
      "ABCD23",
      expect.anything(),
    );
    expect(setActiveRoomCode).toHaveBeenCalledWith("ABCD23");
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

function renderLobby(
  value: AuthContextValue,
  gateway: RoomGateway = createRoomGateway(),
): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(createLobbyRoutes(gateway), {
    initialEntries: ["/lobby"],
  });
  render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

function createLobbyRoutes(gateway: RoomGateway): RouteObject[] {
  return [
    {
      element: <p>처음 화면</p>,
      path: "/",
    },
    {
      element: <p>로그인 화면</p>,
      path: "/login",
    },
    {
      element: <LobbyPage gateway={gateway} />,
      path: "/lobby",
    },
    {
      element: <p>대기방 화면</p>,
      path: "/rooms/:roomCode",
    },
  ];
}

function createRoomGateway(
  overrides: Partial<RoomGateway> = {},
): RoomGateway {
  return {
    create: vi.fn().mockResolvedValue(HOST_SNAPSHOT),
    get: vi.fn().mockResolvedValue(HOST_SNAPSHOT),
    join: vi.fn().mockResolvedValue(GUEST_SNAPSHOT),
    leave: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ rooms: [] }),
    ...overrides,
  };
}

const HOST_SNAPSHOT: WaitingRoomSnapshot = {
  game: null,
  me: {
    connected: true,
    nickname: "레드",
    reconnectDeadline: null,
    role: null,
    userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
  },
  opponent: null,
  roleAssignment: null,
  roleSelection: null,
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 1,
  status: "WAITING_FOR_OPPONENT",
};

const GUEST_SNAPSHOT: WaitingRoomSnapshot = {
  ...HOST_SNAPSHOT,
  me: {
    connected: true,
    nickname: "그린",
    reconnectDeadline: null,
    role: null,
    userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
  },
  opponent: HOST_SNAPSHOT.me,
  roleAssignment: null,
  roleSelection: {
    opponentSelected: false,
    preferredRole: null,
  },
  stateVersion: 2,
  status: "WAITING_FOR_ROLE_SELECTION",
};
