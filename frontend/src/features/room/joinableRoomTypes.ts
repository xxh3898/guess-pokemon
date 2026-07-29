import { ApiError } from "../../shared/api/HttpClient";
import {
  requireRecord,
  requireString,
} from "../../shared/api/responseParsing";
import {
  isValidRoomCode,
  normalizeRoomCode,
} from "./roomCode";
import type { GameMode } from "./roomTypes";

export const MAX_JOINABLE_ROOM_COUNT = 50;

export interface JoinableRoomSummary {
  readonly hostNickname: string;
  readonly mode?: GameMode;
  readonly roomCode: string;
}

export interface JoinableRoomListResponse {
  readonly rooms: readonly JoinableRoomSummary[];
}

export function parseJoinableRoomListResponse(
  payload: unknown,
): JoinableRoomListResponse {
  const response = requireRecord(payload);
  if (
    !Array.isArray(response.rooms) ||
    response.rooms.length > MAX_JOINABLE_ROOM_COUNT
  ) {
    throw ApiError.invalidResponse();
  }

  const roomCodes = new Set<string>();
  const rooms = response.rooms.map((item) => {
    const room = requireRecord(item);
    const roomCode = requireString(room, "roomCode");
    const hostNickname = requireString(room, "hostNickname");
    const hasMode = room.mode !== undefined;
    const mode =
      room.mode === undefined
        ? "TWENTY_QUESTIONS"
        : requireGameMode(room.mode);
    if (
      normalizeRoomCode(roomCode) !== roomCode ||
      !isValidRoomCode(roomCode) ||
      hostNickname.trim().length === 0 ||
      roomCodes.has(roomCode)
    ) {
      throw ApiError.invalidResponse();
    }
    roomCodes.add(roomCode);
    return {
      hostNickname,
      ...(hasMode ? { mode } : {}),
      roomCode,
    };
  });

  return { rooms };
}

function requireGameMode(value: unknown): GameMode {
  if (
    value !== "TWENTY_QUESTIONS" &&
    value !== "SILHOUETTE"
  ) {
    throw ApiError.invalidResponse();
  }
  return value;
}
