package com.guesspokemon.game;

import com.guesspokemon.game.GameTypes.GameActionType;
import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameResult;
import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameTypes.GameStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface GamePersistencePort {

    void createGame(GameState gameState);

    void appendAction(
            long expectedPreviousVersion,
            GameState gameState,
            ActionState actionState);

    void updateAnsweredQuestion(
            long expectedPreviousVersion,
            GameState gameState,
            ActionState actionState);

    void updateGame(
            long expectedPreviousVersion,
            GameState gameState);

    boolean actionCommandExists(UUID commandId);

    int abortInProgressGames(Instant endedAt);

    record GameState(
            UUID gameId,
            UUID roundGroupId,
            int answerPokemonNationalDexId,
            GameStatus status,
            GameEndReason endReason,
            int actionCount,
            long stateVersion,
            Instant startedAt,
            Instant endedAt,
            List<ParticipantState> participants) {

        public GameState {
            participants = List.copyOf(participants);
        }
    }

    record ParticipantState(
            UUID userId,
            GameRole role,
            GameResult result,
            Instant createdAt) {
    }

    record ActionState(
            UUID actionId,
            UUID commandId,
            UUID actorUserId,
            int sequenceNumber,
            GameActionType actionType,
            String question,
            GameAnswer answer,
            String comment,
            Integer guessedPokemonNationalDexId,
            Boolean correct,
            Instant createdAt,
            Instant answeredAt) {
    }
}
