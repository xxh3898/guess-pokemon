import { ApiError } from "../api/HttpClient";
import {
  hasOwn,
  requireBoolean,
  requireDateTime,
  requireInteger,
  requireNullableDateTime,
  requireNullableUuid,
  requireRecord,
  requireString,
  requireUuid,
} from "../api/responseParsing";
import {
  parsePokemonSummary,
  type PokemonSummary,
} from "../../features/pokemon/pokemonTypes";
import {
  parseRoomSnapshot,
  type GameAnswer,
  type GameEndReason,
  type GameStatus,
  type RoomRole,
  type RoomSnapshot,
} from "../../features/room/roomTypes";
import {
  isValidRoomCode,
  normalizeRoomCode,
} from "../../features/room/roomCode";

interface RealtimeEventBase {
  readonly eventId: string;
  readonly gameId: string | null;
  readonly occurredAt: string;
  readonly roomCode: string;
  readonly stateVersion: number;
}

export interface RoomSnapshotEvent extends RealtimeEventBase {
  readonly eventType: "ROOM_SNAPSHOT";
  readonly payload: RoomSnapshot;
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

interface RoundStartedPayloadBase {
  readonly myRole: RoomRole;
  readonly opponentRole: RoomRole;
  readonly remainingActionCount: number;
  readonly roundNumber: number;
  readonly usedActionCount: number;
}

export interface SelectorRoundStartedPayload
  extends RoundStartedPayloadBase {
  readonly myRole: "SELECTOR";
  readonly opponentRole: "QUESTIONER";
  readonly selectedPokemon: PokemonSummary;
}

export interface QuestionerRoundStartedPayload
  extends RoundStartedPayloadBase {
  readonly myRole: "QUESTIONER";
  readonly opponentRole: "SELECTOR";
}

export interface RoundStartedEvent extends RealtimeEventBase {
  readonly eventType: "ROUND_STARTED";
  readonly gameId: string;
  readonly payload:
    | QuestionerRoundStartedPayload
    | SelectorRoundStartedPayload;
}

export interface QuestionAskedEvent extends RealtimeEventBase {
  readonly eventType: "QUESTION_ASKED";
  readonly gameId: string;
  readonly payload: {
    readonly question: string;
    readonly remainingActionCount: number;
    readonly sequenceNo: number;
    readonly usedActionCount: number;
  };
}

export interface QuestionAnsweredEvent extends RealtimeEventBase {
  readonly eventType: "QUESTION_ANSWERED";
  readonly gameId: string;
  readonly payload: {
    readonly answer: GameAnswer;
    readonly question: string;
    readonly remainingActionCount: number;
    readonly sequenceNo: number;
    readonly usedActionCount: number;
  };
}

export interface GuessResolvedEvent extends RealtimeEventBase {
  readonly eventType: "GUESS_RESOLVED";
  readonly gameId: string;
  readonly payload: {
    readonly correct: boolean;
    readonly guessedPokemon: PokemonSummary;
    readonly remainingActionCount: number;
    readonly sequenceNo: number;
    readonly usedActionCount: number;
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

export interface GameEndedEvent extends RealtimeEventBase {
  readonly eventType: "GAME_ENDED";
  readonly gameId: string;
  readonly payload: {
    readonly answerPokemon: PokemonSummary;
    readonly endReason: GameEndReason;
    readonly loserUserId: string | null;
    readonly status: Exclude<GameStatus, "IN_PROGRESS">;
    readonly usedActionCount: number;
    readonly winnerUserId: string | null;
  };
}

export interface RematchStateChangedEvent
  extends RealtimeEventBase {
  readonly eventType: "REMATCH_STATE_CHANGED";
  readonly gameId: string;
  readonly payload: {
    readonly meReady: boolean;
    readonly opponentReady: boolean;
  };
}

export interface IgnoredRoomEvent extends RealtimeEventBase {
  readonly eventType: "IGNORED";
  readonly payload: null;
}

export type RoomRealtimeEvent =
  | GameEndedEvent
  | GuessResolvedEvent
  | IgnoredRoomEvent
  | PlayerConnectionChangedEvent
  | PlayerJoinedEvent
  | QuestionAnsweredEvent
  | QuestionAskedEvent
  | RematchStateChangedEvent
  | RoomClosedEvent
  | RoomSnapshotEvent
  | RoundStartedEvent;

export type WaitingRoomEvent = RoomRealtimeEvent;

export interface RealtimeErrorMessage {
  readonly code: string;
  readonly commandId: string | null;
  readonly latestStateVersion: number | null;
  readonly message: string;
  readonly recoverable: boolean;
}

export function parseRoomRealtimeEvent(
  body: string,
): RoomRealtimeEvent {
  const envelope = parseJsonRecord(body);
  const eventId = requireUuid(envelope, "eventId");
  const gameId = requireNullableUuid(envelope, "gameId");
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
    gameId,
    occurredAt,
    roomCode,
    stateVersion,
  };

  if (eventType === "ROOM_SNAPSHOT") {
    const snapshot = parseRoomSnapshot(envelope.payload);
    const snapshotGameId = snapshot.game?.gameId ?? null;
    if (
      snapshot.roomCode !== roomCode ||
      snapshot.stateVersion !== stateVersion ||
      snapshotGameId !== gameId
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

  if (eventType === "ROUND_STARTED") {
    const activeGameId = requireGameId(gameId);
    const payload = requireRecord(envelope.payload);
    const myRole = requireRoomRole(payload.myRole);
    const opponentRole = requireRoomRole(payload.opponentRole);
    const counts = parseActionCounts(payload);
    const roundNumber = requireInteger(
      payload,
      "roundNumber",
      1,
    );
    if (myRole === opponentRole) {
      throw ApiError.invalidResponse();
    }
    if (myRole === "SELECTOR") {
      return {
        ...base,
        eventType,
        gameId: activeGameId,
        payload: {
          ...counts,
          myRole,
          opponentRole: "QUESTIONER",
          roundNumber,
          selectedPokemon: parsePokemonSummary(
            payload.selectedPokemon,
          ),
        },
      };
    }
    if (hasOwn(payload, "selectedPokemon")) {
      throw ApiError.invalidResponse();
    }
    return {
      ...base,
      eventType,
      gameId: activeGameId,
      payload: {
        ...counts,
        myRole,
        opponentRole: "SELECTOR",
        roundNumber,
      },
    };
  }

  if (eventType === "QUESTION_ASKED") {
    const payload = requireRecord(envelope.payload);
    return {
      ...base,
      eventType,
      gameId: requireGameId(gameId),
      payload: {
        ...parseActionCounts(payload),
        question: requireString(payload, "question"),
        sequenceNo: requireInteger(
          payload,
          "sequenceNo",
          1,
          20,
        ),
      },
    };
  }

  if (eventType === "QUESTION_ANSWERED") {
    const payload = requireRecord(envelope.payload);
    return {
      ...base,
      eventType,
      gameId: requireGameId(gameId),
      payload: {
        ...parseActionCounts(payload),
        answer: requireGameAnswer(payload.answer),
        question: requireString(payload, "question"),
        sequenceNo: requireInteger(
          payload,
          "sequenceNo",
          1,
          20,
        ),
      },
    };
  }

  if (eventType === "GUESS_RESOLVED") {
    const payload = requireRecord(envelope.payload);
    return {
      ...base,
      eventType,
      gameId: requireGameId(gameId),
      payload: {
        ...parseActionCounts(payload),
        correct: requireBoolean(payload, "correct"),
        guessedPokemon: parsePokemonSummary(
          payload.guessedPokemon,
        ),
        sequenceNo: requireInteger(
          payload,
          "sequenceNo",
          1,
          20,
        ),
      },
    };
  }

  if (eventType === "PLAYER_CONNECTION_CHANGED") {
    const payload = requireRecord(envelope.payload);
    return {
      ...base,
      eventType,
      payload: {
        connected: requireBoolean(payload, "connected"),
        reconnectDeadline: requireNullableDateTime(
          payload,
          "reconnectDeadline",
        ),
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

  if (eventType === "GAME_ENDED") {
    const payload = requireRecord(envelope.payload);
    const status = requireFinishedGameStatus(payload.status);
    const winnerUserId = requireNullableUuid(
      payload,
      "winnerUserId",
    );
    const loserUserId = requireNullableUuid(payload, "loserUserId");
    const endReason = requireGameEndReason(payload.endReason);
    validateFinishedGame(
      status,
      winnerUserId,
      loserUserId,
      endReason,
    );
    return {
      ...base,
      eventType,
      gameId: requireGameId(gameId),
      payload: {
        answerPokemon: parsePokemonSummary(
          payload.answerPokemon,
        ),
        endReason,
        loserUserId,
        status,
        usedActionCount: requireInteger(
          payload,
          "usedActionCount",
          0,
          20,
        ),
        winnerUserId,
      },
    };
  }

  if (eventType === "REMATCH_STATE_CHANGED") {
    const payload = requireRecord(envelope.payload);
    return {
      ...base,
      eventType,
      gameId: requireGameId(gameId),
      payload: {
        meReady: requireBoolean(payload, "meReady"),
        opponentReady: requireBoolean(
          payload,
          "opponentReady",
        ),
      },
    };
  }

  return {
    ...base,
    eventType: "IGNORED",
    payload: null,
  };
}

export const parseWaitingRoomEvent = parseRoomRealtimeEvent;

export function parseRealtimeError(
  body: string,
): RealtimeErrorMessage {
  const payload = parseJsonRecord(body);
  const commandId = requireNullableUuid(payload, "commandId");
  const latestStateVersion = payload.latestStateVersion;

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

function parseActionCounts(
  payload: Record<string, unknown>,
): {
  readonly remainingActionCount: number;
  readonly usedActionCount: number;
} {
  const usedActionCount = requireInteger(
    payload,
    "usedActionCount",
    0,
    20,
  );
  const remainingActionCount = requireInteger(
    payload,
    "remainingActionCount",
    0,
    20,
  );
  if (usedActionCount + remainingActionCount !== 20) {
    throw ApiError.invalidResponse();
  }
  return { remainingActionCount, usedActionCount };
}

function requireGameId(gameId: string | null): string {
  if (gameId === null) {
    throw ApiError.invalidResponse();
  }
  return gameId;
}

function requireRoomRole(value: unknown): RoomRole {
  if (value !== "QUESTIONER" && value !== "SELECTOR") {
    throw ApiError.invalidResponse();
  }
  return value;
}

function requireGameAnswer(value: unknown): GameAnswer {
  if (value !== "YES" && value !== "NO" && value !== "UNKNOWN") {
    throw ApiError.invalidResponse();
  }
  return value;
}

function requireFinishedGameStatus(
  value: unknown,
): Exclude<GameStatus, "IN_PROGRESS"> {
  if (value !== "COMPLETED" && value !== "ABORTED") {
    throw ApiError.invalidResponse();
  }
  return value;
}

function requireGameEndReason(value: unknown): GameEndReason {
  if (
    value !== "CORRECT_GUESS" &&
    value !== "QUESTION_LIMIT" &&
    value !== "PLAYER_LEFT" &&
    value !== "RECONNECT_TIMEOUT" &&
    value !== "BOTH_DISCONNECTED" &&
    value !== "SERVER_RESTART"
  ) {
    throw ApiError.invalidResponse();
  }
  return value;
}

function validateFinishedGame(
  status: Exclude<GameStatus, "IN_PROGRESS">,
  winnerUserId: string | null,
  loserUserId: string | null,
  endReason: GameEndReason,
): void {
  const abortedReason =
    endReason === "BOTH_DISCONNECTED" ||
    endReason === "SERVER_RESTART";
  if (
    (status === "COMPLETED" &&
      (winnerUserId === null ||
        loserUserId === null ||
        winnerUserId === loserUserId ||
        abortedReason)) ||
    (status === "ABORTED" &&
      (winnerUserId !== null ||
        loserUserId !== null ||
        !abortedReason))
  ) {
    throw ApiError.invalidResponse();
  }
}

function requireRoomClosedReason(
  value: unknown,
): RoomClosedReason {
  if (value !== "HOST_LEFT" && value !== "RESULT_ROOM_LEFT") {
    throw ApiError.invalidResponse();
  }
  return value;
}
