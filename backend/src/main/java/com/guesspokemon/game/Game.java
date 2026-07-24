package com.guesspokemon.game;

import static com.guesspokemon.game.GameRuleException.GameRuleError.ACTION_LIMIT_REACHED;
import static com.guesspokemon.game.GameRuleException.GameRuleError.ANSWER_PENDING;
import static com.guesspokemon.game.GameRuleException.GameRuleError.DUPLICATE_COMMAND;
import static com.guesspokemon.game.GameRuleException.GameRuleError.INVALID_GAME_STATE;
import static com.guesspokemon.game.GameRuleException.GameRuleError.INVALID_ROLE;
import static com.guesspokemon.game.GameRuleException.GameRuleError.NO_PENDING_QUESTION;
import static com.guesspokemon.game.GameRuleException.GameRuleError.VALIDATION_FAILED;
import static com.guesspokemon.game.GameTypes.GameEndReason.CORRECT_GUESS;
import static com.guesspokemon.game.GameTypes.GameEndReason.QUESTION_LIMIT;
import static com.guesspokemon.game.GameTypes.GameResult.LOSS;
import static com.guesspokemon.game.GameTypes.GameResult.NONE;
import static com.guesspokemon.game.GameTypes.GameResult.WIN;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static com.guesspokemon.game.GameTypes.GameStatus.IN_PROGRESS;

import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameResult;
import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameTypes.GameStatus;
import com.guesspokemon.game.GameViews.ActionView;
import com.guesspokemon.game.GameViews.ParticipantGameView;
import com.guesspokemon.game.GameViews.QuestionerGameView;
import com.guesspokemon.game.GameViews.SelectorGameView;
import java.text.Normalizer;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

final class Game {

    static final int MAX_ACTION_COUNT = 20;
    private static final int MAX_QUESTION_LENGTH = 200;

    private final UUID id;
    private final UUID roundGroupId;
    private final UUID selectorUserId;
    private final UUID questionerUserId;
    private final int answerPokemonId;
    private final GameStatus status;
    private final GameEndReason endReason;
    private final UUID winnerUserId;
    private final UUID loserUserId;
    private final int actionCount;
    private final long stateVersion;
    private final Instant startedAt;
    private final Instant endedAt;
    private final List<GameAction> actions;
    private final Set<UUID> processedCommandIds;

    private Game(
            UUID id,
            UUID roundGroupId,
            UUID selectorUserId,
            UUID questionerUserId,
            int answerPokemonId,
            GameStatus status,
            GameEndReason endReason,
            UUID winnerUserId,
            UUID loserUserId,
            int actionCount,
            long stateVersion,
            Instant startedAt,
            Instant endedAt,
            List<GameAction> actions,
            Set<UUID> processedCommandIds) {
        this.id = Objects.requireNonNull(id);
        this.roundGroupId = Objects.requireNonNull(roundGroupId);
        this.selectorUserId = Objects.requireNonNull(selectorUserId);
        this.questionerUserId = Objects.requireNonNull(questionerUserId);
        if (selectorUserId.equals(questionerUserId)) {
            throw new IllegalArgumentException(
                    "selector와 questioner가 같습니다.");
        }
        if (answerPokemonId <= 0) {
            throw new IllegalArgumentException(
                    "answerPokemonId가 올바르지 않습니다.");
        }
        this.answerPokemonId = answerPokemonId;
        this.status = Objects.requireNonNull(status);
        this.endReason = endReason;
        this.winnerUserId = winnerUserId;
        this.loserUserId = loserUserId;
        if (actionCount < 0 || actionCount > MAX_ACTION_COUNT) {
            throw new IllegalArgumentException(
                    "actionCount가 범위를 벗어났습니다.");
        }
        this.actionCount = actionCount;
        if (stateVersion < 0) {
            throw new IllegalArgumentException(
                    "stateVersion이 음수입니다.");
        }
        this.stateVersion = stateVersion;
        this.startedAt = Objects.requireNonNull(startedAt);
        this.endedAt = endedAt;
        this.actions = List.copyOf(actions);
        this.processedCommandIds = Set.copyOf(processedCommandIds);
        validateLifecycle();
    }

