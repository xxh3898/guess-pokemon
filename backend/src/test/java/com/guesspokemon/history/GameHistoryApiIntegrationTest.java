package com.guesspokemon.history;

import static com.guesspokemon.game.GameTypes.GameAnswer.YES;
import static com.guesspokemon.game.GameTypes.GameEndReason.BOTH_DISCONNECTED;
import static com.guesspokemon.game.GameTypes.GameEndReason.CORRECT_GUESS;
import static com.guesspokemon.game.GameTypes.GameEndReason.PLAYER_LEFT;
import static com.guesspokemon.game.GameTypes.GameEndReason.QUESTION_LIMIT;
import static com.guesspokemon.game.GameTypes.GameResult.LOSS;
import static com.guesspokemon.game.GameTypes.GameResult.NONE;
import static com.guesspokemon.game.GameTypes.GameResult.WIN;
import static com.guesspokemon.game.GameTypes.GameStatus.ABORTED;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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

@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgreSqlTestContainerConfiguration.class)
@Transactional
class GameHistoryApiIntegrationTest {

    private static final Instant BASE_TIME =
            Instant.parse("2026-07-25T05:00:00Z");

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
    void should_returnFilteredLatestPage_when_participantRequestsHistory()
            throws Exception {
        AppUser current =
                fixture.saveUser(
                        "history_list_current",
                        "레드기록");
        AppUser opponent =
                fixture.saveUser(
                        "history_list_opponent",
                        "그린기록");
        UUID newest = GameHistoryTestFixture.id("history-newest");
        UUID middle = GameHistoryTestFixture.id("history-middle");
        UUID oldest = GameHistoryTestFixture.id("history-oldest");
        UUID active = GameHistoryTestFixture.id("history-active");
        fixture.insertEndedGame(
                newest,
                opponent.getId(),
                current.getId(),
                COMPLETED,
                CORRECT_GUESS,
                LOSS,
                WIN,
                2,
                BASE_TIME,
                BASE_TIME.plusSeconds(300));
        fixture.insertEndedGame(
                middle,
                current.getId(),
                opponent.getId(),
                COMPLETED,
                QUESTION_LIMIT,
                LOSS,
                WIN,
                20,
                BASE_TIME.minusSeconds(600),
                BASE_TIME.minusSeconds(300));
        fixture.insertEndedGame(
                oldest,
                opponent.getId(),
                current.getId(),
                ABORTED,
                BOTH_DISCONNECTED,
                NONE,
                NONE,
                0,
                BASE_TIME.minusSeconds(1200),
                BASE_TIME.minusSeconds(900));
        fixture.insertInProgressGame(
                active,
                current.getId(),
                opponent.getId(),
                BASE_TIME.plusSeconds(600));

        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("size", "2")
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(
                        header()
                                .string(
                                        "Cache-Control",
                                        containsString("no-store")))
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(
                        jsonPath("$.content[0].gameId")
                                .value(newest.toString()))
                .andExpect(
                        jsonPath("$.content[0].myRole")
                                .value("QUESTIONER"))
                .andExpect(
                        jsonPath("$.content[0].myResult")
                                .value("WIN"))
                .andExpect(
                        jsonPath("$.content[0].opponent.id")
                                .value(opponent.getId().toString()))
                .andExpect(
                        jsonPath(
                                        "$.content[0].opponent.nickname")
                                .value("그린기록"))
                .andExpect(
                        jsonPath(
                                        "$.content[0].answerPokemon"
                                                + ".koreanName")
                                .value("피카츄"))
                .andExpect(
                        jsonPath(
                                        "$.content[0].answerPokemon"
                                                + ".types[0]")
                                .value("ELECTRIC"))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2));

        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("result", "WIN")
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(
                        jsonPath("$.content[0].gameId")
                                .value(newest.toString()))
                .andExpect(
                        jsonPath("$.content[0].myResult")
                                .value("WIN"));

        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("result", "LOSS")
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(
                        jsonPath("$.content[0].gameId")
                                .value(middle.toString()))
                .andExpect(
                        jsonPath("$.content[0].myResult")
                                .value("LOSS"));

        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("result", "NONE")
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(
                        jsonPath("$.content[0].gameId")
                                .value(oldest.toString()))
                .andExpect(
                        jsonPath("$.content[0].myResult")
                                .value("NONE"));

        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("page", "1")
                                .queryParam("size", "2")
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(
                        jsonPath("$.content[0].gameId")
                                .value(oldest.toString()));
    }

    @Test
    void should_returnParticipantsAndActions_when_participantRequestsDetail()
            throws Exception {
        AppUser current =
                fixture.saveUser(
                        "history_detail_current",
                        "상세레드");
        AppUser opponent =
                fixture.saveUser(
                        "history_detail_opponent",
                        "상세그린");
        UUID gameId = GameHistoryTestFixture.id("history-detail");
        fixture.insertEndedGame(
                gameId,
                opponent.getId(),
                current.getId(),
                COMPLETED,
                CORRECT_GUESS,
                LOSS,
                WIN,
                2,
                BASE_TIME,
                BASE_TIME.plusSeconds(120));
        fixture.insertAnsweredQuestion(
                gameId,
                current.getId(),
                1,
                "전기 타입인가요?",
                YES,
                "노란색 전기 포켓몬이에요.",
                BASE_TIME.plusSeconds(20),
                BASE_TIME.plusSeconds(24));
        fixture.insertGuess(
                gameId,
                current.getId(),
                2,
                25,
                true,
                BASE_TIME.plusSeconds(120));

        mockMvc.perform(
                        get(
                                        "/api/v1/games/{gameId}",
                                        gameId)
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(
                        header()
                                .string(
                                        "Cache-Control",
                                        containsString("no-store")))
                .andExpect(
                        jsonPath("$.gameId")
                                .value(gameId.toString()))
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(
                        jsonPath("$.answerPokemon.koreanName")
                                .value("피카츄"))
                .andExpect(
                        jsonPath("$.answerPokemon.types[0]")
                                .value("ELECTRIC"))
                .andExpect(
                        jsonPath("$.endReason")
                                .value("CORRECT_GUESS"))
                .andExpect(jsonPath("$.actionCount").value(2))
                .andExpect(
                        jsonPath("$.participants[0].userId")
                                .value(current.getId().toString()))
                .andExpect(
                        jsonPath("$.participants[0].role")
                                .value("QUESTIONER"))
                .andExpect(
                        jsonPath("$.participants[0].result")
                                .value("WIN"))
                .andExpect(
                        jsonPath("$.participants[1].userId")
                                .value(opponent.getId().toString()))
                .andExpect(
                        jsonPath("$.actions[0].sequenceNo")
                                .value(1))
                .andExpect(
                        jsonPath("$.actions[0].question")
                                .value("전기 타입인가요?"))
                .andExpect(
                        jsonPath("$.actions[0].answer")
                                .value("YES"))
                .andExpect(
                        jsonPath("$.actions[0].comment")
                                .value("노란색 전기 포켓몬이에요."))
                .andExpect(
                        jsonPath("$.actions[1].type")
                                .value("GUESS"))
                .andExpect(
                        jsonPath(
                                        "$.actions[1].guessedPokemon"
                                                + ".nationalDexId")
                                .value(25))
                .andExpect(
                        jsonPath(
                                        "$.actions[1].guessedPokemon"
                                                + ".types[0]")
                                .value("ELECTRIC"))
                .andExpect(
                        jsonPath("$.actions[1].correct")
                                .value(true));
    }

    @Test
    void should_keepRecordAndHideArtwork_when_catalogRowIsDisabled()
            throws Exception {
        AppUser current =
                fixture.saveUser(
                        "history_disabled_current",
                        "중단레드");
        AppUser opponent =
                fixture.saveUser(
                        "history_disabled_opponent",
                        "중단그린");
        UUID gameId =
                GameHistoryTestFixture.id(
                        "history-disabled-artwork");
        fixture.insertEndedGame(
                gameId,
                opponent.getId(),
                current.getId(),
                ABORTED,
                BOTH_DISCONNECTED,
                NONE,
                NONE,
                1,
                BASE_TIME,
                BASE_TIME.plusSeconds(60));
        fixture.insertPendingQuestion(
                gameId,
                current.getId(),
                1,
                "날개가 있나요?",
                BASE_TIME.plusSeconds(30));
        fixture.disableAnswerPokemon();

        mockMvc.perform(
                        get(
                                        "/api/v1/games/{gameId}",
                                        gameId)
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ABORTED"))
                .andExpect(
                        jsonPath(
                                        "$.answerPokemon"
                                                + ".artworkEnabled")
                                .value(false))
                .andExpect(
                        jsonPath("$.answerPokemon.artworkUrl")
                                .value(nullValue()))
                .andExpect(
                        jsonPath("$.answerPokemon.types[0]")
                                .value("ELECTRIC"))
                .andExpect(
                        jsonPath("$.participants[0].result")
                                .value("NONE"))
                .andExpect(
                        jsonPath("$.participants[1].result")
                                .value("NONE"))
                .andExpect(
                        jsonPath("$.actions[0].answer")
                                .value(nullValue()))
                .andExpect(
                        jsonPath("$.actions[0].comment")
                                .value(nullValue()))
                .andExpect(
                        jsonPath("$.actions[0].answeredAt")
                                .value(nullValue()));
    }

    @Test
    void should_hideGameExistence_when_requesterIsNotParticipant()
            throws Exception {
        AppUser current =
                fixture.saveUser(
                        "history_auth_current",
                        "인가레드");
        AppUser opponent =
                fixture.saveUser(
                        "history_auth_opponent",
                        "인가그린");
        AppUser outsider =
                fixture.saveUser(
                        "history_auth_outsider",
                        "인가블루");
        UUID gameId = GameHistoryTestFixture.id("history-auth");
        fixture.insertEndedGame(
                gameId,
                current.getId(),
                opponent.getId(),
                COMPLETED,
                PLAYER_LEFT,
                WIN,
                LOSS,
                0,
                BASE_TIME,
                BASE_TIME.plusSeconds(60));

        mockMvc.perform(
                        get(
                                        "/api/v1/games/{gameId}",
                                        gameId)
                                .with(authenticated(outsider)))
                .andExpect(status().isNotFound())
                .andExpect(
                        jsonPath("$.code")
                                .value("GAME_NOT_FOUND"));
        mockMvc.perform(
                        get(
                                        "/api/v1/games/{gameId}",
                                        GameHistoryTestFixture.id(
                                                "missing-history"))
                                .with(authenticated(current)))
                .andExpect(status().isNotFound())
                .andExpect(
                        jsonPath("$.code")
                                .value("GAME_NOT_FOUND"));
    }

    @Test
    void should_rejectRequest_when_historyParametersAreInvalid()
            throws Exception {
        AppUser current =
                fixture.saveUser(
                        "history_validation_current",
                        "검증레드");

        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("result", "DRAW")
                                .with(authenticated(current)))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.code")
                                .value("VALIDATION_FAILED"));
        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("page", "-1")
                                .with(authenticated(current)))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.code")
                                .value("VALIDATION_FAILED"));
        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("page", "one")
                                .with(authenticated(current)))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.code")
                                .value("VALIDATION_FAILED"));
        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("size", "101")
                                .with(authenticated(current)))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.code")
                                .value("VALIDATION_FAILED"));
        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("size", "0")
                                .with(authenticated(current)))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.code")
                                .value("VALIDATION_FAILED"));
        mockMvc.perform(
                        get("/api/v1/games/not-a-uuid")
                                .with(authenticated(current)))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.code")
                                .value("VALIDATION_FAILED"));
    }

    @Test
    void should_acceptBoundarySize_when_historyPageIsRequested()
            throws Exception {
        AppUser current =
                fixture.saveUser(
                        "history_size_current",
                        "크기검증레드");

        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("size", "1")
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(1));
        mockMvc.perform(
                        get("/api/v1/games")
                                .queryParam("size", "100")
                                .with(authenticated(current)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    @Test
    void should_requireAuthentication_when_anonymousUserRequestsHistory()
            throws Exception {
        UUID gameId =
                GameHistoryTestFixture.id(
                        "anonymous-history");

        mockMvc.perform(get("/api/v1/games"))
                .andExpect(status().isUnauthorized())
                .andExpect(
                        jsonPath("$.code")
                                .value("AUTHENTICATION_REQUIRED"));
        mockMvc.perform(
                        get(
                                "/api/v1/games/{gameId}",
                                gameId))
                .andExpect(status().isUnauthorized())
                .andExpect(
                        jsonPath("$.code")
                                .value("AUTHENTICATION_REQUIRED"));
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
