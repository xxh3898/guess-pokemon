import { ApiError } from "../../shared/api/HttpClient";
import { isAnswerCommentValue } from "../../shared/game/answerComment";
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
} from "../../shared/api/responseParsing";
import {
  parsePokemonSummary,
  type PokemonSummary,
} from "../pokemon/pokemonTypes";
import { isValidRoomCode, normalizeRoomCode } from "./roomCode";

export const MAX_GAME_ACTION_COUNT = 20;
export const MAX_SILHOUETTE_GUESS_COUNT = 3;
export type GameMode = "TWENTY_QUESTIONS" | "SILHOUETTE";

export type RoomStatus =
  | "WAITING_FOR_OPPONENT"
  | "WAITING_FOR_ROLE_SELECTION"
  | "WAITING_FOR_SELECTION"
  | "PLAYING"
  | "PAUSED"
  | "RESULT";

export type WaitingRoomStatus =
  | "WAITING_FOR_OPPONENT"
  | "WAITING_FOR_ROLE_SELECTION"
  | "WAITING_FOR_SELECTION";

export type RoomRole = "QUESTIONER" | "SELECTOR";
export type GameStatus = "IN_PROGRESS" | "COMPLETED" | "ABORTED";
export type GameAnswer = "YES" | "NO" | "UNKNOWN";
export type GameEndReason =
  | "CORRECT_GUESS"
  | "QUESTION_LIMIT"
  | "GUESS_LIMIT"
  | "PLAYER_LEFT"
  | "RECONNECT_TIMEOUT"
  | "BOTH_DISCONNECTED"
  | "SERVER_RESTART";

export interface RoomMember {
  readonly connected: boolean;
  readonly nickname: string;
  readonly reconnectDeadline: string | null;
  readonly role: RoomRole | null;
  readonly userId: string;
}

interface GameActionBase {
  readonly createdAt: string;
  readonly sequenceNumber: number;
}

export interface QuestionGameAction extends GameActionBase {
  readonly answer: GameAnswer | null;
  readonly answeredAt: string | null;
  readonly comment: string | null;
  readonly question: string;
  readonly type: "QUESTION";
}

export interface GuessGameAction extends GameActionBase {
  readonly correct: boolean;
  readonly guessedPokemon: PokemonSummary | null;
  readonly guessedPokemonNationalDexId: number;
  readonly type: "GUESS";
}

export type GameAction = GuessGameAction | QuestionGameAction;

interface GameSnapshotBase {
  readonly actions: readonly GameAction[];
  readonly gameId: string;
  readonly remainingActionCount: number;
  readonly usedActionCount: number;
}

export interface SelectorGameSnapshot extends GameSnapshotBase {
  readonly selectedPokemon: PokemonSummary;
  readonly status: "IN_PROGRESS";
}

export interface QuestionerGameSnapshot extends GameSnapshotBase {
  readonly status: "IN_PROGRESS";
}

export interface ResultGameSnapshot extends GameSnapshotBase {
  readonly answerPokemon: PokemonSummary;
  readonly endReason: GameEndReason;
  readonly loserUserId: string | null;
  readonly status: "ABORTED" | "COMPLETED";
  readonly winnerUserId: string | null;
}

export interface RoleSelectionState {
  readonly opponentSelected: boolean;
  readonly preferredRole: RoomRole | null;
}

export interface RoleAssignmentState {
  readonly randomized: boolean;
}

interface RoomSnapshotBase {
  readonly me: RoomMember;
  readonly mode?: GameMode;
  readonly roomCode: string;
  readonly roundNumber: number;
  readonly stateVersion: number;
}

export interface WaitingForOpponentSnapshot
  extends RoomSnapshotBase {
  readonly game: null;
  readonly opponent: null;
  readonly roleAssignment: null;
  readonly roleSelection: null;
  readonly status: "WAITING_FOR_OPPONENT";
}

export interface WaitingForRoleSelectionSnapshot
  extends RoomSnapshotBase {
  readonly game: null;
  readonly opponent: RoomMember;
  readonly roleAssignment: null;
  readonly roleSelection: RoleSelectionState;
  readonly status: "WAITING_FOR_ROLE_SELECTION";
}

export interface WaitingForSelectionSnapshot
  extends RoomSnapshotBase {
  readonly game: null;
  readonly opponent: RoomMember;
  readonly roleAssignment: RoleAssignmentState;
  readonly roleSelection: null;
  readonly status: "WAITING_FOR_SELECTION";
}

export interface SelectorActiveRoomSnapshot
  extends RoomSnapshotBase {
  readonly game: SelectorGameSnapshot;
  readonly opponent: RoomMember;
  readonly roleAssignment: null;
  readonly roleSelection: null;
  readonly status: "PAUSED" | "PLAYING";
}

