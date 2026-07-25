import {
  ApiError,
  type ApiPath,
  HttpClient,
  httpClient,
} from "../../shared/api/HttpClient";
import {
  parseHistoryDetail,
  parseHistoryPage,
  type GameResult,
  type HistoryDetail,
  type HistoryPage,
} from "./historyTypes";

const DEFAULT_PAGE_SIZE = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HistoryPageRequest {
  readonly page: number;
  readonly result: GameResult | null;
  readonly size?: number;
}

export interface GameHistoryGateway {
  findDetail(
    gameId: string,
    signal?: AbortSignal,
  ): Promise<HistoryDetail>;
  list(
    request: HistoryPageRequest,
    signal?: AbortSignal,
  ): Promise<HistoryPage>;
}

export function createGameHistoryGateway(
  client: HttpClient,
): GameHistoryGateway {
  return {
    async findDetail(gameId, signal) {
      if (!UUID_PATTERN.test(gameId)) {
        throw validationError(
          "경기 기록 주소를 다시 확인해 주세요.",
        );
      }
      const payload = await client.get(
        `/api/v1/games/${gameId}`,
        signal,
      );
      return parseHistoryDetail(payload);
    },
    async list(request, signal) {
      const size = request.size ?? DEFAULT_PAGE_SIZE;
      requireIntegerInRange(request.page, 0);
      requireIntegerInRange(size, 1, 100);

      const search = new URLSearchParams({
        page: String(request.page),
        size: String(size),
      });
      if (request.result !== null) {
        search.set("result", request.result);
      }
      const path: ApiPath =
        `/api/v1/games?${search.toString()}`;
      const payload = await client.get(path, signal);
      return parseHistoryPage(payload);
    },
  };
}

export const gameHistoryGateway =
  createGameHistoryGateway(httpClient);

function requireIntegerInRange(
  value: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw validationError(
      "경기 기록 조회 조건을 다시 확인해 주세요.",
    );
  }
}

function validationError(detail: string): ApiError {
  return new ApiError({
    code: "VALIDATION_FAILED",
    detail,
    status: 400,
    title: "조회 조건 확인",
  });
}
