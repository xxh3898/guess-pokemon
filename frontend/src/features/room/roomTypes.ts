import { ApiError } from "../../shared/api/HttpClient";
import { isValidRoomCode, normalizeRoomCode } from "./roomCode";

export type WaitingRoomStatus =
  | "WAITING_FOR_OPPONENT"
  | "WAITING_FOR_SELECTION";

export type RoomRole = "QUESTIONER" | "SELECTOR";

export interface RoomMember {
  readonly connected: boolean;
  readonly nickname: string;
  readonly reconnectDeadline: string | null;
  readonly role: RoomRole;
  readonly userId: string;
}

export interface WaitingRoomSnapshot {
  readonly game: null;
  readonly me: RoomMember;
  readonly opponent: RoomMember | null;
  readonly rematch: null;
  readonly roomCode: string;
  readonly roundNumber: number;
  readonly stateVersion: number;
  readonly status: WaitingRoomStatus;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWaitingRoomSnapshot(
  payload: unknown,
): WaitingRoomSnapshot {
  const response = requireRecord(payload);
  const roomCode = normalizeRoomCode(requireString(response, "roomCode"));
  const status = requireWaitingStatus(response.status);
  const me = parseRoomMember(response.me);
  const opponent =
    response.opponent === null
      ? null
      : parseRoomMember(response.opponent);

  if (
    !isValidRoomCode(roomCode) ||
    response.game !== null ||
    response.rematch !== null ||
    "selectedPokemon" in response
  ) {
    throw ApiError.invalidResponse();
  }
  if (
    (status === "WAITING_FOR_OPPONENT" && opponent !== null) ||
    (status === "WAITING_FOR_SELECTION" && opponent === null)
  ) {
    throw ApiError.invalidResponse();
  }
  if (
    opponent &&
    (opponent.userId === me.userId || opponent.role === me.role)
  ) {
    throw ApiError.invalidResponse();
  }

  return {
    game: null,
    me,
    opponent,
    rematch: null,
    roomCode,
    roundNumber: requireInteger(response, "roundNumber", 1),
    stateVersion: requireInteger(response, "stateVersion", 0),
    status,
  };
}

function parseRoomMember(payload: unknown): RoomMember {
  const member = requireRecord(payload);
  const userId = requireString(member, "userId");
  const reconnectDeadline = member.reconnectDeadline;

  if (
    !UUID_PATTERN.test(userId) ||
    (reconnectDeadline !== null &&
      (typeof reconnectDeadline !== "string" ||
        Number.isNaN(Date.parse(reconnectDeadline))))
  ) {
    throw ApiError.invalidResponse();
  }

  return {
    connected: requireBoolean(member, "connected"),
    nickname: requireString(member, "nickname"),
    reconnectDeadline,
    role: requireRoomRole(member.role),
    userId,
  };
}

function requireWaitingStatus(value: unknown): WaitingRoomStatus {
  if (
    value !== "WAITING_FOR_OPPONENT" &&
    value !== "WAITING_FOR_SELECTION"
  ) {
    throw ApiError.invalidResponse();
  }
  return value;
}

function requireRoomRole(value: unknown): RoomRole {
  if (value !== "QUESTIONER" && value !== "SELECTOR") {
    throw ApiError.invalidResponse();
  }
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw ApiError.invalidResponse();
  }
  return value as Record<string, unknown>;
}

function requireString(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw ApiError.invalidResponse();
  }
  return candidate;
}

function requireBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  if (typeof candidate !== "boolean") {
    throw ApiError.invalidResponse();
  }
  return candidate;
}

function requireInteger(
  value: Record<string, unknown>,
  key: string,
  minimum: number,
): number {
  const candidate = value[key];
  if (
    typeof candidate !== "number" ||
    !Number.isInteger(candidate) ||
    candidate < minimum
  ) {
    throw ApiError.invalidResponse();
  }
  return candidate;
}
