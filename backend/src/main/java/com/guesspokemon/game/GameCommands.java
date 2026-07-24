package com.guesspokemon.game;

import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameTypes.GameEndReason;
import java.util.Objects;
import java.util.UUID;

public final class GameCommands {

    private GameCommands() {
    }

    public record StartGameCommand(
            String roomCode,
            UUID roundGroupId,
            UUID selectorUserId,
            UUID questionerUserId,
            int answerPokemonNationalDexId,
            UUID commandId,
            long initialStateVersion) {

        public StartGameCommand {
            requireRoomCode(roomCode);
            Objects.requireNonNull(roundGroupId);
            Objects.requireNonNull(selectorUserId);
            Objects.requireNonNull(questionerUserId);
            Objects.requireNonNull(commandId);
            if (answerPokemonNationalDexId <= 0
                    || initialStateVersion < 0) {
                throw new IllegalArgumentException(
                        "game start 입력값이 올바르지 않습니다.");
            }
        }
    }

    public record AskQuestionCommand(
            String roomCode,
            UUID userId,
            UUID commandId,
            String question) {

        public AskQuestionCommand {
            requireRoomCode(roomCode);
            Objects.requireNonNull(userId);
            Objects.requireNonNull(commandId);
        }
    }

    public record AnswerQuestionCommand(
            String roomCode,
            UUID userId,
            UUID commandId,
            GameAnswer answer) {

        public AnswerQuestionCommand {
            requireRoomCode(roomCode);
            Objects.requireNonNull(userId);
            Objects.requireNonNull(commandId);
            Objects.requireNonNull(answer);
        }
    }

    public record GuessPokemonCommand(
            String roomCode,
            UUID userId,
            UUID commandId,
            int guessedPokemonNationalDexId) {

        public GuessPokemonCommand {
            requireRoomCode(roomCode);
            Objects.requireNonNull(userId);
            Objects.requireNonNull(commandId);
            if (guessedPokemonNationalDexId <= 0) {
                throw new IllegalArgumentException(
                        "guessedPokemonNationalDexId가 올바르지 않습니다.");
            }
        }
    }

    public record EndGameCommand(
            String roomCode,
            UUID disconnectedUserId,
            UUID commandId,
            GameEndReason endReason,
            long targetStateVersion) {

        public EndGameCommand {
            requireRoomCode(roomCode);
            Objects.requireNonNull(commandId);
            Objects.requireNonNull(endReason);
            if (targetStateVersion < 0) {
                throw new IllegalArgumentException(
                        "targetStateVersion이 음수입니다.");
            }
            boolean participantLoss =
                    endReason == GameEndReason.PLAYER_LEFT
                            || endReason
                                    == GameEndReason.RECONNECT_TIMEOUT;
            boolean bothDisconnected =
                    endReason == GameEndReason.BOTH_DISCONNECTED;
            if ((!participantLoss && !bothDisconnected)
                    || (participantLoss
                            && disconnectedUserId == null)
                    || (bothDisconnected
                            && disconnectedUserId != null)) {
                throw new IllegalArgumentException(
                        "game 종료 입력값이 올바르지 않습니다.");
            }
        }
    }

    private static void requireRoomCode(String roomCode) {
        if (roomCode == null || roomCode.isBlank()) {
            throw new IllegalArgumentException(
                    "roomCode가 없습니다.");
        }
    }
}
