package com.guesspokemon.game;

import static com.guesspokemon.game.GameRuleException.GameRuleError.DUPLICATE_COMMAND;
import static com.guesspokemon.game.GameRuleException.GameRuleError.POKEMON_NOT_FOUND;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;

import com.guesspokemon.game.GameCommands.AnswerQuestionCommand;
import com.guesspokemon.game.GameCommands.AskQuestionCommand;
import com.guesspokemon.game.GameCommands.GuessPokemonCommand;
import com.guesspokemon.game.GameCommands.EndGameCommand;
import com.guesspokemon.game.GameCommands.StartGameCommand;
import com.guesspokemon.game.GamePersistencePort.ActionState;
import com.guesspokemon.game.GamePersistencePort.GameState;
import com.guesspokemon.game.GamePersistencePort.ParticipantState;
import com.guesspokemon.game.GameViews.ParticipantGameView;
import com.guesspokemon.pokemon.PokemonSpeciesRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

@Service
public class GameCommandService {

    private final GameRegistry gameRegistry;
    private final GamePersistencePort gamePersistencePort;
    private final PokemonSpeciesRepository pokemonSpeciesRepository;
    private final Clock clock;

    public GameCommandService(
            GameRegistry gameRegistry,
            GamePersistencePort gamePersistencePort,
            PokemonSpeciesRepository pokemonSpeciesRepository,
            Clock clock) {
        this.gameRegistry = gameRegistry;
        this.gamePersistencePort = gamePersistencePort;
        this.pokemonSpeciesRepository = pokemonSpeciesRepository;
        this.clock = clock;
    }

    public ParticipantGameView startGame(
            StartGameCommand command) {
        requireEnabledPokemon(
                command.answerPokemonNationalDexId());
        Instant now = currentTime();
        Game game =
                gameRegistry.start(
                        command.roomCode(),
                        command.commandId(),
                        () ->
                                Game.start(
                                        UUID.randomUUID(),
                                        command.roundGroupId(),
                                        command.selectorUserId(),
                                        command.questionerUserId(),
                                        command.answerPokemonNationalDexId(),
                                        command.commandId(),
                                        command.initialStateVersion(),
                                        now),
                        candidate ->
                                gamePersistencePort.createGame(
                                        toGameState(candidate)));
        return game.viewFor(command.selectorUserId());
    }

    public ParticipantGameView askQuestion(
            AskQuestionCommand command) {
        return askQuestion(command, null);
    }

    public ParticipantGameView askQuestion(
            AskQuestionCommand command,
            long targetStateVersion) {
        return askQuestion(
                command,
                Long.valueOf(targetStateVersion));
    }

    private ParticipantGameView askQuestion(
            AskQuestionCommand command,
            Long targetStateVersion) {
        Game game =
                gameRegistry.transition(
                        command.roomCode(),
                        current ->
                                targetStateVersion == null
                                        ? current.ask(
                                                command.userId(),
                                                command.commandId(),
                                                UUID.randomUUID(),
                                                command.question(),
                                                currentTime())
                                        : current.ask(
                                                command.userId(),
                                                command.commandId(),
                                                UUID.randomUUID(),
                                                command.question(),
                                                targetStateVersion,
                                                currentTime()),
                        transition ->
                                persistNewAction(
                                        command.commandId(),
                                        transition));
        return game.viewFor(command.userId());
    }

    public ParticipantGameView answerQuestion(
            AnswerQuestionCommand command) {
        return answerQuestion(command, null);
    }

    public ParticipantGameView answerQuestion(
            AnswerQuestionCommand command,
            long targetStateVersion) {
        return answerQuestion(
                command,
                Long.valueOf(targetStateVersion));
    }

    private ParticipantGameView answerQuestion(
            AnswerQuestionCommand command,
            Long targetStateVersion) {
        Game game =
                gameRegistry.transition(
                        command.roomCode(),
                        current ->
                                targetStateVersion == null
                                        ? current.answer(
                                                command.userId(),
                                                command.commandId(),
                                                command.answer(),
                                                command.comment(),
                                                currentTime())
                                        : current.answer(
                                                command.userId(),
                                                command.commandId(),
                                                command.answer(),
                                                command.comment(),
                                                targetStateVersion,
                                                currentTime()),
                        transition ->
                                gamePersistencePort
                                        .updateAnsweredQuestion(
                                                transition
                                                        .previous()
                                                        .stateVersion(),
                                                toGameState(
                                                        transition
                                                                .candidate()),
                                                toActionState(
                                                        transition
                                                                .changedAction())));
        return game.viewFor(command.userId());
    }

