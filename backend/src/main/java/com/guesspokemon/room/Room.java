package com.guesspokemon.room;

import static com.guesspokemon.common.error.ApiErrorCode.CANNOT_JOIN_OWN_ROOM;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_FULL;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_MEMBERSHIP_REQUIRED;
import static com.guesspokemon.game.GameRuleException.GameRuleError.DUPLICATE_COMMAND;
import static com.guesspokemon.game.GameRuleException.GameRuleError.INVALID_GAME_STATE;
import static com.guesspokemon.game.GameRuleException.GameRuleError.INVALID_ROLE;
import static com.guesspokemon.game.GameRuleException.GameRuleError.STALE_ROOM_STATE;
import static com.guesspokemon.game.GameTypes.GameEndReason.BOTH_DISCONNECTED;
import static com.guesspokemon.game.GameTypes.GameEndReason.RECONNECT_TIMEOUT;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.IN_PROGRESS;
import static com.guesspokemon.room.RoomDtos.RoomStatus.PAUSED;
import static com.guesspokemon.room.RoomDtos.RoomStatus.PLAYING;
import static com.guesspokemon.room.RoomDtos.RoomStatus.RESULT;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_OPPONENT;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_SELECTION;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.game.GameRuleException;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameViews.ParticipantGameView;
import com.guesspokemon.room.RoomDtos.RematchState;
import com.guesspokemon.room.RoomDtos.RoomGameSnapshot;
import com.guesspokemon.room.RoomDtos.RoomMember;
import com.guesspokemon.room.RoomDtos.RoomRole;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import com.guesspokemon.room.RoomDtos.RoomStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

final class Room {

    private final String code;
    private final Participant host;
    private final Instant createdAt;
    private final UUID roundGroupId;
    private final Set<UUID> processedRoomCommandIds =
            new HashSet<>();
    private Participant guest;
    private UUID selectorUserId;
    private UUID questionerUserId;
    private RoomStatus status;
    private long stateVersion;
    private int roundNumber;
    private boolean hasVisibleGame;
    private boolean hostRematchReady;
    private boolean guestRematchReady;

    Room(String code, UUID hostUserId, String hostNickname, Instant createdAt) {
        this.code = Objects.requireNonNull(code);
        this.host = new Participant(hostUserId, hostNickname);
        this.createdAt = Objects.requireNonNull(createdAt);
        this.roundGroupId = UUID.randomUUID();
        this.selectorUserId = hostUserId;
        this.status = WAITING_FOR_OPPONENT;
        this.stateVersion = 1;
        this.roundNumber = 1;
    }

    void join(UUID guestUserId, String guestNickname) {
        if (host.userId().equals(guestUserId)) {
            throw new ApiException(CANNOT_JOIN_OWN_ROOM);
        }
        if (guest != null) {
            throw new ApiException(ROOM_FULL);
        }
        guest = new Participant(guestUserId, guestNickname);
        questionerUserId = guestUserId;
        status = WAITING_FOR_SELECTION;
        stateVersion += 1;
    }

    LeaveResult leave(UUID userId) {
        requireParticipant(userId);
        if (status == RESULT || status == PLAYING || status == PAUSED) {
            return LeaveResult.ROOM_CLOSED;
        }
        if (host.userId().equals(userId)) {
            return LeaveResult.ROOM_CLOSED;
        }
        guest = null;
        selectorUserId = host.userId();
        questionerUserId = null;
        status = WAITING_FOR_OPPONENT;
        hasVisibleGame = false;
        hostRematchReady = false;
        guestRematchReady = false;
        stateVersion += 1;
        return LeaveResult.GUEST_LEFT;
    }

    StartContext prepareStart(
            UUID userId,
            UUID commandId,
            long expectedStateVersion) {
        requireParticipant(userId);
        requireExpectedStateVersion(expectedStateVersion);
        if (status != WAITING_FOR_SELECTION
                || guest == null
                || !bothConnected()) {
            throw new GameRuleException(INVALID_GAME_STATE);
        }
        requireRole(userId, SELECTOR);
        if (processedRoomCommandIds.contains(commandId)) {
            throw new GameRuleException(DUPLICATE_COMMAND);
        }
        return new StartContext(
                roundGroupId,
                selectorUserId,
                questionerUserId,
                stateVersion + 1);
    }

    long prepareGameCommand(
            UUID userId,
            GameRole expectedRole,
            long expectedStateVersion) {
        requireParticipant(userId);
        requireExpectedStateVersion(expectedStateVersion);
        if (status != PLAYING || !bothConnected()) {
            throw new GameRuleException(INVALID_GAME_STATE);
        }
        requireRole(userId, expectedRole);
        return stateVersion + 1;
    }

    void applyGameView(
            UUID commandId,
            ParticipantGameView gameView) {
        Objects.requireNonNull(commandId);
        Objects.requireNonNull(gameView);
        if (gameView.stateVersion() <= stateVersion) {
            throw new IllegalArgumentException(
                    "game version이 room version보다 최신이 아닙니다.");
        }
        processedRoomCommandIds.add(commandId);
        stateVersion = gameView.stateVersion();
        hasVisibleGame = true;
        status =
                gameView.status() == IN_PROGRESS
                        ? PLAYING
                        : RESULT;
        if (status == RESULT) {
            clearReconnectState();
            hostRematchReady = false;
            guestRematchReady = false;
        }
    }

