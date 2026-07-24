package com.guesspokemon.game;

import static com.guesspokemon.game.GameRuleException.GameRuleError.ACTION_LIMIT_REACHED;
import static com.guesspokemon.game.GameRuleException.GameRuleError.ANSWER_PENDING;
import static com.guesspokemon.game.GameRuleException.GameRuleError.DUPLICATE_COMMAND;
import static com.guesspokemon.game.GameRuleException.GameRuleError.INVALID_GAME_STATE;
import static com.guesspokemon.game.GameRuleException.GameRuleError.INVALID_ROLE;
import static com.guesspokemon.game.GameRuleException.GameRuleError.NO_PENDING_QUESTION;
import static com.guesspokemon.game.GameRuleException.GameRuleError.VALIDATION_FAILED;
import static com.guesspokemon.game.GameTypes.GameAnswer.NO;
import static com.guesspokemon.game.GameTypes.GameEndReason.CORRECT_GUESS;
import static com.guesspokemon.game.GameTypes.GameEndReason.QUESTION_LIMIT;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static com.guesspokemon.game.GameTypes.GameStatus.IN_PROGRESS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.game.GameRuleException.GameRuleError;
import com.guesspokemon.game.GameViews.ParticipantGameView;
import com.guesspokemon.game.GameViews.QuestionerGameView;
import com.guesspokemon.game.GameViews.SelectorGameView;
import java.time.Instant;
import java.util.Arrays;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;

class GameTest {

    private static final UUID GAME_ID =
            UUID.fromString("a1cb9bb9-2351-48ce-8836-8f004b2f0cd3");
    private static final UUID ROUND_GROUP_ID =
            UUID.fromString("5827416a-e591-4fce-9df7-f61ddba1cb99");
    private static final UUID SELECTOR_USER_ID =
            UUID.fromString("9d748b35-ff8e-4379-baa7-c48a7ac901f0");
    private static final UUID QUESTIONER_USER_ID =
            UUID.fromString("d4482ef7-18e3-4270-a938-653e96d58c90");
    private static final int ANSWER_POKEMON_ID = 25;
    private static final long INITIAL_STATE_VERSION = 3;
    private static final Instant STARTED_AT =
            Instant.parse("2026-07-25T01:00:00Z");

    @Test
    void should_exposeSelectedPokemonOnlyToSelector_when_gameStarts() {
        Game game = newGame();

        ParticipantGameView selectorView =
                game.viewFor(SELECTOR_USER_ID);
        ParticipantGameView questionerView =
                game.viewFor(QUESTIONER_USER_ID);

        SelectorGameView typedSelectorView =
                assertInstanceOf(
                        SelectorGameView.class,
                        selectorView);
        QuestionerGameView typedQuestionerView =
                assertInstanceOf(
                        QuestionerGameView.class,
                        questionerView);
        assertEquals(
                ANSWER_POKEMON_ID,
                typedSelectorView.selectedPokemonNationalDexId());
        assertEquals(SELECTOR, typedSelectorView.myRole());
        assertEquals(QUESTIONER, typedQuestionerView.myRole());
        assertEquals(IN_PROGRESS, typedQuestionerView.status());
        assertEquals(INITIAL_STATE_VERSION, typedQuestionerView.stateVersion());
        assertEquals(0, typedQuestionerView.usedActionCount());
        assertEquals(20, typedQuestionerView.remainingActionCount());
        assertFalse(
                Arrays.stream(
                                QuestionerGameView.class
                                        .getRecordComponents())
                        .anyMatch(
                                component ->
                                        component
                                                .getName()
                                                .contains(
                                                        "selectedPokemon")));
    }

    @Test
    void should_normalizeQuestionToNfcAndStripWhitespace_when_questionIsAsked() {
        Game game = newGame();

        Game candidate =
                game.ask(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                "  cafe\u0301인가요?  ",
                                STARTED_AT.plusSeconds(1))
                        .candidate();

        assertEquals(1, candidate.actionCount());
        assertEquals(INITIAL_STATE_VERSION + 1, candidate.stateVersion());
        assertEquals(
                "café인가요?",
                candidate
                        .viewFor(QUESTIONER_USER_ID)
                        .actions()
                        .getFirst()
                        .question());
        assertNull(
                candidate
                        .viewFor(QUESTIONER_USER_ID)
                        .actions()
                        .getFirst()
                        .answer());
    }

