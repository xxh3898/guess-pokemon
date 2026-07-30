package com.guesspokemon.room;

import com.guesspokemon.game.GameTypes.GameActionType;
import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameMode;
import com.guesspokemon.game.GameTypes.GameStatus;
import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public final class RoomDtos {

    private RoomDtos() {
    }

    public enum RoomStatus {
        WAITING_FOR_OPPONENT,
        WAITING_FOR_ROLE_SELECTION,
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

    public record RoleSelectionState(
            RoomRole preferredRole,
            boolean opponentSelected) {
    }

    public record RoleAssignmentState(
            boolean randomized) {
    }

    public record RoomActionSnapshot(
            int sequenceNumber,
            GameActionType type,
            String question,
            GameAnswer answer,
            String comment,
            Integer guessedPokemonNationalDexId,
            PokemonSummary guessedPokemon,
            Boolean correct,
            Instant createdAt,
            Instant answeredAt) {
    }

    public sealed interface RoomGameSnapshot
            permits SelectorGameSnapshot,
                    QuestionerGameSnapshot,
                    ResultGameSnapshot {

        UUID gameId();

        GameStatus status();

        int usedActionCount();

        int remainingActionCount();

        List<RoomActionSnapshot> actions();
    }

    public record SelectorGameSnapshot(
            UUID gameId,
            GameStatus status,
            int usedActionCount,
            int remainingActionCount,
            PokemonSummary selectedPokemon,
            List<RoomActionSnapshot> actions)
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
            List<RoomActionSnapshot> actions)
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
            List<RoomActionSnapshot> actions)
            implements RoomGameSnapshot {

        public ResultGameSnapshot {
            actions = List.copyOf(actions);
        }
    }

    public record JoinableRoomSummary(
            String roomCode,
            String hostNickname,
            GameMode mode) {

        public JoinableRoomSummary {
            roomCode = Objects.requireNonNull(roomCode);
            hostNickname = Objects.requireNonNull(hostNickname);
            mode = Objects.requireNonNull(mode);
        }

        public JoinableRoomSummary(
                String roomCode,
                String hostNickname) {
            this(
                    roomCode,
                    hostNickname,
                    GameMode.TWENTY_QUESTIONS);
        }
    }

    public record JoinableRoomListResponse(
            List<JoinableRoomSummary> rooms) {

        public JoinableRoomListResponse {
            rooms = List.copyOf(rooms);
        }
    }

    public record RoomSnapshot(
            String roomCode,
            GameMode mode,
            RoomStatus status,
            long stateVersion,
            int roundNumber,
            RoomMember me,
            RoomMember opponent,
            RoomGameSnapshot game,
            RoleSelectionState roleSelection,
            RoleAssignmentState roleAssignment) {

        public RoomSnapshot(
                String roomCode,
                RoomStatus status,
                long stateVersion,
                int roundNumber,
                RoomMember me,
                RoomMember opponent,
                RoomGameSnapshot game,
                RoleSelectionState roleSelection,
                RoleAssignmentState roleAssignment) {
            this(
                    roomCode,
                    GameMode.TWENTY_QUESTIONS,
                    status,
                    stateVersion,
                    roundNumber,
                    me,
                    opponent,
                    game,
                    roleSelection,
                    roleAssignment);
        }
    }
}
