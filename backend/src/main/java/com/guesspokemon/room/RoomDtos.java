package com.guesspokemon.room;

import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameStatus;
import com.guesspokemon.game.GameViews.ActionView;
import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class RoomDtos {

    private RoomDtos() {
    }

    public enum RoomStatus {
        WAITING_FOR_OPPONENT,
        WAITING_FOR_SELECTION,
        PLAYING,
        PAUSED,
        RESULT
    }

    public enum RoomRole {
        SELECTOR,
        QUESTIONER
    }

    public record RoomMember(
            UUID userId,
            String nickname,
            RoomRole role,
            boolean connected,
            Instant reconnectDeadline) {
    }

    public record RematchState(
            boolean meReady,
            boolean opponentReady) {
    }

    public sealed interface RoomGameSnapshot
            permits SelectorGameSnapshot,
                    QuestionerGameSnapshot,
                    ResultGameSnapshot {

        UUID gameId();

        GameStatus status();

        int usedActionCount();

        int remainingActionCount();

        List<ActionView> actions();
    }

    public record SelectorGameSnapshot(
            UUID gameId,
            GameStatus status,
            int usedActionCount,
            int remainingActionCount,
            PokemonSummary selectedPokemon,
            List<ActionView> actions)
            implements RoomGameSnapshot {

        public SelectorGameSnapshot {
            actions = List.copyOf(actions);
        }
    }

    public record QuestionerGameSnapshot(
            UUID gameId,
            GameStatus status,
            int usedActionCount,
            int remainingActionCount,
            List<ActionView> actions)
            implements RoomGameSnapshot {

        public QuestionerGameSnapshot {
            actions = List.copyOf(actions);
        }
    }

    public record ResultGameSnapshot(
            UUID gameId,
            GameStatus status,
            int usedActionCount,
            int remainingActionCount,
            PokemonSummary answerPokemon,
            UUID winnerUserId,
            UUID loserUserId,
            GameEndReason endReason,
            List<ActionView> actions)
            implements RoomGameSnapshot {

        public ResultGameSnapshot {
            actions = List.copyOf(actions);
        }
    }

    public record RoomSnapshot(
            String roomCode,
            RoomStatus status,
            long stateVersion,
            int roundNumber,
            RoomMember me,
            RoomMember opponent,
            RoomGameSnapshot game,
            RematchState rematch) {
    }
}
