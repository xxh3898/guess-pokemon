package com.guesspokemon;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class FlywayMigrationIntegrationTest {

    @Autowired
    private JdbcClient jdbcClient;

    @Autowired
    private Flyway flyway;

    @Test
    void should_createUserSessionAndCatalogTables_when_migrationsRun() {
        Long tableCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM information_schema.tables
                                WHERE table_schema = 'public'
                                  AND table_name IN (
                                      'app_user',
                                      'spring_session',
                                      'spring_session_attributes',
                                      'pokemon_species'
                                  )
                                """)
                        .query(Long.class)
                        .single();

        assertEquals(4L, tableCount);
    }

    @Test
    void should_keepSchemaUnchanged_when_migrateRunsAgain() {
        int migrationsExecuted = flyway.migrate().migrationsExecuted;
        Long historyCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM flyway_schema_history
                                WHERE success = true
                                """)
                        .query(Long.class)
                        .single();

        assertEquals(0, migrationsExecuted);
        assertEquals(2L, historyCount);
    }

    @Test
    void should_createCatalogConstraintsAndIndexes_when_v2MigrationRuns() {
        Long constraintCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM information_schema.table_constraints
                                WHERE table_schema = 'public'
                                  AND table_name = 'pokemon_species'
                                  AND constraint_name IN (
                                      'pk_pokemon_species',
                                      'uk_pokemon_species_slug',
                                      'uk_pokemon_species_korean_name',
                                      'ck_pokemon_species_national_dex_id',
                                      'ck_pokemon_species_slug',
                                      'ck_pokemon_species_korean_name',
                                      'ck_pokemon_species_generation',
                                      'ck_pokemon_species_artwork_url',
                                      'ck_pokemon_species_catalog_version'
                                  )
                                """)
                        .query(Long.class)
                        .single();
        Long indexCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM pg_indexes
                                WHERE schemaname = 'public'
                                  AND tablename = 'pokemon_species'
                                  AND indexname IN (
                                      'ix_pokemon_species_korean_name',
                                      'ix_pokemon_species_generation_national_dex_id'
                                  )
                                """)
                        .query(Long.class)
                        .single();

        assertEquals(9L, constraintCount);
        assertEquals(2L, indexCount);
    }
}
