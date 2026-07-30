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
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_ROLE_SELECTION;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_SELECTION;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.game.GameRuleException;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameMode;
import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameViews.ParticipantGameView;
import com.guesspokemon.room.RoomDtos.RoleAssignmentState;
import com.guesspokemon.room.RoomDtos.RoleSelectionState;
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
    private final GameMode mode;
    private final Set<UUID> processedRoomCommandIds =
            new HashSet<>();
    private Participant guest;
    private UUID selectorUserId;
    private UUID questionerUserId;
    private RoomStatus status;
    private long stateVersion;
    private int roundNumber;
    private boolean hasVisibleGame;
    private RoomRole hostRolePreference;
    private RoomRole guestRolePreference;
    private Boolean roleAssignmentRandomized;

    Room(
            String code,
            UUID hostUserId,
            String hostNickname,
            GameMode mode,
            Instant createdAt) {
        this.code = Objects.requireNonNull(code);
        this.host = new Participant(hostUserId, hostNickname);
        this.mode = Objects.requireNonNull(mode);
        this.createdAt = Objects.requireNonNull(createdAt);
        this.roundGroupId = UUID.randomUUID();
        this.status = WAITING_FOR_OPPONENT;
        this.stateVersion = 1;
        this.roundNumber = 1;
    }

    Room(
            String code,
            UUID hostUserId,
            String hostNickname,
            Instant createdAt) {
        this(
                code,
                hostUserId,
                hostNickname,
                GameMode.TWENTY_QUESTIONS,
                createdAt);
    }

    void join(UUID guestUserId, String guestNickname) {
        if (host.userId().equals(guestUserId)) {
            throw new ApiException(CANNOT_JOIN_OWN_ROOM);
        }
        if (guest != null) {
            throw new ApiException(ROOM_FULL);
        }
        guest = new Participant(guestUserId, guestNickname);
        selectorUserId = null;
        questionerUserId = null;
        hostRolePreference = null;
        guestRolePreference = null;
        roleAssignmentRandomized = null;
        status = WAITING_FOR_ROLE_SELECTION;
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
        selectorUserId = null;
        questionerUserId = null;
        status = WAITING_FOR_OPPONENT;
        hasVisibleGame = false;
        hostRolePreference = null;
        guestRolePreference = null;
        roleAssignmentRandomized = null;
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
                mode,
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

    void requireSilhouetteAccess(UUID userId) {
        requireParticipant(userId);
        if ((status != PLAYING && status != PAUSED)
                || mode != GameMode.SILHOUETTE) {
            throw new GameRuleException(INVALID_GAME_STATE);
        }
        requireRole(userId, QUESTIONER);
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
        roleAssignmentRandomized = null;
        if (status == RESULT) {
            clearReconnectState();
            hostRolePreference = null;
            guestRolePreference = null;
        }
    }

    RolePreferenceChange changeRolePreference(
            UUID userId,
            UUID commandId,
            long expectedStateVersion,
            RoomRole preferredRole,
            RoleAssignmentDecider roleAssignmentDecider) {
        requireParticipant(userId);
        requireExpectedStateVersion(expectedStateVersion);
        Objects.requireNonNull(preferredRole);
        Objects.requireNonNull(roleAssignmentDecider);
        if ((status != WAITING_FOR_ROLE_SELECTION && status != RESULT)
                || guest == null
                || !bothConnected()) {
            throw new GameRuleException(INVALID_GAME_STATE);
        }
        if (!processedRoomCommandIds.add(commandId)) {
            throw new GameRuleException(DUPLICATE_COMMAND);
        }
        setRolePreference(userId, preferredRole);
        stateVersion += 1;
        boolean rolesAssigned =
                hostRolePreference != null
                        && guestRolePreference != null;
        boolean randomized = false;
        if (rolesAssigned) {
            boolean nextRound = status == RESULT;
            randomized =
                    assignRoles(roleAssignmentDecider);
            if (nextRound) {
                roundNumber += 1;
            }
            status = WAITING_FOR_SELECTION;
            hasVisibleGame = false;
            hostRolePreference = null;
            guestRolePreference = null;
            roleAssignmentRandomized = randomized;
            processedRoomCommandIds.clear();
        }
        return new RolePreferenceChange(
                rolesAssigned,
                randomized,
                stateVersion);
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

    boolean isJoinable() {
        return status == WAITING_FOR_OPPONENT && guest == null;
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

    String hostNickname() {
        return host.nickname();
    }

    Instant createdAt() {
        return createdAt;
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

    GameMode mode() {
        return mode;
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
        RoleSelectionState roleSelection =
                (status == WAITING_FOR_ROLE_SELECTION
                                || status == RESULT)
                                && opponent != null
                        ? new RoleSelectionState(
                                rolePreferenceOf(me.userId()),
                                rolePreferenceOf(opponent.userId())
                                        != null)
                        : null;
        RoleAssignmentState roleAssignment =
                status == WAITING_FOR_SELECTION
                        && roleAssignmentRandomized != null
                        ? new RoleAssignmentState(
                                roleAssignmentRandomized)
                        : null;
        return new RoomSnapshot(
                code,
                mode,
                status,
                stateVersion,
                roundNumber,
                toMember(me, myRole),
                opponentSummary,
                gameSnapshot,
                roleSelection,
                roleAssignment);
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
        return null;
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

    private void setRolePreference(
            UUID userId,
            RoomRole preferredRole) {
        if (host.userId().equals(userId)) {
            hostRolePreference = preferredRole;
        } else {
            guestRolePreference = preferredRole;
        }
    }

    private RoomRole rolePreferenceOf(UUID userId) {
        return host.userId().equals(userId)
                ? hostRolePreference
                : guestRolePreference;
    }

    private boolean assignRoles(
            RoleAssignmentDecider roleAssignmentDecider) {
        boolean randomized =
                hostRolePreference == guestRolePreference;
        RoomRole hostRole;
        if (randomized) {
            hostRole =
                    roleAssignmentDecider
                                    .assignHostToPreferredRole()
                            ? hostRolePreference
                            : opposite(hostRolePreference);
        } else {
            hostRole = hostRolePreference;
        }
        if (hostRole == RoomRole.SELECTOR) {
            selectorUserId = host.userId();
            questionerUserId = guest.userId();
        } else {
            selectorUserId = guest.userId();
            questionerUserId = host.userId();
        }
        return randomized;
    }

    private RoomRole opposite(RoomRole role) {
        return role == RoomRole.SELECTOR
                ? RoomRole.QUESTIONER
                : RoomRole.SELECTOR;
    }

    enum LeaveResult {
        ROOM_CLOSED,
        GUEST_LEFT
    }

    record StartContext(
            UUID roundGroupId,
            UUID selectorUserId,
            UUID questionerUserId,
            GameMode mode,
            long targetStateVersion) {
    }

    record RolePreferenceChange(
            boolean rolesAssigned,
            boolean randomized,
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