export interface QuestionerActiveRoomSnapshot
  extends RoomSnapshotBase {
  readonly game: QuestionerGameSnapshot;
  readonly opponent: RoomMember;
  readonly roleAssignment: null;
  readonly roleSelection: null;
  readonly status: "PAUSED" | "PLAYING";
}

export interface ResultRoomSnapshot extends RoomSnapshotBase {
  readonly game: ResultGameSnapshot;
  readonly opponent: RoomMember;
  readonly roleAssignment: null;
  readonly roleSelection: RoleSelectionState;
  readonly status: "RESULT";
}

export type ActiveRoomSnapshot =
  | QuestionerActiveRoomSnapshot
  | SelectorActiveRoomSnapshot;

export type WaitingRoomSnapshot =
  | WaitingForOpponentSnapshot
  | WaitingForRoleSelectionSnapshot
  | WaitingForSelectionSnapshot;

export type RoomSnapshot =
  | ActiveRoomSnapshot
  | ResultRoomSnapshot
  | WaitingRoomSnapshot;

export function parseRoomSnapshot(payload: unknown): RoomSnapshot {
  const response = requireRecord(payload);
  const roomCode = normalizeRoomCode(
    requireString(response, "roomCode"),
  );
  const status = requireRoomStatus(response.status);
  const hasMode = response.mode !== undefined;
  const mode = requireGameMode(
    response.mode ?? "TWENTY_QUESTIONS",
  );
  const maxActionCount =
    mode === "SILHOUETTE"
      ? MAX_SILHOUETTE_GUESS_COUNT
      : MAX_GAME_ACTION_COUNT;
  const me = parseRoomMember(response.me);
  const opponent =
    response.opponent === null
      ? null
      : parseRoomMember(response.opponent);
  const base = {
    me,
    ...(hasMode ? { mode } : {}),
    roomCode,
    roundNumber: requireInteger(response, "roundNumber", 1),
    stateVersion: requireInteger(response, "stateVersion", 1),
  };

  if (!isValidRoomCode(roomCode)) {
    throw ApiError.invalidResponse();
  }
  validateParticipants(me, opponent);

  if (status === "WAITING_FOR_OPPONENT") {
    requireEmptyGameState(response);
    if (
      opponent !== null ||
      me.role !== null ||
      response.roleSelection !== null ||
      response.roleAssignment !== null
    ) {
      throw ApiError.invalidResponse();
    }
    return {
      ...base,
      game: null,
      opponent: null,
      roleAssignment: null,
      roleSelection: null,
      status,
    };
  }

  if (status === "WAITING_FOR_ROLE_SELECTION") {
    requireEmptyGameState(response);
    if (
      opponent === null ||
      me.role !== null ||
      opponent.role !== null ||
      response.roleAssignment !== null
    ) {
      throw ApiError.invalidResponse();
    }
    return {
      ...base,
      game: null,
      opponent,
      roleAssignment: null,
      roleSelection: parseRoleSelectionState(
        response.roleSelection,
      ),
      status,
    };
  }

  if (status === "WAITING_FOR_SELECTION") {
    requireEmptyGameState(response);
    if (opponent === null) {
      throw ApiError.invalidResponse();
    }
    requireAssignedRoles(me, opponent);
    if (response.roleSelection !== null) {
      throw ApiError.invalidResponse();
    }
    return {
      ...base,
      game: null,
      opponent,
      roleAssignment: parseRoleAssignmentState(
        response.roleAssignment,
      ),
      roleSelection: null,
      status,
    };
  }

  if (opponent === null) {
    throw ApiError.invalidResponse();
  }

  if (status === "RESULT") {
    requireAssignedRoles(me, opponent);
    if (response.roleAssignment !== null) {
      throw ApiError.invalidResponse();
    }
    return {
      ...base,
      game: parseResultGameSnapshot(
        response.game,
        maxActionCount,
      ),
      opponent,
      roleAssignment: null,
      roleSelection: parseRoleSelectionState(
        response.roleSelection,
      ),
      status,
    };
  }

  requireAssignedRoles(me, opponent);
  if (
    response.roleSelection !== null ||
    response.roleAssignment !== null
  ) {
    throw ApiError.invalidResponse();
  }
  const game =
    me.role === "SELECTOR"
      ? parseSelectorGameSnapshot(
          response.game,
          maxActionCount,
        )
      : parseQuestionerGameSnapshot(
          response.game,
          maxActionCount,
        );
  return {
    ...base,
    game,
    opponent,
    roleAssignment: null,
    roleSelection: null,
    status,
  };
}

