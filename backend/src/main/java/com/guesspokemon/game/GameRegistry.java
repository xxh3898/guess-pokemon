package com.guesspokemon.game;

import static com.guesspokemon.game.GameRuleException.GameRuleError.DUPLICATE_COMMAND;
import static com.guesspokemon.game.GameRuleException.GameRuleError.INVALID_GAME_STATE;
import static com.guesspokemon.game.GameRuleException.GameRuleError.VALIDATION_FAILED;
import static com.guesspokemon.game.GameTypes.GameStatus.IN_PROGRESS;

import com.guesspokemon.game.GameViews.ParticipantGameView;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

@Component
final class GameRegistry {

    private static final int MAX_TRACKED_GAMES = 1_000;

    private final Map<String, Game> gamesByRoomCode =
            new HashMap<>();
    private final ReentrantLock commandLock = new ReentrantLock();

    Game start(
            String roomCodeInput,
            UUID commandId,
            Supplier<Game> candidateFactory,
            Consumer<Game> persistence) {
        String roomCode = normalizeRoomCode(roomCodeInput);
        commandLock.lock();
        try {
            Game current = gamesByRoomCode.get(roomCode);
            if (current != null) {
                if (current.hasProcessedCommand(commandId)) {
                    throw new GameRuleException(DUPLICATE_COMMAND);
                }
                if (current.status() == IN_PROGRESS) {
                    throw new GameRuleException(INVALID_GAME_STATE);
                }
            } else if (gamesByRoomCode.size() >= MAX_TRACKED_GAMES) {
                throw new GameRuleException(INVALID_GAME_STATE);
            }

            Game candidate = candidateFactory.get();
            persistence.accept(candidate);
            gamesByRoomCode.put(roomCode, candidate);
            return candidate;
        } finally {
            commandLock.unlock();
        }
    }

    Game transition(
            String roomCodeInput,
            Function<Game, Game.Transition> transitionFactory,
            Consumer<Game.Transition> persistence) {
        String roomCode = normalizeRoomCode(roomCodeInput);
        commandLock.lock();
        try {
            Game current = requireGame(roomCode);
            Game.Transition transition =
                    transitionFactory.apply(current);
            persistence.accept(transition);
            gamesByRoomCode.put(
                    roomCode,
                    transition.candidate());
            return transition.candidate();
        } finally {
            commandLock.unlock();
        }
    }

    Game end(
            String roomCodeInput,
            Function<Game, Game.LifecycleTransition>
                    transitionFactory,
            Consumer<Game.LifecycleTransition> persistence) {
        String roomCode = normalizeRoomCode(roomCodeInput);
        commandLock.lock();
        try {
            Game current = requireGame(roomCode);
            Game.LifecycleTransition transition =
                    transitionFactory.apply(current);
            persistence.accept(transition);
            gamesByRoomCode.put(
                    roomCode,
                    transition.candidate());
            return transition.candidate();
        } finally {
            commandLock.unlock();
        }
    }

    ParticipantGameView viewFor(
            String roomCodeInput,
            UUID userId) {
        String roomCode = normalizeRoomCode(roomCodeInput);
        commandLock.lock();
        try {
            return requireGame(roomCode).viewFor(userId);
        } finally {
            commandLock.unlock();
        }
    }

    void remove(String roomCodeInput) {
        String roomCode = normalizeRoomCode(roomCodeInput);
        commandLock.lock();
        try {
            gamesByRoomCode.remove(roomCode);
        } finally {
            commandLock.unlock();
        }
    }

    private Game requireGame(String roomCode) {
        Game game = gamesByRoomCode.get(roomCode);
        if (game == null) {
            throw new GameRuleException(INVALID_GAME_STATE);
        }
        return game;
    }

    private String normalizeRoomCode(String roomCodeInput) {
        if (roomCodeInput == null) {
            throw new GameRuleException(VALIDATION_FAILED);
        }
        String roomCode =
                roomCodeInput.strip().toUpperCase(Locale.ROOT);
        if (roomCode.isEmpty()) {
            throw new GameRuleException(VALIDATION_FAILED);
        }
        return roomCode;
    }
}
