package com.guesspokemon.ops;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MigrationMainTest {

    @Test
    void should_buildIsolatedFlywayConfiguration_when_requiredEnvironmentIsPresent() {
        MigrationMain.MigrationSettings settings =
                MigrationMain.MigrationSettings.from(Map.of(
                        "SPRING_DATASOURCE_URL", "jdbc:postgresql://db:5432/guess_pokemon",
                        "SPRING_DATASOURCE_USERNAME", "guess_pokemon",
                        "SPRING_DATASOURCE_PASSWORD", "test-password"
                ));

        var configuration = MigrationMain.createFlyway(settings).getConfiguration();

        assertEquals("jdbc:postgresql://db:5432/guess_pokemon", settings.url());
        assertEquals("guess_pokemon", settings.username());
        assertFalse(configuration.isBaselineOnMigrate());
        assertTrue(
                Arrays.stream(configuration.getLocations())
                        .map(Object::toString)
                        .anyMatch("classpath:db/migration"::equals)
        );
    }

    @Test
    void should_rejectMigrationStartup_when_requiredEnvironmentIsBlank() {
        Map<String, String> environment = Map.of(
                "SPRING_DATASOURCE_URL", "jdbc:postgresql://db:5432/guess_pokemon",
                "SPRING_DATASOURCE_USERNAME", "guess_pokemon",
                "SPRING_DATASOURCE_PASSWORD", " "
        );

        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                () -> MigrationMain.MigrationSettings.from(environment)
        );

        assertTrue(exception.getMessage().contains("SPRING_DATASOURCE_PASSWORD"));
    }
}
