package com.guesspokemon.room;

import static com.guesspokemon.common.error.ApiErrorCode.CANNOT_JOIN_OWN_ROOM;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_FULL;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_MEMBERSHIP_REQUIRED;
import static com.guesspokemon.room.RoomDtos.RoomRole.QUESTIONER;
import static com.guesspokemon.room.RoomDtos.RoomRole.SELECTOR;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_OPPONENT;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_SELECTION;
import static com.guesspokemon.room.RoomDtos.RoomStatus.PAUSED;
import static com.guesspokemon.room.RoomDtos.RoomStatus.PLAYING;
import static com.guesspokemon.game.GameTypes.GameEndReason.CORRECT_GUESS;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static com.guesspokemon.game.GameTypes.GameStatus.IN_PROGRESS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.common.error.ApiErrorCode;
import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.game.GameViews.SelectorGameView;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.List;
import org.junit.jupiter.api.Test;

class RoomTest {

    private static final Instant CREATED_AT =
            Instant.parse("2026-07-25T00:00:00Z");
    private static final UUID HOST_ID =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID GUEST_ID =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Test
    void should_returnHostWaitingSnapshot_when_roomIsCreated() {
        Room room = createRoom();

        RoomSnapshot snapshot = room.snapshotFor(HOST_ID);

        assertEquals("ABC234", snapshot.roomCode());
        assertEquals(WAITING_FOR_OPPONENT, snapshot.status());
        assertEquals(1L, snapshot.stateVersion());
        assertEquals(1, snapshot.roundNumber());
        assertEquals(HOST_ID, snapshot.me().userId());
        assertEquals(SELECTOR, snapshot.me().role());
        assertTrue(snapshot.me().connected());
        assertNull(snapshot.opponent());
        assertNull(snapshot.game());
    }

    @Test
    void should_assignFirstRoundRoles_when_guestJoins() {
        Room room = createRoom();

        room.join(GUEST_ID, "그린");

        RoomSnapshot hostSnapshot = room.snapshotFor(HOST_ID);
        RoomSnapshot guestSnapshot = room.snapshotFor(GUEST_ID);
        assertEquals(WAITING_FOR_SELECTION, hostSnapshot.status());
        assertEquals(2L, hostSnapshot.stateVersion());
        assertEquals(SELECTOR, hostSnapshot.me().role());
        assertEquals(QUESTIONER, hostSnapshot.opponent().role());
        assertEquals(QUESTIONER, guestSnapshot.me().role());
        assertEquals(SELECTOR, guestSnapshot.opponent().role());
    }

    @Test
    void should_rejectJoin_when_userIsHostOrRoomIsFull() {
        Room room = createRoom();

        assertErrorCode(
                CANNOT_JOIN_OWN_ROOM,
                () -> room.join(HOST_ID, "레드"));

        room.join(GUEST_ID, "그린");

        assertErrorCode(
                ROOM_FULL,
                () ->
                        room.join(
                                UUID.fromString(
                                        "33333333-3333-3333-3333-333333333333"),
                                "블루"));
    }

    @Test
    void should_returnToWaitingForOpponent_when_guestLeaves() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");

        Room.LeaveResult result = room.leave(GUEST_ID);

