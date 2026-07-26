import { describe, expect, it } from "vitest";

import {
  parseRoomSnapshot,
  parseWaitingRoomSnapshot,
} from "./roomTypes";

const SELECTOR = {
  connected: true,
  nickname: "레드",
  reconnectDeadline: null,
  role: "SELECTOR",
  userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
};

const QUESTIONER = {
  connected: true,
  nickname: "그린",
  reconnectDeadline: null,
  role: "QUESTIONER",
  userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
};

const PIKACHU = {
  artworkEnabled: true,
  artworkUrl: "https://example.test/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"],
};

const ACTIVE_GAME = {
  actions: [],
  gameId: "3f249b3c-f0a6-4054-8bcf-e6284eec5f3e",
  remainingActionCount: 20,
  status: "IN_PROGRESS",
  usedActionCount: 0,
};

describe("roomTypes", () => {
  it("should_parseWaitingSnapshot_when_hostHasNoOpponent", () => {
    expect(
      parseWaitingRoomSnapshot({
        game: null,
        me: {
          ...SELECTOR,
          role: null,
        },
        opponent: null,
        roleAssignment: null,
        roleSelection: null,
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 1,
        status: "WAITING_FOR_OPPONENT",
      }),
    ).toMatchObject({
      opponent: null,
      status: "WAITING_FOR_OPPONENT",
    });
  });

  it("should_hideOpponentPreference_when_rolesAreBeingSelected", () => {
    expect(
      parseWaitingRoomSnapshot({
        game: null,
        me: {
          ...SELECTOR,
          role: null,
        },
        opponent: {
          ...QUESTIONER,
          role: null,
        },
        roleAssignment: null,
        roleSelection: {
          opponentSelected: true,
          preferredRole: "SELECTOR",
        },
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 3,
        status: "WAITING_FOR_ROLE_SELECTION",
      }),
    ).toMatchObject({
      me: { role: null },
      opponent: { role: null },
      roleSelection: {
        opponentSelected: true,
        preferredRole: "SELECTOR",
      },
      status: "WAITING_FOR_ROLE_SELECTION",
    });
  });

  it("should_parseRandomAssignment_when_rolesHaveBeenAssigned", () => {
    expect(
      parseWaitingRoomSnapshot({
        game: null,
        me: SELECTOR,
        opponent: QUESTIONER,
        roleAssignment: {
          randomized: true,
        },
        roleSelection: null,
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 4,
        status: "WAITING_FOR_SELECTION",
      }),
    ).toMatchObject({
      roleAssignment: {
        randomized: true,
      },
      status: "WAITING_FOR_SELECTION",
    });
  });

  it("should_parseSelectedPokemon_when_selectorGameIsActive", () => {
    expect(
      parseRoomSnapshot({
        game: {
          ...ACTIVE_GAME,
          selectedPokemon: PIKACHU,
        },
        me: SELECTOR,
        opponent: QUESTIONER,
        roleAssignment: null,
        roleSelection: null,
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 3,
        status: "PLAYING",
      }),
    ).toMatchObject({
      game: {
        selectedPokemon: PIKACHU,
      },
      status: "PLAYING",
    });
  });

  it("should_omitSelectedPokemon_when_questionerGameIsActive", () => {
    const snapshot = parseRoomSnapshot({
      game: ACTIVE_GAME,
      me: QUESTIONER,
      opponent: SELECTOR,
      roleAssignment: null,
      roleSelection: null,
      roomCode: "AB3K7M",
      roundNumber: 1,
      stateVersion: 3,
      status: "PLAYING",
    });

    expect(snapshot.game).not.toHaveProperty("selectedPokemon");
    expect(JSON.stringify(snapshot)).not.toContain("피카츄");
  });

  it("should_rejectSnapshot_when_questionerPayloadContainsSecret", () => {
    expect(() =>
      parseRoomSnapshot({
        game: {
          ...ACTIVE_GAME,
          selectedPokemon: PIKACHU,
        },
        me: QUESTIONER,
        opponent: SELECTOR,
        roleAssignment: null,
        roleSelection: null,
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 3,
        status: "PLAYING",
      }),
    ).toThrow();
  });

  it("should_parseResultActions_when_gameIsCompleted", () => {
    expect(
      parseRoomSnapshot({
        game: {
          actions: [
            {
              answer: "YES",
              answeredAt: "2026-07-25T05:01:00Z",
              comment: "노란색 전기 포켓몬이에요.",
              correct: null,
              createdAt: "2026-07-25T05:00:00Z",
              guessedPokemonNationalDexId: null,
              question: "전기 타입인가요?",
              sequenceNumber: 1,
              type: "QUESTION",
            },
            {
              answer: null,
              answeredAt: null,
              comment: null,
              correct: true,
              createdAt: "2026-07-25T05:02:00Z",
              guessedPokemonNationalDexId: 25,
              question: null,
              sequenceNumber: 2,
              type: "GUESS",
            },
          ],
          answerPokemon: PIKACHU,
          endReason: "CORRECT_GUESS",
          gameId: ACTIVE_GAME.gameId,
          loserUserId: SELECTOR.userId,
          remainingActionCount: 18,
          status: "COMPLETED",
          usedActionCount: 2,
          winnerUserId: QUESTIONER.userId,
        },
        me: QUESTIONER,
        opponent: SELECTOR,
        roleAssignment: null,
        roleSelection: {
          opponentSelected: false,
          preferredRole: null,
        },
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 6,
        status: "RESULT",
      }),
    ).toMatchObject({
      game: {
        actions: [
          {
            answer: "YES",
            comment: "노란색 전기 포켓몬이에요.",
            type: "QUESTION",
          },
          {
            guessedPokemonNationalDexId: 25,
            type: "GUESS",
          },
        ],
        answerPokemon: PIKACHU,
      },
      status: "RESULT",
    });
  });

  it("should_rejectSnapshot_when_pendingQuestionHasComment", () => {
    expect(() =>
      parseRoomSnapshot({
        game: {
          actions: [
            {
              answer: null,
              answeredAt: null,
              comment: "아직 답변 전이에요.",
              correct: null,
              createdAt: "2026-07-25T05:00:00Z",
              guessedPokemonNationalDexId: null,
              question: "전기 타입인가요?",
              sequenceNumber: 1,
              type: "QUESTION",
            },
          ],
          gameId: ACTIVE_GAME.gameId,
          remainingActionCount: 19,
          status: "IN_PROGRESS",
          usedActionCount: 1,
        },
        me: QUESTIONER,
        opponent: SELECTOR,
        roleAssignment: null,
        roleSelection: null,
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 4,
        status: "PLAYING",
      }),
    ).toThrow();
  });

  it("should_parseAbortedResult_when_bothPlayersDisconnected", () => {
    expect(
      parseRoomSnapshot({
        game: {
          actions: [],
          answerPokemon: PIKACHU,
          endReason: "BOTH_DISCONNECTED",
          gameId: ACTIVE_GAME.gameId,
          loserUserId: null,
          remainingActionCount: 20,
          status: "ABORTED",
          usedActionCount: 0,
          winnerUserId: null,
        },
        me: SELECTOR,
        opponent: QUESTIONER,
        roleAssignment: null,
        roleSelection: {
          opponentSelected: false,
          preferredRole: null,
        },
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 5,
        status: "RESULT",
      }),
    ).toMatchObject({
      game: {
        endReason: "BOTH_DISCONNECTED",
        winnerUserId: null,
      },
      status: "RESULT",
    });
  });

  it("should_rejectSnapshot_when_actionCountDoesNotMatchActions", () => {
    expect(() =>
      parseRoomSnapshot({
        game: {
          ...ACTIVE_GAME,
          remainingActionCount: 19,
          usedActionCount: 1,
        },
        me: QUESTIONER,
        opponent: SELECTOR,
        roleAssignment: null,
        roleSelection: null,
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 3,
        status: "PLAYING",
      }),
    ).toThrow();
  });
});
