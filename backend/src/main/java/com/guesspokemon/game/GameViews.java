package com.guesspokemon.game;

import com.guesspokemon.game.GameTypes.GameActionType;
import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameTypes.GameStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class GameViews {

    private GameViews() {
    }

    public sealed interface ParticipantGameView
            permits SelectorGameView, QuestionerGameView {

        UUID gameId();

        GameStatus status();

        long stateVersion();

        int usedActionCount();

        int remainingActionCount();

        GameRole myRole();

        UUID winnerUserId();

        UUID loserUserId();

        GameEndReason endReason();

        List<ActionView> actions();
    }

    public record SelectorGameView(
            UUID gameId,
            GameStatus status,
            long stateVersion,
            int usedActionCount,
            int remainingActionCount,
            GameRole myRole,
            int selectedPokemonNationalDexId,
            UUID winnerUserId,
            UUID loserUserId,
            GameEndReason endReason,
            List<ActionView> actions)
            implements ParticipantGameView {

        public SelectorGameView {
            actions = List.copyOf(actions);
        }
    }

    public record QuestionerGameView(
            UUID gameId,
            GameStatus status,
            long stateVersion,
            int usedActionCount,
            int remainingActionCount,
            GameRole myRole,
            UUID winnerUserId,
            UUID loserUserId,
            GameEndReason endReason,
            List<ActionView> actions)
            implements ParticipantGameView {

        public QuestionerGameView {
            actions = List.copyOf(actions);
        }
    }

    public record ActionView(
            int sequenceNumber,
            GameActionType type,
            String question,
            GameAnswer answer,
            Integer guessedPokemonNationalDexId,
            Boolean correct,
            Instant createdAt,
            Instant answeredAt) {
    }
}