export function parseWaitingRoomSnapshot(
  payload: unknown,
): WaitingRoomSnapshot {
  const snapshot = parseRoomSnapshot(payload);
  if (
    snapshot.status !== "WAITING_FOR_OPPONENT" &&
    snapshot.status !== "WAITING_FOR_ROLE_SELECTION" &&
    snapshot.status !== "WAITING_FOR_SELECTION"
  ) {
    throw ApiError.invalidResponse();
  }
  return snapshot;
}

function parseRoomMember(payload: unknown): RoomMember {
  const member = requireRecord(payload);
  return {
    connected: requireBoolean(member, "connected"),
    nickname: requireString(member, "nickname"),
    reconnectDeadline: requireNullableDateTime(
      member,
      "reconnectDeadline",
    ),
    role:
      member.role === null
        ? null
        : requireRoomRole(member.role),
    userId: requireUuid(member, "userId"),
  };
}

function parseSelectorGameSnapshot(
  payload: unknown,
  maxActionCount: number,
): SelectorGameSnapshot {
  const game = requireRecord(payload);
  if (hasOwn(game, "answerPokemon")) {
    throw ApiError.invalidResponse();
  }
  const base = parseGameSnapshotBase(game, maxActionCount);
  if (requireGameStatus(game.status) !== "IN_PROGRESS") {
    throw ApiError.invalidResponse();
  }
  return {
    ...base,
    selectedPokemon: parsePokemonSummary(game.selectedPokemon),
    status: "IN_PROGRESS",
  };
}

function parseQuestionerGameSnapshot(
  payload: unknown,
  maxActionCount: number,
): QuestionerGameSnapshot {
  const game = requireRecord(payload);
  if (
    hasOwn(game, "selectedPokemon") ||
    hasOwn(game, "answerPokemon")
  ) {
    throw ApiError.invalidResponse();
  }
  const base = parseGameSnapshotBase(game, maxActionCount);
  if (requireGameStatus(game.status) !== "IN_PROGRESS") {
    throw ApiError.invalidResponse();
  }
  return {
    ...base,
    status: "IN_PROGRESS",
  };
}

function parseResultGameSnapshot(
  payload: unknown,
  maxActionCount: number,
): ResultGameSnapshot {
  const game = requireRecord(payload);
  if (hasOwn(game, "selectedPokemon")) {
    throw ApiError.invalidResponse();
  }
  const base = parseGameSnapshotBase(game, maxActionCount);
  const status = requireGameStatus(game.status);
  const winnerUserId = requireNullableUuid(game, "winnerUserId");
  const loserUserId = requireNullableUuid(game, "loserUserId");
  const endReason = requireGameEndReason(game.endReason);

  if (
    status === "IN_PROGRESS" ||
    (status === "COMPLETED" &&
      (winnerUserId === null ||
        loserUserId === null ||
        winnerUserId === loserUserId ||
        endReason === "BOTH_DISCONNECTED" ||
        endReason === "SERVER_RESTART")) ||
    (status === "ABORTED" &&
      (winnerUserId !== null ||
        loserUserId !== null ||
        (endReason !== "BOTH_DISCONNECTED" &&
          endReason !== "SERVER_RESTART")))
  ) {
    throw ApiError.invalidResponse();
  }

  return {
    ...base,
    answerPokemon: parsePokemonSummary(game.answerPokemon),
    endReason,
    loserUserId,
    status,
    winnerUserId,
  };
}

function parseGameSnapshotBase(
  game: Record<string, unknown>,
  maxActionCount: number,
): GameSnapshotBase {
  if (!Array.isArray(game.actions)) {
    throw ApiError.invalidResponse();
  }
  const usedActionCount = requireInteger(
    game,
    "usedActionCount",
    0,
    maxActionCount,
  );
  const remainingActionCount = requireInteger(
    game,
    "remainingActionCount",
    0,
    maxActionCount,
  );
  const actions = game.actions.map((action, index) =>
    parseGameAction(action, index + 1),
  );
  if (
    usedActionCount + remainingActionCount !==
      maxActionCount ||
    actions.length !== usedActionCount
  ) {
    throw ApiError.invalidResponse();
  }
  return {
    actions,
    gameId: requireUuid(game, "gameId"),
    remainingActionCount,
    usedActionCount,
  };
}

