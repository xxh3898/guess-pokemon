import { describe, expect, it } from "vitest";

import {
  parseRealtimeError,
  parseRoomRealtimeEvent,
} from "./realtimeTypes";

const EVENT_ID = "2069dc9a-624f-48f9-8b2c-65e912006224";
const GAME_ID = "3f249b3c-f0a6-4054-8bcf-e6284eec5f3e";
const HOST_ID = "624f7d62-e328-4ff0-8b90-f6520b81a47f";
const GUEST_ID = "70226fe2-cdee-4261-a3cb-fbd87a4df783";
const PIKACHU = {
  artworkEnabled: true,
  artworkUrl:
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"],
};
const HOST_MEMBER = {
  connected: true,
  nickname: "레드",
  reconnectDeadline: null,
  role: "SELECTOR",
  userId: HOST_ID,
};
describe("realtimeTypes", () => {
  it("should_parseAuthoritativeSnapshot_when_roomSnapshotArrives", () => {
    const event = parseRoomRealtimeEvent(
      eventBody("ROOM_SNAPSHOT", null, 1, {
        game: null,
        me: HOST_MEMBER,
        opponent: null,
        rematch: null,
        roomCode: "AB3K7M",
        roundNumber: 1,
        stateVersion: 1,
        status: "WAITING_FOR_OPPONENT",
      }),
    );

    expect(event).toMatchObject({
      eventType: "ROOM_SNAPSHOT",
      gameId: null,
      payload: {
        roomCode: "AB3K7M",
        status: "WAITING_FOR_OPPONENT",
      },
    });
  });

  it("should_parseSelectorSecret_when_roundStartsForSelector", () => {
    expect(
      parseRoomRealtimeEvent(
        eventBody("ROUND_STARTED", GAME_ID, 3, {
          myRole: "SELECTOR",
          opponentRole: "QUESTIONER",
          remainingActionCount: 20,
          roundNumber: 1,
          selectedPokemon: PIKACHU,
          usedActionCount: 0,
        }),
      ),
    ).toMatchObject({
      eventType: "ROUND_STARTED",
      payload: {
        myRole: "SELECTOR",
        selectedPokemon: PIKACHU,
      },
    });
  });

  it("should_rejectSelectorSecret_when_roundStartsForQuestioner", () => {
    expect(() =>
      parseRoomRealtimeEvent(
        eventBody("ROUND_STARTED", GAME_ID, 3, {
          myRole: "QUESTIONER",
          opponentRole: "SELECTOR",
          remainingActionCount: 20,
          roundNumber: 1,
          selectedPokemon: PIKACHU,
          usedActionCount: 0,
        }),
      ),
    ).toThrow(
      "서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    );
  });

  it("should_parseActionEvents_when_gameCommandsSucceed", () => {
    const asked = parseRoomRealtimeEvent(
      eventBody("QUESTION_ASKED", GAME_ID, 4, {
        question: "날개가 있나요?",
        remainingActionCount: 19,
        sequenceNo: 1,
        usedActionCount: 1,
      }),
    );
    const answered = parseRoomRealtimeEvent(
      eventBody("QUESTION_ANSWERED", GAME_ID, 5, {
        answer: "NO",
        comment: "날개처럼 보이지만 팔이에요.",
        question: "날개가 있나요?",
        remainingActionCount: 19,
        sequenceNo: 1,
        usedActionCount: 1,
      }),
    );
    const guessed = parseRoomRealtimeEvent(
      eventBody("GUESS_RESOLVED", GAME_ID, 6, {
        correct: false,
        guessedPokemon: PIKACHU,
        remainingActionCount: 18,
        sequenceNo: 2,
        usedActionCount: 2,
      }),
    );

    expect(asked).toMatchObject({
      eventType: "QUESTION_ASKED",
      payload: { sequenceNo: 1 },
    });
    expect(answered).toMatchObject({
      eventType: "QUESTION_ANSWERED",
      payload: {
        answer: "NO",
        comment: "날개처럼 보이지만 팔이에요.",
      },
    });
    expect(guessed).toMatchObject({
      eventType: "GUESS_RESOLVED",
      payload: { guessedPokemon: PIKACHU },
    });
  });

  it("should_parseNullComment_when_questionHasNoAnswerComment", () => {
    expect(
      parseRoomRealtimeEvent(
        eventBody("QUESTION_ANSWERED", GAME_ID, 5, {
          answer: "YES",
          comment: null,
          question: "전기 타입인가요?",
          remainingActionCount: 19,
          sequenceNo: 1,
          usedActionCount: 1,
        }),
      ),
    ).toMatchObject({
      payload: {
        comment: null,
      },
    });
  });

  it("should_rejectQuestionAnsweredEvent_when_commentIsInvalid", () => {
    expect(() =>
      parseRoomRealtimeEvent(
        eventBody("QUESTION_ANSWERED", GAME_ID, 5, {
          answer: "YES",
          comment: " 바깥 공백",
          question: "전기 타입인가요?",
          remainingActionCount: 19,
          sequenceNo: 1,
          usedActionCount: 1,
        }),
      ),
    ).toThrow(
      "서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    );
  });

  it("should_parseCompletedGame_when_gameEndedArrives", () => {
    expect(
      parseRoomRealtimeEvent(
        eventBody("GAME_ENDED", GAME_ID, 8, {
          answerPokemon: PIKACHU,
          endReason: "CORRECT_GUESS",
          loserUserId: HOST_ID,
          status: "COMPLETED",
          usedActionCount: 3,
          winnerUserId: GUEST_ID,
        }),
      ),
    ).toMatchObject({
      eventType: "GAME_ENDED",
      payload: {
        answerPokemon: PIKACHU,
        winnerUserId: GUEST_ID,
      },
    });
  });

  it("should_rejectWinner_when_gameWasAborted", () => {
    expect(() =>
      parseRoomRealtimeEvent(
        eventBody("GAME_ENDED", GAME_ID, 8, {
          answerPokemon: PIKACHU,
          endReason: "SERVER_RESTART",
          loserUserId: null,
          status: "ABORTED",
          usedActionCount: 3,
          winnerUserId: GUEST_ID,
        }),
      ),
    ).toThrow(
      "서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    );
  });

  it("should_parseConnectionRoomClosedAndRematchEvents_when_received", () => {
    expect(
      parseRoomRealtimeEvent(
        eventBody("PLAYER_CONNECTION_CHANGED", GAME_ID, 9, {
          connected: false,
          reconnectDeadline: "2026-07-25T03:01:00Z",
          userId: GUEST_ID,
        }),
      ),
    ).toMatchObject({
      eventType: "PLAYER_CONNECTION_CHANGED",
      payload: { connected: false },
    });
    expect(
      parseRoomRealtimeEvent(
        eventBody("ROOM_CLOSED", null, 10, {
          leftUserId: HOST_ID,
          reason: "HOST_LEFT",
        }),
      ),
    ).toMatchObject({
      eventType: "ROOM_CLOSED",
      payload: { reason: "HOST_LEFT" },
    });
    expect(
      parseRoomRealtimeEvent(
        eventBody("REMATCH_STATE_CHANGED", GAME_ID, 11, {
          meReady: true,
          opponentReady: false,
        }),
      ),
    ).toMatchObject({
      eventType: "REMATCH_STATE_CHANGED",
      payload: { meReady: true },
    });
  });

  it("should_parseNullableCommandId_when_realtimeErrorArrives", () => {
    expect(
      parseRealtimeError(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          commandId: null,
          latestStateVersion: null,
          message: "요청 입력값을 확인해 주세요.",
          recoverable: true,
        }),
      ),
    ).toEqual({
      code: "VALIDATION_FAILED",
      commandId: null,
      latestStateVersion: null,
      message: "요청 입력값을 확인해 주세요.",
      recoverable: true,
    });
  });

  it("should_rejectInvalidJson_when_messageCannotBeParsed", () => {
    expect(() => parseRoomRealtimeEvent("{broken")).toThrow(
      "서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    );
  });
});

function eventBody(
  eventType: string,
  gameId: string | null,
  stateVersion: number,
  payload: unknown,
): string {
  return JSON.stringify({
    eventId: EVENT_ID,
    eventType,
    gameId,
    occurredAt: "2026-07-25T03:00:00Z",
    payload,
    roomCode: "AB3K7M",
    stateVersion,
  });
}
