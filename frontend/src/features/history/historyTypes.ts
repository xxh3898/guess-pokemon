import { ApiError } from "../../shared/api/HttpClient";
import { isAnswerCommentValue } from "../../shared/game/answerComment";
import {
  requireBoolean,
  requireDateTime,
  requireInteger,
  requireRecord,
  requireString,
  requireUuid,
} from "../../shared/api/responseParsing";
import {
  parsePokemonSummary,
  type PokemonSummary,
} from "../pokemon/pokemonTypes";

export type GameActionType = "GUESS" | "QUESTION";
export type GameAnswer = "NO" | "UNKNOWN" | "YES";
export type GameEndReason =
  | "BOTH_DISCONNECTED"
  | "CORRECT_GUESS"
  | "PLAYER_LEFT"
  | "QUESTION_LIMIT"
  | "RECONNECT_TIMEOUT"
  | "SERVER_RESTART";
export type GameResult = "LOSS" | "NONE" | "WIN";
export type GameRole = "QUESTIONER" | "SELECTOR";
export type GameStatus = "ABORTED" | "COMPLETED";

export interface HistoryOpponent {
  readonly id: string;
  readonly nickname: string;
}

export interface HistoryListItem {
  readonly actionCount: number;
  readonly answerPokemon: PokemonSummary;
  readonly endedAt: string;
  readonly endReason: GameEndReason;
  readonly gameId: string;
  readonly myResult: GameResult;
  readonly myRole: GameRole;
  readonly opponent: HistoryOpponent;
  readonly startedAt: string;
}

export interface HistoryPage {
  readonly content: readonly HistoryListItem[];
  readonly page: number;
  readonly size: number;
  readonly totalElements: number;
  readonly totalPages: number;
}

export interface HistoryParticipant {
  readonly nickname: string;
  readonly result: GameResult;
  readonly role: GameRole;
  readonly userId: string;
}

export interface HistoryAction {
  readonly answer: GameAnswer | null;
  readonly answeredAt: string | null;
  readonly comment: string | null;
  readonly correct: boolean | null;
  readonly createdAt: string;
  readonly guessedPokemon: PokemonSummary | null;
  readonly question: string | null;
  readonly sequenceNo: number;
  readonly type: GameActionType;
}

export interface HistoryDetail {
  readonly actionCount: number;
  readonly actions: readonly HistoryAction[];
  readonly answerPokemon: PokemonSummary;
  readonly endedAt: string;
  readonly endReason: GameEndReason;
  readonly gameId: string;
  readonly participants: readonly HistoryParticipant[];
  readonly startedAt: string;
  readonly status: GameStatus;
}

const GAME_ACTION_TYPES = ["GUESS", "QUESTION"] as const;
const GAME_ANSWERS = ["NO", "UNKNOWN", "YES"] as const;
const GAME_END_REASONS = [
  "BOTH_DISCONNECTED",
  "CORRECT_GUESS",
  "PLAYER_LEFT",
  "QUESTION_LIMIT",
  "RECONNECT_TIMEOUT",
  "SERVER_RESTART",
] as const;
const GAME_RESULTS = ["LOSS", "NONE", "WIN"] as const;
const GAME_ROLES = ["QUESTIONER", "SELECTOR"] as const;
const GAME_STATUSES = ["ABORTED", "COMPLETED"] as const;

export function parseHistoryPage(payload: unknown): HistoryPage {
  const page = requireRecord(payload);
  if (!Array.isArray(page.content)) {
    throw ApiError.invalidResponse();
  }

  const content = page.content.map(parseHistoryListItem);
  const size = requireInteger(page, "size", 1, 100);
  const totalElements = requireInteger(page, "totalElements", 0);
  const totalPages = requireInteger(page, "totalPages", 0);

  if (
    content.length > size ||
    content.length > totalElements ||
    (totalElements === 0 && totalPages !== 0) ||
    (totalElements > 0 &&
      totalPages !== Math.ceil(totalElements / size))
  ) {
    throw ApiError.invalidResponse();
  }

  return {
    content,
    page: requireInteger(page, "page", 0),
    size,
    totalElements,
    totalPages,
  };
}