    public ParticipantGameView guessPokemon(
            GuessPokemonCommand command) {
        return guessPokemon(command, null);
    }

    public ParticipantGameView guessPokemon(
            GuessPokemonCommand command,
            long targetStateVersion) {
        return guessPokemon(
                command,
                Long.valueOf(targetStateVersion));
    }

    private ParticipantGameView guessPokemon(
            GuessPokemonCommand command,
            Long targetStateVersion) {
        requireEnabledPokemon(
                command.guessedPokemonNationalDexId());
        Game game =
                gameRegistry.transition(
                        command.roomCode(),
                        current ->
                                targetStateVersion == null
                                        ? current.guess(
                                                command.userId(),
                                                command.commandId(),
                                                UUID.randomUUID(),
                                                command.guessedPokemonNationalDexId(),
                                                currentTime())
                                        : current.guess(
                                                command.userId(),
                                                command.commandId(),
                                                UUID.randomUUID(),
                                                command.guessedPokemonNationalDexId(),
                                                targetStateVersion,
                                                currentTime()),
                        transition ->
                                persistNewAction(
                                        command.commandId(),
                                        transition));
        return game.viewFor(command.userId());
    }

    public ParticipantGameView endGame(
            EndGameCommand command,
            UUID viewerUserId) {
        Game game =
                gameRegistry.end(
                        command.roomCode(),
                        current ->
                                current.end(
                                        command.disconnectedUserId(),
                                        command.commandId(),
                                        command.endReason(),
                                        command.targetStateVersion(),
                                        currentTime()),
                        transition ->
                                gamePersistencePort.updateGame(
                                        transition
                                                .previous()
                                                .stateVersion(),
                                        toGameState(
                                                transition.candidate())));
        return game.viewFor(viewerUserId);
    }

    public ParticipantGameView getView(
            String roomCode,
            UUID userId) {
        return gameRegistry.viewFor(roomCode, userId);
    }

    public void removeGame(String roomCode) {
        gameRegistry.remove(roomCode);
    }

    private void persistNewAction(
            UUID commandId,
            Game.Transition transition) {
        persistAction(
                commandId,
                () ->
                        gamePersistencePort.appendAction(
                                transition
                                        .previous()
                                        .stateVersion(),
                                toGameState(
                                        transition.candidate()),
                                toActionState(
                                        transition.changedAction())));
    }

    private void persistAction(
            UUID commandId,
            Runnable persistenceAction) {
        try {
            persistenceAction.run();
        } catch (DataIntegrityViolationException exception) {
            if (gamePersistencePort
                    .actionCommandExists(commandId)) {
                throw new GameRuleException(
                        DUPLICATE_COMMAND,
                        exception);
            }
            throw exception;
        }
    }

    private void requireEnabledPokemon(int nationalDexId) {
        if (pokemonSpeciesRepository
                .findByNationalDexIdAndEnabledTrue(nationalDexId)
                .isEmpty()) {
            throw new GameRuleException(POKEMON_NOT_FOUND);
        }
    }

    private Instant currentTime() {
        return clock.instant()
                .truncatedTo(ChronoUnit.MICROS);
    }

    private GameState toGameState(Game game) {
        return new GameState(
                game.id(),
                game.roundGroupId(),
                game.answerPokemonId(),
                game.status(),
                game.endReason(),
                game.actionCount(),
                game.stateVersion(),
                game.startedAt(),
                game.endedAt(),
                List.of(
                        new ParticipantState(
                                game.selectorUserId(),
                                SELECTOR,
                                game.resultFor(
                                        game.selectorUserId()),
                                game.startedAt()),
                        new ParticipantState(
                                game.questionerUserId(),
                                QUESTIONER,
                                game.resultFor(
                                        game.questionerUserId()),
                                game.startedAt())));
    }

    private ActionState toActionState(GameAction action) {
        return new ActionState(
                action.id(),
                action.commandId(),
                action.actorUserId(),
                action.sequenceNumber(),
                action.type(),
                action.question(),
                action.answer(),
                action.comment(),
                action.guessedPokemonId(),
                action.correct(),
                action.createdAt(),
                action.answeredAt());
    }
}
