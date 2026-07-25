import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  HttpClient,
} from "../../shared/api/HttpClient";
import { createRoomGateway } from "./roomApi";

const HOST_SNAPSHOT = {
  game: null,
  me: {
    connected: true,
    nickname: "레드",
    reconnectDeadline: null,
    role: "SELECTOR",
    userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
  },
  opponent: null,
  rematch: null,
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 1,
  status: "WAITING_FOR_OPPONENT",
};

describe("roomApi", () => {
  it("should_parseHostSnapshot_when_roomIsCreated", async () => {
    const fetcher = stateChangingFetcher(HOST_SNAPSHOT);
    const gateway = createRoomGateway(new HttpClient(fetcher));

    await expect(gateway.create()).resolves.toEqual(HOST_SNAPSHOT);

    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/v1/rooms");
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("POST");
  });

  it("should_parseJoinableRooms_when_lobbyListIsRequested", async () => {
    const payload = {
      rooms: [
        {
          hostNickname: "레드",
          roomCode: "ABCD23",
        },
      ],
    };
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse(payload));
    const gateway = createRoomGateway(new HttpClient(fetcher));

    await expect(gateway.list()).resolves.toEqual(payload);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/rooms");
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("should_normalizeCode_when_joiningRoom", async () => {
    const guestSnapshot = {
      ...HOST_SNAPSHOT,
      me: {
        ...HOST_SNAPSHOT.me,
        nickname: "그린",
        role: "QUESTIONER",
        userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
      },
      opponent: HOST_SNAPSHOT.me,
      stateVersion: 2,
      status: "WAITING_FOR_SELECTION",
    };
    const fetcher = stateChangingFetcher(guestSnapshot);
    const gateway = createRoomGateway(new HttpClient(fetcher));

    await expect(gateway.join(" ab3k7m ")).resolves.toEqual(
      guestSnapshot,
    );

    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/api/v1/rooms/AB3K7M/join",
    );
  });

  it("should_sendDeleteRequest_when_leavingWaitingRoom", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = createRoomGateway(new HttpClient(fetcher));

    await expect(gateway.leave("AB3K7M")).resolves.toBeUndefined();

    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/api/v1/rooms/AB3K7M/members/me",
    );
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("should_parseQuestionerGame_when_activeSnapshotContainsNoSecret", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        ...HOST_SNAPSHOT,
        me: {
          ...HOST_SNAPSHOT.me,
          role: "QUESTIONER",
        },
        opponent: {
          ...HOST_SNAPSHOT.me,
          role: "SELECTOR",
          userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
        },
        game: {
          actions: [],
          gameId: "3f249b3c-f0a6-4054-8bcf-e6284eec5f3e",
          remainingActionCount: 20,
          status: "IN_PROGRESS",
          usedActionCount: 0,
        },
        stateVersion: 3,
        status: "PLAYING",
      }),
    );
    const gateway = createRoomGateway(new HttpClient(fetcher));

    await expect(gateway.get("AB3K7M")).resolves.toMatchObject({
      status: "PLAYING",
    });
  });

  it("should_rejectRequestBeforeFetch_when_roomCodeIsInvalid", async () => {
    const fetcher = vi.fn();
    const gateway = createRoomGateway(new HttpClient(fetcher));

    await expect(gateway.get("ABC101")).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function stateChangingFetcher(payload: unknown) {
  return vi
    .fn()
    .mockResolvedValueOnce(csrfResponse())
    .mockResolvedValueOnce(jsonResponse(payload));
}

function csrfResponse(): Response {
  return jsonResponse({
    headerName: "X-XSRF-TOKEN",
    parameterName: "_csrf",
    token: "csrf-token",
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}
