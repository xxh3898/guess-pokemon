import { describe, expect, it } from "vitest";

import {
  parseRealtimeError,
  parseWaitingRoomEvent,
} from "./realtimeTypes";

const HOST_MEMBER = {
  connected: true,
  nickname: "레드",
  reconnectDeadline: null,
  role: "SELECTOR",
  userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
};

describe("realtimeTypes", () => {
  it("should_parseAuthoritativeSnapshot_when_roomSnapshotArrives", () => {
    const event = parseWaitingRoomEvent(
      JSON.stringify({
        eventId: "2069dc9a-624f-48f9-8b2c-65e912006224",
        eventType: "ROOM_SNAPSHOT",
        gameId: null,
        occurredAt: "2026-07-25T03:00:00Z",
        payload: {
          game: null,
          me: HOST_MEMBER,
          opponent: null,
          rematch: null,
          roomCode: "AB3K7M",
          roundNumber: 1,
          stateVersion: 1,
          status: "WAITING_FOR_OPPONENT",
        },
        roomCode: "AB3K7M",
        stateVersion: 1,
      }),
    );

    expect(event).toMatchObject({
      eventType: "ROOM_SNAPSHOT",
      payload: {
        roomCode: "AB3K7M",
        status: "WAITING_FOR_OPPONENT",
      },
    });
  });

  it("should_parseNullableCommandId_when_realtimeErrorArrives", () => {
    expect(
      parseRealtimeError(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          commandId: null,
          latestStateVersion: null,
          message: "요청 입력값을 확인해 주세요.",
          recoverable: true,
        }),
      ),
    ).toEqual({
      code: "VALIDATION_FAILED",
      commandId: null,
      latestStateVersion: null,
      message: "요청 입력값을 확인해 주세요.",
      recoverable: true,
    });
  });

  it("should_parseRoomClosedReason_when_hostLeaves", () => {
    expect(
      parseWaitingRoomEvent(
        JSON.stringify({
          eventId: "2069dc9a-624f-48f9-8b2c-65e912006224",
          eventType: "ROOM_CLOSED",
          occurredAt: "2026-07-25T03:00:00Z",
          payload: {
            leftUserId:
              "624f7d62-e328-4ff0-8b90-f6520b81a47f",
            reason: "HOST_LEFT",
          },
          roomCode: "AB3K7M",
          stateVersion: 2,
        }),
      ),
    ).toMatchObject({
      eventType: "ROOM_CLOSED",
      payload: {
        reason: "HOST_LEFT",
      },
    });
  });

  it("should_rejectInvalidJson_when_messageCannotBeParsed", () => {
    expect(() => parseWaitingRoomEvent("{broken")).toThrow(
      "서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    );
  });
});
