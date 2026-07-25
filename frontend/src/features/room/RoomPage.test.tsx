import {
  act,
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
} from "../auth/AuthContext";
import { ApiError } from "../../shared/api/HttpClient";
import type {
  RealtimeConnectionStatus,
  RoomRealtimeGateway,
  RoomRealtimeHandlers,
  RoomRealtimeSession,
} from "../../shared/realtime/RoomRealtimeGateway";
import type { WaitingRoomEvent } from "../../shared/realtime/realtimeTypes";
import {
  createAuthContextValue,
  TEST_CURRENT_USER,
} from "../../test/authTestUtils";
import type { RoomGateway } from "./roomApi";
import { RoomPage } from "./RoomPage";
import type { WaitingRoomSnapshot } from "./roomTypes";

describe("RoomPage", () => {
  it("should_loadSnapshotAndOpenRealtime_when_directRoomRouteOpens", async () => {
    const setActiveRoomCode = vi.fn();
    const gateway = createRoomGateway();
    const realtime = createRealtimeHarness();

    renderRoom({
      auth: createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway,
      realtimeGateway: realtime.gateway,
    });

    expect(
      await screen.findByRole("heading", {
        name: "상대를 기다리는 중",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("레드")).toBeInTheDocument();
    expect(gateway.get).toHaveBeenCalledWith(
      "AB3K7M",
      expect.any(AbortSignal),
    );
    expect(realtime.gateway.open).toHaveBeenCalledWith(
      "AB3K7M",
      expect.any(Object),
    );
    expect(setActiveRoomCode).toHaveBeenCalledWith("AB3K7M");
  });

  it("should_applySameVersionSnapshot_when_playerJoinedNoticeArrivesFirst", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway(),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "상대를 기다리는 중",
    });

    act(() => {
      realtime.event({
        ...baseEvent(2),
        eventType: "PLAYER_JOINED",
        payload: {
          player: {
            nickname: "그린",
            userId: GUEST_MEMBER.userId,
          },
        },
      });
      realtime.event({
        ...baseEvent(2),
        eventType: "ROOM_SNAPSHOT",
        payload: TWO_PLAYER_SNAPSHOT,
      });
    });

    expect(
      await screen.findByRole("heading", {
        name: "정답 선택을 준비하고 있어요",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("그린")).toBeInTheDocument();
    expect(screen.queryByText("피카츄")).not.toBeInTheDocument();
  });

  it("should_showDisconnectedOpponent_when_connectionEventArrives", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(TWO_PLAYER_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("그린");

    act(() => {
      realtime.event({
        ...baseEvent(3),
        eventType: "PLAYER_CONNECTION_CHANGED",
        payload: {
          connected: false,
          reconnectDeadline: null,
          userId: GUEST_MEMBER.userId,
        },
      });
    });

    expect(await screen.findByText("연결 끊김")).toBeInTheDocument();
  });

  it("should_announceDeparture_when_guestLeavesWaitingRoom", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(TWO_PLAYER_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("그린");

    act(() => {
      realtime.event({
        ...baseEvent(3),
        eventType: "ROOM_SNAPSHOT",
        payload: {
          ...HOST_SNAPSHOT,
          stateVersion: 3,
        },
      });
    });

    expect(
      await screen.findByText("그린님이 방을 나갔어요."),
    ).toBeInTheDocument();
  });

  it("should_clearActiveRoomAndShowClosedState_when_hostLeaves", async () => {
    const setActiveRoomCode = vi.fn();
    const realtime = createRealtimeHarness();
    renderRoom({
      auth: createAuthContextValue({
        currentUser: {
          ...TEST_CURRENT_USER,
          activeRoomCode: "AB3K7M",
        },
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(TWO_PLAYER_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("그린");

    act(() => {
      realtime.event({
        ...baseEvent(2),
        eventType: "ROOM_CLOSED",
        payload: {
          leftUserId: HOST_MEMBER.userId,
          reason: "HOST_LEFT",
        },
      });
    });

    expect(
      await screen.findByRole("heading", {
        name: "방이 종료됐어요",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("방장이 방을 나가 대기방을 종료했어요."),
    ).toBeInTheDocument();
    expect(setActiveRoomCode).toHaveBeenCalledWith(null);
  });

  it("should_ignoreLateSnapshot_when_roomClosedEventArrivesFirst", async () => {
    let resolveSnapshot:
      | ((snapshot: WaitingRoomSnapshot) => void)
      | undefined;
    const get = vi.fn().mockReturnValue(
      new Promise<WaitingRoomSnapshot>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const setActiveRoomCode = vi.fn();
    const realtime = createRealtimeHarness();
    renderRoom({
      auth: createAuthContextValue({
        currentUser: {
          ...TEST_CURRENT_USER,
          activeRoomCode: "AB3K7M",
        },
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway: createRoomGateway({ get }),
      realtimeGateway: realtime.gateway,
    });

    act(() => {
      realtime.event({
        ...baseEvent(2),
        eventType: "ROOM_CLOSED",
        payload: {
          leftUserId: HOST_MEMBER.userId,
          reason: "HOST_LEFT",
        },
      });
    });
    expect(
      await screen.findByRole("heading", {
        name: "방이 종료됐어요",
      }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveSnapshot?.(TWO_PLAYER_SNAPSHOT);
      await Promise.resolve();
    });

    expect(setActiveRoomCode).toHaveBeenCalledWith(null);
    expect(setActiveRoomCode).not.toHaveBeenCalledWith("AB3K7M");
  });

  it("should_copyRoomCodeAndAnnounceSuccess_when_copyIsAllowed", async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    renderRoom({
      writeClipboard,
    });
    await screen.findByRole("heading", {
      name: "상대를 기다리는 중",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "방 코드 복사" }),
    );

    expect(await screen.findByText("방 코드를 복사했어요.")).toBeInTheDocument();
    expect(writeClipboard).toHaveBeenCalledWith("AB3K7M");
  });

  it("should_clearActiveRoomAndOpenLobby_when_leaveSucceeds", async () => {
    const setActiveRoomCode = vi.fn();
    const gateway = createRoomGateway();
    const { router } = renderRoom({
      auth: createAuthContextValue({
        currentUser: {
          ...TEST_CURRENT_USER,
          activeRoomCode: "AB3K7M",
        },
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway,
    });
    await screen.findByRole("heading", {
      name: "상대를 기다리는 중",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "방 나가기" }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/lobby");
    });
    expect(gateway.leave).toHaveBeenCalledWith("AB3K7M");
    expect(setActiveRoomCode).toHaveBeenCalledWith(null);
  });

  it("should_showSafeErrorAndRetry_when_snapshotRequestFails", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({
          code: "ROOM_NOT_FOUND",
          detail: "방을 찾을 수 없습니다.",
          status: 404,
          title: "방 없음",
        }),
      )
      .mockResolvedValueOnce(HOST_SNAPSHOT);
    renderRoom({
      gateway: createRoomGateway({ get }),
    });

    expect(
      await screen.findByRole("heading", {
        name: "대기방을 불러오지 못했어요",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("방을 찾을 수 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(
      await screen.findByRole("heading", {
        name: "상대를 기다리는 중",
      }),
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("should_skipRoomRequests_when_routeCodeIsInvalid", async () => {
    const gateway = createRoomGateway();
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway,
      initialEntry: "/rooms/ABC101",
      realtimeGateway: realtime.gateway,
    });

    expect(
      await screen.findByRole("heading", {
        name: "방 코드를 확인해 주세요",
      }),
    ).toBeInTheDocument();
    expect(gateway.get).not.toHaveBeenCalled();
    expect(realtime.gateway.open).not.toHaveBeenCalled();
  });

  it("should_closeRealtimeSession_when_roomPageUnmounts", async () => {
    const realtime = createRealtimeHarness();
    const { unmount } = renderRoom({
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "상대를 기다리는 중",
    });

    unmount();

    expect(realtime.close).toHaveBeenCalledOnce();
  });
});

interface RenderRoomOptions {
  auth?: AuthContextValue;
  gateway?: RoomGateway;
  initialEntry?: string;
  realtimeGateway?: RoomRealtimeGateway;
  writeClipboard?: (value: string) => Promise<void>;
}

function renderRoom({
  auth = createAuthContextValue({
    currentUser: TEST_CURRENT_USER,
    status: "authenticated",
  }),
  gateway = createRoomGateway(),
  initialEntry = "/rooms/AB3K7M",
  realtimeGateway = createRealtimeHarness().gateway,
  writeClipboard = vi.fn().mockResolvedValue(undefined),
}: RenderRoomOptions = {}) {
  const routes: RouteObject[] = [
    {
      element: (
        <RoomPage
          gateway={gateway}
          realtimeGateway={realtimeGateway}
          writeClipboard={writeClipboard}
        />
      ),
      path: "/rooms/:roomCode",
    },
    {
      element: <p>로비 화면</p>,
      path: "/lobby",
    },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries: [initialEntry],
  });
  const rendered = render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return { ...rendered, router };
}

function createRoomGateway(
  overrides: Partial<RoomGateway> = {},
): RoomGateway {
  return {
    create: vi.fn().mockResolvedValue(HOST_SNAPSHOT),
    get: vi.fn().mockResolvedValue(HOST_SNAPSHOT),
    join: vi.fn().mockResolvedValue(TWO_PLAYER_SNAPSHOT),
    leave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createRealtimeHarness() {
  let handlers: RoomRealtimeHandlers | null = null;
  const close = vi.fn().mockResolvedValue(undefined);
  const session: RoomRealtimeSession = { close };
  const gateway: RoomRealtimeGateway = {
    open: vi.fn((_roomCode, nextHandlers) => {
      handlers = nextHandlers;
      return session;
    }),
  };
  return {
    close,
    event(event: WaitingRoomEvent) {
      handlers?.onEvent(event);
    },
    gateway,
    status(status: RealtimeConnectionStatus) {
      handlers?.onStatusChange(status);
    },
  };
}

const HOST_MEMBER = {
  connected: true,
  nickname: "레드",
  reconnectDeadline: null,
  role: "SELECTOR" as const,
  userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
};

const GUEST_MEMBER = {
  connected: true,
  nickname: "그린",
  reconnectDeadline: null,
  role: "QUESTIONER" as const,
  userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
};

const HOST_SNAPSHOT: WaitingRoomSnapshot = {
  game: null,
  me: HOST_MEMBER,
  opponent: null,
  rematch: null,
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 1,
  status: "WAITING_FOR_OPPONENT",
};

const TWO_PLAYER_SNAPSHOT: WaitingRoomSnapshot = {
  ...HOST_SNAPSHOT,
  opponent: GUEST_MEMBER,
  stateVersion: 2,
  status: "WAITING_FOR_SELECTION",
};

function baseEvent(stateVersion: number) {
  return {
    eventId: "2069dc9a-624f-48f9-8b2c-65e912006224",
    occurredAt: "2026-07-25T03:00:00Z",
    roomCode: "AB3K7M",
    stateVersion,
  };
}
