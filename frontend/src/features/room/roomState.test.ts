import { describe, expect, it } from "vitest";

import type { WaitingRoomEvent } from "../../shared/realtime/realtimeTypes";
import {
  applyAuthoritativeSnapshot,
  applyWaitingRoomEvent,
} from "./roomState";
import type { WaitingRoomSnapshot } from "./roomTypes";

const HOST_SNAPSHOT: WaitingRoomSnapshot = {
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

describe("roomState", () => {
  it("should_acceptSameVersionSnapshot_when_joinNoticeArrivedFirst", () => {
    const joined = twoPlayerSnapshot();

    expect(
      applyWaitingRoomEvent(HOST_SNAPSHOT, {
        ...baseEvent(2),
        eventType: "ROOM_SNAPSHOT",
        payload: joined,
      }),
    ).toEqual(joined);
  });

  it("should_keepLatestSnapshot_when_restResponseArrivesLate", () => {
    const joined = twoPlayerSnapshot();

    expect(
      applyAuthoritativeSnapshot(joined, HOST_SNAPSHOT),
    ).toEqual(joined);
  });

  it("should_updateOpponentConnection_when_newerEventArrives", () => {
    const joined = twoPlayerSnapshot();
    const event: WaitingRoomEvent = {
      ...baseEvent(3),
      eventType: "PLAYER_CONNECTION_CHANGED",
      payload: {
        connected: false,
        reconnectDeadline: null,
        userId: joined.opponent?.userId ?? "",
      },
    };

    const result = applyWaitingRoomEvent(joined, event);

    expect(result?.opponent?.connected).toBe(false);
    expect(result?.stateVersion).toBe(3);
  });

  it("should_ignoreDuplicateConnectionEvent_when_versionIsNotNewer", () => {
    const joined = twoPlayerSnapshot();
    const event: WaitingRoomEvent = {
      ...baseEvent(2),
      eventType: "PLAYER_CONNECTION_CHANGED",
      payload: {
        connected: false,
        reconnectDeadline: null,
        userId: joined.opponent?.userId ?? "",
      },
    };

    expect(applyWaitingRoomEvent(joined, event)).toBe(joined);
  });
});

function twoPlayerSnapshot(): WaitingRoomSnapshot {
  return {
    ...HOST_SNAPSHOT,
    opponent: {
      connected: true,
      nickname: "그린",
      reconnectDeadline: null,
      role: "QUESTIONER",
      userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
    },
    stateVersion: 2,
    status: "WAITING_FOR_SELECTION",
  };
}

function baseEvent(stateVersion: number) {
  return {
    eventId: "2069dc9a-624f-48f9-8b2c-65e912006224",
    occurredAt: "2026-07-25T03:00:00Z",
    roomCode: "AB3K7M",
    stateVersion,
  };
}
