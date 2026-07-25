import {
  ApiError,
  HttpClient,
  httpClient,
} from "../../shared/api/HttpClient";
import {
  isValidRoomCode,
  normalizeRoomCode,
} from "./roomCode";
import {
  parseJoinableRoomListResponse,
  type JoinableRoomListResponse,
} from "./joinableRoomTypes";
import {
  parseRoomSnapshot,
  parseWaitingRoomSnapshot,
  type RoomSnapshot,
  type WaitingRoomSnapshot,
} from "./roomTypes";

export interface RoomGateway {
  create(signal?: AbortSignal): Promise<WaitingRoomSnapshot>;
  list(signal?: AbortSignal): Promise<JoinableRoomListResponse>;
  get(
    roomCode: string,
    signal?: AbortSignal,
  ): Promise<RoomSnapshot>;
  join(
    roomCode: string,
    signal?: AbortSignal,
  ): Promise<WaitingRoomSnapshot>;
  leave(roomCode: string, signal?: AbortSignal): Promise<void>;
}

export function createRoomGateway(client: HttpClient): RoomGateway {
  return {
    async create(signal) {
      const payload = await client.post(
        "/api/v1/rooms",
        undefined,
        signal,
      );
      return parseWaitingRoomSnapshot(payload);
    },
    async list(signal) {
      const payload = await client.get(
        "/api/v1/rooms",
        signal,
      );
      return parseJoinableRoomListResponse(payload);
    },
    async get(roomCode, signal) {
      const normalizedCode = requireRoomCode(roomCode);
      const payload = await client.get(
        `/api/v1/rooms/${normalizedCode}`,
        signal,
      );
      return parseRoomSnapshot(payload);
    },
    async join(roomCode, signal) {
      const normalizedCode = requireRoomCode(roomCode);
      const payload = await client.post(
        `/api/v1/rooms/${normalizedCode}/join`,
        undefined,
        signal,
      );
      return parseWaitingRoomSnapshot(payload);
    },
    async leave(roomCode, signal) {
      const normalizedCode = requireRoomCode(roomCode);
      await client.delete(
        `/api/v1/rooms/${normalizedCode}/members/me`,
        signal,
      );
    },
  };
}

export const roomGateway = createRoomGateway(httpClient);

function requireRoomCode(value: string): string {
  const roomCode = normalizeRoomCode(value);
  if (!isValidRoomCode(roomCode)) {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      detail: "방 코드 6자리를 다시 확인해 주세요.",
      status: 400,
      title: "방 코드 확인",
    });
  }
  return roomCode;
}
