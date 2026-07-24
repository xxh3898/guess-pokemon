package com.guesspokemon.room;

import java.util.UUID;

public final class RoomDtos {

    private RoomDtos() {
    }

    public enum RoomStatus {
        WAITING_FOR_OPPONENT,
        WAITING_FOR_SELECTION
    }

    public enum RoomRole {
        SELECTOR,
        QUESTIONER
    }

    public record RoomMember(
            UUID userId,
            String nickname,
            RoomRole role,
            boolean connected) {
    }

    public record RoomSnapshot(
            String roomCode,
            RoomStatus status,
            long stateVersion,
            int roundNumber,
            RoomMember me,
            RoomMember opponent,
            Void game) {
    }
}
