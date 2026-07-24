package com.guesspokemon.history;

import static com.guesspokemon.game.GameTypes.GameActionType.QUESTION;
import static com.guesspokemon.game.GameTypes.GameAnswer.NO;
import static com.guesspokemon.game.GameTypes.GameResult.NONE;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.IN_PROGRESS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.game.GamePersistencePort.ActionState;
import com.guesspokemon.game.GamePersistencePort.GameState;
import com.guesspokemon.game.GamePersistencePort.ParticipantState;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class GameHistoryMappingTest {

    private static final Instant STARTED_AT =
            Instant.parse("2026-07-25T03:00:00Z");

    @Autowired
    private JpaGameHistoryStore gameHistoryStore;

    @Autowired
    private GameRecordRepository gameRecordRepository;

    @Autowired
    private GameParticipantRecordRepository
            gameParticipantRecordRepository;

    @Autowired
    private GameActionRecordRepository gameActionRecordRepository;

    @Autowired
    private AppUserRepository appUserRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    @Transactional
    void should_mapGameParticipantsAndAnsweredQuestion_when_recordsAreLoaded() {
        AppUser selector = saveUser("selector");
        AppUser questioner = saveUser("questioner");
        UUID gameId = UUID.randomUUID();
        GameState startState =
                startState(
                        gameId,
                        selector.getId(),
                        questioner.getId());
        gameHistoryStore.createGame(startState);

        UUID actionId = UUID.randomUUID();
        UUID commandId = UUID.randomUUID();
        ActionState pendingQuestion =
                new ActionState(
                        actionId,
                        commandId,
                        questioner.getId(),
                        1,
                        QUESTION,
                        "날개가 있나요?",
                        null,
                        null,
                        null,
                        STARTED_AT.plusSeconds(1),
                        null);
        GameState pendingState =
                new GameState(
                        gameId,
                        startState.roundGroupId(),
                        25,
                        IN_PROGRESS,
                        null,
                        1,
                        4,
                        STARTED_AT,
                        null,
                        startState.participants());
        gameHistoryStore.appendAction(
                3,
                pendingState,
                pendingQuestion);

        ActionState answeredQuestion =
                new ActionState(
                        actionId,
                        commandId,
                        questioner.getId(),
                        1,
                        QUESTION,
                        "날개가 있나요?",
                        NO,
                        null,
                        null,
                        STARTED_AT.plusSeconds(1),
                        STARTED_AT.plusSeconds(2));
        GameState answeredState =
                new GameState(
                        gameId,
                        startState.roundGroupId(),
                        25,
                        IN_PROGRESS,
                        null,
                        1,
                        5,
                        STARTED_AT,
                        null,
                        startState.participants());
        gameHistoryStore.updateAnsweredQuestion(
                4,
                answeredState,
                answeredQuestion);

        GameRecord game =
                gameRecordRepository.findById(gameId).orElseThrow();
        Map<UUID, GameParticipantRecord> participants =
                gameParticipantRecordRepository
                        .findAllByIdGameId(gameId)
                        .stream()
                        .collect(
                                Collectors.toMap(
                                        record ->
                                                record
                                                        .getId()
                                                        .getUserId(),
                                        Function.identity()));
        GameActionRecord action =
                gameActionRecordRepository
                        .findByGameIdAndSequenceNumber(
                                gameId,
                                (short) 1)
                        .orElseThrow();

        assertEquals(5L, game.getStateVersion());
        assertEquals((short) 1, game.getActionCount());
        assertNull(game.getEndReason());
        assertEquals(SELECTOR, participants.get(selector.getId()).getRole());
        assertEquals(QUESTIONER, participants.get(questioner.getId()).getRole());
        assertEquals(NONE, participants.get(selector.getId()).getResult());
        assertEquals(NO, action.getAnswer());
        assertEquals(
                STARTED_AT.plusSeconds(2),
                action.getAnsweredAt());
    }

    @Test
    @Transactional
    void should_rejectActionRow_when_questionShapeIsInvalid() {
        AppUser selector = saveUser("shape_selector");
        AppUser questioner = saveUser("shape_questioner");
        UUID gameId = UUID.randomUUID();
        gameHistoryStore.createGame(
                startState(
                        gameId,
                        selector.getId(),
                        questioner.getId()));

        assertThrows(
                DataIntegrityViolationException.class,
                () ->
                        jdbcClient
                                .sql(
                                        """
                                        INSERT INTO game_action (
                                            id,
                                            command_id,
                                            game_id,
                                            actor_user_id,
                                            sequence_no,
                                            action_type,
                                            question_text,
                                            answer,
                                            guessed_pokemon_id,
                                            correct,
                                            created_at,
                                            answered_at
                                        )
                                        VALUES (
                                            :id,
                                            :commandId,
                                            :gameId,
                                            :actorUserId,
                                            1,
                                            'QUESTION',
                                            '   ',
                                            NULL,
                                            NULL,
                                            NULL,
                                            CURRENT_TIMESTAMP,
                                            NULL
                                        )
                                        """)
                                .param("id", UUID.randomUUID())
                                .param(
                                        "commandId",
                                        UUID.randomUUID())
                                .param("gameId", gameId)
                                .param(
                                        "actorUserId",
                                        questioner.getId())
                                .update());
    }

    private GameState startState(
            UUID gameId,
            UUID selectorUserId,
            UUID questionerUserId) {
        return new GameState(
                gameId,
                UUID.randomUUID(),
                25,
                IN_PROGRESS,
                null,
                0,
                3,
                STARTED_AT,
                null,
                List.of(
                        new ParticipantState(
                                selectorUserId,
                                SELECTOR,
                                NONE,
                                STARTED_AT),
                        new ParticipantState(
                                questionerUserId,
                                QUESTIONER,
                                NONE,
                                STARTED_AT)));
    }

    private AppUser saveUser(String prefix) {
        String suffix =
                UUID.randomUUID()
                        .toString()
                        .replace("-", "")
                        .substring(0, 8);
        String loginId = prefix + "_" + suffix;
        String nickname = prefix.substring(0, 1) + suffix;
        return appUserRepository.saveAndFlush(
                AppUser.create(
                        loginId,
                        loginId,
                        nickname,
                        nickname,
                        "test-password-hash",
                        STARTED_AT));
    }
}
