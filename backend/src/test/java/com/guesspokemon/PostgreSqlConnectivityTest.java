package com.guesspokemon;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class PostgreSqlConnectivityTest {

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void should_returnOne_when_postgresqlIsAvailable() {
        Integer result = jdbcClient.sql("SELECT 1").query(Integer.class).single();

        assertEquals(1, result);
    }
}
