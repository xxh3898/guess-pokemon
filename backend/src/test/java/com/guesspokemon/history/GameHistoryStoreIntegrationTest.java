package com.guesspokemon.history;

import static com.guesspokemon.game.GameRuleException.GameRuleError.DUPLICATE_COMMAND;
import static com.guesspokemon.game.GameRuleException.GameRuleError.INVALID_GAME_STATE;
import static com.guesspokemon.game.GameRuleException.GameRuleError.PERSISTENCE_CONFLICT;
import static com.guesspokemon.game.GameTypes.GameActionType.GUESS;
import static com.guesspokemon.game.GameTypes.GameActionType.QUESTION;
import static com.guesspokemon.game.GameTypes.GameAnswer.NO;
import static com.guesspokemon.game.GameTypes.GameEndReason.CORRECT_GUESS;
import static com.guesspokemon.game.GameTypes.GameResult.LOSS;
import static com.guesspokemon.game.GameTypes.GameResult.WIN;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.game.GameCommandService;
import com.guesspokemon.game.GameCommands.AnswerQuestionCommand;
import com.guesspokemon.game.GameCommands.AskQuestionCommand;
import com.guesspokemon.game.GameCommands.GuessPokemonCommand;
import com.guesspokemon.game.GameCommands.StartGameCommand;
import com.guesspokemon.game.GameRuleException;
import com.guesspokemon.game.GameRuleException.GameRuleError;
import com.guesspokemon.game.GameViews.ParticipantGameView;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserRepository;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class GameHistoryStoreIntegrationTest {

    private static final int PIKACHU_ID = 25;
    private static final long INITIAL_STATE_VERSION = 3;
    private static final Instant USER_CREATED_AT =
            Instant.parse("2026-07-25T04:00:00Z");

    @Autowired
    private GameCommandService gameCommandService;

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

    @BeforeEach
    void setUp() {
        cleanGameHistoryAndUsers();
    }

    @AfterEach
    void cleanUp() {
        cleanGameHistoryAndUsers();
    }

    @Test
    void should_persistGameParticipantsAndActions_when_commandsCompleteGame() {
        AppUser selector = saveUser("complete_selector");
        AppUser questioner = saveUser("complete_questioner");
        String roomCode = randomRoomCode();
        ParticipantGameView start =
                startGame(
                        roomCode,
                        selector.getId(),
                        questioner.getId());

        gameCommandService.askQuestion(
                new AskQuestionCommand(
                        roomCode,
                        questioner.getId(),
                        UUID.randomUUID(),
                        "  전기 타입인가요?  "));
        gameCommandService.answerQuestion(
                new AnswerQuestionCommand(
                        roomCode,
                        selector.getId(),
                        UUID.randomUUID(),
                        NO));
        ParticipantGameView completed =
                gameCommandService.guessPokemon(
                        new GuessPokemonCommand(
                                roomCode,
                                questioner.getId(),
                                UUID.randomUUID(),
                                PIKACHU_ID));

        GameRecord game =
                gameRecordRepository
                        .findById(start.gameId())
                        .orElseThrow();
        Map<UUID, GameParticipantRecord> participants =
                gameParticipantRecordRepository
                        .findAllByIdGameId(start.gameId())
                        .stream()
                        .collect(
                                Collectors.toMap(
                                        record ->
                                                record
                                                        .getId()
                                                        .getUserId(),
                                        Function.identity()));
        GameActionRecord question =
                gameActionRecordRepository
                        .findByGameIdAndSequenceNumber(
                                start.gameId(),
                                (short) 1)
                        .orElseThrow();
        GameActionRecord guess =
                gameActionRecordRepository
                        .findByGameIdAndSequenceNumber(
                                start.gameId(),
                                (short) 2)
                        .orElseThrow();

        assertEquals(COMPLETED, completed.status());
        assertEquals(COMPLETED, game.getStatus());
        assertEquals(CORRECT_GUESS, game.getEndReason());
        assertEquals((short) 2, game.getActionCount());
        assertEquals(
                INITIAL_STATE_VERSION + 3,
                game.getStateVersion());
        assertEquals(LOSS, participants.get(selector.getId()).getResult());
        assertEquals(SELECTOR, participants.get(selector.getId()).getRole());
        assertEquals(WIN, participants.get(questioner.getId()).getResult());
        assertEquals(
                QUESTIONER,
                participants.get(questioner.getId()).getRole());
        assertEquals(QUESTION, question.getActionType());
        assertEquals("전기 타입인가요?", question.getQuestion());
        assertEquals(NO, question.getAnswer());
        assertEquals(GUESS, guess.getActionType());
        assertEquals(PIKACHU_ID, guess.getGuessedPokemonId());
        assertTrue(guess.getCorrect());
        assertEquals(2L, gameActionRecordRepository.count());
    }

    @Test
    void should_keepMemoryAndDatabaseActionUnchanged_when_storedVersionDiffers() {
        AppUser selector = saveUser("version_selector");
        AppUser questioner = saveUser("version_questioner");
        String roomCode = randomRoomCode();
        ParticipantGameView start =
                startGame(
                        roomCode,
                        selector.getId(),
                        questioner.getId());
        jdbcClient
                .sql(
                        """
                        UPDATE game
                        SET state_version = 99
                        WHERE id = :gameId
                        """)
                .param("gameId", start.gameId())
                .update();

        assertRuleError(
                PERSISTENCE_CONFLICT,
                () ->
                        gameCommandService.askQuestion(
                                new AskQuestionCommand(
                                        roomCode,
                                        questioner.getId(),
                                        UUID.randomUUID(),
                                        "날개가 있나요?")));
        ParticipantGameView current =
                gameCommandService.getView(
                        roomCode,
                        questioner.getId());
        GameRecord stored =
                gameRecordRepository
                        .findById(start.gameId())
                        .orElseThrow();

        assertEquals(INITIAL_STATE_VERSION, current.stateVersion());
        assertEquals(0, current.usedActionCount());
        assertEquals(99L, stored.getStateVersion());
        assertEquals((short) 0, stored.getActionCount());
        assertEquals(0L, gameActionRecordRepository.count());
    }

    @Test
    void should_rollbackGameInsert_when_participantForeignKeyFails() {
        AppUser selector = saveUser("rollback_selector");
        UUID missingQuestionerId = UUID.randomUUID();
        String roomCode = randomRoomCode();

        assertThrows(
                DataIntegrityViolationException.class,
                () ->
                        startGame(
                                roomCode,
                                selector.getId(),
                                missingQuestionerId));

        assertEquals(0L, gameRecordRepository.count());
        assertEquals(0L, gameParticipantRecordRepository.count());
        assertRuleError(
                INVALID_GAME_STATE,
                () ->
                        gameCommandService.getView(
                                roomCode,
                                selector.getId()));
    }

    @Test
    void should_rejectDuplicateCommandAndRollbackSecondGame_when_uuidIsReused() {
        AppUser firstSelector = saveUser("duplicate_first_selector");
        AppUser firstQuestioner = saveUser("duplicate_first_questioner");
        AppUser secondSelector = saveUser("duplicate_second_selector");
        AppUser secondQuestioner = saveUser("duplicate_second_questioner");
        String firstRoomCode = randomRoomCode();
        String secondRoomCode = randomRoomCode();
        startGame(
                firstRoomCode,
                firstSelector.getId(),
                firstQuestioner.getId());
        ParticipantGameView secondStart =
                startGame(
                        secondRoomCode,
                        secondSelector.getId(),
                        secondQuestioner.getId());
        UUID sharedCommandId = UUID.randomUUID();
        gameCommandService.askQuestion(
                new AskQuestionCommand(
                        firstRoomCode,
                        firstQuestioner.getId(),
                        sharedCommandId,
                        "첫 번째 질문"));

        assertRuleError(
                DUPLICATE_COMMAND,
                () ->
                        gameCommandService.askQuestion(
                                new AskQuestionCommand(
                                        secondRoomCode,
                                        secondQuestioner.getId(),
                                        sharedCommandId,
                                        "두 번째 질문")));
        ParticipantGameView secondCurrent =
                gameCommandService.getView(
                        secondRoomCode,
                        secondQuestioner.getId());
        GameRecord secondStored =
                gameRecordRepository
                        .findById(secondStart.gameId())
                        .orElseThrow();
        Long secondActionCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM game_action
                                WHERE game_id = :gameId
                                """)
                        .param(
                                "gameId",
                                secondStart.gameId())
                        .query(Long.class)
                        .single();

        assertEquals(INITIAL_STATE_VERSION, secondCurrent.stateVersion());
        assertEquals(0, secondCurrent.usedActionCount());
        assertEquals(INITIAL_STATE_VERSION, secondStored.getStateVersion());
        assertEquals((short) 0, secondStored.getActionCount());
        assertEquals(0L, secondActionCount);
        assertEquals(1L, gameActionRecordRepository.count());
        assertTrue(
                gameActionRecordRepository
                        .existsByCommandId(sharedCommandId));
    }

    private ParticipantGameView startGame(
            String roomCode,
            UUID selectorUserId,
            UUID questionerUserId) {
        return gameCommandService.startGame(
                new StartGameCommand(
                        roomCode,
                        UUID.randomUUID(),
                        selectorUserId,
                        questionerUserId,
                        PIKACHU_ID,
                        UUID.randomUUID(),
                        INITIAL_STATE_VERSION));
    }

    private AppUser saveUser(String prefix) {
        String suffix =
                UUID.randomUUID()
                        .toString()
                        .replace("-", "")
                        .substring(0, 8);
        String safePrefix =
                prefix.substring(
                        0,
                        Math.min(prefix.length(), 21));
        String loginId = safePrefix + "_" + suffix;
        String nickname = prefix.substring(0, 1) + suffix;
        return appUserRepository.saveAndFlush(
                AppUser.create(
                        loginId,
                        loginId,
                        nickname,
                        nickname,
                        "test-password-hash",
                        USER_CREATED_AT));
    }

    private String randomRoomCode() {
        return UUID.randomUUID()
                .toString()
                .replace("-", "")
                .substring(0, 6)
                .toUpperCase();
    }

    private void assertRuleError(
            GameRuleError expected,
            Runnable runnable) {
        GameRuleException exception =
                assertThrows(
                        GameRuleException.class,
                        runnable::run);
        assertEquals(expected, exception.error());
    }

    private void cleanGameHistoryAndUsers() {
        gameActionRecordRepository.deleteAllInBatch();
        gameParticipantRecordRepository.deleteAllInBatch();
        gameRecordRepository.deleteAllInBatch();
        appUserRepository.deleteAllInBatch();
    }
}
