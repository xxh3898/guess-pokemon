package com.guesspokemon.history;

import static com.guesspokemon.game.GameTypes.GameEndReason.SERVER_RESTART;
import static com.guesspokemon.game.GameTypes.GameStatus.ABORTED;

import com.guesspokemon.game.GamePersistencePort.GameState;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameMode;
import com.guesspokemon.game.GameTypes.GameStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(
        name = "game",
        indexes = {
            @Index(
                    name = "ix_game_round_group_id",
                    columnList = "round_group_id"),
            @Index(
                    name = "ix_game_status_updated_at",
                    columnList = "status,updated_at"),
            @Index(
                    name = "ix_game_ended_at_desc",
                    columnList = "ended_at")
        })
public class GameRecord {

    @Id
    @Column(nullable = false)
    private UUID id;

    @Column(name = "round_group_id", nullable = false)
    private UUID roundGroupId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private GameMode mode;

    @Column(name = "answer_pokemon_id", nullable = false)
    private Integer answerPokemonId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private GameStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "end_reason", length = 40)
    private GameEndReason endReason;

    @Column(name = "action_count", nullable = false)
    private Short actionCount;

    @Column(name = "state_version", nullable = false)
    private Long stateVersion;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected GameRecord() {
    }

    private GameRecord(GameState state) {
        id = state.gameId();
        roundGroupId = state.roundGroupId();
        mode = state.mode();
        answerPokemonId =
                state.answerPokemonNationalDexId();
        status = state.status();
        endReason = state.endReason();
        actionCount = (short) state.actionCount();
        stateVersion = state.stateVersion();
        startedAt = state.startedAt();
        endedAt = state.endedAt();
        createdAt = state.startedAt();
        updatedAt = state.startedAt();
    }

    static GameRecord create(GameState state) {
        return new GameRecord(state);
    }

    void apply(GameState state, Instant changedAt) {
        requireSameIdentity(state);
        status = state.status();
        endReason = state.endReason();
        actionCount = (short) state.actionCount();
        stateVersion = state.stateVersion();
        endedAt = state.endedAt();
        updatedAt = Objects.requireNonNull(changedAt);
    }

    void abortForServerRestart(Instant now) {
        if (status != GameStatus.IN_PROGRESS) {
            return;
        }
        Instant effectiveEnd =
                now.isBefore(startedAt) ? startedAt : now;
        status = ABORTED;
        endReason = SERVER_RESTART;
        stateVersion += 1;
        endedAt = effectiveEnd;
        updatedAt = effectiveEnd;
    }

    public UUID getId() {
        return id;
    }

    public UUID getRoundGroupId() {
        return roundGroupId;
    }

    public Integer getAnswerPokemonId() {
        return answerPokemonId;
    }

    public GameMode getMode() {
        return mode;
    }

    public GameStatus getStatus() {
        return status;
    }

    public GameEndReason getEndReason() {
        return endReason;
    }

    public Short getActionCount() {
        return actionCount;
    }

    public Long getStateVersion() {
        return stateVersion;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getEndedAt() {
        return endedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    private void requireSameIdentity(GameState state) {
        if (!id.equals(state.gameId())
                || !roundGroupId.equals(state.roundGroupId())
                || mode != state.mode()
                || answerPokemonId
                        != state.answerPokemonNationalDexId()
                || !startedAt.equals(state.startedAt())) {
            throw new IllegalArgumentException(
                    "game persistence identity가 달라졌습니다.");
        }
    }
}
