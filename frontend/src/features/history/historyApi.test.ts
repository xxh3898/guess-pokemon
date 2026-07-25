import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  HttpClient,
} from "../../shared/api/HttpClient";
import { createGameHistoryGateway } from "./historyApi";

const GAME_ID = "b10d3452-0508-4964-a037-61460073cc7a";

describe("historyApi", () => {
  it("should_sendResultAndPage_when_filterIsGiven", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [],
        page: 1,
        size: 20,
        totalElements: 0,
        totalPages: 0,
      }),
    );
    const gateway =
      createGameHistoryGateway(new HttpClient(fetcher));
    const controller = new AbortController();

    await gateway.list(
      {
        page: 1,
        result: "WIN",
      },
      controller.signal,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/games?page=1&size=20&result=WIN",
      expect.objectContaining({
        method: "GET",
        signal: controller.signal,
      }),
    );
  });

  it("should_fetchDetail_when_gameIdIsValid", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        actionCount: 0,
        actions: [],
        answerPokemon: {
          artworkEnabled: false,
          artworkUrl: null,
          generation: 1,
          koreanName: "피카츄",
          nationalDexId: 25,
        },
        endedAt: "2026-07-25T05:05:00Z",
        endReason: "CORRECT_GUESS",
        gameId: GAME_ID,
        participants: [
          {
            nickname: "레드",
            result: "WIN",
            role: "QUESTIONER",
            userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
          },
          {
            nickname: "그린",
            result: "LOSS",
            role: "SELECTOR",
            userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
          },
        ],
        startedAt: "2026-07-25T05:00:00Z",
        status: "COMPLETED",
      }),
    );
    const gateway =
      createGameHistoryGateway(new HttpClient(fetcher));

    await expect(gateway.findDetail(GAME_ID)).resolves.toMatchObject({
      gameId: GAME_ID,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `/api/v1/games/${GAME_ID}`,
    );
  });

  it("should_rejectBeforeFetch_when_requestIsInvalid", async () => {
    const fetcher = vi.fn();
    const gateway =
      createGameHistoryGateway(new HttpClient(fetcher));

    await expect(
      gateway.list({ page: -1, result: null }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      gateway.findDetail("not-a-uuid"),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}
