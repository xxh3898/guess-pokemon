import type {
  GameEndedEvent,
  PlayerConnectionChangedEvent,
  QuestionAnsweredEvent,
  RoomRealtimeEvent,
} from "../../shared/realtime/realtimeTypes";
import {
  MAX_GAME_ACTION_COUNT,
  MAX_SILHOUETTE_GUESS_COUNT,
  type ActiveRoomSnapshot,
  type GameAction,
  type QuestionGameAction,
  type ResultRoomSnapshot,
  type RoomMember,
  type RoomSnapshot,
  type WaitingRoomSnapshot,
} from "./roomTypes";

export function applyAuthoritativeSnapshot(
  current: RoomSnapshot | null,
  incoming: RoomSnapshot,
): RoomSnapshot {
  if (
    current &&
    (incoming.roomCode !== current.roomCode ||
      incoming.stateVersion < current.stateVersion)
  ) {
    return current;
  }
  return incoming;
}

export function applyRoomEvent(
  current: RoomSnapshot | null,
  event: RoomRealtimeEvent,
): RoomSnapshot | null {
  if (event.eventType === "ROOM_SNAPSHOT") {
    return applyAuthoritativeSnapshot(current, event.payload);
  }
  if (
    !current ||
    event.roomCode !== current.roomCode ||
    event.stateVersion < current.stateVersion
  ) {
    return current;
  }

  const sameVersion =
    event.stateVersion === current.stateVersion;
  if (
    sameVersion &&
    !isComplementarySameVersionEvent(current, event)
  ) {
    return current;
  }

  switch (event.eventType) {
    case "PLAYER_JOINED":
      return withStateVersion(current, event.stateVersion);
    case "ROUND_STARTED":
      return applyRoundStarted(current, event);
    case "QUESTION_ASKED":
      return applyQuestionAsked(current, event);
    case "QUESTION_ANSWERED":
      return applyQuestionAnswered(current, event);
    case "GUESS_RESOLVED":
      return applyGuessResolved(current, event);
    case "PLAYER_CONNECTION_CHANGED":
      return applyConnectionChanged(current, event);
    case "GAME_ENDED":
      return applyGameEnded(current, event);
    case "IGNORED":
    case "ROOM_CLOSED":
      return current;
  }
}

export function applyWaitingRoomEvent(
  current: WaitingRoomSnapshot | null,
  event: RoomRealtimeEvent,
): RoomSnapshot | null {
  return applyRoomEvent(current, event);
}

function isComplementarySameVersionEvent(
  current: RoomSnapshot,
  event: RoomRealtimeEvent,
): boolean {
  if (
    event.eventType === "GAME_ENDED" &&
    current.status !== "RESULT"
  ) {
    return hasMatchingActiveGame(current, event.gameId);
  }
  if (
    event.eventType === "QUESTION_ANSWERED" &&
    isActive(current) &&
    current.game.gameId === event.gameId
  ) {
    const action = current.game.actions.find(
      (candidate) =>
        candidate.sequenceNumber === event.payload.sequenceNo,
    );
    return (
      action?.type === "QUESTION" && action.answer === null
    );
  }
  if (
    (event.eventType === "QUESTION_ASKED" ||
      event.eventType === "GUESS_RESOLVED") &&
    isActive(current) &&
    current.game.gameId === event.gameId
  ) {
    return !hasActionSequence(
      current.game.actions,
      event.payload.sequenceNo,
    );
  }
  return false;
}

function applyRoundStarted(
  current: RoomSnapshot,
  event: Extract<
    RoomRealtimeEvent,
    { eventType: "ROUND_STARTED" }
  >,
): RoomSnapshot {
  if (
    current.status !== "WAITING_FOR_SELECTION" ||
    current.me.role !== event.payload.myRole ||
    current.opponent.role !== event.payload.opponentRole
  ) {
    return current;
  }
  const gameBase = {
    actions: [] as readonly GameAction[],
    gameId: event.gameId,
    remainingActionCount: event.payload.remainingActionCount,
    status: "IN_PROGRESS" as const,
    usedActionCount: event.payload.usedActionCount,
  };
  if (event.payload.myRole === "SELECTOR") {
    return {
      ...current,
      game: {
        ...gameBase,
        selectedPokemon: event.payload.selectedPokemon,
      },
      roleAssignment: null,
      roleSelection: null,
      roundNumber: event.payload.roundNumber,
      stateVersion: event.stateVersion,
      status: "PLAYING",
    };
  }
  return {
    ...current,
    game: gameBase,
    roleAssignment: null,
    roleSelection: null,
    roundNumber: event.payload.roundNumber,
    stateVersion: event.stateVersion,
    status: "PLAYING",
  };
}

function applyQuestionAsked(
  current: RoomSnapshot,
  event: Extract<
    RoomRealtimeEvent,
    { eventType: "QUESTION_ASKED" }
  >,
): RoomSnapshot {
  if (
    !hasMatchingActiveGame(current, event.gameId) ||
    event.payload.sequenceNo !==
      current.game.actions.length + 1
  ) {
    return current;
  }
  const action: QuestionGameAction = {
    answer: null,
    answeredAt: null,
    comment: null,
    createdAt: event.occurredAt,
    question: event.payload.question,
    sequenceNumber: event.payload.sequenceNo,
    type: "QUESTION",
  };
  return withGameActions(current, event, [
    ...current.game.actions,
    action,
  ]);
}

