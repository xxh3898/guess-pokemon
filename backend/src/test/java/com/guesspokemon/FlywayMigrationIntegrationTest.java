package com.guesspokemon;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class FlywayMigrationIntegrationTest {

    private static final String UPGRADE_SCHEMA =
            "pokemon_type_upgrade_test";
    private static final String ANSWER_COMMENT_UPGRADE_SCHEMA =
            "answer_comment_upgrade_test";
    private static final String EVOLUTION_UPGRADE_SCHEMA =
            "pokemon_evolution_upgrade_test";

    @Autowired
    private JdbcClient jdbcClient;

    @Autowired
    private Flyway flyway;

    @Autowired
    private DataSource dataSource;

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
        assertEquals(6L, historyCount);
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

    @Test
    void should_createPokemonTypeColumnsAndConstraints_when_v4MigrationRuns() {
        Long columnCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM information_schema.columns
                                WHERE table_schema = 'public'
                                  AND table_name = 'pokemon_species'
                                  AND column_name IN (
                                      'primary_type',
                                      'secondary_type'
                                  )
                                """)
                        .query(Long.class)
                        .single();
        Long constraintCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM information_schema.table_constraints
                                WHERE table_schema = 'public'
                                  AND table_name = 'pokemon_species'
                                  AND constraint_name IN (
                                      'ck_pokemon_species_primary_type',
                                      'ck_pokemon_species_secondary_type',
                                      'ck_pokemon_species_secondary_requires_primary',
                                      'ck_pokemon_species_types_distinct',
                                      'ck_pokemon_species_enabled_primary_type'
                                  )
                                """)
                        .query(Long.class)
                        .single();
        Long dualTypeCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM pokemon_species
                                WHERE secondary_type IS NOT NULL
                                """)
                        .query(Long.class)
                        .single();

        assertEquals(2L, columnCount);
        assertEquals(5L, constraintCount);
        assertEquals(526L, dualTypeCount);
    }

    @Test
    void should_createAnswerCommentColumnAndConstraint_when_v5MigrationRuns() {
        Long columnCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM information_schema.columns
                                WHERE table_schema = 'public'
                                  AND table_name = 'game_action'
                                  AND column_name = 'answer_comment'
                                  AND is_nullable = 'YES'
                                  AND character_maximum_length = 200
                                """)
                        .query(Long.class)
                        .single();
        Boolean constraintValidated =
                jdbcClient
                        .sql(
                                """
                                SELECT convalidated
                                FROM pg_constraint
                                WHERE conname =
                                    'ck_game_action_answer_comment'
                                  AND connamespace =
                                    'public'::regnamespace
                                """)
                        .query(Boolean.class)
                        .single();

        assertEquals(1L, columnCount);
        assertTrue(constraintValidated);
    }

    @Test
    void should_createEvolutionColumnConstraintsAndIndex_when_v6MigrationRuns() {
        Long columnCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM information_schema.columns
                                WHERE table_schema = 'public'
                                  AND table_name = 'pokemon_species'
                                  AND column_name =
                                      'evolves_from_national_dex_id'
                                  AND data_type = 'integer'
                                  AND is_nullable = 'YES'
                                """)
                        .query(Long.class)
                        .single();
        Long constraintCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM information_schema.table_constraints
                                WHERE table_schema = 'public'
                                  AND table_name = 'pokemon_species'
                                  AND constraint_name IN (
                                      'fk_pokemon_species_evolves_from',
                                      'ck_pokemon_species_evolves_from_not_self'
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
                                  AND indexname =
                                      'ix_pokemon_species_evolves_from'
                                """)
                        .query(Long.class)
                        .single();

        assertEquals(1L, columnCount);
        assertEquals(2L, constraintCount);
        assertEquals(1L, indexCount);
    }

    @Test
    void should_disableExistingCatalogRows_when_v3DatabaseMigratesToV4() {
        Flyway legacyFlyway =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(UPGRADE_SCHEMA)
                        .defaultSchema(UPGRADE_SCHEMA)
                        .target("3")
                        .load();
        assertEquals(
                3,
                legacyFlyway.migrate().migrationsExecuted);
        JdbcClient upgradeJdbcClient = JdbcClient.create(dataSource);
        upgradeJdbcClient
                .sql(
                        """
                        INSERT INTO %s.pokemon_species (
                            national_dex_id,
                            slug,
                            korean_name,
                            generation,
                            artwork_url,
                            catalog_version,
                            source_updated_at,
                            enabled
                        )
                        VALUES (
                            25,
                            'pikachu',
                            '피카츄',
                            1,
                            'https://example.test/25.png',
                            'pokeapi-v2-legacy',
                            CURRENT_TIMESTAMP,
                            TRUE
                        )
                        """
                                .formatted(UPGRADE_SCHEMA))
                .update();

        Flyway currentFlyway =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(UPGRADE_SCHEMA)
                        .defaultSchema(UPGRADE_SCHEMA)
                        .target("4")
                        .load();
        assertEquals(
                1,
                currentFlyway.migrate().migrationsExecuted);

        Long disabledUntypedCount =
                upgradeJdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM %s.pokemon_species
                                WHERE national_dex_id = 25
                                  AND enabled = FALSE
                                  AND primary_type IS NULL
                                  AND secondary_type IS NULL
                                """
                                        .formatted(UPGRADE_SCHEMA))
                        .query(Long.class)
                        .single();
        Boolean enabledConstraintValidated =
                upgradeJdbcClient
                        .sql(
                                """
                                SELECT convalidated
                                FROM pg_constraint
                                WHERE conname =
                                    'ck_pokemon_species_enabled_primary_type'
                                  AND connamespace =
                                    CAST(:schema AS regnamespace)
                                """)
                        .param("schema", UPGRADE_SCHEMA)
                        .query(Boolean.class)
                        .single();

        assertEquals(1L, disabledUntypedCount);
        assertTrue(enabledConstraintValidated);
        assertFalse(
                upgradeJdbcClient
                                .sql(
                                        """
                                        SELECT enabled
                                        FROM %s.pokemon_species
                                        WHERE national_dex_id = 25
                                        """
                                                .formatted(UPGRADE_SCHEMA))
                                .query(Boolean.class)
                                .single());
    }

    @Test
    void should_preserveExistingActionWithoutComment_when_v4DatabaseMigratesToV5() {
        Flyway legacyFlyway =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(ANSWER_COMMENT_UPGRADE_SCHEMA)
                        .defaultSchema(ANSWER_COMMENT_UPGRADE_SCHEMA)
                        .target("4")
                        .load();
        assertEquals(
                4,
                legacyFlyway.migrate().migrationsExecuted);
        JdbcClient upgradeJdbcClient = JdbcClient.create(dataSource);
        insertV4AnsweredQuestion(upgradeJdbcClient);

        Flyway currentFlyway =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(ANSWER_COMMENT_UPGRADE_SCHEMA)
                        .defaultSchema(ANSWER_COMMENT_UPGRADE_SCHEMA)
                        .target("5")
                        .load();
        assertEquals(
                1,
                currentFlyway.migrate().migrationsExecuted);

        Long preservedActionCount =
                upgradeJdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM %s.game_action
                                WHERE id =
                                    '55555555-5555-4555-8555-555555555555'
                                  AND answer = 'NO'
                                  AND answer_comment IS NULL
                                """
                                        .formatted(
                                                ANSWER_COMMENT_UPGRADE_SCHEMA))
                        .query(Long.class)
                        .single();
        Boolean constraintValidated =
                upgradeJdbcClient
                        .sql(
                                """
                                SELECT convalidated
                                FROM pg_constraint
                                WHERE conname =
                                    'ck_game_action_answer_comment'
                                  AND connamespace =
                                    CAST(:schema AS regnamespace)
                                """)
                        .param(
                                "schema",
                                ANSWER_COMMENT_UPGRADE_SCHEMA)
                        .query(Boolean.class)
                        .single();

        assertEquals(1L, preservedActionCount);
        assertTrue(constraintValidated);
    }

    @Test
    void should_preserveExistingCatalogRows_when_v5DatabaseMigratesToV6() {
        Flyway legacyFlyway =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(EVOLUTION_UPGRADE_SCHEMA)
                        .defaultSchema(EVOLUTION_UPGRADE_SCHEMA)
                        .target("5")
                        .load();
        assertEquals(
                5,
                legacyFlyway.migrate().migrationsExecuted);
        JdbcClient upgradeJdbcClient = JdbcClient.create(dataSource);
        upgradeJdbcClient
                .sql(
                        """
                        INSERT INTO %s.pokemon_species (
                            national_dex_id,
                            slug,
                            korean_name,
                            generation,
                            primary_type,
                            secondary_type,
                            artwork_url,
                            catalog_version,
                            source_updated_at,
                            enabled
                        )
                        VALUES
                            (
                                25,
                                'pikachu',
                                '피카츄',
                                1,
                                'ELECTRIC',
                                NULL,
                                'https://example.test/25.png',
                                'pokeapi-v2-upgrade',
                                CURRENT_TIMESTAMP,
                                TRUE
                            ),
                            (
                                172,
                                'pichu',
                                '피츄',
                                2,
                                'ELECTRIC',
                                NULL,
                                'https://example.test/172.png',
                                'pokeapi-v2-upgrade',
                                CURRENT_TIMESTAMP,
                                TRUE
                            )
                        """
                                .formatted(EVOLUTION_UPGRADE_SCHEMA))
                .update();

        Flyway currentFlyway =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(EVOLUTION_UPGRADE_SCHEMA)
                        .defaultSchema(EVOLUTION_UPGRADE_SCHEMA)
                        .load();
        assertEquals(
                1,
                currentFlyway.migrate().migrationsExecuted);

        Long preservedRowCount =
                upgradeJdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM %s.pokemon_species
                                WHERE national_dex_id IN (25, 172)
                                  AND evolves_from_national_dex_id IS NULL
                                """
                                        .formatted(
                                                EVOLUTION_UPGRADE_SCHEMA))
                        .query(Long.class)
                        .single();

        assertEquals(2L, preservedRowCount);
    }

    private void insertV4AnsweredQuestion(
            JdbcClient upgradeJdbcClient) {
        upgradeJdbcClient
                .sql(
                        """
                        INSERT INTO %s.pokemon_species (
                            national_dex_id,
                            slug,
                            korean_name,
                            generation,
                            artwork_url,
                            catalog_version,
                            source_updated_at,
                            enabled,
                            primary_type,
                            secondary_type
                        )
                        VALUES (
                            25,
                            'pikachu',
                            '피카츄',
                            1,
                            'https://example.test/25.png',
                            'pokeapi-v2-upgrade',
                            CURRENT_TIMESTAMP,
                            TRUE,
                            'ELECTRIC',
                            NULL
                        )
                        """
                                .formatted(
                                        ANSWER_COMMENT_UPGRADE_SCHEMA))
                .update();
        upgradeJdbcClient
                .sql(
                        """
                        INSERT INTO %s.app_user (
                            id,
                            login_id,
                            login_id_key,
                            nickname,
                            nickname_key,
                            password_hash,
                            status,
                            created_at,
                            updated_at
                        )
                        VALUES
                            (
                                '11111111-1111-4111-8111-111111111111',
                                'selector_test',
                                'selector_test',
                                '출제자',
                                '출제자',
                                'test-password-hash',
                                'ACTIVE',
                                CURRENT_TIMESTAMP,
                                CURRENT_TIMESTAMP
                            ),
                            (
                                '22222222-2222-4222-8222-222222222222',
                                'questioner_test',
                                'questioner_test',
                                '질문자',
                                '질문자',
                                'test-password-hash',
                                'ACTIVE',
                                CURRENT_TIMESTAMP,
                                CURRENT_TIMESTAMP
                            )
                        """
                                .formatted(
                                        ANSWER_COMMENT_UPGRADE_SCHEMA))
                .update();
        upgradeJdbcClient
                .sql(
                        """
                        INSERT INTO %s.game (
                            id,
                            round_group_id,
                            answer_pokemon_id,
                            status,
                            end_reason,
                            action_count,
                            state_version,
                            started_at,
                            ended_at,
                            created_at,
                            updated_at
                        )
                        VALUES (
                            '33333333-3333-4333-8333-333333333333',
                            '44444444-4444-4444-8444-444444444444',
                            25,
                            'IN_PROGRESS',
                            NULL,
                            1,
                            5,
                            CURRENT_TIMESTAMP,
                            NULL,
                            CURRENT_TIMESTAMP,
                            CURRENT_TIMESTAMP
                        )
                        """
                                .formatted(
                                        ANSWER_COMMENT_UPGRADE_SCHEMA))
                .update();
        upgradeJdbcClient
                .sql(
                        """
                        INSERT INTO %s.game_participant (
                            game_id,
                            user_id,
                            role,
                            result,
                            created_at
                        )
                        VALUES
                            (
                                '33333333-3333-4333-8333-333333333333',
                                '11111111-1111-4111-8111-111111111111',
                                'SELECTOR',
                                'NONE',
                                CURRENT_TIMESTAMP
                            ),
                            (
                                '33333333-3333-4333-8333-333333333333',
                                '22222222-2222-4222-8222-222222222222',
                                'QUESTIONER',
                                'NONE',
                                CURRENT_TIMESTAMP
                            )
                        """
                                .formatted(
                                        ANSWER_COMMENT_UPGRADE_SCHEMA))
                .update();
        upgradeJdbcClient
                .sql(
                        """
                        INSERT INTO %s.game_action (
                            id,
                            command_id,
                            game_id,
                            actor_user_id,
                            sequence_no,
                            action_type,
                            question_text,
                            answer,
                            guessed_pokemon_id,
                            correct,
                            created_at,
                            answered_at
                        )
                        VALUES (
                            '55555555-5555-4555-8555-555555555555',
                            '66666666-6666-4666-8666-666666666666',
                            '33333333-3333-4333-8333-333333333333',
                            '22222222-2222-4222-8222-222222222222',
                            1,
                            'QUESTION',
                            '전기 타입인가요?',
                            'NO',
                            NULL,
                            NULL,
                            CURRENT_TIMESTAMP,
                            CURRENT_TIMESTAMP
                        )
                        """
                                .formatted(
                                        ANSWER_COMMENT_UPGRADE_SCHEMA))
                .update();
    }
}
