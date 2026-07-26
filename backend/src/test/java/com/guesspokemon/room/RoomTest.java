package com.guesspokemon.room;

import static com.guesspokemon.common.error.ApiErrorCode.CANNOT_JOIN_OWN_ROOM;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_FULL;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_MEMBERSHIP_REQUIRED;
import static com.guesspokemon.game.GameRuleException.GameRuleError.DUPLICATE_COMMAND;
import static com.guesspokemon.game.GameRuleException.GameRuleError.STALE_ROOM_STATE;
import static com.guesspokemon.room.RoomDtos.RoomRole.QUESTIONER;
import static com.guesspokemon.room.RoomDtos.RoomRole.SELECTOR;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_OPPONENT;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_ROLE_SELECTION;
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
import com.guesspokemon.game.GameRuleException;
import com.guesspokemon.game.GameViews.SelectorGameView;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Random;
import java.util.UUID;
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
        assertNull(snapshot.me().role());
        assertTrue(snapshot.me().connected());
        assertNull(snapshot.opponent());
        assertNull(snapshot.game());
        assertNull(snapshot.roleSelection());
        assertNull(snapshot.roleAssignment());
    }

    @Test
    void should_waitForRolePreferences_when_guestJoins() {
        Room room = createRoom();

        room.join(GUEST_ID, "그린");

        RoomSnapshot hostSnapshot = room.snapshotFor(HOST_ID);
        RoomSnapshot guestSnapshot = room.snapshotFor(GUEST_ID);
        assertEquals(
                WAITING_FOR_ROLE_SELECTION,
                hostSnapshot.status());
        assertEquals(2L, hostSnapshot.stateVersion());
        assertNull(hostSnapshot.me().role());
        assertNull(hostSnapshot.opponent().role());
        assertNull(guestSnapshot.me().role());
        assertNull(guestSnapshot.opponent().role());
        assertNull(
                hostSnapshot
                        .roleSelection()
                        .preferredRole());
        assertFalse(
                hostSnapshot
                        .roleSelection()
                        .opponentSelected());
    }

    @Test
    void should_assignPreferredRoles_when_preferencesDiffer() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");

        room.changeRolePreference(
                HOST_ID,
                UUID.randomUUID(),
                2,
                SELECTOR,
                roleAssignmentDecider());

        RoomSnapshot hostPending = room.snapshotFor(HOST_ID);
        RoomSnapshot guestPending = room.snapshotFor(GUEST_ID);
        assertEquals(
                SELECTOR,
                hostPending
                        .roleSelection()
                        .preferredRole());
        assertFalse(
                hostPending
                        .roleSelection()
                        .opponentSelected());
        assertNull(
                guestPending
                        .roleSelection()
                        .preferredRole());
        assertTrue(
                guestPending
                        .roleSelection()
                        .opponentSelected());
        assertNull(guestPending.opponent().role());

        Room.RolePreferenceChange change =
                room.changeRolePreference(
                        GUEST_ID,
                        UUID.randomUUID(),
                        3,
                        QUESTIONER,
                        roleAssignmentDecider());

        assertTrue(change.rolesAssigned());
        assertFalse(change.randomized());
        RoomSnapshot hostAssigned = room.snapshotFor(HOST_ID);
        assertEquals(
                WAITING_FOR_SELECTION,
                hostAssigned.status());
        assertEquals(SELECTOR, hostAssigned.me().role());
        assertEquals(
                QUESTIONER,
                hostAssigned.opponent().role());
        assertFalse(
                hostAssigned
                        .roleAssignment()
                        .randomized());
        assertNull(hostAssigned.roleSelection());
    }

    @Test
    void should_assignOppositeRolesRandomly_when_preferencesMatch() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");
        room.changeRolePreference(
                HOST_ID,
                UUID.randomUUID(),
                2,
                SELECTOR,
                roleAssignmentDecider());

        Room.RolePreferenceChange change =
                room.changeRolePreference(
                        GUEST_ID,
                        UUID.randomUUID(),
                        3,
                        SELECTOR,
                        roleAssignmentDecider());

        RoomSnapshot snapshot = room.snapshotFor(HOST_ID);
        assertTrue(change.rolesAssigned());
        assertTrue(change.randomized());
        assertTrue(
                snapshot.me().role() !=
                        snapshot.opponent().role());
        assertTrue(
                snapshot
                        .roleAssignment()
                        .randomized());
    }

    @Test
    void should_allowPreferenceChange_when_opponentHasNotSelected() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");
        room.changeRolePreference(
                HOST_ID,
                UUID.randomUUID(),
                2,
                SELECTOR,
                roleAssignmentDecider());

        Room.RolePreferenceChange change =
                room.changeRolePreference(
                        HOST_ID,
                        UUID.randomUUID(),
                        3,
                        QUESTIONER,
                        roleAssignmentDecider());

        assertFalse(change.rolesAssigned());
        assertEquals(
                QUESTIONER,
                room.snapshotFor(HOST_ID)
                        .roleSelection()
                        .preferredRole());
    }

    @Test
    void should_preserveRolePreference_when_participantReconnects() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");
        room.changeRolePreference(
                HOST_ID,
                UUID.randomUUID(),
                2,
                SELECTOR,
                roleAssignmentDecider());

        room.disconnect(
                HOST_ID,
                CREATED_AT.plusSeconds(10),
                Duration.ofSeconds(60));
        RoomSnapshot disconnected = room.snapshotFor(HOST_ID);
        room.resume(HOST_ID);
        RoomSnapshot resumed = room.snapshotFor(HOST_ID);

        assertFalse(disconnected.me().connected());
        assertEquals(
                SELECTOR,
                disconnected
                        .roleSelection()
                        .preferredRole());
        assertTrue(resumed.me().connected());
        assertEquals(
                SELECTOR,
                resumed.roleSelection().preferredRole());
    }

    @Test
    void should_rejectDuplicateAndStaleRolePreference_when_stateChanged() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");
        UUID commandId = UUID.randomUUID();
        room.changeRolePreference(
                HOST_ID,
                commandId,
                2,
                SELECTOR,
                roleAssignmentDecider());

        assertRuleError(
                DUPLICATE_COMMAND,
                () ->
                        room.changeRolePreference(
                                HOST_ID,
                                commandId,
                                3,
                                QUESTIONER,
                                roleAssignmentDecider()));
        assertRuleError(
                STALE_ROOM_STATE,
                () ->
                        room.changeRolePreference(
                                GUEST_ID,
                                UUID.randomUUID(),
                                2,
                                QUESTIONER,
                                roleAssignmentDecider()));
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
        room.changeRolePreference(
                HOST_ID,
                UUID.randomUUID(),
                2,
                SELECTOR,
                roleAssignmentDecider());

        Room.LeaveResult result = room.leave(GUEST_ID);

        assertEquals(Room.LeaveResult.GUEST_LEFT, result);
        RoomSnapshot snapshot = room.snapshotFor(HOST_ID);
        assertEquals(WAITING_FOR_OPPONENT, snapshot.status());
        assertEquals(4L, snapshot.stateVersion());
        assertNull(snapshot.opponent());
        assertNull(snapshot.me().role());
        assertNull(snapshot.roleSelection());
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
        assertEquals(8L, timeout.targetStateVersion());
    }

    @Test
    void should_applyRolePreferences_when_nextRoundStarts() {
        Room room = completedRoom();

        Room.RolePreferenceChange hostPreference =
                room.changeRolePreference(
                        HOST_ID,
                        UUID.randomUUID(),
                        5,
                        QUESTIONER,
                        roleAssignmentDecider());
        Room.RolePreferenceChange guestPreference =
                room.changeRolePreference(
                        GUEST_ID,
                        UUID.randomUUID(),
                        6,
                        SELECTOR,
                        roleAssignmentDecider());

        assertFalse(hostPreference.rolesAssigned());
        assertTrue(guestPreference.rolesAssigned());
        RoomSnapshot hostSnapshot = room.snapshotFor(HOST_ID);
        RoomSnapshot guestSnapshot = room.snapshotFor(GUEST_ID);
        assertEquals(WAITING_FOR_SELECTION, hostSnapshot.status());
        assertEquals(2, hostSnapshot.roundNumber());
        assertEquals(QUESTIONER, hostSnapshot.me().role());
        assertEquals(SELECTOR, guestSnapshot.me().role());
        assertNull(hostSnapshot.game());
        assertNull(hostSnapshot.roleSelection());
        assertFalse(
                hostSnapshot
                        .roleAssignment()
                        .randomized());
    }

    private Room startedRoom() {
        Room room = createRoom();
        room.join(GUEST_ID, "그린");
        assignFirstRoundRoles(room);
        room.applyGameView(
                UUID.randomUUID(),
                new SelectorGameView(
                        UUID.randomUUID(),
                        IN_PROGRESS,
                        5,
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
        assignFirstRoundRoles(room);
        room.applyGameView(
                UUID.randomUUID(),
                new SelectorGameView(
                        UUID.randomUUID(),
                        COMPLETED,
                        5,
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

    private void assignFirstRoundRoles(Room room) {
        room.changeRolePreference(
                HOST_ID,
                UUID.randomUUID(),
                2,
                SELECTOR,
                roleAssignmentDecider());
        room.changeRolePreference(
                GUEST_ID,
                UUID.randomUUID(),
                3,
                QUESTIONER,
                roleAssignmentDecider());
    }

    private RoleAssignmentDecider roleAssignmentDecider() {
        return new RoleAssignmentDecider(new Random(3898));
    }

    private void assertErrorCode(
            ApiErrorCode expected,
            Runnable action) {
        ApiException exception =
                assertThrows(ApiException.class, action::run);
        assertEquals(expected, exception.errorCode());
    }

    private void assertRuleError(
            GameRuleException.GameRuleError expected,
            Runnable action) {
        GameRuleException exception =
                assertThrows(GameRuleException.class, action::run);
        assertEquals(expected, exception.error());
    }
}
