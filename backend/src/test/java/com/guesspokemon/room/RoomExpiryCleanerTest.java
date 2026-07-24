package com.guesspokemon.room;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import java.util.Random;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RoomExpiryCleanerTest {

    @Test
    void should_removeExpiredRooms_when_scheduledCleanupRuns() {
        MutableClock clock =
                new MutableClock(
                        Instant.parse("2026-07-25T00:00:00Z"));
        RoomRegistry roomRegistry =
                new RoomRegistry(
                        new RoomCodeGenerator(new Random(3898)),
                        clock,
                        Duration.ofMinutes(30),
                        Duration.ofMinutes(30),
                        100,
                        100,
                        100);
        UUID hostId =
                UUID.fromString(
                        "11111111-1111-1111-1111-111111111111");
        roomRegistry.create(hostId, "레드");
        RoomExpiryCleaner cleaner =
                new RoomExpiryCleaner(roomRegistry);

        clock.advance(Duration.ofMinutes(30));
        cleaner.cleanExpiredRooms();

        assertEquals(0, roomRegistry.activeRoomCount());
        assertEquals(1, roomRegistry.expiredCodeCount());
        assertTrue(roomRegistry.findActiveRoomCode(hostId).isEmpty());
    }
}
