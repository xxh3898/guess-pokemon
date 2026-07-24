package com.guesspokemon.history;

import com.guesspokemon.game.GamePersistencePort;
import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class GameRestartRecovery
        implements ApplicationRunner {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(GameRestartRecovery.class);

    private final GamePersistencePort gamePersistencePort;
    private final Clock clock;

    public GameRestartRecovery(
            GamePersistencePort gamePersistencePort,
            Clock clock) {
        this.gamePersistencePort = gamePersistencePort;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        int abortedCount =
                gamePersistencePort.abortInProgressGames(
                        clock.instant());
        if (abortedCount > 0) {
            LOGGER.info(
                    "Games aborted after server restart count={}",
                    abortedCount);
        }
    }
}
