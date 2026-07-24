package com.guesspokemon.room;

import static com.guesspokemon.common.error.ApiErrorCode.CANNOT_JOIN_OWN_ROOM;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_CAPACITY_UNAVAILABLE;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_EXPIRED;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_FULL;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_MEMBERSHIP_REQUIRED;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_NOT_FOUND;
import static com.guesspokemon.common.error.ApiErrorCode.USER_ALREADY_IN_ACTIVE_ROOM;
import static com.guesspokemon.common.error.ApiErrorCode.VALIDATION_FAILED;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_OPPONENT;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_SELECTION;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.common.error.ApiErrorCode;
import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class RoomRegistryTest {

    private static final Duration WAITING_EXPIRY =
            Duration.ofMinutes(30);
    private static final Duration TOMBSTONE_RETENTION =
            Duration.ofMinutes(30);

    private MutableClock clock;
    private RoomRegistry roomRegistry;

    @BeforeEach
    void setUp() {
        clock =
                new MutableClock(
                        Instant.parse("2026-07-25T00:00:00Z"));
        roomRegistry =
                createRegistry(
                        new RoomCodeGenerator(new Random(3898)),
                        100,
                        100,
                        100);
    }

    @Test
    void should_createAndJoinRoom_when_usersHaveNoActiveRoom() {
        TestUser host = user(1, "레드");
        TestUser guest = user(2, "그린");

        RoomSnapshot created =
                roomRegistry.create(host.id(), host.nickname());
        RoomSnapshot joined =
                roomRegistry.join(
                        "  " + created.roomCode().toLowerCase() + "  ",
                        guest.id(),
                        guest.nickname());

        assertEquals(WAITING_FOR_OPPONENT, created.status());
        assertEquals(WAITING_FOR_SELECTION, joined.status());
        assertEquals(
                created.roomCode(),
                roomRegistry.findActiveRoomCode(host.id()).orElseThrow());
        assertEquals(
                created.roomCode(),
                roomRegistry.findActiveRoomCode(guest.id()).orElseThrow());
    }

    @Test
    void should_rejectCreateOrJoin_when_userAlreadyHasActiveRoom() {
        TestUser host = user(1, "레드");
        TestUser secondHost = user(2, "그린");
        RoomSnapshot first =
                roomRegistry.create(host.id(), host.nickname());
        RoomSnapshot second =
                roomRegistry.create(
                        secondHost.id(),
                        secondHost.nickname());

        assertErrorCode(
                USER_ALREADY_IN_ACTIVE_ROOM,
                () -> roomRegistry.create(host.id(), host.nickname()));
        assertErrorCode(
                USER_ALREADY_IN_ACTIVE_ROOM,
                () ->
                        roomRegistry.join(
                                first.roomCode(),
                                secondHost.id(),
                                secondHost.nickname()));

        assertEquals(
                second.roomCode(),
                roomRegistry
                        .findActiveRoomCode(secondHost.id())
                        .orElseThrow());
    }

    @Test
    void should_distinguishJoinFailures_when_roomCannotBeJoined() {
        TestUser host = user(1, "레드");
        TestUser guest = user(2, "그린");
        TestUser outsider = user(3, "블루");
        String roomCode =
                roomRegistry.create(host.id(), host.nickname()).roomCode();

        assertErrorCode(
                CANNOT_JOIN_OWN_ROOM,
                () ->
                        roomRegistry.join(
                                roomCode,
                                host.id(),
                                host.nickname()));

        roomRegistry.join(roomCode, guest.id(), guest.nickname());

        assertErrorCode(
                ROOM_FULL,
                () ->
                        roomRegistry.join(
                                roomCode,
                                outsider.id(),
                                outsider.nickname()));
        assertErrorCode(
                ROOM_MEMBERSHIP_REQUIRED,
                () -> roomRegistry.getSnapshot(roomCode, outsider.id()));
        assertErrorCode(
                ROOM_NOT_FOUND,
                () ->
                        roomRegistry.join(
                                "ZZZ999",
                                outsider.id(),
                                outsider.nickname()));
        assertErrorCode(
                VALIDATION_FAILED,
                () ->
                        roomRegistry.join(
                                "ABC01I",
                                outsider.id(),
                                outsider.nickname()));
    }

    @Test
    void should_releaseMemberships_when_guestOrHostLeaves() {
        TestUser host = user(1, "레드");
        TestUser guest = user(2, "그린");
        String roomCode =
                roomRegistry.create(host.id(), host.nickname()).roomCode();
        roomRegistry.join(roomCode, guest.id(), guest.nickname());

        roomRegistry.leave(roomCode, guest.id());

        assertTrue(roomRegistry.findActiveRoomCode(guest.id()).isEmpty());
        RoomSnapshot hostOnly =
                roomRegistry.getSnapshot(roomCode, host.id());
        assertEquals(WAITING_FOR_OPPONENT, hostOnly.status());
        assertNull(hostOnly.opponent());

        roomRegistry.join(roomCode, guest.id(), guest.nickname());
        roomRegistry.leave(roomCode, host.id());

        assertTrue(roomRegistry.findActiveRoomCode(host.id()).isEmpty());
        assertTrue(roomRegistry.findActiveRoomCode(guest.id()).isEmpty());
        assertErrorCode(
                ROOM_NOT_FOUND,
                () -> roomRegistry.getSnapshot(roomCode, guest.id()));
    }

    @Test
    void should_expireRoomAndRetainTombstone_when_waitingTimePasses() {
        TestUser host = user(1, "레드");
        TestUser guest = user(2, "그린");
        String roomCode =
                roomRegistry.create(host.id(), host.nickname()).roomCode();

        clock.advance(WAITING_EXPIRY);

        assertEquals(1, roomRegistry.cleanExpiredRooms());
        assertTrue(roomRegistry.findActiveRoomCode(host.id()).isEmpty());
        assertEquals(1, roomRegistry.expiredCodeCount());
        assertErrorCode(
                ROOM_EXPIRED,
                () ->
                        roomRegistry.join(
                                roomCode,
                                guest.id(),
                                guest.nickname()));

        clock.advance(TOMBSTONE_RETENTION);

        assertEquals(0, roomRegistry.expiredCodeCount());
        assertErrorCode(
                ROOM_NOT_FOUND,
                () ->
                        roomRegistry.join(
                                roomCode,
                                guest.id(),
                                guest.nickname()));
    }

    @Test
    void should_keepJoinedRoom_when_waitingExpiryPasses() {
        TestUser host = user(1, "레드");
        TestUser guest = user(2, "그린");
        String roomCode =
                roomRegistry.create(host.id(), host.nickname()).roomCode();
        roomRegistry.join(roomCode, guest.id(), guest.nickname());

        clock.advance(Duration.ofDays(1));

        assertEquals(0, roomRegistry.cleanExpiredRooms());
        assertEquals(1, roomRegistry.activeRoomCount());
        assertFalse(roomRegistry.findActiveRoomCode(host.id()).isEmpty());
        assertFalse(roomRegistry.findActiveRoomCode(guest.id()).isEmpty());
    }

    @Test
    void should_rejectCreate_when_capacityOrCodeAttemptsAreExhausted() {
        RoomCodeGenerator fixedGenerator =
                new RoomCodeGenerator(new FixedRandom());
        RoomRegistry capacityRegistry =
                createRegistry(fixedGenerator, 1, 2, 10);
        capacityRegistry.create(user(1, "레드").id(), "레드");

        assertErrorCode(
                ROOM_CAPACITY_UNAVAILABLE,
                () ->
                        capacityRegistry.create(
                                user(2, "그린").id(),
                                "그린"));

        RoomRegistry collisionRegistry =
                createRegistry(fixedGenerator, 2, 2, 10);
        collisionRegistry.create(user(3, "블루").id(), "블루");

        assertErrorCode(
                ROOM_CAPACITY_UNAVAILABLE,
                () ->
                        collisionRegistry.create(
                                user(4, "옐로").id(),
                                "옐로"));
    }

    @Test
    void should_allowOnlyOneGuest_when_usersJoinConcurrently()
            throws Exception {
        TestUser host = user(1, "레드");
        TestUser firstGuest = user(2, "그린");
        TestUser secondGuest = user(3, "블루");
        String roomCode =
                roomRegistry.create(host.id(), host.nickname()).roomCode();

        List<OperationOutcome> outcomes =
                runConcurrentOperations(
                        () ->
                                roomRegistry.join(
                                        roomCode,
                                        firstGuest.id(),
                                        firstGuest.nickname()),
                        () ->
                                roomRegistry.join(
                                        roomCode,
                                        secondGuest.id(),
                                        secondGuest.nickname()));

        assertEquals(
                1,
                outcomes.stream()
                        .filter(OperationOutcome::succeeded)
                        .count());
        assertEquals(
                1,
                outcomes.stream()
                        .filter(
                                outcome ->
                                        outcome.errorCode() == ROOM_FULL)
                        .count());
        assertEquals(
                1,
                List.of(firstGuest, secondGuest).stream()
                        .filter(
                                guest ->
                                        roomRegistry
                                                .findActiveRoomCode(guest.id())
                                                .isPresent())
                        .count());
    }

    @Test
    void should_allowOnlyOneRoom_when_userJoinsConcurrently()
            throws Exception {
        TestUser firstHost = user(1, "레드");
        TestUser secondHost = user(2, "그린");
        TestUser guest = user(3, "블루");
        String firstRoomCode =
                roomRegistry
                        .create(firstHost.id(), firstHost.nickname())
                        .roomCode();
        String secondRoomCode =
                roomRegistry
                        .create(secondHost.id(), secondHost.nickname())
                        .roomCode();

        List<OperationOutcome> outcomes =
                runConcurrentOperations(
                        () ->
                                roomRegistry.join(
                                        firstRoomCode,
                                        guest.id(),
                                        guest.nickname()),
                        () ->
                                roomRegistry.join(
                                        secondRoomCode,
                                        guest.id(),
                                        guest.nickname()));

        assertEquals(
                1,
                outcomes.stream()
                        .filter(OperationOutcome::succeeded)
                        .count());
        assertEquals(
                1,
                outcomes.stream()
                        .filter(
                                outcome ->
                                        outcome.errorCode()
                                                == USER_ALREADY_IN_ACTIVE_ROOM)
                        .count());
        assertTrue(roomRegistry.findActiveRoomCode(guest.id()).isPresent());
    }

    @Test
    void should_allowOnlyOneRoom_when_userCreatesConcurrently()
            throws Exception {
        TestUser host = user(1, "레드");

        List<OperationOutcome> outcomes =
                runConcurrentOperations(
                        () ->
                                roomRegistry.create(
                                        host.id(),
                                        host.nickname()),
                        () ->
                                roomRegistry.create(
                                        host.id(),
                                        host.nickname()));

        assertEquals(
                1,
                outcomes.stream()
                        .filter(OperationOutcome::succeeded)
                        .count());
        assertEquals(
                1,
                outcomes.stream()
                        .filter(
                                outcome ->
                                        outcome.errorCode()
                                                == USER_ALREADY_IN_ACTIVE_ROOM)
                        .count());
        assertEquals(1, roomRegistry.activeRoomCount());
    }

    @Test
    void should_boundExpiredCodeTombstones_when_limitIsExceeded() {
        RoomRegistry boundedRegistry =
                createRegistry(
                        new RoomCodeGenerator(new Random(3898)),
                        2,
                        100,
                        1);
        String firstRoomCode =
                boundedRegistry
                        .create(user(1, "레드").id(), "레드")
                        .roomCode();
        String secondRoomCode =
                boundedRegistry
                        .create(user(2, "그린").id(), "그린")
                        .roomCode();

        clock.advance(WAITING_EXPIRY);

        assertEquals(2, boundedRegistry.cleanExpiredRooms());
        assertEquals(1, boundedRegistry.expiredCodeCount());

        List<ApiErrorCode> errorCodes =
                List.of(firstRoomCode, secondRoomCode).stream()
                        .map(
                                roomCode ->
                                        captureErrorCode(
                                                () ->
                                                        boundedRegistry.join(
                                                                roomCode,
                                                                user(3, "블루")
                                                                        .id(),
                                                                "블루")))
                        .toList();
        assertEquals(
                1,
                errorCodes.stream()
                        .filter(errorCode -> errorCode == ROOM_EXPIRED)
                        .count());
        assertEquals(
                1,
                errorCodes.stream()
                        .filter(errorCode -> errorCode == ROOM_NOT_FOUND)
                        .count());
    }

    private List<OperationOutcome> runConcurrentOperations(
            RegistryOperation first,
            RegistryOperation second)
            throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<OperationOutcome> firstFuture =
                    executor.submit(
                            () -> executeAfterGate(first, ready, start));
            Future<OperationOutcome> secondFuture =
                    executor.submit(
                            () -> executeAfterGate(second, ready, start));
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            return List.of(
                    firstFuture.get(5, TimeUnit.SECONDS),
                    secondFuture.get(5, TimeUnit.SECONDS));
        } finally {
            executor.shutdownNow();
        }
    }

    private OperationOutcome executeAfterGate(
            RegistryOperation operation,
            CountDownLatch ready,
            CountDownLatch start)
            throws InterruptedException {
        ready.countDown();
        assertTrue(start.await(5, TimeUnit.SECONDS));
        try {
            operation.execute();
            return new OperationOutcome(true, null);
        } catch (ApiException exception) {
            return new OperationOutcome(false, exception.errorCode());
        }
    }

    private RoomRegistry createRegistry(
            RoomCodeGenerator generator,
            int maxRooms,
            int codeAttempts,
            int tombstones) {
        return new RoomRegistry(
                generator,
                clock,
                WAITING_EXPIRY,
                TOMBSTONE_RETENTION,
                maxRooms,
                codeAttempts,
                tombstones);
    }

    private TestUser user(int suffix, String nickname) {
        return new TestUser(
                UUID.fromString(
                        "00000000-0000-0000-0000-"
                                + "%012d".formatted(suffix)),
                nickname);
    }

    private void assertErrorCode(
            ApiErrorCode expected,
            Runnable action) {
        assertEquals(expected, captureErrorCode(action));
    }

    private ApiErrorCode captureErrorCode(Runnable action) {
        return assertThrows(ApiException.class, action::run).errorCode();
    }

    @FunctionalInterface
    private interface RegistryOperation {

        void execute();
    }

    private record OperationOutcome(
            boolean succeeded,
            ApiErrorCode errorCode) {
    }

    private record TestUser(UUID id, String nickname) {
    }

    private static final class FixedRandom extends Random {

        @Override
        public int nextInt(int bound) {
            return 0;
        }
    }
}