    static Game start(
            UUID id,
            UUID roundGroupId,
            UUID selectorUserId,
            UUID questionerUserId,
            int answerPokemonId,
            UUID commandId,
            long initialStateVersion,
            Instant startedAt) {
        return new Game(
                id,
                roundGroupId,
                selectorUserId,
                questionerUserId,
                answerPokemonId,
                IN_PROGRESS,
                null,
                null,
                null,
                0,
                initialStateVersion,
                startedAt,
                null,
                List.of(),
                Set.of(Objects.requireNonNull(commandId)));
    }

    Transition ask(
            UUID userId,
            UUID commandId,
            UUID actionId,
            String questionInput,
            Instant now) {
        requireInProgress();
        requireRole(userId, QUESTIONER);
        rejectDuplicateCommand(commandId);
        requireActionAvailable();
        if (pendingQuestion() != null) {
            throw new GameRuleException(ANSWER_PENDING);
        }
        String question = normalizeQuestion(questionInput);
        int nextActionCount = actionCount + 1;
        GameAction action =
                GameAction.question(
                        actionId,
                        commandId,
                        questionerUserId,
                        nextActionCount,
                        question,
                        now);
        return transitionWithAction(
                action,
                nextActionCount,
                stateVersion + 1,
                null,
                null,
                null,
                null);
    }

    Transition answer(
            UUID userId,
            UUID commandId,
            GameAnswer answer,
            Instant now) {
        requireInProgress();
        requireRole(userId, SELECTOR);
        rejectDuplicateCommand(commandId);
        GameAction pendingQuestion = pendingQuestion();
        if (pendingQuestion == null) {
            throw new GameRuleException(NO_PENDING_QUESTION);
        }
        GameAction answeredAction =
                pendingQuestion.answered(
                        Objects.requireNonNull(answer),
                        Objects.requireNonNull(now));
        List<GameAction> updatedActions =
                replaceLastAction(answeredAction);
        Set<UUID> updatedCommands = addCommand(commandId);
        if (actionCount == MAX_ACTION_COUNT) {
            Game completed =
                    completed(
                            QUESTION_LIMIT,
                            selectorUserId,
                            questionerUserId,
                            stateVersion + 1,
                            now,
                            updatedActions,
                            updatedCommands);
            return new Transition(this, completed, answeredAction);
        }
        Game continued =
                copy(
                        IN_PROGRESS,
                        null,
                        null,
                        null,
                        actionCount,
                        stateVersion + 1,
                        null,
                        updatedActions,
                        updatedCommands);
        return new Transition(this, continued, answeredAction);
    }

    Transition guess(
            UUID userId,
            UUID commandId,
            UUID actionId,
            int guessedPokemonId,
            Instant now) {
        requireInProgress();
        requireRole(userId, QUESTIONER);
        rejectDuplicateCommand(commandId);
        requireActionAvailable();
        if (pendingQuestion() != null) {
            throw new GameRuleException(ANSWER_PENDING);
        }
        if (guessedPokemonId <= 0) {
            throw new GameRuleException(VALIDATION_FAILED);
        }
        int nextActionCount = actionCount + 1;
        boolean correct = guessedPokemonId == answerPokemonId;
        GameAction action =
                GameAction.guess(
                        actionId,
                        commandId,
                        questionerUserId,
                        nextActionCount,
                        guessedPokemonId,
                        correct,
                        now);
        if (correct) {
            return transitionWithAction(
                    action,
                    nextActionCount,
                    stateVersion + 1,
                    CORRECT_GUESS,
                    questionerUserId,
                    selectorUserId,
                    now);
        }
        if (nextActionCount == MAX_ACTION_COUNT) {
            return transitionWithAction(
                    action,
                    nextActionCount,
                    stateVersion + 1,
                    QUESTION_LIMIT,
                    selectorUserId,
                    questionerUserId,
                    now);
        }
        return transitionWithAction(
                action,
                nextActionCount,
                stateVersion + 1,
                null,
                null,
                null,
                null);
    }

