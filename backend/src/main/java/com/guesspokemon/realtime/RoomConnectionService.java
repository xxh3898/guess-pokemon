package com.guesspokemon.realtime;

import com.guesspokemon.room.RoomApplicationService;
import com.guesspokemon.room.RoomApplicationService.ConnectionOutcome;
import com.guesspokemon.room.RoomApplicationService.TimeoutOutcome;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

@Service
public class RoomConnectionService {

    private final Map<String, SessionBinding> bindingBySessionId =
            new HashMap<>();
    private final Map<UserRoomKey, Set<String>> sessionIdsByUserRoom =
            new HashMap<>();
    private final Map<UserRoomKey, ReconnectSchedule>
            reconnectSchedules = new HashMap<>();
    private final ReentrantLock connectionLock =
            new ReentrantLock();
    private final RoomApplicationService roomApplicationService;
    private final RealtimeEventPublisher eventPublisher;
    private final TaskScheduler taskScheduler;

    public RoomConnectionService(
            RoomApplicationService roomApplicationService,
            RealtimeEventPublisher eventPublisher,
            @Qualifier("realtimeTaskScheduler")
                    TaskScheduler taskScheduler) {
        this.roomApplicationService = roomApplicationService;
        this.eventPublisher = eventPublisher;
        this.taskScheduler = taskScheduler;
    }

    public void associate(
            String sessionId,
            UUID userId,
            String roomCodeInput) {
        connectionLock.lock();
        try {
            associateLocked(
                    sessionId,
                    userId,
                    normalizeRoomCode(roomCodeInput));
        } finally {
            connectionLock.unlock();
        }
    }

    public void resume(
            String sessionId,
            UUID userId,
            String roomCodeInput) {
        String roomCode = normalizeRoomCode(roomCodeInput);
        ConnectionOutcome outcome;
        connectionLock.lock();
        try {
            boolean added =
                    associateLocked(
                            sessionId,
                            userId,
                            roomCode);
            try {
                outcome =
                        roomApplicationService.resume(
                                roomCode,
                                userId);
            } catch (RuntimeException exception) {
                if (added) {
                    removeBindingLocked(
                            sessionId,
                            new UserRoomKey(
                                    userId,
                                    roomCode));
                }
                throw exception;
            }
            cancelScheduleLocked(
                    new UserRoomKey(userId, roomCode));
        } finally {
            connectionLock.unlock();
        }
        eventPublisher.publishConnectionChanged(outcome);
        eventPublisher.publishResumeSnapshot(
                userId,
                outcome);
    }

    public void disconnect(String sessionId) {
        ConnectionOutcome outcome = null;
        connectionLock.lock();
        try {
            SessionBinding binding =
                    bindingBySessionId.remove(sessionId);
            if (binding == null) {
                return;
            }
            UserRoomKey key =
                    new UserRoomKey(
                            binding.userId(),
                            binding.roomCode());
            Set<String> sessionIds =
                    sessionIdsByUserRoom.get(key);
            if (sessionIds != null) {
                sessionIds.remove(sessionId);
                if (!sessionIds.isEmpty()) {
                    return;
                }
                sessionIdsByUserRoom.remove(key);
            }
            outcome =
                    roomApplicationService.disconnect(
                            binding.roomCode(),
                            binding.userId());
            scheduleReconnectTimeoutLocked(
                    key,
                    outcome);
        } finally {
            connectionLock.unlock();
        }
        eventPublisher.publishConnectionChanged(outcome);
    }

    public void clearRoom(String roomCodeInput) {
        String roomCode = normalizeRoomCode(roomCodeInput);
        connectionLock.lock();
        try {
            bindingBySessionId
                    .entrySet()
                    .removeIf(
                            entry ->
                                    entry.getValue()
                                            .roomCode()
                                            .equals(roomCode));
            sessionIdsByUserRoom
                    .keySet()
                    .removeIf(
                            key ->
                                    key.roomCode()
                                            .equals(roomCode));
            reconnectSchedules
                    .entrySet()
                    .removeIf(
                            entry -> {
                                if (!entry.getKey()
                                        .roomCode()
                                        .equals(roomCode)) {
                                    return false;
                                }
                                entry.getValue()
                                        .future()
                                        .cancel(false);
                                return true;
                            });
        } finally {
            connectionLock.unlock();
        }
    }

    public void clearUserRoom(
            UUID userId,
            String roomCodeInput) {
        Objects.requireNonNull(userId);
        String roomCode = normalizeRoomCode(roomCodeInput);
        UserRoomKey key =
                new UserRoomKey(userId, roomCode);
        connectionLock.lock();
        try {
            Set<String> sessionIds =
                    sessionIdsByUserRoom.remove(key);
            if (sessionIds != null) {
                sessionIds.forEach(
                        bindingBySessionId::remove);
            }
            cancelScheduleLocked(key);
        } finally {
            connectionLock.unlock();
        }
    }

