import type {
  HistoryDetail,
  HistoryPage,
} from "../features/history/historyTypes";

export const TEST_GAME_ID =
  "b10d3452-0508-4964-a037-61460073cc7a";
export const TEST_OPPONENT_USER_ID =
  "70226fe2-cdee-4261-a3cb-fbd87a4df783";

const PIKACHU = {
  artworkEnabled: true,
  artworkUrl: "https://example.test/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"],
} as const;

export const TEST_HISTORY_PAGE: HistoryPage = {
  content: [
    {
      actionCount: 2,
      answerPokemon: PIKACHU,
      endedAt: "2026-07-25T05:05:00Z",
      endReason: "CORRECT_GUESS",
      gameId: TEST_GAME_ID,
      myResult: "WIN",
      myRole: "QUESTIONER",
      opponent: {
        id: TEST_OPPONENT_USER_ID,
        nickname: "그린",
      },
      startedAt: "2026-07-25T05:00:00Z",
    },
  ],
  page: 0,
  size: 20,
  totalElements: 1,
  totalPages: 1,
};

export const TEST_HISTORY_DETAIL: HistoryDetail = {
  actionCount: 2,
  actions: [
    {
      answer: "YES",
      answeredAt: "2026-07-25T05:01:04Z",
      correct: null,
      createdAt: "2026-07-25T05:01:00Z",
      guessedPokemon: null,
      question: "<script>alert('위험')</script>",
      sequenceNo: 1,
      type: "QUESTION",
    },
    {
      answer: null,
      answeredAt: null,
      correct: true,
      createdAt: "2026-07-25T05:05:00Z",
      guessedPokemon: PIKACHU,
      question: null,
      sequenceNo: 2,
      type: "GUESS",
    },
  ],
  answerPokemon: PIKACHU,
  endedAt: "2026-07-25T05:05:00Z",
  endReason: "CORRECT_GUESS",
  gameId: TEST_GAME_ID,
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
      userId: TEST_OPPONENT_USER_ID,
    },
  ],
  startedAt: "2026-07-25T05:00:00Z",
  status: "COMPLETED",
};