    @Test
    void should_acceptTwoHundredUnicodeCodePoints_when_questionIsAsked() {
        Game candidate =
                newGame()
                        .ask(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                "😀".repeat(200),
                                STARTED_AT.plusSeconds(1))
                        .candidate();

        String question =
                candidate
                        .viewFor(QUESTIONER_USER_ID)
                        .actions()
                        .getFirst()
                        .question();
        assertEquals(200, question.codePointCount(0, question.length()));
    }

    @Test
    void should_rejectQuestion_when_normalizedLengthIsInvalid() {
        assertRuleError(
                VALIDATION_FAILED,
                () ->
                        newGame()
                                .ask(
                                        QUESTIONER_USER_ID,
                                        UUID.randomUUID(),
                                        UUID.randomUUID(),
                                        "   ",
                                        STARTED_AT.plusSeconds(1)));
        assertRuleError(
                VALIDATION_FAILED,
                () ->
                        newGame()
                                .ask(
                                        QUESTIONER_USER_ID,
                                        UUID.randomUUID(),
                                        UUID.randomUUID(),
                                        "가".repeat(201),
                                        STARTED_AT.plusSeconds(1)));
    }

    @Test
    void should_rejectCommand_when_userHasWrongRole() {
        Game pending =
                newGame()
                        .ask(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                "전기 타입인가요?",
                                STARTED_AT.plusSeconds(1))
                        .candidate();

        assertRuleError(
                INVALID_ROLE,
                () ->
                        newGame()
                                .ask(
                                        SELECTOR_USER_ID,
                                        UUID.randomUUID(),
                                        UUID.randomUUID(),
                                        "질문",
                                        STARTED_AT.plusSeconds(1)));
        assertRuleError(
                INVALID_ROLE,
                () ->
                        newGame()
                                .guess(
                                        SELECTOR_USER_ID,
                                        UUID.randomUUID(),
                                        UUID.randomUUID(),
                                        ANSWER_POKEMON_ID,
                                        STARTED_AT.plusSeconds(1)));
        assertRuleError(
                INVALID_ROLE,
                () ->
                        pending.answer(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                NO,
                                STARTED_AT.plusSeconds(2)));
        assertRuleError(
                INVALID_ROLE,
                () ->
                        newGame()
                                .viewFor(UUID.randomUUID()));
    }

    @Test
    void should_rejectNewAction_when_questionAnswerIsPending() {
        Game pending =
                newGame()
                        .ask(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                "날개가 있나요?",
                                STARTED_AT.plusSeconds(1))
                        .candidate();

        assertRuleError(
                ANSWER_PENDING,
                () ->
                        pending.ask(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                "두 번째 질문",
                                STARTED_AT.plusSeconds(2)));
        assertRuleError(
                ANSWER_PENDING,
                () ->
                        pending.guess(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                1,
                                STARTED_AT.plusSeconds(2)));
    }

    @Test
    void should_rejectAnswer_when_pendingQuestionDoesNotExist() {
        assertRuleError(
                NO_PENDING_QUESTION,
                () ->
                        newGame()
                                .answer(
                                        SELECTOR_USER_ID,
                                        UUID.randomUUID(),
                                        NO,
                                        STARTED_AT.plusSeconds(1)));
    }

    @Test
    void should_rejectCommand_when_commandIdWasAlreadyProcessed() {
        UUID commandId = UUID.randomUUID();
        Game pending =
                newGame()
                        .ask(
                                QUESTIONER_USER_ID,
                                commandId,
                                UUID.randomUUID(),
                                "날개가 있나요?",
                                STARTED_AT.plusSeconds(1))
                        .candidate();

        assertRuleError(
                DUPLICATE_COMMAND,
                () ->
                        pending.answer(
                                SELECTOR_USER_ID,
                                commandId,
                                NO,
                                STARTED_AT.plusSeconds(2)));
    }

