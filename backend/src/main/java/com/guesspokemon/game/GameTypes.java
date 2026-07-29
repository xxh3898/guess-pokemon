package com.guesspokemon.game;

public final class GameTypes {

    private GameTypes() {
    }

    public enum GameStatus {
        IN_PROGRESS,
        COMPLETED,
        ABORTED
    }

    public enum GameMode {
        TWENTY_QUESTIONS,
        SILHOUETTE
    }

    public enum GameRole {
        SELECTOR,
        QUESTIONER
    }

    public enum GameResult {
        WIN,
        LOSS,
        NONE
    }

    public enum GameEndReason {
        CORRECT_GUESS,
        QUESTION_LIMIT,
        GUESS_LIMIT,
        PLAYER_LEFT,
        RECONNECT_TIMEOUT,
        BOTH_DISCONNECTED,
        SERVER_RESTART
    }

    public enum GameActionType {
        QUESTION,
        GUESS
    }

    public enum GameAnswer {
        YES,
        NO,
        UNKNOWN
    }
}