function applyQuestionAnswered(
  current: RoomSnapshot,
  event: QuestionAnsweredEvent,
): RoomSnapshot {
  if (!hasMatchingActiveGame(current, event.gameId)) {
    return current;
  }
  const existingIndex = current.game.actions.findIndex(
    (action) =>
      action.sequenceNumber === event.payload.sequenceNo,
  );
  if (existingIndex === -1) {
    if (
      event.payload.sequenceNo !== current.game.actions.length + 1
    ) {
      return current;
    }
    const action: QuestionGameAction = {
      answer: event.payload.answer,
      answeredAt: event.occurredAt,
      comment: event.payload.comment,
      createdAt: event.occurredAt,
      question: event.payload.question,
      sequenceNumber: event.payload.sequenceNo,
      type: "QUESTION",
    };
    return withGameActions(current, event, [
      ...current.game.actions,
      action,
    ]);
  }

  const existing = current.game.actions[existingIndex];
  if (
    existing?.type !== "QUESTION" ||
    existing.answer !== null
  ) {
    return current;
  }
  const actions = [...current.game.actions];
  actions[existingIndex] = {
    ...existing,
    answer: event.payload.answer,
    answeredAt: event.occurredAt,
    comment: event.payload.comment,
  };
  return withGameActions(current, event, actions);
}

function applyGuessResolved(
  current: RoomSnapshot,
  event: Extract<
    RoomRealtimeEvent,
    { eventType: "GUESS_RESOLVED" }
  >,
): RoomSnapshot {
  if (
    !hasMatchingActiveGame(current, event.gameId) ||
    event.payload.sequenceNo !==
      current.game.actions.length + 1
  ) {
    return current;
  }
  return withGameActions(current, event, [
    ...current.game.actions,
    {
      correct: event.payload.correct,
      createdAt: event.occurredAt,
      guessedPokemon: event.payload.guessedPokemon,
      guessedPokemonNationalDexId:
        event.payload.guessedPokemon.nationalDexId,
      sequenceNumber: event.payload.sequenceNo,
      type: "GUESS" as const,
    },
  ]);
}

function withGameActions(
  current: ActiveRoomSnapshot,
  event:
    | Extract<
        RoomRealtimeEvent,
        { eventType: "GUESS_RESOLVED" }
      >
    | Extract<
        RoomRealtimeEvent,
        { eventType: "QUESTION_ASKED" }
      >
    | QuestionAnsweredEvent,
  actions: readonly GameAction[],
): ActiveRoomSnapshot {
  return {
    ...current,
    game: {
      ...current.game,
      actions,
      remainingActionCount:
        event.payload.remainingActionCount,
      usedActionCount: event.payload.usedActionCount,
    },
    stateVersion: event.stateVersion,
  };
}

function applyConnectionChanged(
  current: RoomSnapshot,
  event: PlayerConnectionChangedEvent,
): RoomSnapshot {
  const me = updateConnection(current.me, event);
  const opponent = current.opponent
    ? updateConnection(current.opponent, event)
    : null;

  if (me === current.me && opponent === current.opponent) {
    return current;
  }
  if (current.status === "WAITING_FOR_OPPONENT") {
    return {
      ...current,
      me,
      stateVersion: event.stateVersion,
    };
  }
  if (opponent === null) {
    return current;
  }
  if (
    current.status === "PLAYING" ||
    current.status === "PAUSED"
  ) {
    return {
      ...current,
      me,
      opponent,
      stateVersion: event.stateVersion,
      status:
        me.connected && opponent.connected ? "PLAYING" : "PAUSED",
    };
  }
  return {
    ...current,
    me,
    opponent,
    stateVersion: event.stateVersion,
  };
}

function applyGameEnded(
  current: RoomSnapshot,
  event: GameEndedEvent,
): RoomSnapshot {
  if (!hasMatchingActiveGame(current, event.gameId)) {
    return current;
  }
  const result: ResultRoomSnapshot = {
    ...current,
    game: {
      actions: current.game.actions,
      answerPokemon: event.payload.answerPokemon,
      endReason: event.payload.endReason,
      gameId: event.gameId,
      loserUserId: event.payload.loserUserId,
      remainingActionCount:
        (current.mode === "SILHOUETTE"
          ? MAX_SILHOUETTE_GUESS_COUNT
          : MAX_GAME_ACTION_COUNT) -
        event.payload.usedActionCount,
      status: event.payload.status,
      usedActionCount: event.payload.usedActionCount,
      winnerUserId: event.payload.winnerUserId,
    },
    roleAssignment: null,
    roleSelection: {
      opponentSelected: false,
      preferredRole: null,
    },
    stateVersion: event.stateVersion,
    status: "RESULT",
  };
  return result;
}

function hasMatchingActiveGame(
  current: RoomSnapshot,
  gameId: string,
): current is ActiveRoomSnapshot {
  return (
    isActive(current) && current.game.gameId === gameId
  );
}

function isActive(
  current: RoomSnapshot,
): current is ActiveRoomSnapshot {
  return (
    current.status === "PLAYING" ||
    current.status === "PAUSED"
  );
}

function hasActionSequence(
  actions: readonly GameAction[],
  sequenceNumber: number,
): boolean {
  return actions.some(
    (action) => action.sequenceNumber === sequenceNumber,
  );
}

function updateConnection(
  member: RoomMember,
  event: PlayerConnectionChangedEvent,
): RoomMember {
  if (member.userId !== event.payload.userId) {
    return member;
  }
  return {
    ...member,
    connected: event.payload.connected,
    reconnectDeadline: event.payload.reconnectDeadline,
  };
}

function withStateVersion(
  current: RoomSnapshot,
  stateVersion: number,
): RoomSnapshot {
  return {
    ...current,
    stateVersion,
  };
}
