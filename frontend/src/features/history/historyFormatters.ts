import type {
  GameAnswer,
  GameEndReason,
  GameResult,
  GameRole,
} from "./historyTypes";

interface DateFormatOptions {
  readonly timeZone?: string;
}

interface HistoryListDate {
  readonly date: string;
  readonly time: string;
}

export function formatHistoryListDate(
  value: string,
  options: DateFormatOptions = {},
): HistoryListDate {
  const parts = dateParts(value, options, false);
  return {
    date: `${parts.year}.${parts.month}.${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function formatHistoryDetailDate(
  value: string,
  options: DateFormatOptions = {},
): string {
  const parts = dateParts(value, options, true);
  return (
    `${parts.year}.${parts.month}.${parts.day} ` +
    `(${parts.weekday}) ${parts.hour}:${parts.minute}`
  );
}

export function formatHistoryActionTime(
  value: string,
  options: DateFormatOptions = {},
): string {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    timeZone: options.timeZone,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(value))
      .map(({ type, value: part }) => [type, part]),
  );
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function gameAnswerLabel(answer: GameAnswer): string {
  return {
    NO: "아니요",
    UNKNOWN: "모르겠어요",
    YES: "예",
  }[answer];
}

export function gameEndReasonLabel(
  endReason: GameEndReason,
): string {
  return {
    BOTH_DISCONNECTED: "양쪽 모두 이탈",
    CORRECT_GUESS: "정답 추측",
    PLAYER_LEFT: "참가자 이탈",
    QUESTION_LIMIT: "질문 20회 소진",
    RECONNECT_TIMEOUT: "재접속 시간 초과",
    SERVER_RESTART: "서버 재시작으로 중단",
  }[endReason];
}

export function gameResultLabel(result: GameResult): string {
  return {
    LOSS: "패배",
    NONE: "중단",
    WIN: "승리",
  }[result];
}

export function gameRoleLabel(role: GameRole): string {
  return {
    QUESTIONER: "질문자",
    SELECTOR: "출제자",
  }[role];
}

function dateParts(
  value: string,
  options: DateFormatOptions,
  includeWeekday: boolean,
): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: options.timeZone,
    weekday: includeWeekday ? "short" : undefined,
    year: "numeric",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(new Date(value))
      .map(({ type, value: part }) => [type, part]),
  );
}
