package com.guesspokemon.history;

import com.guesspokemon.game.GamePersistencePort.ParticipantState;
import com.guesspokemon.game.GameTypes.GameResult;
import com.guesspokemon.game.GameTypes.GameRole;
import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
        name = "game_participant",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uk_game_participant_game_role",
                        columnNames = {"game_id", "role"}),
        indexes =
                @Index(
                        name = "ix_game_participant_user_game",
                        columnList = "user_id,game_id"))
public class GameParticipantRecord {

    @EmbeddedId
    private GameParticipantId id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private GameRole role;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private GameResult result;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected GameParticipantRecord() {
    }

    private GameParticipantRecord(
            UUID gameId,
            ParticipantState state) {
        id =
                new GameParticipantId(
                        gameId,
                        state.userId());
        role = state.role();
        result = state.result();
        createdAt = state.createdAt();
    }

    static GameParticipantRecord create(
            UUID gameId,
            ParticipantState state) {
        return new GameParticipantRecord(gameId, state);
    }

    void updateResult(GameResult newResult) {
        result = newResult;
    }

    public GameParticipantId getId() {
        return id;
    }

    public GameRole getRole() {
        return role;
    }

    public GameResult getResult() {
        return result;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