        assertEquals(Room.LeaveResult.GUEST_LEFT, result);
        RoomSnapshot snapshot = room.snapshotFor(HOST_ID);
        assertEquals(WAITING_FOR_OPPONENT, snapshot.status());
        assertEquals(3L, snapshot.stateVersion());
        assertNull(snapshot.opponent());
    }

    @Test
    void should_reportHostLeft_when_hostLeaves() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");

        Room.LeaveResult result = room.leave(HOST_ID);

        assertEquals(Room.LeaveResult.ROOM_CLOSED, result);
    }

    @Test
    void should_rejectSnapshotAndLeave_when_userIsNotParticipant() {
        Room room = createRoom();
        UUID outsiderId =
                UUID.fromString(
                        "33333333-3333-3333-3333-333333333333");

        assertErrorCode(
                ROOM_MEMBERSHIP_REQUIRED,
                () -> room.snapshotFor(outsiderId));
        assertErrorCode(
                ROOM_MEMBERSHIP_REQUIRED,
                () -> room.leave(outsiderId));
    }

    @Test
    void should_expireHostOnlyRoom_when_thirtyMinutesPass() {
        Room room = createRoom();

        assertFalse(
                room.isHostOnlyExpired(
                        CREATED_AT.plus(Duration.ofMinutes(30))
                                .minusNanos(1),
                        Duration.ofMinutes(30)));
        assertTrue(
                room.isHostOnlyExpired(
                        CREATED_AT.plus(Duration.ofMinutes(30)),
                        Duration.ofMinutes(30)));

        room.join(GUEST_ID, "그린");

        assertFalse(
                room.isHostOnlyExpired(
                        CREATED_AT.plus(Duration.ofDays(1)),
                        Duration.ofMinutes(30)));
    }

    @Test
    void should_pauseAndResumeGame_when_participantConnectionChanges() {
        Room room = startedRoom();

        Room.ConnectionChange disconnected =
                room.disconnect(
                        GUEST_ID,
                        CREATED_AT.plusSeconds(10),
                        Duration.ofSeconds(60));

        assertTrue(disconnected.changed());
        assertEquals(PAUSED, room.snapshotFor(HOST_ID).status());
        assertEquals(
                CREATED_AT.plusSeconds(70),
                disconnected.reconnectDeadline());
        assertFalse(
                room.snapshotFor(GUEST_ID)
                        .me()
                        .connected());

        Room.ConnectionChange resumed =
                room.resume(GUEST_ID);

        assertTrue(resumed.changed());
        assertEquals(PLAYING, room.snapshotFor(HOST_ID).status());
        assertTrue(
                room.snapshotFor(GUEST_ID)
                        .me()
                        .connected());
        assertNull(
                room.snapshotFor(GUEST_ID)
                        .me()
                        .reconnectDeadline());
    }

    @Test
    void should_prepareBothDisconnectedAbort_when_bothDeadlinesAreActive() {
        Room room = startedRoom();
        Room.ConnectionChange hostDisconnect =
                room.disconnect(
                        HOST_ID,
                        CREATED_AT.plusSeconds(10),
                        Duration.ofSeconds(60));
        room.disconnect(
                GUEST_ID,
                CREATED_AT.plusSeconds(11),
                Duration.ofSeconds(60));

        Room.TimeoutContext timeout =
                room.prepareReconnectTimeout(
                        HOST_ID,
                        hostDisconnect.reconnectToken(),
                        hostDisconnect.reconnectDeadline());

        assertEquals(
                com.guesspokemon.game.GameTypes.GameEndReason
                        .BOTH_DISCONNECTED,
                timeout.endReason());
        assertNull(timeout.disconnectedUserId());
        assertEquals(6L, timeout.targetStateVersion());
    }

    @Test
    void should_swapRoles_when_bothPlayersAcceptRematch() {
        Room room = completedRoom();

        Room.RematchChange hostReady =
                room.changeRematchReady(
                        HOST_ID,
                        UUID.randomUUID(),
                        3,
                        true);
        Room.RematchChange guestReady =
                room.changeRematchReady(
                        GUEST_ID,
                        UUID.randomUUID(),
                        4,
                        true);

        assertFalse(hostReady.nextRoundReady());
        assertTrue(guestReady.nextRoundReady());
        RoomSnapshot hostSnapshot = room.snapshotFor(HOST_ID);
        RoomSnapshot guestSnapshot = room.snapshotFor(GUEST_ID);
        assertEquals(WAITING_FOR_SELECTION, hostSnapshot.status());
        assertEquals(2, hostSnapshot.roundNumber());
        assertEquals(QUESTIONER, hostSnapshot.me().role());
        assertEquals(SELECTOR, guestSnapshot.me().role());
        assertNull(hostSnapshot.game());
        assertNull(hostSnapshot.rematch());
    }

    private Room startedRoom() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");
        room.applyGameView(
                UUID.randomUUID(),
                new SelectorGameView(
                        UUID.randomUUID(),
                        IN_PROGRESS,
                        3,
                        0,
                        20,
                        com.guesspokemon.game.GameTypes.GameRole
                                .SELECTOR,
                        25,
                        null,
                        null,
                        null,
                        List.of()));
        return room;
    }

    private Room completedRoom() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");
        room.applyGameView(
                UUID.randomUUID(),
                new SelectorGameView(
                        UUID.randomUUID(),
                        COMPLETED,
                        3,
                        1,
                        19,
                        com.guesspokemon.game.GameTypes.GameRole
                                .SELECTOR,
                        25,
                        GUEST_ID,
                        HOST_ID,
                        CORRECT_GUESS,
                        List.of()));
        return room;
    }

    private Room createRoom() {
        return new Room("ABC234", HOST_ID, "레드", CREATED_AT);
    }

    private void assertErrorCode(
            ApiErrorCode expected,
            Runnable action) {
        ApiException exception =
                assertThrows(ApiException.class, action::run);
        assertEquals(expected, exception.errorCode());
    }
}
