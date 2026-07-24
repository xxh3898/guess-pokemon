package com.guesspokemon.history;

import static com.guesspokemon.game.GameTypes.GameEndReason.CORRECT_GUESS;
import static com.guesspokemon.game.GameTypes.GameEndReason.SERVER_RESTART;
import static com.guesspokemon.game.GameTypes.GameResult.LOSS;
import static com.guesspokemon.game.GameTypes.GameResult.NONE;
import static com.guesspokemon.game.GameTypes.GameResult.WIN;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.ABORTED;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.game.GameCommandService;
import com.guesspokemon.game.GameCommands.GuessPokemonCommand;
import com.guesspokemon.game.GameCommands.StartGameCommand;
import com.guesspokemon.game.GameTypes.GameResult;
import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameViews.ParticipantGameView;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserRepository;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class GameRestartRecoveryIntegrationTest {

    private static final int PIKACHU_ID = 25;
    private static final long INITIAL_STATE_VERSION = 3;
    private static final Instant USER_CREATED_AT =
            Instant.parse("2026-07-25T05:00:00Z");

    @Autowired
    private GameCommandService gameCommandService;

    @Autowired
    private GameRestartRecovery gameRestartRecovery;

    @Autowired
    private GameRecordRepository gameRecordRepository;

    @Autowired
    private GameParticipantRecordRepository
            gameParticipantRecordRepository;

    @Autowired
    private GameActionRecordRepository gameActionRecordRepository;

    @Autowired
    private AppUserRepository appUserRepository;

    @BeforeEach
    void setUp() {
        cleanGameHistoryAndUsers();
    }

    @AfterEach
    void cleanUp() {
        cleanGameHistoryAndUsers();
    }

    @Test
    void should_abortOnlyInProgressGames_when_applicationStarts() {
        AppUser activeSelector = saveUser("active_selector");
        AppUser activeQuestioner = saveUser("active_questioner");
        ParticipantGameView active =
                startGame(
                        randomRoomCode(),
                        activeSelector.getId(),
                        activeQuestioner.getId());
        AppUser completedSelector = saveUser("completed_selector");
        AppUser completedQuestioner = saveUser("completed_questioner");
        String completedRoomCode = randomRoomCode();
        ParticipantGameView completedStart =
                startGame(
                        completedRoomCode,
                        completedSelector.getId(),
                        completedQuestioner.getId());
        gameCommandService.guessPokemon(
                new GuessPokemonCommand(
                        completedRoomCode,
                        completedQuestioner.getId(),
                        UUID.randomUUID(),
                        PIKACHU_ID));
        GameRecord completedBeforeRecovery =
                gameRecordRepository
                        .findById(completedStart.gameId())
                        .orElseThrow();
        Instant completedEndedAt =
                completedBeforeRecovery.getEndedAt();
        long completedVersion =
                completedBeforeRecovery.getStateVersion();

        gameRestartRecovery.run(
                new DefaultApplicationArguments(
                        new String[0]));

        GameRecord aborted =
                gameRecordRepository
                        .findById(active.gameId())
                        .orElseThrow();
        GameRecord completed =
                gameRecordRepository
                        .findById(completedStart.gameId())
                        .orElseThrow();
        Map<GameRole, GameResult> abortedResults =
                participantResults(active.gameId());
        Map<GameRole, GameResult> completedResults =
                participantResults(completedStart.gameId());

        assertEquals(ABORTED, aborted.getStatus());
        assertEquals(SERVER_RESTART, aborted.getEndReason());
        assertEquals(
                INITIAL_STATE_VERSION + 1,
                aborted.getStateVersion());
        assertNotNull(aborted.getEndedAt());
        assertFalse(
                aborted.getEndedAt()
                        .isBefore(aborted.getStartedAt()));
        assertEquals(NONE, abortedResults.get(SELECTOR));
        assertEquals(NONE, abortedResults.get(QUESTIONER));
        assertEquals(COMPLETED, completed.getStatus());
        assertEquals(CORRECT_GUESS, completed.getEndReason());
        assertEquals(completedVersion, completed.getStateVersion());
        assertEquals(completedEndedAt, completed.getEndedAt());
        assertEquals(LOSS, completedResults.get(SELECTOR));
        assertEquals(WIN, completedResults.get(QUESTIONER));

        gameRestartRecovery.run(
                new DefaultApplicationArguments(
                        new String[0]));
        assertEquals(
                INITIAL_STATE_VERSION + 1,
                gameRecordRepository
                        .findById(active.gameId())
                        .orElseThrow()
                        .getStateVersion());
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

    private Map<GameRole, GameResult> participantResults(
            UUID gameId) {
        return gameParticipantRecordRepository
                .findAllByIdGameId(gameId)
                .stream()
                .collect(
                        Collectors.toMap(
                                GameParticipantRecord::getRole,
                                GameParticipantRecord::getResult));
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

    private void cleanGameHistoryAndUsers() {
        gameActionRecordRepository.deleteAllInBatch();
        gameParticipantRecordRepository.deleteAllInBatch();
        gameRecordRepository.deleteAllInBatch();
        appUserRepository.deleteAllInBatch();
    }
}
