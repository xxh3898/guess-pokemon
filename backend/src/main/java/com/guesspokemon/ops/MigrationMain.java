package com.guesspokemon.ops;

import java.util.Map;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.output.MigrateResult;

/** Runs only Flyway for the exact candidate API image before application cutover. */
public final class MigrationMain {

    private static final String DATASOURCE_URL = "SPRING_DATASOURCE_URL";
    private static final String DATASOURCE_USERNAME = "SPRING_DATASOURCE_USERNAME";
    private static final String DATASOURCE_PASSWORD = "SPRING_DATASOURCE_PASSWORD";

    private MigrationMain() {
    }

    public static void main(String[] args) {
        MigrationSettings settings = MigrationSettings.from(System.getenv());
        Flyway flyway = createFlyway(settings);
        MigrateResult result = flyway.migrate();
        flyway.validate();
        System.out.printf(
                "Flyway one-shot migration completed: executed=%d%n",
                result.migrationsExecuted
        );
    }

    static Flyway createFlyway(MigrationSettings settings) {
        return Flyway.configure()
                .dataSource(settings.url(), settings.username(), settings.password())
                .locations("classpath:db/migration")
                .load();
    }

    record MigrationSettings(String url, String username, String password) {

        static MigrationSettings from(Map<String, String> environment) {
            return new MigrationSettings(
                    required(environment, DATASOURCE_URL),
                    required(environment, DATASOURCE_USERNAME),
                    required(environment, DATASOURCE_PASSWORD)
            );
        }

        private static String required(Map<String, String> environment, String name) {
            String value = environment.get(name);
            if (value == null || value.isBlank()) {
                throw new IllegalArgumentException(
                        "Required migration environment is missing: " + name
                );
            }
            return value;
        }
    }
}
