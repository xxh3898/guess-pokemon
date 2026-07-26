package com.guesspokemon.room;

import static com.guesspokemon.game.GameTypes.GameEndReason.PLAYER_LEFT;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.IN_PROGRESS;

import com.guesspokemon.game.GameCommandService;
import com.guesspokemon.game.GameCommands.AnswerQuestionCommand;
import com.guesspokemon.game.GameCommands.AskQuestionCommand;
import com.guesspokemon.game.GameCommands.EndGameCommand;
import com.guesspokemon.game.GameCommands.GuessPokemonCommand;
import com.guesspokemon.game.GameCommands.StartGameCommand;
import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameViews.ParticipantGameView;
import com.guesspokemon.game.GameViews.QuestionerGameView;
import com.guesspokemon.game.GameViews.SelectorGameView;
import com.guesspokemon.pokemon.PokemonCatalogService;
import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import com.guesspokemon.room.RoomDtos.JoinableRoomListResponse;
import com.guesspokemon.room.RoomDtos.QuestionerGameSnapshot;
import com.guesspokemon.room.RoomDtos.ResultGameSnapshot;
import com.guesspokemon.room.RoomDtos.RoomGameSnapshot;
import com.guesspokemon.room.RoomDtos.RoomRole;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import com.guesspokemon.room.RoomDtos.SelectorGameSnapshot;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class RoomApplicationService {

    static final Duration RECONNECT_GRACE =
            Duration.ofSeconds(60);

    private final RoomRegistry roomRegistry;
    private final GameCommandService gameCommandService;
    private final PokemonCatalogService pokemonCatalogService;
    private final RoleAssignmentDecider roleAssignmentDecider;
    private final Clock clock;

    public RoomApplicationService(
            RoomRegistry roomRegistry,
            GameCommandService gameCommandService,
            PokemonCatalogService pokemonCatalogService,
            RoleAssignmentDecider roleAssignmentDecider,
            Clock roomClock) {
        this.roomRegistry = roomRegistry;
        this.gameCommandService = gameCommandService;
        this.pokemonCatalogService = pokemonCatalogService;
        this.roleAssignmentDecider = roleAssignmentDecider;
        this.clock = roomClock;
    }

    public RoomSnapshot create(
            UUID userId,
            String nickname) {
        return roomRegistry.create(userId, nickname);
    }

    public JoinableRoomListResponse listJoinableRooms() {
        return new JoinableRoomListResponse(
                roomRegistry.listJoinableRooms());
    }

    public JoinOutcome join(
            String roomCode,
            UUID userId,
            String nickname) {
        return roomRegistry.join(
                        roomCode,
                        userId,
                        nickname,
                room ->
                        new JoinOutcome(
                                userId,
                                room.hostUserId(),
                                snapshotsFor(room)));
    }

    public RoomSnapshot getSnapshot(
            String roomCode,
            UUID userId) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                room ->
                        snapshotsFor(room).get(userId));
    }

    public LeaveOutcome leave(
            String roomCode,
            UUID userId) {
        RoomRegistry.LeaveExecution<LeaveOutcome> execution =
                roomRegistry.leave(
                        roomCode,
                        userId,
                        room -> prepareLeave(room, userId),
                        (room, prepared) ->
                                new LeaveOutcome(
                                        prepared.gameEnded(),
                                        false,
                                        prepared.leftUserId(),
                                        snapshotsFor(room)));
        LeaveOutcome outcome = execution.result();
        boolean roomClosed =
                execution.leaveResult()
                        == Room.LeaveResult.ROOM_CLOSED;
        if (roomClosed) {
            gameCommandService.removeGame(roomCode);
        }
        return new LeaveOutcome(
                outcome.gameEnded(),
                roomClosed,
                outcome.leftUserId(),
                outcome.snapshots());
    }

    public CommandOutcome selectPokemon(
            String roomCode,
            UUID userId,
            UUID commandId,
            long expectedStateVersion,
            int nationalDexId) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                room -> {
                    Room.StartContext context =
                            room.prepareStart(
                                    userId,
                                    commandId,
                                    expectedStateVersion);
                    ParticipantGameView gameView =
                            gameCommandService.startGame(
                                    new StartGameCommand(
                                            room.code(),
                                            context.roundGroupId(),
                                            context.selectorUserId(),
                                            context.questionerUserId(),
                                            nationalDexId,
                                            commandId,
                                            context.targetStateVersion()));
                    room.applyGameView(commandId, gameView);
                    return commandOutcome(
                            room,
                            false);
                });
    }

    public CommandOutcome askQuestion(
            String roomCode,
            UUID userId,
            UUID commandId,
            long expectedStateVersion,
            String question) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                room -> {
                    long targetStateVersion =
                            room.prepareGameCommand(
                                    userId,
                                    QUESTIONER,
                                    expectedStateVersion);
                    ParticipantGameView gameView =
                            gameCommandService.askQuestion(
                                    new AskQuestionCommand(
                                            room.code(),
                                            userId,
                                            commandId,
                                            question),
                                    targetStateVersion);
                    room.applyGameView(commandId, gameView);
                    return commandOutcome(
                            room,
                            false);
                });
    }

    public CommandOutcome answerQuestion(
            String roomCode,
            UUID userId,
            UUID commandId,
            long expectedStateVersion,
            GameAnswer answer) {
        return answerQuestion(
                roomCode,
                userId,
                commandId,
                expectedStateVersion,
                answer,
                null);
    }

    public CommandOutcome answerQuestion(
            String roomCode,
            UUID userId,
            UUID commandId,
            long expectedStateVersion,
            GameAnswer answer,
            String comment) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                room -> {
                    long targetStateVersion =
                            room.prepareGameCommand(
                                    userId,
                                    SELECTOR,
                                    expectedStateVersion);
                    ParticipantGameView gameView =
                            gameCommandService.answerQuestion(
                                    new AnswerQuestionCommand(
                                            room.code(),
                                            userId,
                                            commandId,
                                            answer,
                                            comment),
                                    targetStateVersion);
                    room.applyGameView(commandId, gameView);
                    return commandOutcome(
                            room,
                            gameView.status() != IN_PROGRESS);
                });
    }

    public CommandOutcome guessPokemon(
            String roomCode,
            UUID userId,
            UUID commandId,
            long expectedStateVersion,
            int nationalDexId) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                room -> {
                    long targetStateVersion =
                            room.prepareGameCommand(
                                    userId,
                                    QUESTIONER,
                                    expectedStateVersion);
                    ParticipantGameView gameView =
                            gameCommandService.guessPokemon(
                                    new GuessPokemonCommand(
                                            room.code(),
                                            userId,
                                            commandId,
                                            nationalDexId),
                                    targetStateVersion);
                    room.applyGameView(commandId, gameView);
                    return commandOutcome(
                            room,
                            gameView.status() != IN_PROGRESS);
                });
    }

    public ConnectionOutcome resume(
            String roomCode,
            UUID userId) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                room -> {
                    Room.ConnectionChange change =
                            room.resume(userId);
                    return new ConnectionOutcome(
                            toConnectionStateChange(change),
                            snapshotsFor(room));
                });
    }

    public ConnectionOutcome disconnect(
            String roomCode,
            UUID userId) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                room -> {
                    Room.ConnectionChange change =
                            room.disconnect(
                                    userId,
                                    clock.instant(),
                                    RECONNECT_GRACE);
                    return new ConnectionOutcome(
                            toConnectionStateChange(change),
                            snapshotsFor(room));
                });
    }

    public TimeoutOutcome reconnectTimedOut(
            String roomCode,
            UUID userId,
            UUID reconnectToken,
            Instant reconnectDeadline) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                room -> {
                    Room.TimeoutContext context =
                            room.prepareReconnectTimeout(
                                    userId,
                                    reconnectToken,
                                    reconnectDeadline);
                    if (context == null) {
                        return TimeoutOutcome.ignored();
                    }
                    UUID commandId = UUID.randomUUID();
                    ParticipantGameView gameView =
                            gameCommandService.endGame(
                                    new EndGameCommand(
                                            room.code(),
                                            context.disconnectedUserId(),
                                            commandId,
                                            context.endReason(),
                                            context.targetStateVersion()),
                                    room.selectorUserId());
                    room.applyGameView(commandId, gameView);
                    return TimeoutOutcome.completed(
                            context.endReason(),
                            snapshotsFor(room));
                });
    }

    public RolePreferenceOutcome changeRolePreference(
            String roomCode,
            UUID userId,
            UUID commandId,
            long expectedStateVersion,
            RoomRole preferredRole) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                room -> {
                    Room.RolePreferenceChange change =
                            room.changeRolePreference(
                                    userId,
                                    commandId,
                                    expectedStateVersion,
                                    preferredRole,
                                    roleAssignmentDecider);
                    return new RolePreferenceOutcome(
                            change.rolesAssigned(),
                            snapshotsFor(room));
                });
    }

    public long latestStateVersion(
            String roomCode,
            UUID userId) {
        return roomRegistry.executeLocked(
                roomCode,
                userId,
                Room::stateVersion);
    }

    private LeaveOutcome prepareLeave(
            Room room,
            UUID userId) {
        if (!room.hasGameInProgress()) {
            return new LeaveOutcome(
                    false,
                    false,
                    userId,
                    Map.of());
        }
        UUID commandId = UUID.randomUUID();
        ParticipantGameView gameView =
                gameCommandService.endGame(
                        new EndGameCommand(
                                room.code(),
                                userId,
                                commandId,
                                PLAYER_LEFT,
                                room.stateVersion() + 1),
                        room.selectorUserId());
        room.applyGameView(commandId, gameView);
        return new LeaveOutcome(
                true,
                false,
                userId,
                Map.of());
    }

    private CommandOutcome commandOutcome(
            Room room,
            boolean gameEnded) {
        return new CommandOutcome(
                gameEnded,
                snapshotsFor(room));
    }

    private ConnectionStateChange toConnectionStateChange(
            Room.ConnectionChange change) {
        return new ConnectionStateChange(
                change.userId(),
                change.changed(),
                change.connected(),
                change.stateVersion(),
                change.reconnectDeadline(),
                change.reconnectToken());
    }

    private Map<UUID, RoomSnapshot> snapshotsFor(
            Room room) {
        Map<UUID, RoomSnapshot> snapshots =
                new LinkedHashMap<>();
        UUID hostUserId = room.hostUserId();
        UUID guestUserId = room.guestUserId();
        if (!room.hasVisibleGame()) {
            snapshots.put(
                    hostUserId,
                    room.snapshotFor(hostUserId));
            if (guestUserId != null) {
                snapshots.put(
                        guestUserId,
                        room.snapshotFor(guestUserId));
            }
            return Map.copyOf(snapshots);
        }

        SelectorGameView selectorView =
                (SelectorGameView)
                        gameCommandService.getView(
                                room.code(),
                                room.selectorUserId());
        QuestionerGameView questionerView =
                (QuestionerGameView)
                        gameCommandService.getView(
                                room.code(),
                                room.questionerUserId());
        PokemonSummary answerPokemon =
                pokemonCatalogService.findByNationalDexId(
                        selectorView
                                .selectedPokemonNationalDexId());
        RoomGameSnapshot selectorSnapshot;
        RoomGameSnapshot questionerSnapshot;
        if (selectorView.status() == IN_PROGRESS) {
            selectorSnapshot =
                    new SelectorGameSnapshot(
                            selectorView.gameId(),
                            selectorView.status(),
                            selectorView.usedActionCount(),
                            selectorView.remainingActionCount(),
                            answerPokemon,
                            selectorView.actions());
            questionerSnapshot =
                    new QuestionerGameSnapshot(
                            questionerView.gameId(),
                            questionerView.status(),
                            questionerView.usedActionCount(),
                            questionerView
                                    .remainingActionCount(),
                            questionerView.actions());
        } else {
            ResultGameSnapshot resultSnapshot =
                    new ResultGameSnapshot(
                            selectorView.gameId(),
                            selectorView.status(),
                            selectorView.usedActionCount(),
                            selectorView.remainingActionCount(),
                            answerPokemon,
                            selectorView.winnerUserId(),
                            selectorView.loserUserId(),
                            selectorView.endReason(),
                            selectorView.actions());
            selectorSnapshot = resultSnapshot;
            questionerSnapshot = resultSnapshot;
        }
        snapshots.put(
                room.selectorUserId(),
                room.snapshotFor(
                        room.selectorUserId(),
                        selectorSnapshot));
        snapshots.put(
                room.questionerUserId(),
                room.snapshotFor(
                        room.questionerUserId(),
                        questionerSnapshot));
        return Map.copyOf(snapshots);
    }

    public record JoinOutcome(
            UUID joinedUserId,
            UUID hostUserId,
            Map<UUID, RoomSnapshot> snapshots) {

        public JoinOutcome {
            snapshots = Map.copyOf(snapshots);
        }

        public RoomSnapshot joinedSnapshot() {
            return snapshots.get(joinedUserId);
        }
    }

    public record CommandOutcome(
            boolean gameEnded,
            Map<UUID, RoomSnapshot> snapshots) {

        public CommandOutcome {
            snapshots = Map.copyOf(snapshots);
        }
    }

    public record LeaveOutcome(
            boolean gameEnded,
            boolean roomClosed,
            UUID leftUserId,
            Map<UUID, RoomSnapshot> snapshots) {

        public LeaveOutcome {
            Objects.requireNonNull(leftUserId);
            snapshots = Map.copyOf(snapshots);
        }
    }

    public record ConnectionOutcome(
            ConnectionStateChange change,
            Map<UUID, RoomSnapshot> snapshots) {

        public ConnectionOutcome {
            Objects.requireNonNull(change);
            snapshots = Map.copyOf(snapshots);
        }
    }

    public record ConnectionStateChange(
            UUID userId,
            boolean changed,
            boolean connected,
            long stateVersion,
            Instant reconnectDeadline,
            UUID reconnectToken) {
    }

    public record TimeoutOutcome(
            boolean completed,
            com.guesspokemon.game.GameTypes.GameEndReason
                    endReason,
            Map<UUID, RoomSnapshot> snapshots) {

        public TimeoutOutcome {
            snapshots = Map.copyOf(snapshots);
        }

        static TimeoutOutcome ignored() {
            return new TimeoutOutcome(
                    false,
                    null,
                    Map.of());
        }

        static TimeoutOutcome completed(
                com.guesspokemon.game.GameTypes.GameEndReason
                        endReason,
                Map<UUID, RoomSnapshot> snapshots) {
            return new TimeoutOutcome(
                    true,
                    endReason,
                    snapshots);
        }
    }

    public record RolePreferenceOutcome(
            boolean rolesAssigned,
            Map<UUID, RoomSnapshot> snapshots) {

        public RolePreferenceOutcome {
            snapshots = Map.copyOf(snapshots);
        }
    }
}
