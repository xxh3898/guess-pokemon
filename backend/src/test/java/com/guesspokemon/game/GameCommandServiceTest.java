package com.guesspokemon.game;

import static com.guesspokemon.game.GameRuleException.GameRuleError.INVALID_GAME_STATE;
import static com.guesspokemon.game.GameRuleException.GameRuleError.POKEMON_NOT_FOUND;
import static com.guesspokemon.game.GameTypes.GameAnswer.NO;
import static com.guesspokemon.game.GameTypes.GameEndReason.RECONNECT_TIMEOUT;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.guesspokemon.game.GameCommands.AnswerQuestionCommand;
import com.guesspokemon.game.GameCommands.AskQuestionCommand;
import com.guesspokemon.game.GameCommands.GuessPokemonCommand;
import com.guesspokemon.game.GameCommands.EndGameCommand;
import com.guesspokemon.game.GameCommands.StartGameCommand;
import com.guesspokemon.game.GamePersistencePort.ActionState;
import com.guesspokemon.game.GamePersistencePort.GameState;
import com.guesspokemon.game.GameRuleException.GameRuleError;
import com.guesspokemon.game.GameViews.ParticipantGameView;
import com.guesspokemon.pokemon.PokemonSpecies;
import com.guesspokemon.pokemon.PokemonSpeciesRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class GameCommandServiceTest {

    private static final UUID SELECTOR_USER_ID =
            UUID.fromString("bdb54d31-e305-4860-b1bd-f7d1870e8d9c");
    private static final UUID QUESTIONER_USER_ID =
            UUID.fromString("1151e14d-7bed-47da-a771-a82369173849");
    private static final int PIKACHU_ID = 25;
    private static final long INITIAL_STATE_VERSION = 3;
    private static final String ROOM_CODE = "ABCD12";
    private static final Instant CLOCK_INSTANT =
            Instant.parse("2026-07-25T02:00:00.123456789Z");

    private GameRegistry gameRegistry;
    private FakeGamePersistencePort persistencePort;
    private PokemonSpeciesRepository pokemonSpeciesRepository;
    private GameCommandService gameCommandService;

    @BeforeEach
    void setUp() {
        gameRegistry = new GameRegistry();
        persistencePort = new FakeGamePersistencePort();
        pokemonSpeciesRepository =
                mock(PokemonSpeciesRepository.class);
        when(
                        pokemonSpeciesRepository
                                .findByNationalDexIdAndEnabledTrue(
                                        anyInt()))
                .thenReturn(
                        Optional.of(
                                mock(PokemonSpecies.class)));
        gameCommandService =
                new GameCommandService(
                        gameRegistry,
                        persistencePort,
                        pokemonSpeciesRepository,
                        Clock.fixed(
                                CLOCK_INSTANT,
                                ZoneOffset.UTC));
    }

    @Test
    void should_persistMappedStates_when_gameCommandsSucceed() {
        ParticipantGameView startView =
                gameCommandService.startGame(startCommand(ROOM_CODE));
        ParticipantGameView questionView =
                gameCommandService.askQuestion(
                        new AskQuestionCommand(
                                ROOM_CODE,
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                "전기 타입인가요?"));
        ParticipantGameView answerView =
                gameCommandService.answerQuestion(
                        new AnswerQuestionCommand(
                                ROOM_CODE,
                                SELECTOR_USER_ID,
                                UUID.randomUUID(),
                                NO,
                                "  비슷하지만 달라요.  "));
        ParticipantGameView guessView =
                gameCommandService.guessPokemon(
                        new GuessPokemonCommand(
                                ROOM_CODE,
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                PIKACHU_ID));

        assertEquals(INITIAL_STATE_VERSION, startView.stateVersion());
        assertEquals(INITIAL_STATE_VERSION + 1, questionView.stateVersion());
        assertEquals(INITIAL_STATE_VERSION + 2, answerView.stateVersion());
        assertEquals(INITIAL_STATE_VERSION + 3, guessView.stateVersion());
        assertEquals(1, persistencePort.createdGames.size());
        assertEquals(
                Instant.parse(
                        "2026-07-25T02:00:00.123456Z"),
                persistencePort.createdGames
                        .getFirst()
                        .startedAt());
        assertEquals(2, persistencePort.appendedActions.size());
        assertEquals(1, persistencePort.answeredActions.size());
        assertEquals(
                "비슷하지만 달라요.",
                persistencePort.answeredActions
                        .getFirst()
                        .comment());
        assertEquals(
                "비슷하지만 달라요.",
                answerView.actions()
                        .getFirst()
                        .comment());
        assertEquals(
                2,
                persistencePort.appendedActions
                        .getLast()
                        .sequenceNumber());
        assertEquals(
                PIKACHU_ID,
                persistencePort.appendedActions
                        .getLast()
                        .guessedPokemonNationalDexId());
    }

    @Test
    void should_keepPreviousMemoryState_when_actionPersistenceFails() {
        gameCommandService.startGame(startCommand(ROOM_CODE));
        persistencePort.failAppend = true;

        assertThrows(
                IllegalStateException.class,
                () ->
                        gameCommandService.askQuestion(
                                new AskQuestionCommand(
                                        ROOM_CODE,
                                        QUESTIONER_USER_ID,
                                        UUID.randomUUID(),
                                        "날개가 있나요?")));
        ParticipantGameView current =
                gameCommandService.getView(
                        ROOM_CODE,
                        QUESTIONER_USER_ID);

        assertEquals(INITIAL_STATE_VERSION, current.stateVersion());
        assertEquals(0, current.usedActionCount());
        assertEquals(List.of(), current.actions());
    }

    @Test
    void should_keepPendingQuestion_when_answerPersistenceFails() {
        gameCommandService.startGame(startCommand(ROOM_CODE));
        gameCommandService.askQuestion(
                new AskQuestionCommand(
                        ROOM_CODE,
                        QUESTIONER_USER_ID,
                        UUID.randomUUID(),
                        "날개가 있나요?"));
        persistencePort.failAnswer = true;

        assertThrows(
                IllegalStateException.class,
                () ->
                        gameCommandService.answerQuestion(
                                new AnswerQuestionCommand(
                                        ROOM_CODE,
                                        SELECTOR_USER_ID,
                                        UUID.randomUUID(),
                                        NO)));
        ParticipantGameView current =
                gameCommandService.getView(
                        ROOM_CODE,
                        QUESTIONER_USER_ID);

        assertEquals(
                INITIAL_STATE_VERSION + 1,
                current.stateVersion());
        assertEquals(1, current.usedActionCount());
        assertEquals(1, current.actions().size());
        assertNull(current.actions().getFirst().answer());
    }

    @Test
    void should_notRegisterGame_when_startPersistenceFails() {
        persistencePort.failCreate = true;

        assertThrows(
                IllegalStateException.class,
                () ->
                        gameCommandService.startGame(
                                startCommand(ROOM_CODE)));
        assertRuleError(
                INVALID_GAME_STATE,
                () ->
                        gameCommandService.getView(
                                ROOM_CODE,
                                SELECTOR_USER_ID));
    }

    @Test
    void should_rejectPokemonBeforePersistence_when_catalogEntryIsUnavailable() {
        when(
                        pokemonSpeciesRepository
                                .findByNationalDexIdAndEnabledTrue(
                                        PIKACHU_ID))
                .thenReturn(Optional.empty());

        assertRuleError(
                POKEMON_NOT_FOUND,
                () ->
                        gameCommandService.startGame(
                                startCommand(ROOM_CODE)));
        assertEquals(List.of(), persistencePort.createdGames);
    }

    @Test
    void should_keepPreviousMemoryState_when_endPersistenceFails() {
        gameCommandService.startGame(startCommand(ROOM_CODE));
        persistencePort.failEnd = true;

        assertThrows(
                IllegalStateException.class,
                () ->
                        gameCommandService.endGame(
                                new EndGameCommand(
                                        ROOM_CODE,
                                        QUESTIONER_USER_ID,
                                        UUID.randomUUID(),
                                        RECONNECT_TIMEOUT,
                                        INITIAL_STATE_VERSION + 3),
                                SELECTOR_USER_ID));
        ParticipantGameView current =
                gameCommandService.getView(
                        ROOM_CODE,
                        SELECTOR_USER_ID);

        assertEquals(
                INITIAL_STATE_VERSION,
                current.stateVersion());
        assertNull(current.endReason());
        assertEquals(List.of(), persistencePort.endedGames);
    }

    private StartGameCommand startCommand(String roomCode) {
        return new StartGameCommand(
                roomCode,
                UUID.randomUUID(),
                SELECTOR_USER_ID,
                QUESTIONER_USER_ID,
                PIKACHU_ID,
                UUID.randomUUID(),
                INITIAL_STATE_VERSION);
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

    private static final class FakeGamePersistencePort
            implements GamePersistencePort {

        private final List<GameState> createdGames =
                new ArrayList<>();
        private final List<ActionState> appendedActions =
                new ArrayList<>();
        private final List<ActionState> answeredActions =
                new ArrayList<>();
        private final List<GameState> endedGames =
                new ArrayList<>();
        private final Set<UUID> actionCommandIds =
                new HashSet<>();
        private boolean failCreate;
        private boolean failAppend;
        private boolean failAnswer;
        private boolean failEnd;

        @Override
        public void createGame(GameState gameState) {
            if (failCreate) {
                throw new IllegalStateException(
                        "start persistence failure");
            }
            createdGames.add(gameState);
        }

        @Override
        public void appendAction(
                long expectedPreviousVersion,
                GameState gameState,
                ActionState actionState) {
            if (failAppend) {
                throw new IllegalStateException(
                        "action persistence failure");
            }
            appendedActions.add(actionState);
            actionCommandIds.add(actionState.commandId());
        }

        @Override
        public void updateAnsweredQuestion(
                long expectedPreviousVersion,
                GameState gameState,
                ActionState actionState) {
            if (failAnswer) {
                throw new IllegalStateException(
                        "answer persistence failure");
            }
            answeredActions.add(actionState);
        }

        @Override
        public void updateGame(
                long expectedPreviousVersion,
                GameState gameState) {
            if (failEnd) {
                throw new IllegalStateException(
                        "end persistence failure");
            }
            endedGames.add(gameState);
        }

        @Override
        public boolean actionCommandExists(UUID commandId) {
            return actionCommandIds.contains(commandId);
        }

        @Override
        public int abortInProgressGames(Instant endedAt) {
            return 0;
        }
    }
}
