package com.guesspokemon.history;

import com.guesspokemon.game.GamePersistencePort.ActionState;
import com.guesspokemon.game.GameTypes.GameActionType;
import com.guesspokemon.game.GameTypes.GameAnswer;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
        name = "game_action",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uk_game_action_command_id",
                    columnNames = "command_id"),
            @UniqueConstraint(
                    name = "uk_game_action_game_sequence",
                    columnNames = {"game_id", "sequence_no"})
        })
public class GameActionRecord {

    @Id
    @Column(nullable = false)
    private UUID id;

    @Column(name = "command_id", nullable = false)
    private UUID commandId;

    @Column(name = "game_id", nullable = false)
    private UUID gameId;

    @Column(name = "actor_user_id", nullable = false)
    private UUID actorUserId;

    @Column(name = "sequence_no", nullable = false)
    private Short sequenceNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "action_type", nullable = false, length = 20)
    private GameActionType actionType;

    @Column(name = "question_text", length = 200)
    private String question;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private GameAnswer answer;

    @Column(name = "answer_comment", length = 200)
    private String answerComment;

    @Column(name = "guessed_pokemon_id")
    private Integer guessedPokemonId;

    @Column
    private Boolean correct;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "answered_at")
    private Instant answeredAt;

    protected GameActionRecord() {
    }

    private GameActionRecord(
            UUID gameId,
            ActionState state) {
        id = state.actionId();
        commandId = state.commandId();
        this.gameId = gameId;
        actorUserId = state.actorUserId();
        sequenceNumber = (short) state.sequenceNumber();
        actionType = state.actionType();
        question = state.question();
        answer = state.answer();
        answerComment = state.comment();
        guessedPokemonId =
                state.guessedPokemonNationalDexId();
        correct = state.correct();
        createdAt = state.createdAt();
        answeredAt = state.answeredAt();
    }

    static GameActionRecord create(
            UUID gameId,
            ActionState state) {
        return new GameActionRecord(gameId, state);
    }

    void applyAnswer(ActionState state) {
        if (!id.equals(state.actionId())
                || !commandId.equals(state.commandId())
                || !actorUserId.equals(state.actorUserId())
                || sequenceNumber
                        != state.sequenceNumber()
                || actionType
                        != GameActionType.QUESTION
                || state.actionType()
                        != GameActionType.QUESTION
                || !createdAt.equals(state.createdAt())) {
            throw new IllegalArgumentException(
                    "answer 대상 action이 다릅니다.");
        }
        answer = state.answer();
        answerComment = state.comment();
        answeredAt = state.answeredAt();
    }

    public UUID getId() {
        return id;
    }

    public UUID getCommandId() {
        return commandId;
    }

    public UUID getGameId() {
        return gameId;
    }

    public UUID getActorUserId() {
        return actorUserId;
    }

    public Short getSequenceNumber() {
        return sequenceNumber;
    }

    public GameActionType getActionType() {
        return actionType;
    }

    public String getQuestion() {
        return question;
    }

    public GameAnswer getAnswer() {
        return answer;
    }

    public String getAnswerComment() {
        return answerComment;
    }

    public Integer getGuessedPokemonId() {
        return guessedPokemonId;
    }

    public Boolean getCorrect() {
        return correct;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getAnsweredAt() {
        return answeredAt;
    }
}