function parseGameAction(
  payload: unknown,
  expectedSequence: number,
): GameAction {
  const action = requireRecord(payload);
  const sequenceNumber = requireInteger(
    action,
    "sequenceNumber",
    1,
    MAX_GAME_ACTION_COUNT,
  );
  if (sequenceNumber !== expectedSequence) {
    throw ApiError.invalidResponse();
  }
  const type = requireGameActionType(action.type);
  const createdAt = requireDateTime(action, "createdAt");

  if (type === "QUESTION") {
    const answer =
      action.answer === null
        ? null
        : requireGameAnswer(action.answer);
    const answeredAt = requireNullableDateTime(
      action,
      "answeredAt",
    );
    const comment = requireAnswerComment(action.comment);
    if (
      action.guessedPokemonNationalDexId !== null ||
      (hasOwn(action, "guessedPokemon") &&
        action.guessedPokemon !== null) ||
      action.correct !== null ||
      (answer === null && comment !== null) ||
      (answer === null) !== (answeredAt === null)
    ) {
      throw ApiError.invalidResponse();
    }
    return {
      answer,
      answeredAt,
      comment,
      createdAt,
      question: requireString(action, "question"),
      sequenceNumber,
      type,
    };
  }

  if (
    action.question !== null ||
    action.answer !== null ||
    action.comment !== null ||
    action.answeredAt !== null
  ) {
    throw ApiError.invalidResponse();
  }
  const guessedPokemonNationalDexId = requireInteger(
    action,
    "guessedPokemonNationalDexId",
    1,
    1_025,
  );
  const guessedPokemon =
    hasOwn(action, "guessedPokemon") &&
    action.guessedPokemon !== null
      ? parsePokemonSummary(action.guessedPokemon)
      : null;
  if (
    guessedPokemon !== null &&
    guessedPokemon.nationalDexId !==
      guessedPokemonNationalDexId
  ) {
    throw ApiError.invalidResponse();
  }
  return {
    correct: requireBoolean(action, "correct"),
    createdAt,
    guessedPokemon,
    guessedPokemonNationalDexId,
    sequenceNumber,
    type,
  };
}

function parseRoleSelectionState(
  payload: unknown,
): RoleSelectionState {
  const selection = requireRecord(payload);
  return {
    opponentSelected: requireBoolean(
      selection,
      "opponentSelected",
    ),
    preferredRole:
      selection.preferredRole === null
        ? null
        : requireRoomRole(selection.preferredRole),
  };
}

function parseRoleAssignmentState(
  payload: unknown,
): RoleAssignmentState {
  const assignment = requireRecord(payload);
  return {
    randomized: requireBoolean(assignment, "randomized"),
  };
}

function requireEmptyGameState(
  response: Record<string, unknown>,
): void {
  if (
    response.game !== null ||
    hasOwn(response, "rematch") ||
    hasOwn(response, "selectedPokemon") ||
    hasOwn(response, "answerPokemon")
  ) {
    throw ApiError.invalidResponse();
  }
}

function validateParticipants(
  me: RoomMember,
  opponent: RoomMember | null,
): void {
  if (
    opponent &&
    opponent.userId === me.userId
  ) {
    throw ApiError.invalidResponse();
  }
}

function requireAssignedRoles(
  me: RoomMember,
  opponent: RoomMember,
): void {
  if (
    me.role === null ||
    opponent.role === null ||
    opponent.role === me.role
  ) {
    throw ApiError.invalidResponse();
  }
}

function requireRoomStatus(value: unknown): RoomStatus {
  if (
    value !== "WAITING_FOR_OPPONENT" &&
    value !== "WAITING_FOR_ROLE_SELECTION" &&
    value !== "WAITING_FOR_SELECTION" &&
    value !== "PLAYING" &&
    value !== "PAUSED" &&
    value !== "RESULT"
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

function requireGameMode(value: unknown): GameMode {
  if (
    value !== "TWENTY_QUESTIONS" &&
    value !== "SILHOUETTE"
  ) {
    throw ApiError.invalidResponse();
  }
  return value;
}

function requireGameStatus(value: unknown): GameStatus {
  if (
    value !== "IN_PROGRESS" &&
    value !== "COMPLETED" &&
    value !== "ABORTED"
  ) {
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

function requireAnswerComment(
  value: unknown,
): string | null {
  if (!isAnswerCommentValue(value)) {
    throw ApiError.invalidResponse();
  }
  return value;
}

function requireGameActionType(
  value: unknown,
): GameAction["type"] {
  if (value !== "QUESTION" && value !== "GUESS") {
    throw ApiError.invalidResponse();
  }
  return value;
}

function requireGameEndReason(
  value: unknown,
): GameEndReason {
  if (
    value !== "CORRECT_GUESS" &&
    value !== "QUESTION_LIMIT" &&
    value !== "GUESS_LIMIT" &&
    value !== "PLAYER_LEFT" &&
    value !== "RECONNECT_TIMEOUT" &&
    value !== "BOTH_DISCONNECTED" &&
    value !== "SERVER_RESTART"
  ) {
    throw ApiError.invalidResponse();
  }
  return value;
}
