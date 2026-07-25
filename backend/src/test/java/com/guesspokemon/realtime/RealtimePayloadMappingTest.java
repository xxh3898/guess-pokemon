package com.guesspokemon.realtime;

import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.IN_PROGRESS;
import static com.guesspokemon.game.GameTypes.GameAnswer.YES;
import static com.guesspokemon.realtime.RealtimeDtos.RoomClosedReason.HOST_LEFT;
import static com.guesspokemon.room.RoomDtos.RoomStatus.PLAYING;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import com.guesspokemon.pokemon.PokemonType;
import com.guesspokemon.realtime.RealtimeDtos.AnswerQuestionPayload;
import com.guesspokemon.realtime.RealtimeDtos.QuestionerRoundStartedPayload;
import com.guesspokemon.realtime.RealtimeDtos.QuestionAnsweredPayload;
import com.guesspokemon.realtime.RealtimeDtos.RoomClosedPayload;
import com.guesspokemon.realtime.RealtimeDtos.SelectorRoundStartedPayload;
import com.guesspokemon.room.RoomDtos.QuestionerGameSnapshot;
import com.guesspokemon.room.RoomDtos.RoomMember;
import com.guesspokemon.room.RoomDtos.RoomRole;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import com.guesspokemon.room.RoomDtos.SelectorGameSnapshot;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class RealtimePayloadMappingTest {

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
                    true,
                    List.of(PokemonType.ELECTRIC));
    private final JsonMapper jsonMapper =
            JsonMapper.builder()
                    .findAndAddModules()
                    .build();

    @Test
    void should_omitSelectedPokemon_when_questionerSnapshotIsSerialized()
            throws Exception {
        RoomSnapshot selector =
                new RoomSnapshot(
                        "ABC234",
                        PLAYING,
                        3,
                        1,
                        new RoomMember(
                                SELECTOR_ID,
                                "레드",
                                RoomRole.SELECTOR,
                                true,
                                null),
                        new RoomMember(
                                QUESTIONER_ID,
                                "그린",
                                RoomRole.QUESTIONER,
                                true,
                                null),
                        new SelectorGameSnapshot(
                                GAME_ID,
                                IN_PROGRESS,
                                0,
                                20,
                                PIKACHU,
                                List.of()),
                        null);
        RoomSnapshot questioner =
                new RoomSnapshot(
                        "ABC234",
                        PLAYING,
                        3,
                        1,
                        selector.opponent(),
                        selector.me(),
                        new QuestionerGameSnapshot(
                                GAME_ID,
                                IN_PROGRESS,
                                0,
                                20,
                                List.of()),
                        null);

        String selectorJson =
                jsonMapper.writeValueAsString(selector);
        String questionerJson =
                jsonMapper.writeValueAsString(questioner);

        assertTrue(selectorJson.contains("selectedPokemon"));
        assertTrue(selectorJson.contains("피카츄"));
        assertTrue(selectorJson.contains("ELECTRIC"));
        assertFalse(questionerJson.contains("selectedPokemon"));
        assertFalse(questionerJson.contains("피카츄"));
        assertFalse(questionerJson.contains("ELECTRIC"));
    }

    @Test
    void should_omitSelectedPokemon_when_questionerRoundEventIsSerialized()
            throws Exception {
        String selectorJson =
                jsonMapper.writeValueAsString(
                        new SelectorRoundStartedPayload(
                                1,
                                SELECTOR,
                                QUESTIONER,
                                0,
                                20,
                                PIKACHU));
        String questionerJson =
                jsonMapper.writeValueAsString(
                        new QuestionerRoundStartedPayload(
                                1,
                                QUESTIONER,
                                SELECTOR,
                                0,
                                20));

        assertTrue(selectorJson.contains("selectedPokemon"));
        assertTrue(selectorJson.contains("ELECTRIC"));
        assertFalse(questionerJson.contains("selectedPokemon"));
        assertFalse(questionerJson.contains("피카츄"));
        assertFalse(questionerJson.contains("ELECTRIC"));
    }

    @Test
    void should_serializeMinimalPayload_when_roomClosedEventIsCreated()
            throws Exception {
        String payloadJson =
                jsonMapper.writeValueAsString(
                        new RoomClosedPayload(
                                SELECTOR_ID,
                                HOST_LEFT));

        assertEquals(
                """
                {"leftUserId":"11111111-1111-1111-1111-111111111111","reason":"HOST_LEFT"}\
                """,
                payloadJson);
        assertFalse(payloadJson.contains("nickname"));
    }

    @Test
    void should_acceptMissingComment_when_oldAnswerPayloadIsDeserialized()
            throws Exception {
        AnswerQuestionPayload payload =
                jsonMapper.readValue(
                        """
                        {"answer":"YES"}
                        """,
                        AnswerQuestionPayload.class);

        assertEquals(YES, payload.answer());
        assertNull(payload.comment());
    }

    @Test
    void should_serializeComment_when_questionAnsweredEventIsCreated()
            throws Exception {
        String payloadJson =
                jsonMapper.writeValueAsString(
                        new QuestionAnsweredPayload(
                                1,
                                "전기 타입인가요?",
                                YES,
                                "노란색 포켓몬이에요.",
                                1,
                                19));

        assertTrue(
                payloadJson.contains(
                        "\"comment\":\"노란색 포켓몬이에요.\""));
    }
}