    @Test
    void should_completeWithSelectorWin_when_twentiethQuestionIsAnswered() {
        Game afterNineteenActions =
                advanceWithWrongGuesses(newGame(), 19);
        Game pending =
                afterNineteenActions
                        .ask(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                "마지막 질문인가요?",
                                STARTED_AT.plusSeconds(20))
                        .candidate();

        Game completed =
                pending.answer(
                                SELECTOR_USER_ID,
                                UUID.randomUUID(),
                                NO,
                                STARTED_AT.plusSeconds(21))
                        .candidate();
        ParticipantGameView view =
                completed.viewFor(QUESTIONER_USER_ID);

        assertEquals(COMPLETED, view.status());
        assertEquals(QUESTION_LIMIT, view.endReason());
        assertEquals(SELECTOR_USER_ID, view.winnerUserId());
        assertEquals(QUESTIONER_USER_ID, view.loserUserId());
        assertEquals(20, view.usedActionCount());
        assertEquals(0, view.remainingActionCount());
        assertEquals(INITIAL_STATE_VERSION + 21, view.stateVersion());
        assertEquals(NO, view.actions().getLast().answer());
    }

    @Test
    void should_rejectNewActionWithLimitError_when_twentiethQuestionIsPending() {
        Game pending =
                advanceWithWrongGuesses(newGame(), 19)
                        .ask(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                "마지막 질문인가요?",
                                STARTED_AT.plusSeconds(20))
                        .candidate();

        assertRuleError(
                ACTION_LIMIT_REACHED,
                () ->
                        pending.guess(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                ANSWER_POKEMON_ID,
                                STARTED_AT.plusSeconds(21)));
    }

    @Test
    void should_completeWithSelectorWin_when_twentiethGuessIsWrong() {
        Game afterNineteenActions =
                advanceWithWrongGuesses(newGame(), 19);

        Game completed =
                afterNineteenActions
                        .guess(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                1,
                                STARTED_AT.plusSeconds(20))
                        .candidate();
        ParticipantGameView view =
                completed.viewFor(QUESTIONER_USER_ID);

        assertEquals(COMPLETED, view.status());
        assertEquals(QUESTION_LIMIT, view.endReason());
        assertEquals(SELECTOR_USER_ID, view.winnerUserId());
        assertEquals(QUESTIONER_USER_ID, view.loserUserId());
        assertEquals(20, view.usedActionCount());
    }

    @Test
    void should_completeWithQuestionerWin_when_twentiethGuessIsCorrect() {
        Game afterNineteenActions =
                advanceWithWrongGuesses(newGame(), 19);

        Game completed =
                afterNineteenActions
                        .guess(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                ANSWER_POKEMON_ID,
                                STARTED_AT.plusSeconds(20))
                        .candidate();
        ParticipantGameView view =
                completed.viewFor(QUESTIONER_USER_ID);

        assertEquals(COMPLETED, view.status());
        assertEquals(CORRECT_GUESS, view.endReason());
        assertEquals(QUESTIONER_USER_ID, view.winnerUserId());
        assertEquals(SELECTOR_USER_ID, view.loserUserId());
        assertTrue(view.actions().getLast().correct());
    }

    @Test
    void should_rejectCommand_when_gameIsCompleted() {
        Game completed =
                newGame()
                        .guess(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                ANSWER_POKEMON_ID,
                                STARTED_AT.plusSeconds(1))
                        .candidate();

        assertRuleError(
                INVALID_GAME_STATE,
                () ->
                        completed.guess(
                                QUESTIONER_USER_ID,
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                ANSWER_POKEMON_ID,
                                STARTED_AT.plusSeconds(2)));
    }

    private Game newGame() {
        return Game.start(
                GAME_ID,
                ROUND_GROUP_ID,
                SELECTOR_USER_ID,
                QUESTIONER_USER_ID,
                ANSWER_POKEMON_ID,
                UUID.randomUUID(),
                INITIAL_STATE_VERSION,
                STARTED_AT);
    }

    private Game advanceWithWrongGuesses(
            Game initialGame,
            int count) {
        Game current = initialGame;
        for (int sequence = 1; sequence <= count; sequence++) {
            current =
                    current.guess(
                                    QUESTIONER_USER_ID,
                                    UUID.randomUUID(),
                                    UUID.randomUUID(),
                                    1,
                                    STARTED_AT.plusSeconds(sequence))
                            .candidate();
        }
        return current;
    }

    private void assertRuleError(
            GameRuleError expected,
            Executable executable) {
        GameRuleException exception =
                assertThrows(
                        GameRuleException.class,
                        executable);
        assertEquals(expected, exception.error());
    }
}
