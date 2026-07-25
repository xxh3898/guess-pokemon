package com.guesspokemon.room;

import static com.guesspokemon.common.error.ApiErrorCode.CANNOT_JOIN_OWN_ROOM;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_CAPACITY_UNAVAILABLE;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_EXPIRED;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_FULL;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_MEMBERSHIP_REQUIRED;
import static com.guesspokemon.common.error.ApiErrorCode.ROOM_NOT_FOUND;
import static com.guesspokemon.common.error.ApiErrorCode.USER_ALREADY_IN_ACTIVE_ROOM;
import static com.guesspokemon.common.error.ApiErrorCode.VALIDATION_FAILED;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.BiFunction;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class RoomRegistry {

    static final Duration WAITING_EXPIRY = Duration.ofMinutes(30);
    static final Duration EXPIRED_CODE_RETENTION = Duration.ofMinutes(30);
    static final int MAX_ACTIVE_ROOMS = 1_000;
    static final int MAX_CODE_ALLOCATION_ATTEMPTS = 100;
    static final int MAX_EXPIRED_CODE_TOMBSTONES = 10_000;

    private static final Logger LOGGER =
            LoggerFactory.getLogger(RoomRegistry.class);

    private final ConcurrentHashMap<String, Room> rooms =
            new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, String> activeRoomByUser =
            new ConcurrentHashMap<>();
    private final LinkedHashMap<String, Instant> expiredRoomCodes =
            new LinkedHashMap<>();
    private final ReentrantLock mutationLock = new ReentrantLock();
    private final RoomCodeGenerator roomCodeGenerator;
    private final Clock clock;
    private final Duration waitingExpiry;
    private final Duration expiredCodeRetention;
    private final int maxActiveRooms;
    private final int maxCodeAllocationAttempts;
    private final int maxExpiredCodeTombstones;

    RoomRegistry(
            RoomCodeGenerator roomCodeGenerator,
            Clock clock,
            Duration waitingExpiry,
            Duration expiredCodeRetention,
            int maxActiveRooms,
            int maxCodeAllocationAttempts,
            int maxExpiredCodeTombstones) {
        this.roomCodeGenerator = Objects.requireNonNull(roomCodeGenerator);
        this.clock = Objects.requireNonNull(clock);
        this.waitingExpiry = requirePositive(waitingExpiry, "waitingExpiry");
        this.expiredCodeRetention =
                requirePositive(
                        expiredCodeRetention,
                        "expiredCodeRetention");
        this.maxActiveRooms =
                requirePositive(maxActiveRooms, "maxActiveRooms");
        this.maxCodeAllocationAttempts =
                requirePositive(
                        maxCodeAllocationAttempts,
                        "maxCodeAllocationAttempts");
        this.maxExpiredCodeTombstones =
                requirePositive(
                        maxExpiredCodeTombstones,
                        "maxExpiredCodeTombstones");
    }

    public RoomSnapshot create(UUID userId, String nickname) {
        requireParticipant(userId, nickname);
        mutationLock.lock();
        try {
            Instant now = clock.instant();
            cleanExpiredState(now);
            if (activeRoomByUser.containsKey(userId)) {
                throw new ApiException(USER_ALREADY_IN_ACTIVE_ROOM);
            }
            if (rooms.size() >= maxActiveRooms) {
                throw new ApiException(ROOM_CAPACITY_UNAVAILABLE);
            }

            String roomCode = allocateRoomCode();
            Room room = new Room(roomCode, userId, nickname, now);
            rooms.put(roomCode, room);
            activeRoomByUser.put(userId, roomCode);
            LOGGER.info("Room created hostUserId={}", userId);
            return room.snapshotFor(userId);
        } finally {
            mutationLock.unlock();
        }
    }

    public RoomSnapshot join(
            String roomCodeInput,
            UUID userId,
            String nickname) {
        return join(
                roomCodeInput,
                userId,
                nickname,
                room -> room.snapshotFor(userId));
    }

    <T> T join(
            String roomCodeInput,
            UUID userId,
            String nickname,
            Function<Room, T> afterJoin) {
        requireParticipant(userId, nickname);
        Objects.requireNonNull(afterJoin);
        String roomCode = normalizeRoomCode(roomCodeInput);
        mutationLock.lock();
        try {
            Instant now = clock.instant();
            cleanExpiredState(now);
            Room room = rooms.get(roomCode);
            if (room == null) {
                if (expiredRoomCodes.containsKey(roomCode)) {
                    throw new ApiException(ROOM_EXPIRED);
                }
                throw new ApiException(ROOM_NOT_FOUND);
            }
            if (room.isHost(userId)) {
                throw new ApiException(CANNOT_JOIN_OWN_ROOM);
            }
            if (activeRoomByUser.containsKey(userId)) {
                throw new ApiException(USER_ALREADY_IN_ACTIVE_ROOM);
            }
            if (room.isFull()) {
                throw new ApiException(ROOM_FULL);
            }

            room.join(userId, nickname);
            activeRoomByUser.put(userId, roomCode);
            LOGGER.info(
                    "Room joined hostUserId={} guestUserId={}",
                    room.hostUserId(),
                    userId);
            return afterJoin.apply(room);
        } finally {
            mutationLock.unlock();
        }
    }

    public RoomSnapshot getSnapshot(String roomCodeInput, UUID userId) {
        Objects.requireNonNull(userId);
        String roomCode = normalizeRoomCode(roomCodeInput);
        mutationLock.lock();
        try {
            cleanExpiredState(clock.instant());
            Room room = rooms.get(roomCode);
            if (room == null) {
                throw new ApiException(ROOM_NOT_FOUND);
            }
            if (!room.isParticipant(userId)) {
                throw new ApiException(ROOM_MEMBERSHIP_REQUIRED);
            }
            return room.snapshotFor(userId);
        } finally {
            mutationLock.unlock();
        }
    }

    public void leave(String roomCodeInput, UUID userId) {
        leave(
                roomCodeInput,
                userId,
                room -> null,
                (room, result) -> result);
    }

    <T> LeaveExecution<T> leave(
            String roomCodeInput,
            UUID userId,
            Function<Room, T> beforeLeave) {
        return leave(
                roomCodeInput,
                userId,
                beforeLeave,
                (room, result) -> result);
    }

    <T> LeaveExecution<T> leave(
            String roomCodeInput,
            UUID userId,
            Function<Room, T> beforeLeave,
            BiFunction<Room, T, T> afterLeave) {
        Objects.requireNonNull(userId);
        Objects.requireNonNull(beforeLeave);
        Objects.requireNonNull(afterLeave);
        String roomCode = normalizeRoomCode(roomCodeInput);
        mutationLock.lock();
        try {
            cleanExpiredState(clock.instant());
            Room room = rooms.get(roomCode);
            if (room == null) {
                throw new ApiException(ROOM_NOT_FOUND);
            }
            if (!room.isParticipant(userId)) {
                throw new ApiException(ROOM_MEMBERSHIP_REQUIRED);
            }

            T preparedResult = beforeLeave.apply(room);
            Room.LeaveResult leaveResult = room.leave(userId);
            if (leaveResult == Room.LeaveResult.ROOM_CLOSED) {
                rooms.remove(roomCode, room);
                activeRoomByUser.remove(room.hostUserId(), roomCode);
                UUID guestUserId = room.guestUserId();
                if (guestUserId != null) {
                    activeRoomByUser.remove(guestUserId, roomCode);
                }
            } else {
                activeRoomByUser.remove(userId, roomCode);
            }
            LOGGER.info(
                    "Room left userId={} hostLeft={}",
                    userId,
                    room.isHost(userId));
            T result =
                    afterLeave.apply(
                            room,
                            preparedResult);
            return new LeaveExecution<>(
                    leaveResult,
                    result);
        } finally {
            mutationLock.unlock();
        }
    }

    public Optional<String> findActiveRoomCode(UUID userId) {
        Objects.requireNonNull(userId);
        mutationLock.lock();
        try {
            cleanExpiredState(clock.instant());
            return Optional.ofNullable(activeRoomByUser.get(userId));
        } finally {
            mutationLock.unlock();
        }
    }

    public boolean hasGameInProgress(UUID userId) {
        Objects.requireNonNull(userId);
        mutationLock.lock();
        try {
            cleanExpiredState(clock.instant());
            String roomCode = activeRoomByUser.get(userId);
            if (roomCode == null) {
                return false;
            }
            Room room = rooms.get(roomCode);
            return room != null
                    && room.isParticipant(userId)
                    && room.hasGameInProgress();
        } finally {
            mutationLock.unlock();
        }
    }

    <T> T executeLocked(
            String roomCodeInput,
            UUID userId,
            Function<Room, T> operation) {
        Objects.requireNonNull(userId);
        Objects.requireNonNull(operation);
        String roomCode = normalizeRoomCode(roomCodeInput);
        mutationLock.lock();
        try {
            cleanExpiredState(clock.instant());
            Room room = rooms.get(roomCode);
            if (room == null) {
                throw new ApiException(ROOM_NOT_FOUND);
            }
            if (!room.isParticipant(userId)) {
                throw new ApiException(ROOM_MEMBERSHIP_REQUIRED);
            }
            return operation.apply(room);
        } finally {
            mutationLock.unlock();
        }
    }

    int cleanExpiredRooms() {
        mutationLock.lock();
        try {
            return cleanExpiredState(clock.instant());
        } finally {
            mutationLock.unlock();
        }
    }

    int activeRoomCount() {
        mutationLock.lock();
        try {
            cleanExpiredState(clock.instant());
            return rooms.size();
        } finally {
            mutationLock.unlock();
        }
    }

    int expiredCodeCount() {
        mutationLock.lock();
        try {
            pruneExpiredRoomCodes(clock.instant());
            return expiredRoomCodes.size();
        } finally {
            mutationLock.unlock();
        }
    }

    private int cleanExpiredState(Instant now) {
        pruneExpiredRoomCodes(now);
        List<Room> expiredRooms = new ArrayList<>();
        for (Room room : rooms.values()) {
            if (room.isHostOnlyExpired(now, waitingExpiry)) {
                expiredRooms.add(room);
            }
        }

        int removedCount = 0;
        for (Room room : expiredRooms) {
            if (rooms.remove(room.code(), room)) {
                activeRoomByUser.remove(room.hostUserId(), room.code());
                rememberExpiredCode(room.code(), now);
                removedCount += 1;
            }
        }
        if (removedCount > 0) {
            LOGGER.info("Rooms expired count={}", removedCount);
        }
        return removedCount;
    }

    private void rememberExpiredCode(String roomCode, Instant now) {
        expiredRoomCodes.put(
                roomCode,
                now.plus(expiredCodeRetention));
        while (expiredRoomCodes.size() > maxExpiredCodeTombstones) {
            Iterator<Map.Entry<String, Instant>> iterator =
                    expiredRoomCodes.entrySet().iterator();
            if (!iterator.hasNext()) {
                return;
            }
            iterator.next();
            iterator.remove();
        }
    }

    private void pruneExpiredRoomCodes(Instant now) {
        expiredRoomCodes
                .entrySet()
                .removeIf(entry -> !now.isBefore(entry.getValue()));
    }

    private String allocateRoomCode() {
        for (int attempt = 0;
                attempt < maxCodeAllocationAttempts;
                attempt++) {
            String roomCode = roomCodeGenerator.generate();
            if (!RoomCodeGenerator.isAllowedCode(roomCode)) {
                throw new IllegalStateException(
                        "room code generator가 잘못된 code를 생성했습니다.");
            }
            if (!rooms.containsKey(roomCode)
                    && !expiredRoomCodes.containsKey(roomCode)) {
                return roomCode;
            }
        }
        throw new ApiException(ROOM_CAPACITY_UNAVAILABLE);
    }

    private String normalizeRoomCode(String roomCodeInput) {
        if (roomCodeInput == null) {
            throw new ApiException(VALIDATION_FAILED);
        }
        String roomCode =
                roomCodeInput.strip().toUpperCase(Locale.ROOT);
        if (!RoomCodeGenerator.isAllowedCode(roomCode)) {
            throw new ApiException(VALIDATION_FAILED);
        }
        return roomCode;
    }

    private void requireParticipant(UUID userId, String nickname) {
        if (userId == null || nickname == null || nickname.isBlank()) {
            throw new IllegalArgumentException(
                    "authenticated participant 정보가 없습니다.");
        }
    }

    private Duration requirePositive(Duration duration, String name) {
        if (duration == null
                || duration.isZero()
                || duration.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        return duration;
    }

    private int requirePositive(int value, String name) {
        if (value <= 0) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        return value;
    }

    record LeaveExecution<T>(
            Room.LeaveResult leaveResult,
            T result) {
    }
}
