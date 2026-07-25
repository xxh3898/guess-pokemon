package com.guesspokemon.history;

import static com.guesspokemon.game.GameTypes.GameEndReason.PLAYER_LEFT;
import static com.guesspokemon.game.GameTypes.GameResult.LOSS;
import static com.guesspokemon.game.GameTypes.GameResult.WIN;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.security.AuthenticatedUser;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(
        properties =
                "pokemon.catalog.artwork-enabled=false")
@AutoConfigureMockMvc
@Import(PostgreSqlTestContainerConfiguration.class)
@Transactional
class GameHistoryArtworkDisabledApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcClient jdbcClient;

    @Autowired
    private AppUserRepository appUserRepository;

    private GameHistoryTestFixture fixture;

    @BeforeEach
    void setUp() {
        fixture =
                new GameHistoryTestFixture(
                        jdbcClient,
                        appUserRepository);
    }

    @Test
    void should_hideArtwork_when_globalArtworkFlagIsDisabled()
            throws Exception {
        AppUser current =
                fixture.saveUser(
                        "history_global_art_current",
                        "전역레드");
        AppUser opponent =
                fixture.saveUser(
                        "history_global_art_opponent",
                        "전역그린");
        UUID gameId =
                GameHistoryTestFixture.id(
                        "global-artwork-disabled");
        Instant startedAt =
                Instant.parse("2026-07-25T08:00:00Z");
        fixture.insertEndedGame(
                gameId,
                current.getId(),
                opponent.getId(),
                COMPLETED,
                PLAYER_LEFT,
                WIN,
                LOSS,
                0,
                startedAt,
                startedAt.plusSeconds(60));

        mockMvc.perform(
                        get(
                                        "/api/v1/games/{gameId}",
                                        gameId)
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath(
                                        "$.answerPokemon"
                                                + ".artworkEnabled")
                                .value(false))
                .andExpect(
                        jsonPath("$.answerPokemon.artworkUrl")
                                .value(nullValue()));
    }

    private RequestPostProcessor authenticated(
            AppUser appUser) {
        AuthenticatedUser user =
                AuthenticatedUser.from(appUser);
        return authentication(
                UsernamePasswordAuthenticationToken.authenticated(
                        user,
                        null,
                        user.getAuthorities()));
    }
}