export function parseHistoryDetail(payload: unknown): HistoryDetail {
  const detail = requireRecord(payload);
  if (
    !Array.isArray(detail.participants) ||
    !Array.isArray(detail.actions)
  ) {
    throw ApiError.invalidResponse();
  }

  const status = requireEnum(detail, "status", GAME_STATUSES);
  const participants = detail.participants.map(
    parseHistoryParticipant,
  );
  const actions = detail.actions.map(parseHistoryAction);
  const actionCount = requireInteger(detail, "actionCount", 0, 20);

  if (
    !hasValidParticipants(participants, status) ||
    actionCount !== actions.length ||
    actions.some(
      (action, index) => action.sequenceNo !== index + 1,
    )
  ) {
    throw ApiError.invalidResponse();
  }

  return {
    actionCount,
    actions,
    answerPokemon: parsePokemonSummary(detail.answerPokemon),
    endedAt: requireDateTime(detail, "endedAt"),
    endReason: requireEnum(
      detail,
      "endReason",
      GAME_END_REASONS,
    ),
    gameId: requireUuid(detail, "gameId"),
    participants,
    startedAt: requireDateTime(detail, "startedAt"),
    status,
  };
}

function parseHistoryListItem(payload: unknown): HistoryListItem {
  const item = requireRecord(payload);
  const opponent = requireRecord(item.opponent);
  return {
    actionCount: requireInteger(item, "actionCount", 0, 20),
    answerPokemon: parsePokemonSummary(item.answerPokemon),
    endedAt: requireDateTime(item, "endedAt"),
    endReason: requireEnum(
      item,
      "endReason",
      GAME_END_REASONS,
    ),
    gameId: requireUuid(item, "gameId"),
    myResult: requireEnum(item, "myResult", GAME_RESULTS),
    myRole: requireEnum(item, "myRole", GAME_ROLES),
    opponent: {
      id: requireUuid(opponent, "id"),
      nickname: requireString(opponent, "nickname"),
    },
    startedAt: requireDateTime(item, "startedAt"),
  };
}

function parseHistoryParticipant(
  payload: unknown,
): HistoryParticipant {
  const participant = requireRecord(payload);
  return {
    nickname: requireString(participant, "nickname"),
    result: requireEnum(participant, "result", GAME_RESULTS),
    role: requireEnum(participant, "role", GAME_ROLES),
    userId: requireUuid(participant, "userId"),
  };
}

function parseHistoryAction(payload: unknown): HistoryAction {
  const action = requireRecord(payload);
  const type = requireEnum(
    action,
    "type",
    GAME_ACTION_TYPES,
  );
  const answer = nullableEnum(action, "answer", GAME_ANSWERS);
  const answeredAt = nullableDateTime(action, "answeredAt");
  const comment = requireAnswerComment(action.comment);
  const correct = nullableBoolean(action, "correct");
  const guessedPokemon =
    action.guessedPokemon === null
      ? null
      : parsePokemonSummary(action.guessedPokemon);
  const question = nullableString(action, "question");

  const validQuestion =
    type === "QUESTION" &&
    question !== null &&
    guessedPokemon === null &&
    correct === null &&
    ((answer === null &&
      comment === null &&
      answeredAt === null) ||
      (answer !== null && answeredAt !== null));
  const validGuess =
    type === "GUESS" &&
    question === null &&
    answer === null &&
    comment === null &&
    answeredAt === null &&
    guessedPokemon !== null &&
    correct !== null;
  if (!validQuestion && !validGuess) {
    throw ApiError.invalidResponse();
  }

  return {
    answer,
    answeredAt,
    comment,
    correct,
    createdAt: requireDateTime(action, "createdAt"),
    guessedPokemon,
    question,
    sequenceNo: requireInteger(action, "sequenceNo", 1, 20),
    type,
  };
}

function hasValidParticipants(
  participants: readonly HistoryParticipant[],
  status: GameStatus,
): boolean {
  if (
    participants.length !== 2 ||
    new Set(participants.map(({ userId }) => userId)).size !== 2 ||
    new Set(participants.map(({ role }) => role)).size !== 2
  ) {
    return false;
  }
  const results = participants.map(({ result }) => result).sort();
  return status === "COMPLETED"
    ? results.join(",") === "LOSS,WIN"
    : results.join(",") === "NONE,NONE";
}

function requireEnum<const Value extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly Value[],
): Value {
  const candidate = requireString(record, key);
  if (!allowed.includes(candidate as Value)) {
    throw ApiError.invalidResponse();
  }
  return candidate as Value;
}

function nullableEnum<const Value extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly Value[],
): Value | null {
  return record[key] === null
    ? null
    : requireEnum(record, key, allowed);
}

function nullableBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  return record[key] === null
    ? null
    : requireBoolean(record, key);
}

function nullableDateTime(
  record: Record<string, unknown>,
  key: string,
): string | null {
  return record[key] === null
    ? null
    : requireDateTime(record, key);
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  return record[key] === null
    ? null
    : requireString(record, key);
}

function requireAnswerComment(
  value: unknown,
): string | null {
  if (!isAnswerCommentValue(value)) {
    throw ApiError.invalidResponse();
  }
  return value;
}
