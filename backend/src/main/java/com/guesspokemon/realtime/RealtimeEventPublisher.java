package com.guesspokemon.realtime;

import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.GAME_ENDED;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.GUESS_RESOLVED;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.PLAYER_CONNECTION_CHANGED;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.PLAYER_JOINED;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.QUESTION_ANSWERED;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.QUESTION_ASKED;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.REMATCH_STATE_CHANGED;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.ROOM_CLOSED;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.ROOM_SNAPSHOT;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.ROUND_STARTED;
import static com.guesspokemon.realtime.RealtimeDtos.RoomClosedReason.HOST_LEFT;
import static com.guesspokemon.realtime.RealtimeDtos.RoomClosedReason.RESULT_ROOM_LEFT;
import static com.guesspokemon.room.RoomDtos.RoomStatus.RESULT;

import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameViews.ActionView;
import com.guesspokemon.pokemon.PokemonCatalogService;
import com.guesspokemon.realtime.RealtimeDtos.GameEndedPayload;
import com.guesspokemon.realtime.RealtimeDtos.GameEventEnvelope;
import com.guesspokemon.realtime.RealtimeDtos.GameEventType;
import com.guesspokemon.realtime.RealtimeDtos.GuessResolvedPayload;
import com.guesspokemon.realtime.RealtimeDtos.PlayerConnectionChangedPayload;
import com.guesspokemon.realtime.RealtimeDtos.PlayerJoinedPayload;
import com.guesspokemon.realtime.RealtimeDtos.PlayerSummary;
import com.guesspokemon.realtime.RealtimeDtos.QuestionAnsweredPayload;
import com.guesspokemon.realtime.RealtimeDtos.QuestionAskedPayload;
import com.guesspokemon.realtime.RealtimeDtos.QuestionerRoundStartedPayload;
import com.guesspokemon.realtime.RealtimeDtos.RematchStateChangedPayload;
import com.guesspokemon.realtime.RealtimeDtos.RoomClosedPayload;
import com.guesspokemon.realtime.RealtimeDtos.RoomClosedReason;
import com.guesspokemon.realtime.RealtimeDtos.RoundStartedPayload;
import com.guesspokemon.realtime.RealtimeDtos.SelectorRoundStartedPayload;
import com.guesspokemon.room.RoomApplicationService.CommandOutcome;
import com.guesspokemon.room.RoomApplicationService.ConnectionOutcome;
import com.guesspokemon.room.RoomApplicationService.JoinOutcome;
import com.guesspokemon.room.RoomApplicationService.LeaveOutcome;
import com.guesspokemon.room.RoomApplicationService.RematchOutcome;
import com.guesspokemon.room.RoomApplicationService.TimeoutOutcome;
import com.guesspokemon.room.RoomDtos.QuestionerGameSnapshot;
import com.guesspokemon.room.RoomDtos.RematchState;
import com.guesspokemon.room.RoomDtos.ResultGameSnapshot;
import com.guesspokemon.room.RoomDtos.RoomGameSnapshot;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import com.guesspokemon.room.RoomDtos.SelectorGameSnapshot;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class RealtimeEventPublisher {

    private final SimpMessagingTemplate messagingTemplate;
    private final PokemonCatalogService pokemonCatalogService;
    private final Clock clock;

    public RealtimeEventPublisher(
            SimpMessagingTemplate messagingTemplate,
            PokemonCatalogService pokemonCatalogService,
            Clock roomClock) {
        this.messagingTemplate = messagingTemplate;
        this.pokemonCatalogService = pokemonCatalogService;
        this.clock = roomClock;
    }

    public void publishPlayerJoined(JoinOutcome outcome) {
        RoomSnapshot joined =
                outcome.snapshots()
                        .get(outcome.joinedUserId());
        publish(
                outcome.hostUserId(),
                PLAYER_JOINED,
                outcome.snapshots().get(outcome.hostUserId()),
                new PlayerJoinedPayload(
                        new PlayerSummary(
                                joined.me().userId(),
                                joined.me().nickname())));
        publishSnapshot(
                outcome.hostUserId(),
                outcome.snapshots().get(outcome.hostUserId()));
    }

    public void publishRoundStarted(
            CommandOutcome outcome) {
        for (Map.Entry<UUID, RoomSnapshot> entry :
                outcome.snapshots().entrySet()) {
            RoomSnapshot snapshot = entry.getValue();
            publish(
                    entry.getKey(),
                    ROUND_STARTED,
                    snapshot,
                    roundStartedPayload(snapshot));
        }
    }

    public void publishQuestionAsked(
            CommandOutcome outcome) {
        RoomSnapshot representative =
                outcome.snapshots().values().iterator().next();
        ActionView action =
                representative.game().actions().getLast();
        QuestionAskedPayload payload =
                new QuestionAskedPayload(
                        action.sequenceNumber(),
                        action.question(),
                        representative
                                .game()
                                .usedActionCount(),
                        representative
                                .game()
                                .remainingActionCount());
        publishToAll(
                QUESTION_ASKED,
                outcome.snapshots(),
                payload);
    }

    public void publishQuestionAnswered(
            CommandOutcome outcome) {
        RoomSnapshot representative =
                outcome.snapshots().values().iterator().next();
        ActionView action =
                representative.game().actions().getLast();
        QuestionAnsweredPayload payload =
                new QuestionAnsweredPayload(
                        action.sequenceNumber(),
                        action.question(),
                        action.answer(),
                        action.comment(),
                        representative
                                .game()
                                .usedActionCount(),
                        representative
                                .game()
                                .remainingActionCount());
        publishToAll(
                QUESTION_ANSWERED,
                outcome.snapshots(),
                payload);
        if (outcome.gameEnded()) {
            publishGameEnded(outcome.snapshots());
        }
    }

    public void publishGuessResolved(
            CommandOutcome outcome) {
        RoomSnapshot representative =
                outcome.snapshots().values().iterator().next();
        ActionView action =
                representative.game().actions().getLast();
        GuessResolvedPayload payload =
                new GuessResolvedPayload(
                        action.sequenceNumber(),
                        pokemonCatalogService
                                .findByNationalDexId(
                                        action
                                                .guessedPokemonNationalDexId()),
                        Boolean.TRUE.equals(action.correct()),
                        representative
                                .game()
                                .usedActionCount(),
                        representative
                                .game()
                                .remainingActionCount());
        publishToAll(
                GUESS_RESOLVED,
                outcome.snapshots(),
                payload);
        if (outcome.gameEnded()) {
            publishGameEnded(outcome.snapshots());
        }
    }

    public void publishConnectionChanged(
            ConnectionOutcome outcome) {
        if (!outcome.change().changed()) {
            return;
        }
        PlayerConnectionChangedPayload payload =
                new PlayerConnectionChangedPayload(
                        outcome.change().userId(),
                        outcome.change().connected(),
                        outcome.change().reconnectDeadline());
        publishToAll(
                PLAYER_CONNECTION_CHANGED,
                outcome.snapshots(),
                payload);
    }

    public void publishResumeSnapshot(
            UUID userId,
            ConnectionOutcome outcome) {
        publishSnapshot(
                userId,
                outcome.snapshots().get(userId));
    }

    public void publishTimeout(
            TimeoutOutcome outcome) {
        if (outcome.completed()) {
            publishGameEnded(outcome.snapshots());
        }
    }

    public void publishLeave(LeaveOutcome outcome) {
        if (outcome.gameEnded()) {
            publishGameEnded(outcome.snapshots());
            return;
        }
        if (outcome.roomClosed()) {
            publishRoomClosed(outcome);
            return;
        }
        outcome.snapshots()
                .forEach(this::publishSnapshot);
    }

    public void publishRematch(
            RematchOutcome outcome) {
        if (outcome.nextRoundReady()) {
            outcome.snapshots()
                    .forEach(this::publishSnapshot);
            return;
        }
        for (Map.Entry<UUID, RoomSnapshot> entry :
                outcome.snapshots().entrySet()) {
            RematchState rematch =
                    entry.getValue().rematch();
            publish(
                    entry.getKey(),
                    REMATCH_STATE_CHANGED,
                    entry.getValue(),
                    new RematchStateChangedPayload(
                            rematch.meReady(),
                            rematch.opponentReady()));
        }
    }

    private void publishGameEnded(
            Map<UUID, RoomSnapshot> snapshots) {
        RoomSnapshot representative =
                snapshots.values().iterator().next();
        ResultGameSnapshot game =
                (ResultGameSnapshot)
                        representative.game();
        GameEndedPayload payload =
                new GameEndedPayload(
                        game.status(),
                        game.answerPokemon(),
                        game.winnerUserId(),
                        game.loserUserId(),
                        game.endReason(),
                        game.usedActionCount());
        publishToAll(
                GAME_ENDED,
                snapshots,
                payload);
    }

    private void publishRoomClosed(
            LeaveOutcome outcome) {
        RoomClosedReason reason =
                outcome.snapshots()
                                .values()
                                .stream()
                                .anyMatch(
                                        snapshot ->
                                                snapshot.status()
                                                        == RESULT)
                        ? RESULT_ROOM_LEFT
                        : HOST_LEFT;
        RoomClosedPayload payload =
                new RoomClosedPayload(
                        outcome.leftUserId(),
                        reason);
        outcome.snapshots()
                .forEach(
                        (userId, snapshot) -> {
                            if (!userId.equals(
                                    outcome.leftUserId())) {
                                publish(
                                        userId,
                                        ROOM_CLOSED,
                                        snapshot,
                                        payload);
                            }
                        });
    }

    private RoundStartedPayload roundStartedPayload(
            RoomSnapshot snapshot) {
        RoomGameSnapshot game = snapshot.game();
        GameRole myRole =
                GameRole.valueOf(
                        snapshot.me().role().name());
        GameRole opponentRole =
                GameRole.valueOf(
                        snapshot.opponent().role().name());
        if (game instanceof SelectorGameSnapshot selector) {
            return new SelectorRoundStartedPayload(
                    snapshot.roundNumber(),
                    myRole,
                    opponentRole,
                    selector.usedActionCount(),
                    selector.remainingActionCount(),
                    selector.selectedPokemon());
        }
        QuestionerGameSnapshot questioner =
                (QuestionerGameSnapshot) game;
        return new QuestionerRoundStartedPayload(
                snapshot.roundNumber(),
                myRole,
                opponentRole,
                questioner.usedActionCount(),
                questioner.remainingActionCount());
    }

    private void publishSnapshot(
            UUID userId,
            RoomSnapshot snapshot) {
        publish(
                userId,
                ROOM_SNAPSHOT,
                snapshot,
                snapshot);
    }

    private void publishToAll(
            GameEventType eventType,
            Map<UUID, RoomSnapshot> snapshots,
            Object payload) {
        snapshots.forEach(
                (userId, snapshot) ->
                        publish(
                                userId,
                                eventType,
                                snapshot,
                                payload));
    }

    private void publish(
            UUID userId,
            GameEventType eventType,
            RoomSnapshot snapshot,
            Object payload) {
        Instant occurredAt = clock.instant();
        UUID gameId =
                snapshot.game() == null
                        ? null
                        : snapshot.game().gameId();
        messagingTemplate.convertAndSendToUser(
                userId.toString(),
                WebSocketConfig.GAME_EVENT_QUEUE,
                new GameEventEnvelope(
                        UUID.randomUUID(),
                        eventType,
                        snapshot.roomCode(),
                        gameId,
                        snapshot.stateVersion(),
                        occurredAt,
                        payload));
    }
}
