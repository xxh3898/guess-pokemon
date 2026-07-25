package com.guesspokemon.realtime;

import static com.guesspokemon.game.GameTypes.GameEndReason.CORRECT_GUESS;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static com.guesspokemon.realtime.RealtimeDtos.GameEventType.ROOM_CLOSED;
import static com.guesspokemon.realtime.RealtimeDtos.RoomClosedReason.RESULT_ROOM_LEFT;
import static com.guesspokemon.room.RoomDtos.RoomRole.QUESTIONER;
import static com.guesspokemon.room.RoomDtos.RoomRole.SELECTOR;
import static com.guesspokemon.room.RoomDtos.RoomStatus.RESULT;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.guesspokemon.pokemon.PokemonCatalogService;
import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import com.guesspokemon.realtime.RealtimeDtos.GameEventEnvelope;
import com.guesspokemon.realtime.RealtimeDtos.RoomClosedPayload;
import com.guesspokemon.room.RoomApplicationService.LeaveOutcome;
import com.guesspokemon.room.RoomDtos.ResultGameSnapshot;
import com.guesspokemon.room.RoomDtos.RoomMember;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;

class RealtimeEventPublisherTest {

    private static final UUID SELECTOR_ID =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID QUESTIONER_ID =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID GAME_ID =
            UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final PokemonSummary PIKACHU =
            new PokemonSummary(
                    25,
                    "피카츄",
                    1,
                    "https://example.test/25.png",
                    true);

    @Test
    void should_publishResultRoomClosedToRemainingMember_when_resultParticipantLeaves() {
        SimpMessagingTemplate messagingTemplate =
                mock(SimpMessagingTemplate.class);
        RealtimeEventPublisher publisher =
                new RealtimeEventPublisher(
                        messagingTemplate,
                        mock(PokemonCatalogService.class),
                        Clock.fixed(
                                Instant.parse(
                                        "2026-07-25T03:00:00Z"),
                                ZoneOffset.UTC));
        RoomMember selector =
                new RoomMember(
                        SELECTOR_ID,
                        "레드",
                        SELECTOR,
                        true,
                        null);
        RoomMember questioner =
                new RoomMember(
                        QUESTIONER_ID,
                        "그린",
                        QUESTIONER,
                        true,
                        null);
        ResultGameSnapshot game =
                new ResultGameSnapshot(
                        GAME_ID,
                        COMPLETED,
                        1,
                        19,
                        PIKACHU,
                        QUESTIONER_ID,
                        SELECTOR_ID,
                        CORRECT_GUESS,
                        List.of());
        Map<UUID, RoomSnapshot> snapshots =
                Map.of(
                        SELECTOR_ID,
                        snapshot(selector, questioner, game),
                        QUESTIONER_ID,
                        snapshot(questioner, selector, game));

        publisher.publishLeave(
                new LeaveOutcome(
                        false,
                        true,
                        SELECTOR_ID,
                        snapshots));

        ArgumentCaptor<Object> eventCaptor =
                ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate)
                .convertAndSendToUser(
                        eq(QUESTIONER_ID.toString()),
                        eq(WebSocketConfig.GAME_EVENT_QUEUE),
                        eventCaptor.capture());
        verify(messagingTemplate, never())
                .convertAndSendToUser(
                        eq(SELECTOR_ID.toString()),
                        eq(WebSocketConfig.GAME_EVENT_QUEUE),
                        org.mockito.ArgumentMatchers.any());
        GameEventEnvelope event =
                assertInstanceOf(
                        GameEventEnvelope.class,
                        eventCaptor.getValue());
        RoomClosedPayload payload =
                assertInstanceOf(
                        RoomClosedPayload.class,
                        event.payload());
        assertEquals(ROOM_CLOSED, event.eventType());
        assertEquals(RESULT_ROOM_LEFT, payload.reason());
        assertEquals(SELECTOR_ID, payload.leftUserId());
    }

    private RoomSnapshot snapshot(
            RoomMember me,
            RoomMember opponent,
            ResultGameSnapshot game) {
        return new RoomSnapshot(
                "ABC234",
                RESULT,
                7,
                1,
                me,
                opponent,
                game,
                null);
    }
}
