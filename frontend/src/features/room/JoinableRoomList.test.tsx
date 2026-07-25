import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ApiError } from "../../shared/api/HttpClient";
import { JoinableRoomList } from "./JoinableRoomList";
import type { RoomGateway } from "./roomApi";
import type { JoinableRoomListResponse } from "./joinableRoomTypes";
import type { WaitingRoomSnapshot } from "./roomTypes";

describe("JoinableRoomList", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  it("should_showRooms_when_initialRequestSucceeds", async () => {
    const gateway = createRoomGateway();

    renderRoomList(gateway);

    expect(
      await screen.findByText("레드님의 방"),
    ).toBeInTheDocument();
    expect(screen.getByText("ABCD23")).toBeInTheDocument();
    expect(gateway.list).toHaveBeenCalledOnce();
  });

  it("should_showEmptyState_when_noRoomIsJoinable", async () => {
    renderRoomList(
      createRoomGateway({
        list: vi.fn().mockResolvedValue({ rooms: [] }),
      }),
    );

    expect(
      await screen.findByText("지금은 참가 가능한 방이 없어요."),
    ).toBeInTheDocument();
  });

  it("should_retryRoomList_when_initialRequestFails", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(JOINABLE_ROOMS);
    renderRoomList(createRoomGateway({ list }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("방 목록을 불러오지 못했어요.");

    fireEvent.click(
      screen.getByRole("button", { name: "다시 불러오기" }),
    );

    expect(
      await screen.findByText("레드님의 방"),
    ).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("should_pollEveryFiveSeconds_when_documentIsVisible", async () => {
    vi.useFakeTimers();
    const list = vi.fn().mockResolvedValue(JOINABLE_ROOMS);
    renderRoomList(createRoomGateway({ list }));
    await flushPromises();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledTimes(2);
  });

  it("should_pausePollingAndRefresh_when_visibilityChanges", async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    const list = vi.fn().mockResolvedValue(JOINABLE_ROOMS);
    renderRoomList(createRoomGateway({ list }));
    await flushPromises();

    visibilityState = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(list).toHaveBeenCalledOnce();

    visibilityState = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledTimes(2);
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("should_avoidOverlappingRequests_when_pollRunsDuringRequest", async () => {
    vi.useFakeTimers();
    const pending = deferred<JoinableRoomListResponse>();
    const list = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(JOINABLE_ROOMS);
    renderRoomList(createRoomGateway({ list }));

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(list).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve(JOINABLE_ROOMS);
      await pending.promise;
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledTimes(2);
  });

  it("should_abortRequest_when_componentUnmounts", () => {
    let requestSignal: AbortSignal | undefined;
    const list = vi.fn((signal?: AbortSignal) => {
      requestSignal = signal;
      return new Promise<JoinableRoomListResponse>(() => undefined);
    });
    const { unmount } = renderRoomList(
      createRoomGateway({ list }),
    );

    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });

  it("should_notifyJoinedRoom_when_listJoinSucceeds", async () => {
    const onJoined = vi.fn();
    const onJoiningChange = vi.fn();
    const gateway = createRoomGateway();
    renderRoomList(
      gateway,
      false,
      onJoined,
      onJoiningChange,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "레드님의 방 ABCD23 입장하기",
      }),
    );

    await waitFor(() => {
      expect(onJoined).toHaveBeenCalledWith("ABCD23");
    });
    expect(gateway.join).toHaveBeenCalledWith(
      "ABCD23",
      expect.anything(),
    );
    expect(onJoiningChange).toHaveBeenNthCalledWith(1, true);
    expect(onJoiningChange).toHaveBeenLastCalledWith(false);
  });

  it("should_showRaceErrorAndRefresh_when_anotherUserJoinsFirst", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(JOINABLE_ROOMS)
      .mockResolvedValueOnce({ rooms: [] });
    const gateway = createRoomGateway({
      join: vi.fn().mockRejectedValue(
        new ApiError({
          code: "ROOM_FULL",
          detail: "방 정원이 찼습니다.",
          status: 409,
          title: "방 입장 실패",
        }),
      ),
      list,
    });
    renderRoomList(gateway);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "레드님의 방 ABCD23 입장하기",
      }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("다른 사용자가 먼저 입장했어요.");
    expect(
      screen.getByText("지금은 참가 가능한 방이 없어요."),
    ).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("should_disableJoinButton_when_roomActionIsUnavailable", async () => {
    const gateway = createRoomGateway();
    renderRoomList(gateway, true);

    const joinButton = await screen.findByRole("button", {
      name: "레드님의 방 ABCD23 입장하기",
    });

    expect(joinButton).toBeDisabled();
    fireEvent.click(joinButton);
    expect(gateway.join).not.toHaveBeenCalled();
  });
});

function renderRoomList(
  gateway: RoomGateway,
  disabled = false,
  onJoined = vi.fn(),
  onJoiningChange = vi.fn(),
) {
  return render(
    <JoinableRoomList
      disabled={disabled}
      gateway={gateway}
      onJoined={onJoined}
      onJoiningChange={onJoiningChange}
    />,
  );
}

function createRoomGateway(
  overrides: Partial<RoomGateway> = {},
): RoomGateway {
  return {
    create: vi.fn().mockResolvedValue(JOINED_SNAPSHOT),
    get: vi.fn().mockResolvedValue(JOINED_SNAPSHOT),
    join: vi.fn().mockResolvedValue(JOINED_SNAPSHOT),
    leave: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(JOINABLE_ROOMS),
    ...overrides,
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function deferred<Value>() {
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}

const JOINABLE_ROOMS: JoinableRoomListResponse = {
  rooms: [
    {
      hostNickname: "레드",
      roomCode: "ABCD23",
    },
  ],
};

const JOINED_SNAPSHOT: WaitingRoomSnapshot = {
  game: null,
  me: {
    connected: true,
    nickname: "그린",
    reconnectDeadline: null,
    role: "QUESTIONER",
    userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
  },
  opponent: {
    connected: true,
    nickname: "레드",
    reconnectDeadline: null,
    role: "SELECTOR",
    userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
  },
  rematch: null,
  roomCode: "ABCD23",
  roundNumber: 1,
  stateVersion: 2,
  status: "WAITING_FOR_SELECTION",
};