    ParticipantGameView viewFor(UUID userId) {
        GameRole role = roleOf(userId);
        List<ActionView> actionViews =
                actions.stream()
                        .map(Game::toActionView)
                        .toList();
        int remainingActionCount =
                MAX_ACTION_COUNT - actionCount;
        if (role == SELECTOR) {
            return new SelectorGameView(
                    id,
                    status,
                    stateVersion,
                    actionCount,
                    remainingActionCount,
                    role,
                    answerPokemonId,
                    winnerUserId,
                    loserUserId,
                    endReason,
                    actionViews);
        }
        return new QuestionerGameView(
                id,
                status,
                stateVersion,
                actionCount,
                remainingActionCount,
                role,
                winnerUserId,
                loserUserId,
                endReason,
                actionViews);
    }

    boolean hasProcessedCommand(UUID commandId) {
        return processedCommandIds.contains(commandId);
    }

    UUID id() {
        return id;
    }

    UUID roundGroupId() {
        return roundGroupId;
    }

    UUID selectorUserId() {
        return selectorUserId;
    }

    UUID questionerUserId() {
        return questionerUserId;
    }

    int answerPokemonId() {
        return answerPokemonId;
    }

    GameStatus status() {
        return status;
    }

    GameEndReason endReason() {
        return endReason;
    }

    int actionCount() {
        return actionCount;
    }

    long stateVersion() {
        return stateVersion;
    }

    Instant startedAt() {
        return startedAt;
    }

    Instant endedAt() {
        return endedAt;
    }

    GameResult resultFor(UUID userId) {
        roleOf(userId);
        if (status != COMPLETED) {
            return NONE;
        }
        return userId.equals(winnerUserId) ? WIN : LOSS;
    }

    private Transition transitionWithAction(
            GameAction action,
            int newActionCount,
            long newStateVersion,
            GameEndReason newEndReason,
            UUID newWinnerUserId,
            UUID newLoserUserId,
            Instant newEndedAt) {
        List<GameAction> updatedActions =
                new ArrayList<>(actions);
        updatedActions.add(action);
        Set<UUID> updatedCommands =
                addCommand(action.commandId());
        Game candidate;
        if (newEndReason == null) {
            candidate =
                    copy(
                            IN_PROGRESS,
                            null,
                            null,
                            null,
                            newActionCount,
                            newStateVersion,
                            null,
                            updatedActions,
                            updatedCommands);
        } else {
            candidate =
                    completed(
                            newEndReason,
                            newWinnerUserId,
                            newLoserUserId,
                            newStateVersion,
                            newEndedAt,
                            updatedActions,
                            updatedCommands);
        }
        return new Transition(this, candidate, action);
    }

    private Game completed(
            GameEndReason newEndReason,
            UUID newWinnerUserId,
            UUID newLoserUserId,
            long newStateVersion,
            Instant newEndedAt,
            List<GameAction> updatedActions,
            Set<UUID> updatedCommands) {
        return copy(
                COMPLETED,
                newEndReason,
                newWinnerUserId,
                newLoserUserId,
                updatedActions.size(),
                newStateVersion,
                newEndedAt,
                updatedActions,
                updatedCommands);
    }

