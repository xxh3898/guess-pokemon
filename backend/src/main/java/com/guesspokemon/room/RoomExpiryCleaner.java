package com.guesspokemon.room;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class RoomExpiryCleaner {

    static final long CLEANUP_DELAY_MILLISECONDS = 60_000;

    private final RoomRegistry roomRegistry;

    public RoomExpiryCleaner(RoomRegistry roomRegistry) {
        this.roomRegistry = roomRegistry;
    }

    @Scheduled(fixedDelay = CLEANUP_DELAY_MILLISECONDS)
    void cleanExpiredRooms() {
        roomRegistry.cleanExpiredRooms();
    }
}
