package com.guesspokemon.history;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

@Embeddable
public class GameParticipantId implements Serializable {

    @Column(name = "game_id", nullable = false)
    private UUID gameId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    protected GameParticipantId() {
    }

    public GameParticipantId(UUID gameId, UUID userId) {
        this.gameId = Objects.requireNonNull(gameId);
        this.userId = Objects.requireNonNull(userId);
    }

    public UUID getGameId() {
        return gameId;
    }

    public UUID getUserId() {
        return userId;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof GameParticipantId that)) {
            return false;
        }
        return gameId.equals(that.gameId)
                && userId.equals(that.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(gameId, userId);
    }
}