    private Game copy(
            GameStatus newStatus,
            GameEndReason newEndReason,
            UUID newWinnerUserId,
            UUID newLoserUserId,
            int newActionCount,
            long newStateVersion,
            Instant newEndedAt,
            List<GameAction> updatedActions,
            Set<UUID> updatedCommands) {
        return new Game(
                id,
                roundGroupId,
                selectorUserId,
                questionerUserId,
                answerPokemonId,
                newStatus,
                newEndReason,
                newWinnerUserId,
                newLoserUserId,
                newActionCount,
                newStateVersion,
                startedAt,
                newEndedAt,
                updatedActions,
                updatedCommands);
    }

    private List<GameAction> replaceLastAction(
            GameAction answeredAction) {
        List<GameAction> updatedActions =
                new ArrayList<>(actions);
        updatedActions.set(
                updatedActions.size() - 1,
                answeredAction);
        return updatedActions;
    }

    private Set<UUID> addCommand(UUID commandId) {
        Set<UUID> updatedCommands =
                new HashSet<>(processedCommandIds);
        updatedCommands.add(Objects.requireNonNull(commandId));
        return updatedCommands;
    }

    private GameAction pendingQuestion() {
        if (actions.isEmpty()) {
            return null;
        }
        GameAction lastAction =
                actions.get(actions.size() - 1);
        return lastAction.isPendingQuestion() ? lastAction : null;
    }

    private void rejectDuplicateCommand(UUID commandId) {
        Objects.requireNonNull(commandId);
        if (processedCommandIds.contains(commandId)) {
            throw new GameRuleException(DUPLICATE_COMMAND);
        }
    }

    private void requireInProgress() {
        if (status != IN_PROGRESS) {
            throw new GameRuleException(INVALID_GAME_STATE);
        }
    }

    private void requireRole(UUID userId, GameRole expectedRole) {
        if (roleOf(userId) != expectedRole) {
            throw new GameRuleException(INVALID_ROLE);
        }
    }

    private GameRole roleOf(UUID userId) {
        Objects.requireNonNull(userId);
        if (selectorUserId.equals(userId)) {
            return SELECTOR;
        }
        if (questionerUserId.equals(userId)) {
            return QUESTIONER;
        }
        throw new GameRuleException(INVALID_ROLE);
    }

    private void requireActionAvailable() {
        if (actionCount >= MAX_ACTION_COUNT) {
            throw new GameRuleException(ACTION_LIMIT_REACHED);
        }
    }

    private String normalizeQuestion(String questionInput) {
        if (questionInput == null) {
            throw new GameRuleException(VALIDATION_FAILED);
        }
        String normalized =
                Normalizer.normalize(
                        questionInput.strip(),
                        Normalizer.Form.NFC);
        int codePointLength =
                normalized.codePointCount(0, normalized.length());
        if (codePointLength < 1
                || codePointLength > MAX_QUESTION_LENGTH) {
            throw new GameRuleException(VALIDATION_FAILED);
        }
        return normalized;
    }

    private void validateLifecycle() {
        if (status == IN_PROGRESS) {
            if (endReason != null
                    || winnerUserId != null
                    || loserUserId != null
                    || endedAt != null) {
                throw new IllegalArgumentException(
                        "진행 중 game 종료 정보가 있습니다.");
            }
            return;
        }
        if (status != COMPLETED
                || endReason == null
                || winnerUserId == null
                || loserUserId == null
                || winnerUserId.equals(loserUserId)
                || endedAt == null
                || endedAt.isBefore(startedAt)) {
            throw new IllegalArgumentException(
                    "완료 game lifecycle이 올바르지 않습니다.");
        }
    }

    private static ActionView toActionView(GameAction action) {
        return new ActionView(
                action.sequenceNumber(),
                action.type(),
                action.question(),
                action.answer(),
                action.guessedPokemonId(),
                action.correct(),
                action.createdAt(),
                action.answeredAt());
    }

    record Transition(
            Game previous,
            Game candidate,
            GameAction changedAction) {

        Transition {
            Objects.requireNonNull(previous);
            Objects.requireNonNull(candidate);
            Objects.requireNonNull(changedAction);
        }
    }
}
