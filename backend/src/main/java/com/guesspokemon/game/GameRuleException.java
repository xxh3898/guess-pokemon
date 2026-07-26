package com.guesspokemon.game;

import java.util.Objects;

public final class GameRuleException extends RuntimeException {

    private final GameRuleError error;

    public GameRuleException(GameRuleError error) {
        super(Objects.requireNonNull(error).name());
        this.error = error;
    }

    public GameRuleException(GameRuleError error, Throwable cause) {
        super(Objects.requireNonNull(error).name(), cause);
        this.error = error;
    }

    public GameRuleError error() {
        return error;
    }

    public enum GameRuleError {
        INVALID_ROLE,
        INVALID_GAME_STATE,
        ANSWER_PENDING,
        NO_PENDING_QUESTION,
        ACTION_LIMIT_REACHED,
        DUPLICATE_COMMAND,
        POKEMON_ALREADY_GUESSED,
        STALE_ROOM_STATE,
        POKEMON_NOT_FOUND,
        VALIDATION_FAILED,
        PERSISTENCE_CONFLICT
    }
}