    public void cancelRoomTimeouts(String roomCodeInput) {
        String roomCode = normalizeRoomCode(roomCodeInput);
        connectionLock.lock();
        try {
            reconnectSchedules
                    .entrySet()
                    .removeIf(
                            entry -> {
                                if (!entry.getKey()
                                        .roomCode()
                                        .equals(roomCode)) {
                                    return false;
                                }
                                entry.getValue()
                                        .future()
                                        .cancel(false);
                                return true;
                            });
        } finally {
            connectionLock.unlock();
        }
    }

    private boolean associateLocked(
            String sessionId,
            UUID userId,
            String roomCode) {
        Objects.requireNonNull(sessionId);
        Objects.requireNonNull(userId);
        SessionBinding requested =
                new SessionBinding(userId, roomCode);
        SessionBinding current =
                bindingBySessionId.get(sessionId);
        if (current != null && !current.equals(requested)) {
            throw new IllegalStateException(
                    "STOMP session이 다른 방에 연결돼 있습니다.");
        }
        if (current != null) {
            return false;
        }
        bindingBySessionId.put(sessionId, requested);
        sessionIdsByUserRoom
                .computeIfAbsent(
                        new UserRoomKey(userId, roomCode),
                        ignored -> new HashSet<>())
                .add(sessionId);
        return true;
    }

    private void removeBindingLocked(
            String sessionId,
            UserRoomKey key) {
        bindingBySessionId.remove(sessionId);
        Set<String> sessionIds =
                sessionIdsByUserRoom.get(key);
        if (sessionIds == null) {
            return;
        }
        sessionIds.remove(sessionId);
        if (sessionIds.isEmpty()) {
            sessionIdsByUserRoom.remove(key);
        }
    }

    private void scheduleReconnectTimeoutLocked(
            UserRoomKey key,
            ConnectionOutcome outcome) {
        Instant deadline =
                outcome.change().reconnectDeadline();
        UUID token = outcome.change().reconnectToken();
        if (!outcome.change().changed()
                || deadline == null
                || token == null) {
            return;
        }
        cancelScheduleLocked(key);
        ScheduledFuture<?> future =
                taskScheduler.schedule(
                        () ->
                                onReconnectTimeout(
                                        key,
                                        token,
                                        deadline),
                        deadline);
        if (future == null) {
            throw new IllegalStateException(
                    "재접속 timeout task를 등록하지 못했습니다.");
        }
        reconnectSchedules.put(
                key,
                new ReconnectSchedule(
                        token,
                        deadline,
                        future));
    }

    private void onReconnectTimeout(
            UserRoomKey key,
            UUID token,
            Instant deadline) {
        TimeoutOutcome outcome;
        connectionLock.lock();
        try {
            ReconnectSchedule current =
                    reconnectSchedules.get(key);
            if (current == null
                    || !current.token().equals(token)
                    || !current.deadline().equals(deadline)) {
                return;
            }
            reconnectSchedules.remove(key);
            outcome =
                    roomApplicationService
                            .reconnectTimedOut(
                                    key.roomCode(),
                                    key.userId(),
                                    token,
                                    deadline);
            if (outcome.completed()) {
                cancelRoomTimeoutsLocked(
                        key.roomCode());
            }
        } finally {
            connectionLock.unlock();
        }
        eventPublisher.publishTimeout(outcome);
    }

    private void cancelScheduleLocked(UserRoomKey key) {
        ReconnectSchedule schedule =
                reconnectSchedules.remove(key);
        if (schedule != null) {
            schedule.future().cancel(false);
        }
    }

    private void cancelRoomTimeoutsLocked(String roomCode) {
        reconnectSchedules
                .entrySet()
                .removeIf(
                        entry -> {
                            if (!entry.getKey()
                                    .roomCode()
                                    .equals(roomCode)) {
                                return false;
                            }
                            entry.getValue()
                                    .future()
                                    .cancel(false);
                            return true;
                        });
    }

    private String normalizeRoomCode(String roomCodeInput) {
        if (roomCodeInput == null) {
            throw new IllegalArgumentException(
                    "roomCode가 없습니다.");
        }
        return roomCodeInput.strip()
                .toUpperCase(Locale.ROOT);
    }

    private record SessionBinding(
            UUID userId,
            String roomCode) {
    }

    private record UserRoomKey(
            UUID userId,
            String roomCode) {
    }

    private record ReconnectSchedule(
            UUID token,
            Instant deadline,
            ScheduledFuture<?> future) {
    }
}