    RematchChange changeRematchReady(
            UUID userId,
            UUID commandId,
            long expectedStateVersion,
            boolean ready) {
        requireParticipant(userId);
        requireExpectedStateVersion(expectedStateVersion);
        if (status != RESULT || guest == null || !bothConnected()) {
            throw new GameRuleException(INVALID_GAME_STATE);
        }
        if (!processedRoomCommandIds.add(commandId)) {
            throw new GameRuleException(DUPLICATE_COMMAND);
        }
        setRematchReady(userId, ready);
        stateVersion += 1;
        boolean nextRoundReady =
                hostRematchReady && guestRematchReady;
        if (nextRoundReady) {
            UUID previousSelector = selectorUserId;
            selectorUserId = questionerUserId;
            questionerUserId = previousSelector;
            roundNumber += 1;
            status = WAITING_FOR_SELECTION;
            hasVisibleGame = false;
            hostRematchReady = false;
            guestRematchReady = false;
            processedRoomCommandIds.clear();
        }
        return new RematchChange(nextRoundReady, stateVersion);
    }

    ConnectionChange disconnect(
            UUID userId,
            Instant now,
            Duration reconnectGrace) {
        Participant participant = requireParticipant(userId);
        if (!participant.connected()) {
            return ConnectionChange.unchanged(
                    userId,
                    participant.connected(),
                    stateVersion,
                    participant.reconnectDeadline(),
                    participant.reconnectToken());
        }
        Instant deadline = null;
        UUID token = null;
        if (status == PLAYING || status == PAUSED) {
            deadline = now.plus(reconnectGrace);
            token = UUID.randomUUID();
            status = PAUSED;
        }
        participant.disconnect(deadline, token);
        stateVersion += 1;
        return ConnectionChange.changed(
                userId,
                false,
                stateVersion,
                deadline,
                token);
    }

    ConnectionChange resume(UUID userId) {
        Participant participant = requireParticipant(userId);
        if (participant.connected()) {
            return ConnectionChange.unchanged(
                    userId,
                    participant.connected(),
                    stateVersion,
                    null,
                    null);
        }
        participant.connect();
        if (status == PAUSED && bothConnected()) {
            status = PLAYING;
        }
        stateVersion += 1;
        return ConnectionChange.changed(
                userId,
                true,
                stateVersion,
                null,
                null);
    }

    TimeoutContext prepareReconnectTimeout(
            UUID userId,
            UUID reconnectToken,
            Instant reconnectDeadline) {
        Participant participant = requireParticipant(userId);
        if (status != PAUSED
                || participant.connected()
                || !Objects.equals(
                        participant.reconnectToken(),
                        reconnectToken)
                || !Objects.equals(
                        participant.reconnectDeadline(),
                        reconnectDeadline)) {
            return null;
        }
        boolean bothDisconnected =
                !host.connected()
                        && guest != null
                        && !guest.connected();
        return new TimeoutContext(
                bothDisconnected
                        ? BOTH_DISCONNECTED
                        : RECONNECT_TIMEOUT,
                bothDisconnected ? null : userId,
                stateVersion + 1);
    }

    RoomSnapshot snapshotFor(UUID userId) {
        return snapshotFor(userId, null);
    }

    RoomSnapshot snapshotFor(
            UUID userId,
            RoomGameSnapshot gameSnapshot) {
        if (host.userId().equals(userId)) {
            return snapshot(host, roleOf(host.userId()), guest, gameSnapshot);
        }
        if (guest != null && guest.userId().equals(userId)) {
            return snapshot(guest, roleOf(guest.userId()), host, gameSnapshot);
        }
        throw new ApiException(ROOM_MEMBERSHIP_REQUIRED);
    }

    boolean isHost(UUID userId) {
        return host.userId().equals(userId);
    }

    boolean isParticipant(UUID userId) {
        return isHost(userId)
                || (guest != null && guest.userId().equals(userId));
    }

    boolean isFull() {
        return guest != null;
    }

    boolean isHostOnlyExpired(
            Instant now,
            Duration waitingExpiry) {
        return guest == null
                && !now.isBefore(createdAt.plus(waitingExpiry));
    }

    boolean hasGameInProgress() {
        return status == PLAYING || status == PAUSED;
    }

    boolean hasVisibleGame() {
        return hasVisibleGame;
    }

    long stateVersion() {
        return stateVersion;
    }

    UUID hostUserId() {
        return host.userId();
    }

    UUID guestUserId() {
        return guest == null ? null : guest.userId();
    }

    UUID selectorUserId() {
        return selectorUserId;
    }

    UUID questionerUserId() {
        return questionerUserId;
    }

    String code() {
        return code;
    }

