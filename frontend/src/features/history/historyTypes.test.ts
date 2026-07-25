import { describe, expect, it } from "vitest";

import {
  parseHistoryDetail,
  parseHistoryPage,
} from "./historyTypes";

const PIKACHU = {
  artworkEnabled: true,
  artworkUrl: "https://example.test/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"],
};
const GAME_ID = "b10d3452-0508-4964-a037-61460073cc7a";
const CURRENT_USER_ID =
  "624f7d62-e328-4ff0-8b90-f6520b81a47f";
const OPPONENT_USER_ID =
  "70226fe2-cdee-4261-a3cb-fbd87a4df783";

describe("historyTypes", () => {
  it("should_parseHistoryPage_when_payloadIsValid", () => {
    expect(
      parseHistoryPage({
        content: [
          {
            actionCount: 2,
            answerPokemon: PIKACHU,
            endedAt: "2026-07-25T05:05:00Z",
            endReason: "CORRECT_GUESS",
            gameId: GAME_ID,
            myResult: "WIN",
            myRole: "QUESTIONER",
            opponent: {
              id: OPPONENT_USER_ID,
              nickname: "그린",
            },
            startedAt: "2026-07-25T05:00:00Z",
          },
        ],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
      }),
    ).toMatchObject({
      content: [
        {
          gameId: GAME_ID,
          myResult: "WIN",
        },
      ],
      totalElements: 1,
    });
  });

  it("should_parseNullableQuestionAnswer_when_gameWasAborted", () => {
    expect(
      parseHistoryDetail(
        historyDetail({
          actionCount: 1,
          actions: [
            {
              answer: null,
              answeredAt: null,
              comment: null,
              correct: null,
              createdAt: "2026-07-25T05:01:00Z",
              guessedPokemon: null,
              question: "날개가 있나요?",
              sequenceNo: 1,
              type: "QUESTION",
            },
          ],
          participants: [
            {
              nickname: "레드",
              result: "NONE",
              role: "QUESTIONER",
              userId: CURRENT_USER_ID,
            },
            {
              nickname: "그린",
              result: "NONE",
              role: "SELECTOR",
              userId: OPPONENT_USER_ID,
            },
          ],
          status: "ABORTED",
        }),
      ).actions[0],
    ).toMatchObject({
      answer: null,
      answeredAt: null,
      comment: null,
      question: "날개가 있나요?",
    });
  });

  it("should_rejectHistoryDetail_when_participantShapeIsInvalid", () => {
    expect(() =>
      parseHistoryDetail(
        historyDetail({
          participants: [
            {
              nickname: "레드",
              result: "WIN",
              role: "QUESTIONER",
              userId: CURRENT_USER_ID,
            },
            {
              nickname: "그린",
              result: "WIN",
              role: "QUESTIONER",
              userId: OPPONENT_USER_ID,
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("should_rejectHistoryDetail_when_actionShapeIsInvalid", () => {
    expect(() =>
      parseHistoryDetail(
        historyDetail({
          actionCount: 1,
          actions: [
            {
              answer: "YES",
              answeredAt: "2026-07-25T05:01:02Z",
              comment: "전기 타입이에요.",
              correct: true,
              createdAt: "2026-07-25T05:01:00Z",
              guessedPokemon: PIKACHU,
              question: "전기 타입인가요?",
              sequenceNo: 1,
              type: "QUESTION",
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("should_parseAnswerComment_when_historyDetailIsValid", () => {
    expect(
      parseHistoryDetail(
        historyDetail({
          actionCount: 1,
          actions: [
            {
              answer: "UNKNOWN",
              answeredAt: "2026-07-25T05:01:02Z",
              comment: "정확히 확인하기 어려워요.",
              correct: null,
              createdAt: "2026-07-25T05:01:00Z",
              guessedPokemon: null,
              question: "밤에만 나타나나요?",
              sequenceNo: 1,
              type: "QUESTION",
            },
          ],
        }),
      ).actions[0],
    ).toMatchObject({
      answer: "UNKNOWN",
      comment: "정확히 확인하기 어려워요.",
    });
  });

  it("should_rejectHistoryPage_when_metadataIsInconsistent", () => {
    expect(() =>
      parseHistoryPage({
        content: [],
        page: 0,
        size: 20,
        totalElements: 21,
        totalPages: 3,
      }),
    ).toThrow();
  });
});

function historyDetail(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    actionCount: 0,
    actions: [],
    answerPokemon: PIKACHU,
    endedAt: "2026-07-25T05:05:00Z",
    endReason: "CORRECT_GUESS",
    gameId: GAME_ID,
    participants: [
      {
        nickname: "레드",
        result: "WIN",
        role: "QUESTIONER",
        userId: CURRENT_USER_ID,
      },
      {
        nickname: "그린",
        result: "LOSS",
        role: "SELECTOR",
        userId: OPPONENT_USER_ID,
      },
    ],
    startedAt: "2026-07-25T05:00:00Z",
    status: "COMPLETED",
    ...overrides,
  };
}
