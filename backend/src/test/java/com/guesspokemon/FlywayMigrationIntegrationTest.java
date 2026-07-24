package com.guesspokemon;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
    void should_createUserSessionCatalogAndGameTables_when_migrationsRun() {
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
                                      'pokemon_species',
                                      'game',
                                      'game_participant',
                                      'game_action'
                                  )
                                """)
                        .query(Long.class)
                        .single();

        assertEquals(7L, tableCount);
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
        assertEquals(3L, historyCount);
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

    @Test
    void should_createGameConstraintsAndIndexes_when_v3MigrationRuns() {
        Long constraintCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM information_schema.table_constraints
                                WHERE table_schema = 'public'
                                  AND table_name IN (
                                      'game',
                                      'game_participant',
                                      'game_action'
                                  )
                                  AND constraint_name IN (
                                      'pk_game',
                                      'fk_game_answer_pokemon',
                                      'ck_game_status',
                                      'ck_game_end_reason',
                                      'ck_game_action_count',
                                      'ck_game_state_version',
                                      'ck_game_lifecycle',
                                      'ck_game_timestamps',
                                      'pk_game_participant',
                                      'fk_game_participant_game',
                                      'fk_game_participant_user',
                                      'uk_game_participant_game_role',
                                      'ck_game_participant_role',
                                      'ck_game_participant_result',
                                      'pk_game_action',
                                      'uk_game_action_command_id',
                                      'uk_game_action_game_sequence',
                                      'fk_game_action_game',
                                      'fk_game_action_actor_participant',
                                      'fk_game_action_guessed_pokemon',
                                      'ck_game_action_sequence',
                                      'ck_game_action_type',
                                      'ck_game_action_answer',
                                      'ck_game_action_shape',
                                      'ck_game_action_timestamps'
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
                                  AND (
                                      (
                                          tablename = 'game'
                                          AND indexname IN (
                                              'ix_game_round_group_id',
                                              'ix_game_status_updated_at',
                                              'ix_game_ended_at_desc'
                                          )
                                      )
                                      OR (
                                          tablename = 'game_participant'
                                          AND indexname =
                                              'ix_game_participant_user_game'
                                      )
                                  )
                                """)
                        .query(Long.class)
                        .single();
        String endedAtIndex =
                jdbcClient
                        .sql(
                                """
                                SELECT indexdef
                                FROM pg_indexes
                                WHERE schemaname = 'public'
                                  AND tablename = 'game'
                                  AND indexname = 'ix_game_ended_at_desc'
                                """)
                        .query(String.class)
                        .single();

        assertEquals(25L, constraintCount);
        assertEquals(4L, indexCount);
        assertTrue(endedAtIndex.contains("ended_at DESC"));
    }
}
