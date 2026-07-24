package com.guesspokemon;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class GuessPokemonApplicationIntegrationTest {

    @Test
    void should_loadApplicationContext_when_started() {
    }
}
