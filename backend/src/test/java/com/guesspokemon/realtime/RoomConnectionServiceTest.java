package com.guesspokemon.realtime;

import static com.guesspokemon.game.GameTypes.GameEndReason.RECONNECT_TIMEOUT;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.guesspokemon.room.RoomApplicationService;
import com.guesspokemon.room.RoomApplicationService.ConnectionOutcome;
import com.guesspokemon.room.RoomApplicationService.ConnectionStateChange;
import com.guesspokemon.room.RoomApplicationService.TimeoutOutcome;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.scheduling.TaskScheduler;

class RoomConnectionServiceTest {

    private static final String ROOM_CODE = "ABC234";
    private static final UUID USER_ID =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant DEADLINE =
            Instant.parse("2026-07-25T06:01:00Z");
    private static final UUID TOKEN =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    private RoomApplicationService roomApplicationService;
    private RealtimeEventPublisher eventPublisher;
    private TaskScheduler taskScheduler;
    private ScheduledFuture<?> future;
    private RoomConnectionService connectionService;

    @BeforeEach
    void setUp() {
        roomApplicationService =
                mock(RoomApplicationService.class);
        eventPublisher =
                mock(RealtimeEventPublisher.class);
        taskScheduler = mock(TaskScheduler.class);
        future = mock(ScheduledFuture.class);
        doReturn(future)
                .when(taskScheduler)
                .schedule(
                        any(Runnable.class),
                        any(Instant.class));
        when(
                        roomApplicationService.disconnect(
                                ROOM_CODE,
                                USER_ID))
                .thenReturn(disconnectedOutcome());
        when(
                        roomApplicationService.resume(
                                ROOM_CODE,
                                USER_ID))
                .thenReturn(resumedOutcome());
        connectionService =
                new RoomConnectionService(
                        roomApplicationService,
                        eventPublisher,
                        taskScheduler);
    }

    @Test
    void should_markOfflineOnlyAfterLastSessionDisconnects_when_userHasTwoSessions() {
        connectionService.associate(
                "session-one",
                USER_ID,
                ROOM_CODE);
        connectionService.associate(
                "session-two",
                USER_ID,
                ROOM_CODE);

        connectionService.disconnect("session-one");

        verify(
                roomApplicationService,
                never())
                .disconnect(ROOM_CODE, USER_ID);

        connectionService.disconnect("session-two");
        connectionService.disconnect("session-two");

        verify(
                roomApplicationService,
                times(1))
                .disconnect(ROOM_CODE, USER_ID);
        verify(taskScheduler)
                .schedule(
                        any(Runnable.class),
                        eq(DEADLINE));
    }

    @Test
    void should_ignoreScheduledTimeout_when_userResumesFirst() {
        ArgumentCaptor<Runnable> taskCaptor =
                ArgumentCaptor.forClass(Runnable.class);
        connectionService.associate(
                "old-session",
                USER_ID,
                ROOM_CODE);
        connectionService.disconnect("old-session");
        verify(taskScheduler)
                .schedule(
                        taskCaptor.capture(),
                        eq(DEADLINE));

        connectionService.resume(
                "new-session",
                USER_ID,
                ROOM_CODE);
        taskCaptor.getValue().run();

        verify(future).cancel(false);
        verify(
                roomApplicationService,
                never())
                .reconnectTimedOut(
                        ROOM_CODE,
                        USER_ID,
                        TOKEN,
                        DEADLINE);
        verify(eventPublisher)
                .publishResumeSnapshot(
                        USER_ID,
                        resumedOutcome());
    }

    @Test
    void should_finalizeTimeoutOnce_when_scheduledTaskRuns() {
        ArgumentCaptor<Runnable> taskCaptor =
                ArgumentCaptor.forClass(Runnable.class);
        TimeoutOutcome timeoutOutcome =
                new TimeoutOutcome(
                        true,
                        RECONNECT_TIMEOUT,
                        Map.of());
        when(
                        roomApplicationService
                                .reconnectTimedOut(
                                        ROOM_CODE,
                                        USER_ID,
                                        TOKEN,
                                        DEADLINE))
                .thenReturn(timeoutOutcome);
        connectionService.associate(
                "session",
                USER_ID,
                ROOM_CODE);
        connectionService.disconnect("session");
        verify(taskScheduler)
                .schedule(
                        taskCaptor.capture(),
                        eq(DEADLINE));

        taskCaptor.getValue().run();
        taskCaptor.getValue().run();

        verify(roomApplicationService)
                .reconnectTimedOut(
                        ROOM_CODE,
                        USER_ID,
                        TOKEN,
                        DEADLINE);
        verify(eventPublisher)
                .publishTimeout(timeoutOutcome);
    }

    private ConnectionOutcome disconnectedOutcome() {
        return new ConnectionOutcome(
                new ConnectionStateChange(
                        USER_ID,
                        true,
                        false,
                        4,
                        DEADLINE,
                        TOKEN),
                Map.of());
    }

    private ConnectionOutcome resumedOutcome() {
        return new ConnectionOutcome(
                new ConnectionStateChange(
                        USER_ID,
                        true,
                        true,
                        5,
                        null,
                        null),
                Map.of());
    }
}
