import { ApiError } from "../api/HttpClient";
import {
  parseWaitingRoomSnapshot,
  type WaitingRoomSnapshot,
} from "../../features/room/roomTypes";
import {
  isValidRoomCode,
  normalizeRoomCode,
} from "../../features/room/roomCode";

interface RealtimeEventBase {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly roomCode: string;
  readonly stateVersion: number;
}

export interface RoomSnapshotEvent extends RealtimeEventBase {
  readonly eventType: "ROOM_SNAPSHOT";
  readonly payload: WaitingRoomSnapshot;
}

export interface PlayerJoinedEvent extends RealtimeEventBase {
  readonly eventType: "PLAYER_JOINED";
  readonly payload: {
    readonly player: {
      readonly nickname: string;
      readonly userId: string;
    };
  };
}

export interface PlayerConnectionChangedEvent
  extends RealtimeEventBase {
  readonly eventType: "PLAYER_CONNECTION_CHANGED";
  readonly payload: {
    readonly connected: boolean;
    readonly reconnectDeadline: string | null;
    readonly userId: string;
  };
}

export type RoomClosedReason =
  | "HOST_LEFT"
  | "RESULT_ROOM_LEFT";

export interface RoomClosedEvent extends RealtimeEventBase {
  readonly eventType: "ROOM_CLOSED";
  readonly payload: {
    readonly leftUserId: string;
    readonly reason: RoomClosedReason;
  };
}

export interface IgnoredRoomEvent extends RealtimeEventBase {
  readonly eventType: "IGNORED";
  readonly payload: null;
}

export type WaitingRoomEvent =
  | IgnoredRoomEvent
  | PlayerConnectionChangedEvent
  | PlayerJoinedEvent
  | RoomClosedEvent
  | RoomSnapshotEvent;

export interface RealtimeErrorMessage {
  readonly code: string;
  readonly commandId: string | null;
  readonly latestStateVersion: number | null;
  readonly message: string;
  readonly recoverable: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWaitingRoomEvent(
  body: string,
): WaitingRoomEvent {
  const envelope = parseJsonRecord(body);
  const eventId = requireUuid(envelope, "eventId");
  const occurredAt = requireDateTime(envelope, "occurredAt");
  const roomCode = normalizeRoomCode(
    requireString(envelope, "roomCode"),
  );
  const stateVersion = requireInteger(
    envelope,
    "stateVersion",
    0,
  );
  const eventType = requireString(envelope, "eventType");

  if (!isValidRoomCode(roomCode)) {
    throw ApiError.invalidResponse();
  }

  const base = {
    eventId,
    occurredAt,
    roomCode,
    stateVersion,
  };

  if (eventType === "ROOM_SNAPSHOT") {
    const snapshot = parseWaitingRoomSnapshot(envelope.payload);
    if (
      snapshot.roomCode !== roomCode ||
      snapshot.stateVersion !== stateVersion
    ) {
      throw ApiError.invalidResponse();
    }
    return {
      ...base,
      eventType,
      payload: snapshot,
    };
  }
  if (eventType === "PLAYER_JOINED") {
    const payload = requireRecord(envelope.payload);
    const player = requireRecord(payload.player);
    return {
      ...base,
      eventType,
      payload: {
        player: {
          nickname: requireString(player, "nickname"),
          userId: requireUuid(player, "userId"),
        },
      },
    };
  }
  if (eventType === "PLAYER_CONNECTION_CHANGED") {
    const payload = requireRecord(envelope.payload);
    const reconnectDeadline = payload.reconnectDeadline;
    if (
      reconnectDeadline !== null &&
      (typeof reconnectDeadline !== "string" ||
        Number.isNaN(Date.parse(reconnectDeadline)))
    ) {
      throw ApiError.invalidResponse();
    }
    return {
      ...base,
      eventType,
      payload: {
        connected: requireBoolean(payload, "connected"),
        reconnectDeadline,
        userId: requireUuid(payload, "userId"),
      },
    };
  }
  if (eventType === "ROOM_CLOSED") {
    const payload = requireRecord(envelope.payload);
    return {
      ...base,
      eventType,
      payload: {
        leftUserId: requireUuid(payload, "leftUserId"),
        reason: requireRoomClosedReason(payload.reason),
      },
    };
  }

  return {
    ...base,
    eventType: "IGNORED",
    payload: null,
  };
}

function requireRoomClosedReason(
  value: unknown,
): RoomClosedReason {
  if (value !== "HOST_LEFT" && value !== "RESULT_ROOM_LEFT") {
    throw ApiError.invalidResponse();
  }
  return value;
}

export function parseRealtimeError(
  body: string,
): RealtimeErrorMessage {
  const payload = parseJsonRecord(body);
  const commandId = payload.commandId;
  const latestStateVersion = payload.latestStateVersion;

  if (
    commandId !== null &&
    (typeof commandId !== "string" || !UUID_PATTERN.test(commandId))
  ) {
    throw ApiError.invalidResponse();
  }
  if (
    latestStateVersion !== null &&
    (typeof latestStateVersion !== "number" ||
      !Number.isInteger(latestStateVersion) ||
      latestStateVersion < 0)
  ) {
    throw ApiError.invalidResponse();
  }

  return {
    code: requireString(payload, "code"),
    commandId,
    latestStateVersion,
    message: requireString(payload, "message"),
    recoverable: requireBoolean(payload, "recoverable"),
  };
}

function parseJsonRecord(body: string): Record<string, unknown> {
  try {
    return requireRecord(JSON.parse(body) as unknown);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw ApiError.invalidResponse();
  }
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

function requireUuid(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = requireString(value, key);
  if (!UUID_PATTERN.test(candidate)) {
    throw ApiError.invalidResponse();
  }
  return candidate;
}

function requireDateTime(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = requireString(value, key);
  if (Number.isNaN(Date.parse(candidate))) {
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
