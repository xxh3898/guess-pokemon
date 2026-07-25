import { describe, expect, it } from "vitest";

import {
  MAX_JOINABLE_ROOM_COUNT,
  parseJoinableRoomListResponse,
} from "./joinableRoomTypes";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

describe("joinableRoomTypes", () => {
  it("should_parseRoomList_when_payloadIsValid", () => {
    expect(
      parseJoinableRoomListResponse({
        rooms: [
          {
            hostNickname: "레드",
            roomCode: "ABCD23",
          },
          {
            hostNickname: "그린",
            roomCode: "EFGH45",
          },
        ],
      }),
    ).toEqual({
      rooms: [
        {
          hostNickname: "레드",
          roomCode: "ABCD23",
        },
        {
          hostNickname: "그린",
          roomCode: "EFGH45",
        },
      ],
    });
  });

  it("should_rejectRoomList_when_roomShapeIsInvalid", () => {
    expect(() =>
      parseJoinableRoomListResponse({
        rooms: [
          {
            hostNickname: " ",
            roomCode: "abcd23",
          },
        ],
      }),
    ).toThrow();
  });

  it("should_rejectRoomList_when_roomCodeIsDuplicated", () => {
    expect(() =>
      parseJoinableRoomListResponse({
        rooms: [
          {
            hostNickname: "레드",
            roomCode: "ABCD23",
          },
          {
            hostNickname: "그린",
            roomCode: "ABCD23",
          },
        ],
      }),
    ).toThrow();
  });

  it("should_rejectRoomList_when_limitIsExceeded", () => {
    const rooms = Array.from(
      { length: MAX_JOINABLE_ROOM_COUNT + 1 },
      (_, index) => ({
        hostNickname: `방장${index + 1}`,
        roomCode: roomCodeAt(index),
      }),
    );

    expect(() =>
      parseJoinableRoomListResponse({ rooms }),
    ).toThrow();
  });
});

function roomCodeAt(index: number): string {
  const high = Math.floor(index / ROOM_CODE_ALPHABET.length);
  const low = index % ROOM_CODE_ALPHABET.length;
  return (
    "ABCD" +
    ROOM_CODE_ALPHABET.charAt(high) +
    ROOM_CODE_ALPHABET.charAt(low)
  );
}