    private RoomSnapshot snapshot(
            Participant me,
            RoomRole myRole,
            Participant opponent,
            RoomGameSnapshot gameSnapshot) {
        RoomMember opponentSummary =
                opponent == null
                        ? null
                        : toMember(
                                opponent,
                                roleOf(opponent.userId()));
        RematchState rematchState =
                status == RESULT && opponent != null
                        ? new RematchState(
                                isRematchReady(me.userId()),
                                isRematchReady(opponent.userId()))
                        : null;
        return new RoomSnapshot(
                code,
                status,
                stateVersion,
                roundNumber,
                toMember(me, myRole),
                opponentSummary,
                gameSnapshot,
                rematchState);
    }

    private RoomMember toMember(
            Participant participant,
            RoomRole role) {
        return new RoomMember(
                participant.userId(),
                participant.nickname(),
                role,
                participant.connected(),
                participant.reconnectDeadline());
    }

    private RoomRole roleOf(UUID userId) {
        if (Objects.equals(selectorUserId, userId)) {
            return RoomDtos.RoomRole.SELECTOR;
        }
        if (Objects.equals(questionerUserId, userId)) {
            return RoomDtos.RoomRole.QUESTIONER;
        }
        throw new ApiException(ROOM_MEMBERSHIP_REQUIRED);
    }

    private void requireRole(
            UUID userId,
            GameRole expectedRole) {
        boolean matches =
                (expectedRole == SELECTOR
                                && Objects.equals(
                                        selectorUserId,
                                        userId))
                        || (expectedRole == QUESTIONER
                                && Objects.equals(
                                        questionerUserId,
                                        userId));
        if (!matches) {
            throw new GameRuleException(INVALID_ROLE);
        }
    }

    private Participant requireParticipant(UUID userId) {
        Objects.requireNonNull(userId);
        if (host.userId().equals(userId)) {
            return host;
        }
        if (guest != null && guest.userId().equals(userId)) {
            return guest;
        }
        throw new ApiException(ROOM_MEMBERSHIP_REQUIRED);
    }

    private void requireExpectedStateVersion(long expectedStateVersion) {
        if (stateVersion != expectedStateVersion) {
            throw new GameRuleException(STALE_ROOM_STATE);
        }
    }

    private boolean bothConnected() {
        return guest != null
                && host.connected()
                && guest.connected();
    }

    private void clearReconnectState() {
        host.clearReconnectDeadline();
        if (guest != null) {
            guest.clearReconnectDeadline();
        }
    }

    private void setRematchReady(UUID userId, boolean ready) {
        if (host.userId().equals(userId)) {
            hostRematchReady = ready;
        } else {
            guestRematchReady = ready;
        }
    }

    private boolean isRematchReady(UUID userId) {
        return host.userId().equals(userId)
                ? hostRematchReady
                : guestRematchReady;
    }

    enum LeaveResult {
        ROOM_CLOSED,
        GUEST_LEFT
    }

    record StartContext(
            UUID roundGroupId,
            UUID selectorUserId,
            UUID questionerUserId,
            long targetStateVersion) {
    }

    record RematchChange(
            boolean nextRoundReady,
            long stateVersion) {
    }

    record TimeoutContext(
            GameEndReason endReason,
            UUID disconnectedUserId,
            long targetStateVersion) {
    }

    record ConnectionChange(
            UUID userId,
            boolean changed,
            boolean connected,
            long stateVersion,
            Instant reconnectDeadline,
            UUID reconnectToken) {

        static ConnectionChange changed(
                UUID userId,
                boolean connected,
                long stateVersion,
                Instant reconnectDeadline,
                UUID reconnectToken) {
            return new ConnectionChange(
                    userId,
                    true,
                    connected,
                    stateVersion,
                    reconnectDeadline,
                    reconnectToken);
        }

        static ConnectionChange unchanged(
                UUID userId,
                boolean connected,
                long stateVersion,
                Instant reconnectDeadline,
                UUID reconnectToken) {
            return new ConnectionChange(
                    userId,
                    false,
                    connected,
                    stateVersion,
                    reconnectDeadline,
                    reconnectToken);
        }
    }

    private static final class Participant {

        private final UUID userId;
        private final String nickname;
        private boolean connected = true;
        private Instant reconnectDeadline;
        private UUID reconnectToken;

        private Participant(UUID userId, String nickname) {
            this.userId = Objects.requireNonNull(userId);
            if (nickname == null || nickname.isBlank()) {
                throw new IllegalArgumentException(
                        "participant nickname이 없습니다.");
            }
            this.nickname = nickname;
        }

        private void disconnect(
                Instant deadline,
                UUID token) {
            connected = false;
            reconnectDeadline = deadline;
            reconnectToken = token;
        }

        private void connect() {
            connected = true;
            clearReconnectDeadline();
        }

        private void clearReconnectDeadline() {
            reconnectDeadline = null;
            reconnectToken = null;
        }

        private UUID userId() {
            return userId;
        }

        private String nickname() {
            return nickname;
        }

        private boolean connected() {
            return connected;
        }

        private Instant reconnectDeadline() {
            return reconnectDeadline;
        }

        private UUID reconnectToken() {
            return reconnectToken;
        }
    }
}
