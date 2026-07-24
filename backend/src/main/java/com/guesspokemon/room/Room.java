package com.guesspokemon.room;

import static com.guesspokemon.common.error.ApiErrorCode.CANNOT_JOIN_OWN_ROOM;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_FULL;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_MEMBERSHIP_REQUIRED;
import static com.guesspokemon.room.RoomDtos.RoomRole.QUESTIONER;
import static com.guesspokemon.room.RoomDtos.RoomRole.SELECTOR;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_OPPONENT;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_SELECTION;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.room.RoomDtos.RoomMember;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import com.guesspokemon.room.RoomDtos.RoomStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

final class Room {

    private final String code;
    private final Participant host;
    private final Instant createdAt;
    private Participant guest;
    private RoomStatus status;
    private long stateVersion;
    private final int roundNumber;

    Room(String code, UUID hostUserId, String hostNickname, Instant createdAt) {
        this.code = Objects.requireNonNull(code);
        this.host = new Participant(hostUserId, hostNickname);
        this.createdAt = Objects.requireNonNull(createdAt);
        this.status = WAITING_FOR_OPPONENT;
        this.stateVersion = 1;
        this.roundNumber = 1;
    }

    synchronized void join(UUID guestUserId, String guestNickname) {
        if (host.userId().equals(guestUserId)) {
            throw new ApiException(CANNOT_JOIN_OWN_ROOM);
        }
        if (guest != null) {
            throw new ApiException(ROOM_FULL);
        }
        guest = new Participant(guestUserId, guestNickname);
        status = WAITING_FOR_SELECTION;
        stateVersion += 1;
    }

    synchronized LeaveResult leave(UUID userId) {
        if (host.userId().equals(userId)) {
            return LeaveResult.HOST_LEFT;
        }
        if (guest != null && guest.userId().equals(userId)) {
            guest = null;
            status = WAITING_FOR_OPPONENT;
            stateVersion += 1;
            return LeaveResult.GUEST_LEFT;
        }
        throw new ApiException(ROOM_MEMBERSHIP_REQUIRED);
    }

    synchronized RoomSnapshot snapshotFor(UUID userId) {
        if (host.userId().equals(userId)) {
            return snapshot(host, SELECTOR, guest, QUESTIONER);
        }
        if (guest != null && guest.userId().equals(userId)) {
            return snapshot(guest, QUESTIONER, host, SELECTOR);
        }
        throw new ApiException(ROOM_MEMBERSHIP_REQUIRED);
    }

    synchronized boolean isHost(UUID userId) {
        return host.userId().equals(userId);
    }

    synchronized boolean isParticipant(UUID userId) {
        return isHost(userId)
                || (guest != null && guest.userId().equals(userId));
    }

    synchronized boolean isFull() {
        return guest != null;
    }

    synchronized boolean isHostOnlyExpired(
            Instant now,
            Duration waitingExpiry) {
        return guest == null
                && !now.isBefore(createdAt.plus(waitingExpiry));
    }

    synchronized UUID hostUserId() {
        return host.userId();
    }

    synchronized UUID guestUserId() {
        return guest == null ? null : guest.userId();
    }

    String code() {
        return code;
    }

    private RoomSnapshot snapshot(
            Participant me,
            RoomDtos.RoomRole myRole,
            Participant opponent,
            RoomDtos.RoomRole opponentRole) {
        RoomMember opponentSummary =
                opponent == null
                        ? null
                        : toMember(opponent, opponentRole);
        return new RoomSnapshot(
                code,
                status,
                stateVersion,
                roundNumber,
                toMember(me, myRole),
                opponentSummary,
                null);
    }

    private RoomMember toMember(
            Participant participant,
            RoomDtos.RoomRole role) {
        return new RoomMember(
                participant.userId(),
                participant.nickname(),
                role,
                true);
    }

    enum LeaveResult {
        HOST_LEFT,
        GUEST_LEFT
    }

    private record Participant(UUID userId, String nickname) {

        private Participant {
            Objects.requireNonNull(userId);
            if (nickname == null || nickname.isBlank()) {
                throw new IllegalArgumentException(
                        "participant nickname이 없습니다.");
            }
        }
    }
}
