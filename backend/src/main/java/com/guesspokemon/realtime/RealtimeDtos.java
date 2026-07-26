package com.guesspokemon.realtime;

import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameTypes.GameStatus;
import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import com.guesspokemon.room.RoomDtos.RoomRole;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class RealtimeDtos {

    private RealtimeDtos() {
    }

    public record CommandEnvelope<T>(
            @NotNull UUID commandId,
            @PositiveOrZero long expectedStateVersion,
            @NotNull @Valid T payload) {
    }

    public record SelectPokemonPayload(
            @Positive int nationalDexId) {
    }

    public record AskQuestionPayload(
            @NotBlank @Size(max = 200) String question) {
    }

    public record AnswerQuestionPayload(
            @NotNull GameAnswer answer,
            String comment) {
    }

    public record GuessPokemonPayload(
            @Positive int nationalDexId) {
    }

    public record ResumePayload() {
    }

    public record RolePreferencePayload(
            @NotNull RoomRole preferredRole) {
    }

    public enum GameEventType {
        ROOM_SNAPSHOT,
        PLAYER_JOINED,
        ROUND_STARTED,
        QUESTION_ASKED,
        QUESTION_ANSWERED,
        GUESS_RESOLVED,
        PLAYER_CONNECTION_CHANGED,
        ROOM_CLOSED,
        GAME_ENDED
    }

    public record GameEventEnvelope(
            UUID eventId,
            GameEventType eventType,
            String roomCode,
            UUID gameId,
            long stateVersion,
            Instant occurredAt,
            Object payload) {
    }

    public record RealtimeError(
            UUID commandId,
            String code,
            String message,
            boolean recoverable,
            Long latestStateVersion) {
    }

    public record PlayerSummary(
            UUID userId,
            String nickname) {
    }

    public record PlayerJoinedPayload(
            PlayerSummary player) {
    }

    public enum RoomClosedReason {
        HOST_LEFT,
        RESULT_ROOM_LEFT
    }

    public record RoomClosedPayload(
            UUID leftUserId,
            RoomClosedReason reason) {
    }

    public sealed interface RoundStartedPayload
            permits SelectorRoundStartedPayload,
                    QuestionerRoundStartedPayload {

        int roundNumber();

        GameRole myRole();

        GameRole opponentRole();

        int usedActionCount();

        int remainingActionCount();
    }

    public record SelectorRoundStartedPayload(
            int roundNumber,
            GameRole myRole,
            GameRole opponentRole,
            int usedActionCount,
            int remainingActionCount,
            PokemonSummary selectedPokemon)
            implements RoundStartedPayload {
    }

    public record QuestionerRoundStartedPayload(
            int roundNumber,
            GameRole myRole,
            GameRole opponentRole,
            int usedActionCount,
            int remainingActionCount)
            implements RoundStartedPayload {
    }

    public record QuestionAskedPayload(
            int sequenceNo,
            String question,
            int usedActionCount,
            int remainingActionCount) {
    }

    public record QuestionAnsweredPayload(
            int sequenceNo,
            String question,
            GameAnswer answer,
            String comment,
            int usedActionCount,
            int remainingActionCount) {
    }

    public record GuessResolvedPayload(
            int sequenceNo,
            PokemonSummary guessedPokemon,
            boolean correct,
            int usedActionCount,
            int remainingActionCount) {
    }

    public record PlayerConnectionChangedPayload(
            UUID userId,
            boolean connected,
            Instant reconnectDeadline) {
    }

    public record GameEndedPayload(
            GameStatus status,
            PokemonSummary answerPokemon,
            UUID winnerUserId,
            UUID loserUserId,
            GameEndReason endReason,
            int usedActionCount) {
    }

}
