import type { WaitingRoomEvent } from "../../shared/realtime/realtimeTypes";
import type {
  RoomMember,
  WaitingRoomSnapshot,
} from "./roomTypes";

export function applyAuthoritativeSnapshot(
  current: WaitingRoomSnapshot | null,
  incoming: WaitingRoomSnapshot,
): WaitingRoomSnapshot {
  if (
    current &&
    (incoming.roomCode !== current.roomCode ||
      incoming.stateVersion < current.stateVersion)
  ) {
    return current;
  }
  return incoming;
}

export function applyWaitingRoomEvent(
  current: WaitingRoomSnapshot | null,
  event: WaitingRoomEvent,
): WaitingRoomSnapshot | null {
  if (event.eventType === "ROOM_SNAPSHOT") {
    return applyAuthoritativeSnapshot(current, event.payload);
  }
  if (
    !current ||
    event.roomCode !== current.roomCode ||
    event.stateVersion <= current.stateVersion
  ) {
    return current;
  }
  if (event.eventType !== "PLAYER_CONNECTION_CHANGED") {
    return current;
  }

  const me = updateConnection(current.me, event);
  const opponent = current.opponent
    ? updateConnection(current.opponent, event)
    : null;

  if (me === current.me && opponent === current.opponent) {
    return current;
  }

  return {
    ...current,
    me,
    opponent,
    stateVersion: event.stateVersion,
  };
}

function updateConnection(
  member: RoomMember,
  event: Extract<
    WaitingRoomEvent,
    { eventType: "PLAYER_CONNECTION_CHANGED" }
  >,
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
