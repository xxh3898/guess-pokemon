import { describe, expect, it } from "vitest";

import type { RoomRealtimeEvent } from "../../shared/realtime/realtimeTypes";
import {
  applyAuthoritativeSnapshot,
  applyRoomEvent,
} from "./roomState";
import type {
  ActiveRoomSnapshot,
  WaitingRoomSnapshot,
} from "./roomTypes";

const GAME_ID = "3f249b3c-f0a6-4054-8bcf-e6284eec5f3e";
const PIKACHU = {
  artworkEnabled: true,
  artworkUrl:
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"] as const,
};
const HOST_SNAPSHOT: WaitingRoomSnapshot = {
  game: null,
  me: {
    connected: true,
    nickname: "레드",
    reconnectDeadline: null,
    role: "SELECTOR",
    userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
  },
  opponent: null,
  rematch: null,
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 1,
  status: "WAITING_FOR_OPPONENT",
};

describe("roomState", () => {
  it("should_acceptSameVersionSnapshot_when_joinNoticeArrivedFirst", () => {
    const joined = twoPlayerSnapshot();
    const notified = applyRoomEvent(HOST_SNAPSHOT, {
      ...baseEvent(2, null),
      eventType: "PLAYER_JOINED",
      payload: {
        player: {
          nickname: "그린",
          userId: joined.opponent?.userId ?? "",
        },
      },
    });

    expect(
      applyRoomEvent(notified, {
        ...baseEvent(2, null),
        eventType: "ROOM_SNAPSHOT",
        payload: joined,
      }),
    ).toEqual(joined);
  });

  it("should_keepLatestSnapshot_when_restResponseArrivesLate", () => {
    const joined = twoPlayerSnapshot();

    expect(
      applyAuthoritativeSnapshot(joined, HOST_SNAPSHOT),
    ).toEqual(joined);
  });

  it("should_createRoleSpecificGame_when_roundStarts", () => {
    const result = applyRoomEvent(twoPlayerSnapshot(), {
      ...baseEvent(3, GAME_ID),
      eventType: "ROUND_STARTED",
      gameId: GAME_ID,
      payload: {
        myRole: "SELECTOR",
        opponentRole: "QUESTIONER",
        remainingActionCount: 20,
        roundNumber: 1,
        selectedPokemon: PIKACHU,
        usedActionCount: 0,
      },
    });

    expect(result).toMatchObject({
      game: {
        selectedPokemon: PIKACHU,
        status: "IN_PROGRESS",
      },
      status: "PLAYING",
    });
  });

  it("should_appendAndAnswerQuestion_when_eventsArrive", () => {
    const started = activeSnapshot();
    const asked = applyRoomEvent(started, {
      ...baseEvent(4, GAME_ID),
      eventType: "QUESTION_ASKED",
      gameId: GAME_ID,
      payload: {
        question: "날개가 있나요?",
        remainingActionCount: 19,
        sequenceNo: 1,
        usedActionCount: 1,
      },
    });
    const answered = applyRoomEvent(asked, {
      ...baseEvent(5, GAME_ID),
      eventType: "QUESTION_ANSWERED",
      gameId: GAME_ID,
      payload: {
        answer: "NO",
        question: "날개가 있나요?",
        remainingActionCount: 19,
        sequenceNo: 1,
        usedActionCount: 1,
      },
    });

    expect(answered?.game?.actions).toEqual([
      expect.objectContaining({
        answer: "NO",
        question: "날개가 있나요?",
        sequenceNumber: 1,
      }),
    ]);
  });

  it("should_applyAnswer_when_sameVersionCompletesPendingQuestion", () => {
    const asked = applyRoomEvent(activeSnapshot(), {
      ...baseEvent(4, GAME_ID),
      eventType: "QUESTION_ASKED",
      gameId: GAME_ID,
      payload: {
        question: "노란색인가요?",
        remainingActionCount: 19,
        sequenceNo: 1,
        usedActionCount: 1,
      },
    });
    const answered = applyRoomEvent(asked, {
      ...baseEvent(4, GAME_ID),
      eventType: "QUESTION_ANSWERED",
      gameId: GAME_ID,
      payload: {
        answer: "YES",
        question: "노란색인가요?",
        remainingActionCount: 19,
        sequenceNo: 1,
        usedActionCount: 1,
      },
    });

    expect(answered?.game?.actions[0]).toMatchObject({
      answer: "YES",
      sequenceNumber: 1,
    });
  });

  it("should_applyTerminalEvent_when_guessSharesStateVersion", () => {
    const guessed = applyRoomEvent(activeSnapshot(), {
      ...baseEvent(4, GAME_ID),
      eventType: "GUESS_RESOLVED",
      gameId: GAME_ID,
      payload: {
        correct: true,
        guessedPokemon: PIKACHU,
        remainingActionCount: 19,
        sequenceNo: 1,
        usedActionCount: 1,
      },
    });
    const ended = applyRoomEvent(guessed, {
      ...baseEvent(4, GAME_ID),
      eventType: "GAME_ENDED",
      gameId: GAME_ID,
      payload: {
        answerPokemon: PIKACHU,
        endReason: "CORRECT_GUESS",
        loserUserId: HOST_SNAPSHOT.me.userId,
        status: "COMPLETED",
        usedActionCount: 1,
        winnerUserId: twoPlayerSnapshot().opponent?.userId ?? "",
      },
    });

    expect(ended).toMatchObject({
      game: {
        actions: [
          {
            correct: true,
            guessedPokemon: PIKACHU,
          },
        ],
        answerPokemon: PIKACHU,
      },
      status: "RESULT",
    });
  });

  it("should_ignoreDuplicateActionAndTerminalEvents_when_replayed", () => {
    const guessEvent: RoomRealtimeEvent = {
      ...baseEvent(4, GAME_ID),
      eventType: "GUESS_RESOLVED",
      gameId: GAME_ID,
      payload: {
        correct: true,
        guessedPokemon: PIKACHU,
        remainingActionCount: 19,
        sequenceNo: 1,
        usedActionCount: 1,
      },
    };
    const guessed = applyRoomEvent(activeSnapshot(), guessEvent);

    expect(applyRoomEvent(guessed, guessEvent)).toBe(guessed);
  });

  it("should_pauseAndResumeGame_when_connectionChanges", () => {
    const started = activeSnapshot();
    const paused = applyRoomEvent(started, {
      ...baseEvent(4, GAME_ID),
      eventType: "PLAYER_CONNECTION_CHANGED",
      payload: {
        connected: false,
        reconnectDeadline: "2026-07-25T03:01:00Z",
        userId: started.opponent.userId,
      },
    });
    const resumed = applyRoomEvent(paused, {
      ...baseEvent(5, GAME_ID),
      eventType: "PLAYER_CONNECTION_CHANGED",
      payload: {
        connected: true,
        reconnectDeadline: null,
        userId: started.opponent.userId,
      },
    });

    expect(paused).toMatchObject({ status: "PAUSED" });
    expect(resumed).toMatchObject({ status: "PLAYING" });
  });

  it("should_updateRematchState_when_resultRoomReceivesReadiness", () => {
    const result = applyRoomEvent(activeSnapshot(), {
      ...baseEvent(4, GAME_ID),
      eventType: "GAME_ENDED",
      gameId: GAME_ID,
      payload: {
        answerPokemon: PIKACHU,
        endReason: "QUESTION_LIMIT",
        loserUserId: twoPlayerSnapshot().opponent?.userId ?? "",
        status: "COMPLETED",
        usedActionCount: 0,
        winnerUserId: HOST_SNAPSHOT.me.userId,
      },
    });
    const ready = applyRoomEvent(result, {
      ...baseEvent(5, GAME_ID),
      eventType: "REMATCH_STATE_CHANGED",
      gameId: GAME_ID,
      payload: {
        meReady: true,
        opponentReady: false,
      },
    });

    expect(ready).toMatchObject({
      rematch: {
        meReady: true,
        opponentReady: false,
      },
      stateVersion: 5,
    });
  });

  it("should_ignoreStaleConnectionEvent_when_newerStateExists", () => {
    const started = activeSnapshot();
    const event: RoomRealtimeEvent = {
      ...baseEvent(2, GAME_ID),
      eventType: "PLAYER_CONNECTION_CHANGED",
      payload: {
        connected: false,
        reconnectDeadline: null,
        userId: started.opponent.userId,
      },
    };

    expect(applyRoomEvent(started, event)).toBe(started);
  });
});

function twoPlayerSnapshot(): WaitingRoomSnapshot {
  return {
    ...HOST_SNAPSHOT,
    opponent: {
      connected: true,
      nickname: "그린",
      reconnectDeadline: null,
      role: "QUESTIONER",
      userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
    },
    stateVersion: 2,
    status: "WAITING_FOR_SELECTION",
  };
}

function activeSnapshot(): ActiveRoomSnapshot {
  const waiting = twoPlayerSnapshot();
  return {
    ...waiting,
    game: {
      actions: [],
      gameId: GAME_ID,
      remainingActionCount: 20,
      selectedPokemon: PIKACHU,
      status: "IN_PROGRESS",
      usedActionCount: 0,
    },
    opponent: waiting.opponent!,
    stateVersion: 3,
    status: "PLAYING",
  };
}

function baseEvent(
  stateVersion: number,
  gameId: string | null,
): Omit<RoomRealtimeEvent, "eventType" | "payload"> {
  return {
    eventId: "2069dc9a-624f-48f9-8b2c-65e912006224",
    gameId,
    occurredAt: "2026-07-25T03:00:00Z",
    roomCode: "AB3K7M",
    stateVersion,
  };
}
