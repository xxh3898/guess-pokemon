package com.guesspokemon.game;

import static com.guesspokemon.game.GameTypes.GameActionType.GUESS;
import static com.guesspokemon.game.GameTypes.GameActionType.QUESTION;

import com.guesspokemon.game.GameTypes.GameActionType;
import com.guesspokemon.game.GameTypes.GameAnswer;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

record GameAction(
        UUID id,
        UUID commandId,
        UUID actorUserId,
        int sequenceNumber,
        GameActionType type,
        String question,
        GameAnswer answer,
        Integer guessedPokemonId,
        Boolean correct,
        Instant createdAt,
        Instant answeredAt) {

    GameAction {
        Objects.requireNonNull(id);
        Objects.requireNonNull(commandId);
        Objects.requireNonNull(actorUserId);
        Objects.requireNonNull(type);
        Objects.requireNonNull(createdAt);
        if (sequenceNumber < 1 || sequenceNumber > Game.MAX_ACTION_COUNT) {
            throw new IllegalArgumentException(
                    "sequenceNumber가 범위를 벗어났습니다.");
        }
        validateShape(
                type,
                question,
                answer,
                guessedPokemonId,
                correct,
                answeredAt);
    }

    static GameAction question(
            UUID id,
            UUID commandId,
            UUID actorUserId,
            int sequenceNumber,
            String question,
            Instant createdAt) {
        return new GameAction(
                id,
                commandId,
                actorUserId,
                sequenceNumber,
                QUESTION,
                Objects.requireNonNull(question),
                null,
                null,
                null,
                createdAt,
                null);
    }

    static GameAction guess(
            UUID id,
            UUID commandId,
            UUID actorUserId,
            int sequenceNumber,
            int guessedPokemonId,
            boolean correct,
            Instant createdAt) {
        return new GameAction(
                id,
                commandId,
                actorUserId,
                sequenceNumber,
                GUESS,
                null,
                null,
                guessedPokemonId,
                correct,
                createdAt,
                null);
    }

    GameAction answered(GameAnswer newAnswer, Instant newAnsweredAt) {
        if (type != QUESTION || answer != null) {
            throw new IllegalStateException(
                    "답변할 수 없는 action입니다.");
        }
        return new GameAction(
                id,
                commandId,
                actorUserId,
                sequenceNumber,
                type,
                question,
                Objects.requireNonNull(newAnswer),
                null,
                null,
                createdAt,
                Objects.requireNonNull(newAnsweredAt));
    }

    boolean isPendingQuestion() {
        return type == QUESTION && answer == null;
    }

    private static void validateShape(
            GameActionType type,
            String question,
            GameAnswer answer,
            Integer guessedPokemonId,
            Boolean correct,
            Instant answeredAt) {
        if (type == QUESTION) {
            if (question == null
                    || guessedPokemonId != null
                    || correct != null
                    || (answer == null) != (answeredAt == null)) {
                throw new IllegalArgumentException(
                        "QUESTION action 형태가 올바르지 않습니다.");
            }
            return;
        }
        if (question != null
                || answer != null
                || answeredAt != null
                || guessedPokemonId == null
                || correct == null) {
            throw new IllegalArgumentException(
                    "GUESS action 형태가 올바르지 않습니다.");
        }
    }
}
