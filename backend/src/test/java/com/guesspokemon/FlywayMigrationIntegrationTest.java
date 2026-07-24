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
    void should_createUserAndSessionTables_when_v1MigrationRuns() {
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
                                      'spring_session_attributes'
                                  )
                                """)
                        .query(Long.class)
                        .single();

        assertEquals(3L, tableCount);
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
        assertEquals(1L, historyCount);
    }
}
